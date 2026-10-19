import { SEARCH_IMAGE_API } from '@/lib/constants';
import type { Announcement, UnreadCountsResponse } from '@/lib/types/message';
import type {
  ProfileUser,
  UserComment,
  UserCommentsResponse,
  UserPost,
  UserPostsResponse,
} from '@/lib/types/user';
import { isProfileId, profileFromWire } from '@/lib/profiles';
import { parseEquippedBadges, parseHeldBadges, type EquippedBadge, type HeldBadge } from '@/lib/userBadges';
import type { Comment, PonyImage } from '@/lib/types/image';
import type { TeamMember } from '@/lib/types/site';
import type { CaptchaChallenge, CaptchaProof, CaptchaPoint } from '@/lib/types/captcha';
import { applyImageLine } from './client';
import { recordBrowsingHistory } from './history';
import { decodeSanitizedText } from '@/lib/sanitizedText';
import { ApiError, isApiError, toApiError } from './errors';
import { api, apiRequest, readApi, readObject, seg } from './http';

/*
 * PicPony's own API — the Rust backend's `/api/v1` resources (`docs/*.md`, `src/pg/*.rs`).
 *
 * Every adapter here is strict: it resolves with a typed value mapped from the backend's DTO, or
 * throws `ApiError` (`api()` turns a non-2xx `{"error":{code,message}}` into one, with `code` and
 * `serverMessage`). Nothing resolves with a failure dressed as data.
 *
 * Writes the backend keys on a receipt (`Idempotency-Key`: comments, reports, dictionary saves,
 * browsing history) carry one; writes with an optimistic version (`expected_revision`) take it from
 * the caller or read it first, as each adapter says.
 */

/** A refusal about this request (a 4xx other than a dead session or a rate limit) — the user's
 *  input or the account's state, which a screen shows beside the field rather than as an outage. */
export function isRefusal(error: unknown, ...codes: string[]): boolean {
  if (!isApiError(error) || error.kind !== 'http' || error.status === undefined) return false;
  if (codes.length) return error.code !== undefined && codes.includes(error.code);
  return error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 408 && error.status !== 429;
}

