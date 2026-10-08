import { SEARCH_IMAGE_API } from '@/lib/constants';
import { backendTimeValue } from '@/lib/format';
import type { Announcement, UnreadCountsResponse } from '@/lib/types/message';
import type {
  ProfileUser,
  UserComment,
  UserCommentsResponse,
  UserPost,
  UserPostsResponse,
} from '@/lib/types/user';
import { isProfileId } from '@/lib/profiles';
import { parseEquippedBadges, parseHeldBadges, type EquippedBadge, type HeldBadge } from '@/lib/userBadges';
import type { Comment, PonyImage } from '@/lib/types/image';
import type { TeamMember } from '@/lib/types/site';
import type { CaptchaGetResponse, CaptchaVerifyResponse } from '@/lib/types/captcha';
import { applyImageLine } from './client';
import { ApiError, FAILURE_MESSAGES, toApiError } from './errors';
import {
  envelopeMessage,
  listOf,
  pageCount,
  picponyPostJson,
  picponyRequest,
  readEnvelope,
  readJson,
} from './http';

/*
 * PicPony's own API. Two kinds of read live here, and the difference is deliberate:
 *
 * - **Strict reads** (`readEnvelope`) resolve with a typed, normalised payload or throw
 *   `ApiError` — for HTTP failures, unreadable bodies and `success: false` alike. Everything the
 *   resource catalogue (`lib/resources.ts`) reads is one of these, so no cached answer can be a
 *   failure dressed as an empty list.
 * - **Envelope reads** resolve with `{ success, message?, …lists }` for screens that still branch
 *   on `success` themselves (the dictionary tools, the captcha). Their list fields are
 *   normalised too — **always arrays**, empty on a failure — so no setter downstream can receive
 *   `undefined`. A transport failure still throws (`ApiError`), as every request does.
 *
 * Mutations return the raw `Response`, and their callers decode it with `readJson`.
 *
 * The inbox and direct messages (announcement history, notifications, contacts, conversations,
 * user search, sending) are strict reads of their own in `lib/api/messages.ts`.
 */

/** Only objects survive into a list — a `null` row would crash the first `.id` read. */
function rows<T>(value: unknown): T[] {
  return listOf<unknown>(value).filter((row): row is T => row !== null && typeof row === 'object');
}