/** A v4 UUID for the backend's `request_id` fields (serde `Uuid`; `randomId` may not be one). */
export function requestId(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes);
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Read every page of a `{ <key>: [], total_pages }` list (the backend caps a page at 100 rows). */
async function allPages<T>(
  path: string,
  key: string,
  options: { token?: string | null; signal?: AbortSignal; limit?: number; maxPages?: number } = {},
): Promise<T[]> {
  const limit = options.limit ?? 100;
  const rows: T[] = [];
  for (let page = 1; page <= (options.maxPages ?? 50); page += 1) {
    const data = await api<Record<string, unknown> & { total_pages: number }>('GET', path, {
      token: options.token,
      signal: options.signal,
      query: { page, limit },
    });
    rows.push(...(data[key] as T[]));
    if (page >= data.total_pages) break;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Session and accounts (`docs/auth-api.md`, `src/pg/auth.rs`, `src/pg/account.rs`)
// ---------------------------------------------------------------------------

/** What a sign-in (or a confirmed registration) grants: the bearer, its CSRF token, its life. */
export interface SessionGrant {
  token: string;
  csrf_token: string;
  expires_in: number;
}

/** A registration (or a resend) whose code is on its way: `verification` names the request. */
export interface PendingVerification {
  verification: string;
  expires_in?: number;
  retry_after?: number;
  mail?: { status: string };
  message?: string;
}

/** `POST /auth/session` — `account` is a username or an email. Sets the `auth_bind` cookie. */
export async function login(data: { account: string; password: string; captchaProof: string }): Promise<SessionGrant> {
  return api<SessionGrant>('POST', '/auth/session', {
    json: { account: data.account, password: data.password, captcha_proof: data.captchaProof },
  });
}

/** `POST /auth/registrations` — the account exists once this answers; it signs in after its code. */
export async function register(data: {
  username: string;
  email: string;
  password: string;
  captchaProof: string;
}): Promise<PendingVerification> {
  return api<PendingVerification>('POST', '/auth/registrations', {
    json: { username: data.username, email: data.email, password: data.password, captcha_proof: data.captchaProof },
  });
}

/** `POST /auth/email-verifications/{verification}/confirmation` — the code signs the new account in. */
export async function confirmRegistration(verification: string, code: string): Promise<SessionGrant> {
  return api<SessionGrant>('POST', `/auth/email-verifications/${seg(verification)}/confirmation`, { json: { code } });
}

/** `…/resends` — a new code, and a new `verification` (the old one is void). Needs a fresh proof. */
export async function resendRegistrationCode(verification: string, captchaProof: string): Promise<PendingVerification> {
  return api<PendingVerification>('POST', `/auth/email-verifications/${seg(verification)}/resends`, {
    json: { captcha_proof: captchaProof },
  });
}

/** `POST /auth/password-resets` — always 202 with a fresh `verification`, whether or not the address is known. */
export async function resetPasswordRequest(email: string, captchaProof: string): Promise<PendingVerification> {
  return api<PendingVerification>('POST', '/auth/password-resets', {
    json: { email: email.trim(), captcha_proof: captchaProof },
  });
}

/** `PUT /auth/password-resets/{verification}` — every session of the account ends. */
export async function resetPassword(verification: string, data: { code: string; new_password: string }): Promise<void> {
  await api('PUT', `/auth/password-resets/${seg(verification)}`, { json: data });
}

/** Raw on purpose: `sessionUser` reads the status itself, because a 401 is an answer there. */
export async function getUser(token: string, signal?: AbortSignal) {
  return apiRequest('GET', '/me', { token, signal, cache: 'no-store' });
}

/**
 * The `GET /me` record in the shape the stored session keeps (`StoredUserInfo`). The Derpibooru
 * identity is the verified upstream binding (`upstream_identity`, `null` when none is verified),
 * so an empty string there is the backend's word that there is none. The API key itself is never
 * sent back (`docs/auth-api.md`), so `api_key` is absent and the device keeps the one it holds.
 */
export function sessionRecordFromMe(user: MeUser): Record<string, unknown> {
  const identity = user.upstream_identity;
  return {
    id: user.id,
    username: user.username,
    email: user.email ?? '',
    email_verified: user.email_verified,
    role: user.role,
    coins: user.coins,
    experience: user.experience,
    level: Math.floor(user.experience / 100) + 1,
    avatar: user.avatar ?? '',
    banner: user.banner ?? '',
    bio: user.bio,
    gender: user.gender,
    race: user.race,
    birthday: user.birthday,
    created_at: user.created_at,
    profile_revision: user.profile_revision,
    settings: user.settings,
    settings_revision: user.settings_revision,
    derpi_user_id: identity ? String(identity.id) : '',
    derpi_username: identity ? identity.name : '',
    is_developer: user.developer_access.active === true,
    developer_access: user.developer_access,
  };
}

/** `GET /me`'s `user` (`auth::me`). */
export interface MeUser {
  id: number;
  username: string;
  email: string | null;
  email_verified: boolean;
  role: string;
  coins: number;
  experience: number;
  avatar: string | null;
  banner: string | null;
  bio: string;
  gender: string;
  race: string;
  birthday: string | null;
  created_at: string;
  profile_revision: number;
  settings: Record<string, unknown>;
  settings_revision: number;
  upstream_identity: { id: number; name: string } | null;
  developer_access: DeveloperState;
}

/**
 * The user record from a `GET /me` response that was not a 401. An HTTP failure throws — an
 * outage is not an answer about the session, and caching it as one would hold it for the whole TTL.
 */
export async function readSessionUser(res: Response): Promise<Record<string, unknown> | null> {
  const data = await readApi<{ user: MeUser }>(res);
  return sessionRecordFromMe(data.user);
}

/**
 * A public profile (`GET /users/{id}`). An unknown id is the backend's 404 (`USER_NOT_FOUND`) —
 * a `notFound` `ApiError` — and an id that cannot be one is the same answer without asking.
 */
export async function getUserProfile(userId: string, signal?: AbortSignal): Promise<{ success: true; user: ProfileUser }> {
  if (!isProfileId(userId)) throw new ApiError('http', { status: 404 });
  const data = await api<{ user: Parameters<typeof profileFromWire>[0] }>('GET', `/users/${seg(userId)}`, { signal });
  return { success: true, user: profileFromWire(data.user) };
}

/** `PUT /me/username` — versioned on the account's `profile_revision`. */
export async function changeUsername(
  token: string,
  newUsername: string,
  expectedRevision: number,
): Promise<{ username: string; revision: number }> {
  return api('PUT', '/me/username', { token, json: { username: newUsername, expected_revision: expectedRevision } });
}

/** `PUT /me/password` — every session of the account ends, this one included. */
export async function changePassword(token: string, data: { old_password: string; new_password: string }): Promise<void> {
  await api('PUT', '/me/password', { token, json: data });
}

export interface SavedProfile {
  revision: number;
  profile: { bio: string; gender: string; race: string; birthday: string | null };
  settings_revision: number;
  adjustments: { field: string; effective: string; reason: string }[];
}

/** `PUT /me/profile` — the whole profile, versioned on `profile_revision`. An empty birthday is none. */
export async function saveProfile(
  token: string,
  data: { bio: string; gender: string; birthday: string; race: string; expected_revision: number },
): Promise<SavedProfile> {
  return api<SavedProfile>('PUT', '/me/profile', {
    token,
    json: { ...data, birthday: data.birthday || null },
  });
}

/** A stored upload (`media::upload`): `url` is the backend's own path for the asset. */
export interface UploadedMedia {
  asset: string;
  url: string;
}

export async function uploadAvatar(token: string, file: File): Promise<UploadedMedia> {
  const formData = new FormData();
  formData.append('avatar', file);
  return api<UploadedMedia>('POST', '/me/avatar', { token, body: formData });
}

export async function uploadBanner(token: string, file: File): Promise<UploadedMedia> {
  const formData = new FormData();
  formData.append('banner', file);
  return api<UploadedMedia>('POST', '/me/banner', { token, body: formData });
}

// Favourites — folders, the privacy space, the shared routes — live in `lib/api/favorites.ts`.

// ---------------------------------------------------------------------------
// Comments and profile tabs (`src/pg/forum.rs`)
// ---------------------------------------------------------------------------

/**
 * `POST /images/{id}/comments {content, reply_to_user_id}` — a reply quotes what it answers in the
 * body (`[quote="name"]…[/quote]`, written by the composer) and names its author so the backend can
 * tell them; a Derpibooru author has no account here and is sent as `null`. The backend has no
 * reply-to-comment field. The key makes a retried send land once.
 */
export async function postComment(
  token: string,
  imageId: number,
  body: string,
  reply?: { userId?: number | null; commentId?: number | null } | null,
  idempotencyKey: string = requestId(),
): Promise<{ id: number; content: string }> {
  return api('POST', `/images/${seg(imageId)}/comments`, {
    token,
    idempotencyKey,
    json: { content: body, reply_to_user_id: reply?.userId ?? null },
  });
}

/** `DELETE /images/comments/{id}` — the author's own comment, or any, for staff. */
export async function deleteComment(token: string, commentId: number): Promise<void> {
  await api('DELETE', `/images/comments/${seg(commentId)}`, { token });
}

/** An image comment row (`to_jsonb(image_comments) || {author}`). */
interface WireImageComment {
  id: number;
  image_id: number;
  user_id: number;
  content: string;
  created_at: string;
  author: {
    id: number;
    username: string;
    avatar: string | null;
    role: string;
    experience: number;
    equipped_badges: unknown;
  };
}

/**
 * The picture's comments written on PicPony, newest first. The backend pages the thread oldest
 * first; every page is read, so a thread that could not be read is never shown as a shorter one.
 */
export async function getSiteComments(imageId: number, signal?: AbortSignal): Promise<Comment[]> {
  const rows = await allPages<WireImageComment>(`/images/${seg(imageId)}/comments`, 'comments', { signal });
  return rows
    .map((row): Comment => ({
      id: row.id,
      /* Stored through the backend's HTML sanitizer: `&`/`<`/`>` arrive as entities. */
      body: decodeSanitizedText(row.content),
      created_at: row.created_at,
      user_id: row.user_id,
      username: row.author.username,
      avatar: row.author.avatar || null,
      source: 'picpony',
      experience: row.author.experience,
      equipped_badges: parseEquippedBadges(row.author.equipped_badges)
        .map(({ badge_name, badge_color }) => ({ badge_name, badge_color })),
    }))
    .reverse();
}

/**
 * A profile's comments tab. `PROFILE_PRIVATE` (403) is the owner's choice — 重试 cannot change it,
 * and `ApiError` already says so for a 403. `token` lets the owner (or staff) read a tab hidden from
 * visitors. Image comments carry no cover: the backend does not know a Derpibooru picture's preview.
 */
export async function getUserComments(
  userId: string,
  page: number = 1,
  signal?: AbortSignal,
  token?: string | null,
): Promise<UserCommentsResponse> {
  const data = await api<{
    comments: { id: number; target_id: number; content: string; created_at: string; kind: 'image' | 'post' }[];
    total_pages: number;
  }>('GET', `/users/${seg(userId)}/comments`, { token, signal, query: { page }, cache: 'no-store' });
  return {
    comments: data.comments.map((row): UserComment => ({
      id: row.id,
      target_id: row.target_id,
      body: decodeSanitizedText(row.content),
      created_at: row.created_at,
      type: row.kind,
      cover_image: null,
    })),
    total_pages: Math.max(1, data.total_pages),
  };
}

export async function getUserPosts(
  userId: string,
  page: number = 1,
  signal?: AbortSignal,
  token?: string | null,
): Promise<UserPostsResponse> {
  const data = await api<{
    posts: { id: number; title: string; cover_image: string | null; created_at: string; reply_count: number; like_count: number }[];
    total_pages: number;
  }>('GET', `/users/${seg(userId)}/posts`, { token, signal, query: { page }, cache: 'no-store' });
  return {
    posts: data.posts.map((row): UserPost => ({
      id: row.id,
      title: row.title,
      cover_image: row.cover_image,
      created_at: row.created_at,
      reply_count: row.reply_count,
      like_count: row.like_count,
    })),
    total_pages: Math.max(1, data.total_pages),
  };
}

// ---------------------------------------------------------------------------
// The unread badge (the inbox itself is `lib/api/messages.ts`)
// ---------------------------------------------------------------------------

/** `GET /me/unread-counts` — `{messages, notifications, interactions, forum}`: unread private
 *  messages, system notifications, interactions, and forum posts created since the last
 *  `POST /me/forum/read-receipts`. */
export async function getUnreadCounts(token: string, signal?: AbortSignal): Promise<UnreadCountsResponse> {
  return api<UnreadCountsResponse>('GET', '/me/unread-counts', { token, signal });
}

// ---------------------------------------------------------------------------
// Captcha (`src/pg/challenge.rs`), announcements
// ---------------------------------------------------------------------------

/** `POST /auth/challenges {}` — a slider challenge; the browser keeps its `picpony_challenge` cookie. */
export async function captchaGet(): Promise<CaptchaChallenge> {
  const data = await api<{ challenge: CaptchaChallenge }>('POST', '/auth/challenges', { json: {}, cache: 'no-store' });
  return data.challenge;
}

/**
 * `POST /auth/challenges/{id}/verification {x, trace}` — `x` and the trace are in the challenge's
 * own 310px canvas units, the trace's `t` in milliseconds since the drag began. A miss is a 403
 * `CAPTCHA_MISMATCH`; a spent or expired challenge a 410 `CAPTCHA_EXPIRED`.
 */
export async function captchaVerify(challengeId: string, x: number, trace: readonly CaptchaPoint[]): Promise<CaptchaProof> {
  return api<CaptchaProof>('POST', `/auth/challenges/${seg(challengeId)}/verification`, {
    json: { x, trace },
    cache: 'no-store',
  });
}

/** The proof errors that mean "solve another challenge", and nothing else (`docs/auth-api.md`). */
export const CAPTCHA_RETRY_CODES = ['CAPTCHA_REQUIRED', 'CAPTCHA_SESSION_REQUIRED', 'CAPTCHA_EXPIRED'] as const;

/**
 * Announcement bodies are admin-authored HTML, and they are sanitised **here**, once, for every
 * consumer — the backend sanitises on publish as well, but the history pane once rendered them raw
 * while the modal sanitised the same field, a stored-XSS sink on a page every signed-in user opens,
 * in the origin that holds the session token. The sanitiser is behind `import()` so its HTML parser
 * stays out of the route's first chunk. Exported for the history read in `lib/api/messages.ts`.
 */
export async function sanitizeAnnouncements(list: Announcement[]): Promise<Announcement[]> {
  if (list.length === 0) return list;
  const { sanitizeHtml } = await import('@/lib/sanitizeHtml');
  return list.map((item) => ({ ...item, content: sanitizeHtml(item.content) }));
}

/** `GET /announcements/latest` — `{announcement: null}` when nothing has been published. */
export async function getAnnouncement(signal?: AbortSignal): Promise<{ success: true; announcement?: Announcement }> {
  const data = await api<{
    announcement: { id: number; version: string; title: string; content: string; created_at: string } | null;
  }>('GET', '/announcements/latest', { signal });
  if (!data.announcement) return { success: true };
  const { created_at, ...rest } = data.announcement;
  const [announcement] = await sanitizeAnnouncements([{ ...rest, date: created_at }]);
  return { success: true, announcement };
}

// ---------------------------------------------------------------------------
// Account settings
// ---------------------------------------------------------------------------

/** `GET /me/upstream-credential` (`credentials::Stored::projection`). */
export interface UpstreamCredential {
  revision: number;
  has_key: boolean;
  key_hint: string | null;
  encryption_ready: boolean;
  key_available: boolean;
  identity: {
    /** `unbound`, `verified`, `no_activity`, or another verification outcome. */
    status: string;
    id: number | null;
    name: string | null;
    checked_at: string | null;
  };
}

export async function getUpstreamCredential(token: string, signal?: AbortSignal): Promise<UpstreamCredential> {
  return api<UpstreamCredential>('GET', '/me/upstream-credential', { token, signal, cache: 'no-store' });
}

/**
 * Bind (or replace) the Derpibooru API key: `PUT /me/upstream-credential`. The backend verifies the
 * key against Derpibooru itself before storing it (`INVALID_API_KEY` when it refuses), and answers
 * with the identity it found.
 */
export async function saveApikey(
  token: string,
  data: { api_key: string; expected_revision: number },
): Promise<UpstreamCredential> {
  return api<UpstreamCredential>('PUT', '/me/upstream-credential', {
    token,
    json: { request_id: requestId(), expected_revision: data.expected_revision, api_key: data.api_key },
  });
}

/** Ask the backend to check the stored key's owner again (`…/verifications`). */
export async function verifyUpstreamCredential(token: string, expectedRevision: number): Promise<UpstreamCredential> {
  return api<UpstreamCredential>('POST', '/me/upstream-credential/verifications', {
    token,
    json: { request_id: requestId(), expected_revision: expectedRevision },
  });
}

/** Unbind the key (`DELETE /me/upstream-credential`). */
export async function clearUpstreamCredential(token: string, expectedRevision: number): Promise<UpstreamCredential> {
  return api<UpstreamCredential>('DELETE', '/me/upstream-credential', {
    token,
    json: { request_id: requestId(), expected_revision: expectedRevision },
  });
}

/**
 * Replace the account's settings object (`PUT /me/preferences`), versioned on `settings_revision`.
 * A stale revision is a 409 `PREFERENCES_CONFLICT`. The answer is what was stored — the backend can
 * adjust a value it does not allow (the content filter), and says which in `adjustments`.
 */
export async function updateSettings(
  token: string,
  data: { settings: Record<string, unknown>; expected_revision: number },
): Promise<{ settings: Record<string, unknown>; revision: number; adjustments: { field: string; effective: string; reason: string }[] }> {
  return api('PUT', '/me/preferences', { token, json: data });
}

/**
 * Begin changing the account's address (`POST /me/email-changes`): a code goes to the new address,
 * and the old one stays bound until it is confirmed. Asking again (with the password) is the resend.
 */
export async function updateEmail(
  token: string,
  data: { new_email: string; current_password: string },
): Promise<PendingVerification> {
  return api<PendingVerification>('POST', '/me/email-changes', { token, json: data });
}

/** Confirm an address change with its code — from the session that asked for it. */
export async function confirmEmailChange(
  token: string,
  verification: string,
  code: string,
): Promise<{ email_changed: true; email: string; already_completed?: boolean }> {
  return api('POST', `/me/email-changes/${seg(verification)}/confirmation`, { token, json: { code } });
}

/** `POST /images/{id}/reports {reason}` — one report per user and picture (a duplicate is a 409). */
export async function reportImage(token: string, imageId: number, reason: string): Promise<void> {
  await api('POST', `/images/${seg(imageId)}/reports`, { token, idempotencyKey: requestId(), json: { reason } });
}

/**
 * 以图搜图, through the search engine's own endpoint (not PicPony's API). Its results are
 * Derpibooru rows, so they are put on the current image line like every other image-bearing
 * response — the forced line reached every list except this one.
 */
export async function searchImage(imageFile: File, distance: number, signal?: AbortSignal) {
  const formData = new FormData();
  formData.append('imageFile', imageFile);
  formData.append('distance', distance.toString());

  let response: Response;
  try {
    response = await fetch(SEARCH_IMAGE_API, { method: 'POST', body: formData, signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw toApiError(error);
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new ApiError('http', { status: response.status });
  }
  const data = await readObject<Record<string, unknown>>(response);
  if (Array.isArray(data.images)) {
    data.images = (data.images as PonyImage[]).filter((row) => row && typeof row === 'object').map(applyImageLine);
  }
  return data;
}

// ---------------------------------------------------------------------------
// History, badges
// ---------------------------------------------------------------------------

/**
 * Record a picture in the browsing history, as the original front end did on opening the detail —
 * the history module's versioned write (`recordBrowsingHistory`, `PUT /me/browsing-history/{id}`),
 * which shares its revision and queue with the history screen's own writes.
 */
export async function addBrowsingHistory(
  token: string,
  params: { image_id: number; preview_url: string; uploader: string },
): Promise<void> {
  await recordBrowsingHistory(token, { imageId: params.image_id, previewUrl: params.preview_url, uploader: params.uploader });
}

/**
 * `GET /me/badges`' worn set as the backend spells it (`{id, name, color, expires_at, position}`,
 * in order) — what the session record keeps as `equipped_badges`, read by `parseEquippedBadges`
 * (the level card). `GET /me` carries no badges, so the session read asks for this beside it.
 */
export async function getMyEquippedBadges(token: string, signal?: AbortSignal): Promise<unknown[]> {
  const data = await api<{ equipped: unknown[] }>('GET', '/me/badges', { token, signal, cache: 'no-store' });
  return data.equipped;
}

/**
 * The signed-in user's own badges and the set they wear — what the profile's 管理佩戴 dialog edits
 * (`GET /me/badges`: `{badges, equipped}`, each row `{id, name, color, expires_at}`).
 */
export async function getMyBadges(
  token: string,
  signal?: AbortSignal,
): Promise<{ badges: HeldBadge[]; equipped: EquippedBadge[] }> {
  const data = await api<{ badges: unknown; equipped: unknown }>('GET', '/me/badges', { token, signal, cache: 'no-store' });
  return { badges: parseHeldBadges(data.badges), equipped: parseEquippedBadges(data.equipped) };
}

/**
 * Replace the worn set (`PUT /me/badges/equipment {badge_ids}`, in order; an empty list takes every
 * badge off). Only owned, unexpired badges are accepted (`BADGE_NOT_OWNED`).
 */
export async function equipBadges(token: string, badges: readonly EquippedBadge[]): Promise<void> {
  const ids = badges.map((badge) => badge.id).filter((id): id is number => typeof id === 'number');
  if (ids.length !== badges.length) throw new ApiError('invalid');
  await api('PUT', '/me/badges/equipment', { token, json: { badge_ids: ids } });
}

/**
 * The badge dictionary — every badge's description, by name (`GET /badges/dictionary`, public). A
 * badge the administrator has not described has no entry, and the wall says 暂无简介.
 */
export async function getBadgeDictionary(signal?: AbortSignal): Promise<Record<string, string>> {
  const data = await api<{ dictionary: { name: string; description: string }[] }>('GET', '/badges/dictionary', { signal });
  const dictionary: Record<string, string> = {};
  for (const row of data.dictionary) {
    const description = row.description.trim();
    if (description) dictionary[row.name] = description;
  }
  return dictionary;
}

// ---------------------------------------------------------------------------
// Dictionary (`src/pg/dictionary.rs`, `src/pg/dictionary_feedback.rs`)
// ---------------------------------------------------------------------------

/* The glossary console's `get_glossary_entries` / `create_` / `update_` / `delete_glossary_entry`
   have no route on the Rust backend and had no caller here; their adapters are gone. */

/** A dictionary row as the editor and the tag dialog read it. */
export interface DictionaryRow {
  id: number;
  en: string;
  cn: string;
  cat: string;
  count: number;
  description: string;
  aliases: string[];
  restricted: boolean;
  /** The row's version — a save must name it (`expected_revision`). */
  revision: number;
  last_editor: string | null;
  updated_at: string;
  [key: string]: unknown;
}

interface WireDictionaryTag {
  id: number;
  en: string;
  cn: string;
  aliases: string[];
  category: string;
  search_count: number;
  description: string;
  restricted: boolean;
  revision: number;
  last_editor: string | null;
  updated_at: string;
  [key: string]: unknown;
}

function dictionaryRow(row: WireDictionaryTag): DictionaryRow {
  const { category, search_count, ...rest } = row;
  return { ...rest, cat: category, count: search_count };
}

/** The editor's statistics block (page 1 of an unfiltered-size list). */
export interface DictionaryStats {
  total: number;
  translated: number;
  leaderboard: { user_id: number; username: string; count: number }[];
}

export interface DictionaryResult {
  success: true;
  tags: DictionaryRow[];
  total_matches?: number;
  stats?: DictionaryStats;
}

/** `GET /dictionary/tags` — public. The two filters are booleans (`untranslated=true`). */
export async function getDictionary(
  token: string,
  params: {
    page?: number;
    limit?: number;
    keyword?: string;
    sort?: string;
    category?: string;
    untranslated?: number | boolean;
    wiki_overlap?: number | boolean;
  },
  signal?: AbortSignal,
): Promise<DictionaryResult> {
  const data = await api<{ tags: WireDictionaryTag[]; total_matches: number | null; stats: DictionaryStats | null }>(
    'GET',
    '/dictionary/tags',
    {
      token,
      signal,
      cache: 'no-store',
      query: {
        page: params.page || undefined,
        limit: params.limit || undefined,
        keyword: params.keyword || undefined,
        sort: params.sort || undefined,
        category: params.category || undefined,
        untranslated: params.untranslated ? true : undefined,
        wiki_overlap: params.wiki_overlap ? true : undefined,
      },
    },
  );
  return {
    success: true,
    tags: data.tags.map(dictionaryRow),
    total_matches: data.total_matches ?? undefined,
    stats: data.stats ?? undefined,
  };
}

/** `POST /dictionary/translations` — keys are lower-cased tag names; untranslated ones are absent. */
export async function getTagTranslations(tags: string[]): Promise<{
  success: true;
  translations: Record<string, string>;
  categories: Record<string, string>;
}> {
  const data = await api<{ translations: Record<string, string>; categories: Record<string, string> }>(
    'POST',
    '/dictionary/translations',
    { json: { tags } },
  );
  return { success: true, ...data };
}

/**
 * `POST /dictionary/feedback {tag, content}` — a report on a tag's glossary entry (a wrong
 * translation, a missing one), which lands in the glossary console's feedback panel. A suggested
 * translation is appended to the content on a line of its own, as the original front end wrote it.
 * Anonymous reports are allowed; a signed-in one is attributed.
 */
export async function submitTagFeedback(
  token: string | null,
  { tagName, reason, translation }: { tagName: string; reason: string; translation?: string },
): Promise<void> {
  const suggestion = translation?.trim();
  const content = suggestion ? `${reason.trim()}\n建议的正确翻译：${suggestion}` : reason.trim();
  await api('POST', '/dictionary/feedback', { token, json: { tag: tagName, content } });
}

/** `GET /me/developer-access` (`developer::projection`). */
export interface DeveloperState {
  user_id: number;
  revision: number;
  enabled: boolean;
  active: boolean;
  banned: boolean;
  source: string | null;
  maintenance_generation: number;
  maintenance_expires_at: string | null;
  inactive_reason: string | null;
  attempts: number;
  locked_until: string | null;
  retry_after: number;
  prerequisites: { api_bound: boolean; level_gt_3: boolean; current_level: number };
}

/** 开发者模式状态. `is_developer` is the *effective* access (`active`), not the stored flag. */
export async function getDeveloperStatus(
  token: string,
  signal?: AbortSignal,
): Promise<{
  success: true;
  is_developer: boolean;
  is_developer_banned: boolean;
  prerequisites: { logged_in?: boolean; api_bound?: boolean; level_gt_3?: boolean };
  state: DeveloperState;
}> {
  const state = await api<DeveloperState>('GET', '/me/developer-access', { token, signal, cache: 'no-store' });
  return {
    success: true,
    is_developer: state.active,
    is_developer_banned: state.banned,
    prerequisites: { logged_in: true, ...state.prerequisites },
    state,
  };
}

/**
 * 输入 8 位维护密码开启开发者模式 (`PUT /me/developer-access/grant`). The write names the access
 * revision and the maintenance code's generation, both read first.
 */
export async function enableDeveloperMode(token: string, password: string): Promise<DeveloperState> {
  const state = await api<DeveloperState>('GET', '/me/developer-access', { token, cache: 'no-store' });
  return api<DeveloperState>('PUT', '/me/developer-access/grant', {
    token,
    json: {
      request_id: requestId(),
      expected_revision: state.revision,
      expected_generation: state.maintenance_generation,
      password,
    },
  });
}

/** 关闭开发者模式 (`DELETE /me/developer-access/grant`). */
export async function disableDeveloperMode(token: string): Promise<DeveloperState> {
  const state = await api<DeveloperState>('GET', '/me/developer-access', { token, cache: 'no-store' });
  return api<DeveloperState>('DELETE', '/me/developer-access/grant', {
    token,
    json: { request_id: requestId(), expected_revision: state.revision },
  });
}

/** `GET /editor/dictionary/duplicates` — every row whose English name another row shares. */
export async function getDictionaryDuplicates(token: string, signal?: AbortSignal): Promise<DictionaryResult> {
  const data = await api<{ tags: WireDictionaryTag[]; total_matches: number }>('GET', '/editor/dictionary/duplicates', {
    token,
    signal,
    cache: 'no-store',
    query: { limit: 200 },
  });
  return { success: true, tags: data.tags.map(dictionaryRow), total_matches: data.total_matches };
}

/**
 * Create (`POST /editor/dictionary/tags`) or update (`PUT …/{id}`, naming the row's `revision`) a
 * dictionary row. `restricted` is part of the row and is written whole: pass the row's own value.
 */
export async function saveDictionaryTag(
  token: string,
  data: {
    id?: number;
    revision?: number;
    cn: string;
    en: string;
    aliases: string[];
    cat: string;
    count: number;
    description: string;
    restricted?: boolean;
  },
): Promise<{ id: number; revision: number }> {
  const body = {
    en: data.en,
    cn: data.cn,
    aliases: data.aliases,
    category: data.cat,
    search_count: data.count,
    description: data.description,
    restricted: data.restricted ?? false,
    expected_revision: data.id ? data.revision : undefined,
  };
  if (data.id && typeof data.revision !== 'number') throw new ApiError('invalid', { message: '标签版本未知，请刷新后重试' });
  return data.id
    ? api('PUT', `/editor/dictionary/tags/${seg(data.id)}`, { token, idempotencyKey: requestId(), json: body })
    : api('POST', '/editor/dictionary/tags', { token, idempotencyKey: requestId(), json: body });
}

export async function deleteDictionaryTag(token: string, id: number): Promise<void> {
  await api('DELETE', `/editor/dictionary/tags/${seg(id)}`, { token });
}

/* `get_dictionary_leaderboard` (`GET /dictionary/contributors`) has no adapter here on purpose. The
   original console's 词库贡献排行榜 查看全部 has no counterpart in 词库编辑 yet; add it back beside
   the UI that reads it. */

/** One edit of a dictionary row, flattened from its snapshot for the history list. */
export interface DictionaryHistoryRow {
  id: number;
  operation: 'create' | 'update' | 'delete';
  editor_username: string;
  created_at: string;
  en_name: string;
  cn_name: string;
  aliases: string[];
  category: string;
  search_count: number;
  description: string;
}

/** 获取某个词库标签的编辑历史（按时间倒序），最新的 100 条。 */
export async function getDictionaryTagHistory(
  token: string,
  tagId: number,
  signal?: AbortSignal,
): Promise<{ success: true; history: DictionaryHistoryRow[] }> {
  const data = await api<{
    history: {
      id: number;
      operation: DictionaryHistoryRow['operation'];
      editor_username: string;
      created_at: string;
      snapshot: WireDictionaryTag;
    }[];
  }>('GET', `/editor/dictionary/tags/${seg(tagId)}/history`, { token, signal, cache: 'no-store', query: { limit: 100 } });
  return {
    success: true,
    history: data.history.map((row) => ({
      id: row.id,
      operation: row.operation,
      editor_username: row.editor_username,
      created_at: row.created_at,
      en_name: row.snapshot.en,
      cn_name: row.snapshot.cn,
      aliases: row.snapshot.aliases,
      category: row.snapshot.category,
      search_count: row.snapshot.search_count,
      description: row.snapshot.description,
    })),
  };
}

/** The 运营团队 list for /about (`GET /team-members`, public) — every page, in the roster's order. */
export async function getTeamMembers(signal?: AbortSignal): Promise<{ success: true; members: TeamMember[] }> {
  return { success: true, members: await allPages<TeamMember>('/team-members', 'members', { signal }) };
}