/** A whole number read off the wire, or `fallback`. */
function count(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** The failure half of an envelope read, with the backend's own words when it sent any. */
function failure(data: unknown): { success: false; message?: string } {
  return { success: false, message: envelopeMessage(data) };
}

/**
 * Whether an envelope read succeeded *with* the list it exists to deliver. A success without
 * its list is not an empty list — "暂无公告" over a partial response would be a claim nobody
 * made — so it reads as a failure the screen can retry.
 */
function listed(data: unknown, field: string): data is Record<string, unknown> {
  return Boolean(data) && (data as { success?: unknown }).success === true &&
    Array.isArray((data as Record<string, unknown>)[field]);
}

const INVALID = { success: false as const, message: FAILURE_MESSAGES.invalid };

/**
 * A refusal from a public profile tab (`success: false` on a 200) is the owner's choice — a
 * hidden folder, a hidden tab — and pressing 重试 cannot change it. Transient failures arrive
 * as HTTP errors instead. `retryable: false` lets the screen show the server's sentence as an
 * empty state rather than an error with a button that cannot work.
 */
async function readProfileTab<T extends object>(res: Response): Promise<T & { success: true }> {
  try {
    return await readEnvelope<T>(res);
  } catch (error) {
    if (error instanceof ApiError && error.kind === 'envelope') {
      throw new ApiError('envelope', { status: error.status, serverMessage: error.serverMessage, retryable: false });
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Session and accounts
// ---------------------------------------------------------------------------

export async function login(data: Record<string, unknown>) {
  return picponyPostJson('login', data);
}

export async function register(data: Record<string, unknown>) {
  return picponyPostJson('register', data);
}

/** Raw on purpose: `sessionUser` reads the status itself, because a 401 is an answer there. */
export async function getUser(token: string, signal?: AbortSignal) {
  return picponyRequest('get_user', { token, signal });
}

/**
 * The user record from a `get_user` response that was not a 401. An HTTP failure throws — an
 * outage is not an answer about the session, and caching it as one would hold it for the whole
 * TTL. A 200 whose body is empty or unusable (a dropped PHP session, a proxy hiccup) is `null`:
 * the stored session is left as it is.
 */
export async function readSessionUser(res: Response): Promise<Record<string, unknown> | null> {
  if (!res.ok) {
    void res.body?.cancel().catch(() => {});
    throw new ApiError('http', { status: res.status });
  }
  const data = await readJson(res);
  return data?.success === true && data.user && typeof data.user === 'object'
    ? data.user as Record<string, unknown>
    : null;
}

/**
 * A public profile. An unknown id is answered with an HTML 404 — a `notFound` `ApiError` — and an
 * id that cannot be one (not a positive integer) is the same answer without asking.
 */
export async function getUserProfile(userId: string, signal?: AbortSignal): Promise<{ success: true; user: ProfileUser }> {
  if (!isProfileId(userId)) throw new ApiError('http', { status: 404 });
  const data = await readEnvelope<{ user?: unknown }>(
    await picponyRequest('get_user_profile', { query: { user_id: userId }, signal }),
  );
  const user = data.user as ProfileUser | undefined;
  if (!user || typeof user !== 'object' || typeof user.username !== 'string') throw new ApiError('invalid');
  return { success: true, user };
}

export async function changeUsername(token: string, newUsername: string) {
  return picponyPostJson('change_username', { new_username: newUsername }, { token });
}

export async function changePassword(token: string, data: Record<string, unknown>) {
  return picponyPostJson('change_password', data, { token });
}

export async function saveProfile(
  token: string,
  data: {
    bio?: string;
    gender?: string;
    birthday?: string;
    race?: string;
  },
) {
  return picponyPostJson('save_profile', data, { token });
}

export async function uploadAvatar(token: string, file: File) {
  const formData = new FormData();
  formData.append('avatar', file);
  return picponyRequest('upload_avatar', { token, method: 'POST', body: formData });
}

export async function uploadBanner(token: string, file: File) {
  const formData = new FormData();
  formData.append('banner', file);
  return picponyRequest('upload_banner', { token, method: 'POST', body: formData });
}

// Favourites — folders, the privacy space, the shared routes — live in `lib/api/favorites.ts`.

// ---------------------------------------------------------------------------
// Comments and profile tabs
// ---------------------------------------------------------------------------

/**
 * `post_comment {image_id, body, reply_to_user_id, reply_to_comment_id}` — the original front
 * end's body. A reply quotes what it answers in the body (`[quote="name"]…[/quote]`, written by
 * the composer) and names the comment and, for a PicPony author, the person, so the backend can
 * tell them they were answered; a Derpibooru author has no account here and is sent as 0.
 */
export async function postComment(
  token: string,
  imageId: number,
  body: string,
  reply?: { userId?: number | null; commentId?: number | null } | null,
) {
  return picponyPostJson('post_comment', {
    image_id: imageId,
    body,
    reply_to_user_id: reply?.userId ?? 0,
    reply_to_comment_id: reply?.commentId ?? null,
  }, { token });
}

/** `delete_comment {comment_id}` — the author's own PicPony comment, or any, for staff. */
export async function deleteComment(token: string, commentId: number) {
  return picponyPostJson('delete_comment', { comment_id: commentId }, { token });
}

/** A PicPony comment's equipped badges arrive as a JSON string; only well-formed ones survive. */
function commentBadges(value: unknown): { badge_name: string; badge_color: string }[] {
  let list: unknown = value;
  if (typeof value === 'string') {
    try {
      list = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return listOf<Record<string, unknown>>(list)
    .filter((badge) => badge && typeof badge.badge_name === 'string' && badge.badge_name.trim())
    .map((badge) => ({
      badge_name: String(badge.badge_name).trim(),
      badge_color: typeof badge.badge_color === 'string' ? badge.badge_color : '',
    }));
}

/**
 * The picture's comments written on PicPony (`get_comments`), newest first. The whole thread in
 * one answer — the backend does not page it. A strict read: a failure throws, so a thread that
 * could not be read is never shown as one with no comments.
 */
export async function getSiteComments(imageId: number, signal?: AbortSignal): Promise<Comment[]> {
  const data = await readEnvelope<{ comments?: unknown }>(
    await picponyRequest('get_comments', { query: { image_id: imageId }, signal }),
  );
  if (!Array.isArray(data.comments)) throw new ApiError('invalid');
  return rows<Record<string, unknown>>(data.comments)
    .filter((row) => Number.isSafeInteger(Number(row.id)))
    .map((row): Comment => ({
      id: Number(row.id),
      body: typeof row.body === 'string' ? row.body : '',
      created_at: typeof row.created_at === 'string' ? row.created_at : '',
      user_id: Number.isSafeInteger(Number(row.user_id)) && Number(row.user_id) > 0 ? Number(row.user_id) : null,
      username: typeof row.username === 'string' && row.username.trim() ? row.username : '匿名用户',
      avatar: typeof row.avatar === 'string' && row.avatar ? row.avatar : null,
      source: 'picpony',
      experience: Number.isFinite(Number(row.experience)) ? Number(row.experience) : undefined,
      equipped_badges: commentBadges(row.equipped_badges),
    }))
    .sort((a, b) => backendTimeValue(b.created_at) - backendTimeValue(a.created_at));
}

export async function getUserComments(
  userId: string,
  page: number = 1,
  signal?: AbortSignal,
): Promise<UserCommentsResponse & { success: true }> {
  const data = await readProfileTab<{ comments?: unknown; total_pages?: unknown }>(
    await picponyRequest('get_user_comments', { query: { user_id: userId, page }, cache: 'no-store', signal }),
  );
  return { success: true, comments: rows<UserComment>(data.comments), total_pages: pageCount(data.total_pages) };
}

export async function getUserPosts(
  userId: string,
  page: number = 1,
  signal?: AbortSignal,
): Promise<UserPostsResponse & { success: true }> {
  const data = await readProfileTab<{ posts?: unknown; total_pages?: unknown }>(
    await picponyRequest('get_user_posts', { query: { user_id: userId, page }, cache: 'no-store', signal }),
  );
  return { success: true, posts: rows<UserPost>(data.posts), total_pages: pageCount(data.total_pages) };
}

// ---------------------------------------------------------------------------
// Forum — the whole contract is `lib/api/forum.ts`
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The unread badge (the inbox itself is `lib/api/messages.ts`)
// ---------------------------------------------------------------------------

export async function getUnreadCounts(token: string, signal?: AbortSignal): Promise<UnreadCountsResponse & { success: true }> {
  const data = await readEnvelope<Record<string, unknown>>(
    await picponyRequest('get_unread_counts', { token, signal }),
  );
  return {
    success: true,
    unread_messages: Math.max(0, count(data.unread_messages)),
    unread_notifications: Math.max(0, count(data.unread_notifications)),
    unread_interactions: Math.max(0, count(data.unread_interactions)),
    total_unread: Math.max(0, count(data.total_unread)),
  };
}

// ---------------------------------------------------------------------------
// Captcha, announcements
// ---------------------------------------------------------------------------

export async function captchaGet(): Promise<CaptchaGetResponse> {
  const res = await picponyRequest('captcha_get', { cache: 'no-store' });
  return readJson(res);
}

export async function captchaVerify(x: number, track?: string): Promise<CaptchaVerifyResponse> {
  const body: Record<string, unknown> = { x };
  if (track) body.track = track;
  const res = await picponyPostJson('captcha_verify', body, { cache: 'no-store' });
  return readJson(res);
}

/**
 * Announcement bodies are admin-authored HTML, and they are sanitised **here**, once, for every
 * consumer — the history pane once rendered them raw while the modal sanitised the same field,
 * a stored-XSS sink on a page every signed-in user opens, in the origin that holds the session
 * token. The sanitiser is behind `import()` so its HTML parser stays out of the route's first
 * chunk; it is only fetched once a response actually carries HTML. Exported for the history
 * read in `lib/api/messages.ts`, so the two announcement reads share one sanitising path.
 */
export async function sanitizeAnnouncements(list: Announcement[]): Promise<Announcement[]> {
  if (list.length === 0) return list;
  const { sanitizeHtml } = await import('@/lib/sanitizeHtml');
  return list.map((item) => ({
    ...item,
    title: typeof item.title === 'string' ? item.title : '',
    content: typeof item.content === 'string' ? sanitizeHtml(item.content) : '',
  }));
}

export async function getAnnouncement(signal?: AbortSignal): Promise<{ success: boolean; message?: string; announcement?: Announcement }> {
  const data = await readJson(await picponyRequest('get_announcement', { signal }));
  if (data?.success !== true) return failure(data);
  if (!data.announcement || typeof data.announcement !== 'object') return { success: true };
  const [announcement] = await sanitizeAnnouncements([data.announcement as Announcement]);
  return { success: true, announcement };
}

// ---------------------------------------------------------------------------
// Account settings
// ---------------------------------------------------------------------------

export async function saveApikey(
  token: string,
  data: { api_key: string; derpi_user_id: string; derpi_username: string },
) {
  return picponyPostJson('save_apikey', data, { token });
}

export async function updateSettings(token: string, data: Record<string, unknown>) {
  return picponyPostJson('update_settings', data, { token });
}

/**
 * Change the account's address. The original front end sent `{ current_password, new_email }`;
 * this app's `email` rides beside them, so either reading of the action finds its field.
 */
export async function updateEmail(
  token: string,
  data: { email: string; new_email: string; current_password: string },
) {
  return picponyPostJson('update_email', data, { token });
}

/**
 * The signed-in account's own verification. Both actions read `user_id`, which is the only way
 * the original front end ever called them (its registration step sent `{ user_id }` and
 * `{ user_id, code }`). Sent with the token alone, the backend answered 参数不完整. The token
 * still rides along for the session check; `user_id` is the field the action reads.
 */
export async function verifyEmail(token: string, userId: number, code: string) {
  return picponyPostJson('verify_email', { user_id: userId, code }, { token });
}

export async function resendVerifyCode(token: string, userId: number) {
  return picponyPostJson('resend_verify_code', { user_id: userId }, { token });
}

export async function verifyEmailById(userId: number, code: string) {
  return picponyPostJson('verify_email', { user_id: userId, code });
}

export async function resendVerifyCodeById(userId: number) {
  return picponyPostJson('resend_verify_code', { user_id: userId });
}

export async function reportImage(token: string, imageId: number, reason: string) {
  return picponyPostJson('report_image', { image_id: imageId, reason }, { token });
}

/**
 * The account a reset is for, in the shape the backend reads: `account` is the value as typed —
 * a username or an email address, which is the contract the original front end sent and the live
 * backend answers — and `email` is added when the value is an address, a harmless extra key that
 * keeps a newer address-only path working too.
 */
function resetAccountBody(account: string): Record<string, string> {
  const value = account.trim();
  return value.includes('@') ? { account: value, email: value } : { account: value };
}

/** Send a reset code to the registered address of `account` (a username or an email). */
export async function resetPasswordRequest(account: string) {
  return picponyPostJson('reset_password_request', resetAccountBody(account));
}

export async function resetPassword(data: { account: string; code: string; new_password: string }) {
  return picponyPostJson('reset_password', {
    ...resetAccountBody(data.account),
    code: data.code,
    new_password: data.new_password,
  });
}

/**
 * 以图搜图, through the search engine's own endpoint. Its results are Derpibooru rows, so they
 * are put on the current image line like every other image-bearing response — the forced line
 * reached every list except this one.
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
  const data = await readJson(response);
  if (Array.isArray(data.images)) {
    data.images = rows<PonyImage>(data.images).map(applyImageLine);
  }
  return data;
}

// ---------------------------------------------------------------------------
// History, tasks, badges, privacy — strict reads
// ---------------------------------------------------------------------------

/** 记录浏览历史（打开图片详情时调用，与完整版前端 add_browsing_history 一致） */
export async function addBrowsingHistory(
  token: string,
  params: { image_id: number; preview_url: string; uploader: string },
) {
  return picponyPostJson('add_browsing_history', params, { token });
}

/**
 * The signed-in user's own badges and the set they wear — what the profile's 管理佩戴 dialog
 * edits. A row's expiry comes from the row, or from `badge_expires` (name → stamp), which the
 * original front end read for the same purpose.
 */
export async function getMyBadges(
  token: string,
  signal?: AbortSignal,
): Promise<{ badges: HeldBadge[]; equipped: EquippedBadge[] }> {
  const data = await readEnvelope<{ badges?: unknown; equipped_badges?: unknown; badge_expires?: unknown }>(
    await picponyRequest('get_my_badges', { token, query: { _t: Date.now() }, signal }),
  );
  const expires = data.badge_expires && typeof data.badge_expires === 'object'
    ? data.badge_expires as Record<string, unknown>
    : {};
  const badges = parseHeldBadges(data.badges).map((badge) => {
    const stamp = expires[badge.name];
    return badge.expiresAt || typeof stamp !== 'string' || !stamp.trim()
      ? badge
      : { ...badge, expiresAt: stamp.trim() };
  });
  return { badges, equipped: parseEquippedBadges(data.equipped_badges) };
}

/**
 * Replace the worn set (the original front end's contract: the whole list, at most three, each
 * `{ badge_name, badge_color }`; an empty list takes every badge off). Throws `ApiError` on any
 * refusal — the backend's sentence, when it sent one, is the message.
 */
export async function equipBadges(token: string, badges: readonly EquippedBadge[]): Promise<void> {
  await readEnvelope(
    await picponyPostJson(
      'equip_badge',
      { equipped_badges: badges.map(({ badge_name, badge_color }) => ({ badge_name, badge_color })) },
      { token },
    ),
  );
}

/**
 * The badge dictionary — every badge's description, by name (`get_all_badge_dict`, public). A
 * badge the administrator has not described has no entry, and the wall says 暂无简介.
 */
export async function getBadgeDictionary(signal?: AbortSignal): Promise<Record<string, string>> {
  const data = await readEnvelope<{ dicts?: unknown }>(
    await picponyRequest('get_all_badge_dict', { signal }),
  );
  if (!Array.isArray(data.dicts)) throw new ApiError('invalid');
  const dictionary: Record<string, string> = {};
  for (const row of rows<{ badge_name?: unknown; description?: unknown }>(data.dicts)) {
    const name = typeof row.badge_name === 'string' ? row.badge_name.trim() : '';
    const description = typeof row.description === 'string' ? row.description.trim() : '';
    if (name && description) dictionary[name] = description;
  }
  return dictionary;
}

// ---------------------------------------------------------------------------
// Glossary and dictionary — envelope reads for the editor tools
// ---------------------------------------------------------------------------

export async function getGlossaryEntries(
  token: string,
  signal?: AbortSignal,
): Promise<{ success: true; entries: Record<string, unknown>[] }> {
  const data = await readEnvelope<{ entries?: unknown }>(
    await picponyRequest('get_glossary_entries', { token, signal }),
  );
  return { success: true, entries: rows<Record<string, unknown>>(data.entries) };
}

export async function createGlossaryEntry(
  token: string,
  data: { term: string; definition: string },
) {
  return picponyPostJson('create_glossary_entry', data, { token });
}

export async function updateGlossaryEntry(
  token: string,
  id: number,
  data: { term: string; definition: string },
) {
  return picponyPostJson('update_glossary_entry', { id, ...data }, { token });
}

export async function deleteGlossaryEntry(token: string, id: number) {
  return picponyPostJson('delete_glossary_entry', { id }, { token });
}

/** A dictionary row as the editor and the tag dialog read it. */
export interface DictionaryRow {
  id: number;
  en: string;
  cn: string;
  cat: string;
  count: number;
  description: string;
  aliases: string[];
  [key: string]: unknown;
}

/** `en`/`cn` always strings, so a null field cannot throw inside a `toLowerCase()`. */
function dictionaryRows(value: unknown): DictionaryRow[] {
  return rows<DictionaryRow>(value).map((row) => ({
    ...row,
    en: typeof row.en === 'string' ? row.en : String(row.en ?? ''),
    cn: typeof row.cn === 'string' ? row.cn : String(row.cn ?? ''),
    aliases: Array.isArray(row.aliases) ? row.aliases.filter((alias): alias is string => typeof alias === 'string') : [],
  }));
}

/** The editor's statistics block, when `get_dictionary` includes it. */
export interface DictionaryStats {
  total: number;
  translated: number;
  leaderboard: { username: string; count: number }[];
}

export interface DictionaryResult {
  success: boolean;
  message?: string;
  error?: string;
  tags: DictionaryRow[];
  total_matches?: number;
  stats?: DictionaryStats;
}

/** Only numbers pass as counts; the statistics block only as a whole. */
function dictionaryExtras(data: Record<string, unknown>): Pick<DictionaryResult, 'total_matches' | 'stats'> {
  const stats = data.stats as Partial<DictionaryStats> | undefined;
  return {
    total_matches: Number.isFinite(Number(data.total_matches)) ? Number(data.total_matches) : undefined,
    stats: stats && typeof stats === 'object'
      ? { total: count(stats.total), translated: count(stats.translated), leaderboard: rows(stats.leaderboard) }
      : undefined,
  };
}

export async function getDictionary(
  token: string,
  params: {
    page?: number;
    limit?: number;
    keyword?: string;
    sort?: string;
    category?: string;
    untranslated?: number;
    wiki_overlap?: number;
  },
  signal?: AbortSignal,
): Promise<DictionaryResult> {
  const res = await picponyRequest('get_dictionary', {
    token,
    query: {
      page: params.page || undefined,
      limit: params.limit || undefined,
      keyword: params.keyword || undefined,
      sort: params.sort || undefined,
      category: params.category || undefined,
      untranslated: params.untranslated,
      wiki_overlap: params.wiki_overlap,
      _t: Date.now(),
    },
    signal,
  });
  const data = await readJson(res);
  if (data?.success !== true) return { ...failure(data), error: envelopeMessage(data), tags: [] };
  if (!listed(data, 'tags')) return { ...INVALID, error: INVALID.message, tags: [] };
  return { success: true, tags: dictionaryRows(data.tags), ...dictionaryExtras(data) };
}

/** 批量获取词库中文翻译（旧前端 get_tag_translations 接口） */
export async function getTagTranslations(tags: string[]) {
  const res = await picponyPostJson('get_tag_translations', { tags });
  return readJson(res);
}

/**
 * `submit_tag_feedback` — a report on a tag's glossary entry (a wrong translation, a missing
 * one), which lands in the glossary console's feedback panel. The original front end's
 * contract: a form body `{tag_name, content}`, a suggested translation appended to the content
 * on a line of its own. Resolves with the envelope, like every mutation here.
 */
export async function submitTagFeedback(
  token: string,
  { tagName, reason, translation }: { tagName: string; reason: string; translation?: string },
) {
  const suggestion = translation?.trim();
  const content = suggestion ? `${reason.trim()}\n建议的正确翻译：${suggestion}` : reason.trim();
  return picponyRequest('submit_tag_feedback', {
    token,
    method: 'POST',
    body: new URLSearchParams({ tag_name: tagName, content }),
  });
}

/** 开发者模式状态：返回 is_developer / is_developer_banned / prerequisites */
export async function getDeveloperStatus(
  token: string,
  signal?: AbortSignal,
): Promise<{
  success: true;
  is_developer: boolean;
  is_developer_banned: boolean;
  prerequisites: { logged_in?: boolean; api_bound?: boolean; level_gt_3?: boolean };
}> {
  const data = await readEnvelope<{ is_developer?: unknown; is_developer_banned?: unknown; prerequisites?: unknown }>(
    await picponyRequest('get_developer_status', { token, query: { _t: Date.now() }, signal }),
  );
  return {
    success: true,
    is_developer: data.is_developer === true || data.is_developer === 1,
    is_developer_banned: data.is_developer_banned === true || data.is_developer_banned === 1,
    prerequisites: data.prerequisites && typeof data.prerequisites === 'object'
      ? data.prerequisites as { logged_in?: boolean; api_bound?: boolean; level_gt_3?: boolean }
      : {},
  };
}

/** 输入 8 位维护密码开启开发者模式 */
export async function enableDeveloperMode(token: string, password: string) {
  return picponyPostJson('enable_developer_mode', { password }, { token });
}

/** 关闭开发者模式 */
export async function disableDeveloperMode(token: string) {
  return picponyRequest('disable_developer_mode', { token, method: 'POST' });
}

export async function getDictionaryDuplicates(token: string, signal?: AbortSignal): Promise<DictionaryResult> {
  const data = await readJson(await picponyRequest('get_duplicates', { token, query: { _t: Date.now() }, signal }));
  if (data?.success !== true) return { ...failure(data), error: envelopeMessage(data), tags: [] };
  if (!listed(data, 'tags')) return { ...INVALID, error: INVALID.message, tags: [] };
  return { success: true, tags: dictionaryRows(data.tags), ...dictionaryExtras(data) };
}

export async function saveDictionaryTag(
  token: string,
  data: {
    id?: number;
    cn: string;
    en: string;
    aliases: string[];
    cat: string;
    count: number;
    description: string;
  },
) {
  return picponyPostJson('save_dictionary_tag', data, { token });
}

export async function deleteDictionaryTag(token: string, id: number) {
  return picponyPostJson('delete_dictionary_tag', { id }, { token });
}

/* `get_dictionary_leaderboard` has no adapter here on purpose. The original console's
   词库贡献排行榜 查看全部 (ciku.html) has no counterpart in 词库编辑 yet, and `api` is a runtime
   spread, so an adapter with no caller ships to every one of its importers. Add it back beside the
   UI that reads it. */

/** 获取某个词库标签的编辑历史（按时间倒序） */
export async function getDictionaryTagHistory(
  token: string,
  tagId: number,
  signal?: AbortSignal,
): Promise<{ success: boolean; message?: string; error?: string; history: Record<string, unknown>[] }> {
  const data = await readJson(await picponyRequest('get_dictionary_tag_history', {
    token, query: { tag_id: tagId, _t: Date.now() }, signal,
  }));
  if (data?.success !== true) return { ...failure(data), error: envelopeMessage(data), history: [] };
  if (!listed(data, 'history')) return { ...INVALID, error: INVALID.message, history: [] };
  return { success: true, history: rows<Record<string, unknown>>(data.history) };
}

/** The运营团队 list for /about — a public, tokenless read kept out of the admin module so
 *  /about need not import the un-tree-shakeable admin surface. */
export async function getTeamMembers(signal?: AbortSignal): Promise<{ success: true; members: TeamMember[] }> {
  const data = await readEnvelope<{ members?: unknown }>(
    await picponyRequest('get_team_members', { query: { _t: Date.now() }, signal }),
  );
  if (!Array.isArray(data.members)) throw new ApiError('invalid');
  return { success: true, members: rows<TeamMember>(data.members) };
}
