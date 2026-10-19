import type { PonyImage } from '@/lib/types/image';
import { DERPIBOORU_API_BASE } from '@/lib/constants';
import { beijingDateKey } from '@/lib/format';
import { adminWrite, requestUuid, type AdminRow } from '@/lib/adminMutations';
import { applyImageLine, proxyFetch } from './client';
import { api, readObject, seg } from './http';
import { ApiError } from './errors';

/*
 * The admin console's adapters, on the Rust backend's `/api/v1` resources.
 *
 * Reads resolve with the backend's DTO (already typed: no envelope, no `success`) and throw the
 * transport's `ApiError` on any failure, so a refusal (403) reads as one and is not offered 重试.
 * Writes resolve with the backend's answer (`{}` for a 204) through `adminWrite`, which carries the
 * `Idempotency-Key` most admin writes require. Several resources are guarded by a revision the
 * write must name (`expected_revision`); the reads hand it out beside the rows and the panels keep
 * it in their cache.
 */

const READ = { cache: 'no-store' as const };

/** Every page of a `page`/`limit` list (the console shows these whole and pages them itself). */
async function everyPage<T>(
  read: (page: number) => Promise<{ rows: T[]; totalPages: number }>,
  maxPages = 500,
): Promise<T[]> {
  const first = await read(1);
  const rows = [...first.rows];
  for (let page = 2; page <= Math.min(first.totalPages, maxPages); page += 1) rows.push(...(await read(page)).rows);
  return rows;
}

/** Every page of a cursor list (`before`/`after` → `next_cursor`). */
async function everyCursor<T>(
  read: (cursor: number | undefined) => Promise<{ rows: T[]; next: number | null }>,
  maxPages = 500,
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: number | undefined;
  for (let n = 0; n < maxPages; n += 1) {
    const page = await read(cursor);
    rows.push(...page.rows);
    if (page.next == null) break;
    cursor = page.next;
  }
  return rows;
}

/** A Beijing calendar date for a backend timestamp — the unit the badge endpoints take back. */
function beijingDay(value: string | null | undefined): string | undefined {
  return value ? beijingDateKey(value) ?? undefined : undefined;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/** One row of `GET /admin/users`. */
export interface AdminUserRow {
  id: number;
  username: string;
  email: string | null;
  email_verified: boolean;
  role: string;
  is_banned: boolean;
  bio: string;
  avatar: string;
  banner: string;
  experience: number;
  coins: number;
  created_at: string;
  last_online: string | null;
  ip_location: string | null;
}

/** The bound Derpibooru credential, as the admin view projects it (the key itself never leaves). */
export interface AdminCredential {
  revision: number;
  has_key: boolean;
  key_hint?: string | null;
  state: string;
  upstream_id?: number | null;
  upstream_name?: string | null;
}

export interface AdminUserBadgeRow { id: number; name: string; color: string; expires_at: string | null }

/** `GET /admin/users/{id}` — the editor's account, with the revisions its writes name. */
export interface AdminUserDetail extends AdminUserRow {
  account_revision: number;
  gender: string;
  race: string;
  birthday: string | null;
  active_sessions: number;
  /** Barred from API acceleration (`POST /admin/api-accel-bans`). */
  api_accel_banned: boolean;
  upstream_credential: AdminCredential;
  badges: AdminUserBadgeRow[];
}

const USERS_PAGE = 100;

/** Every account: the backend pages by 100, the console lists them whole (search and paging are local). */
export async function adminGetUsers(token: string, signal?: AbortSignal): Promise<AdminUserRow[]> {
  return everyPage(async (page) => {
    const data = await api<{ users: AdminUserRow[]; total_pages: number }>('GET', '/admin/users', { token, signal, query: { page, limit: USERS_PAGE }, ...READ });
    return { rows: data.users, totalPages: data.total_pages };
  });
}

export async function adminGetUser(token: string, userId: number, signal?: AbortSignal): Promise<AdminUserDetail> {
  return (await api<{ user: AdminUserDetail }>('GET', `/admin/users/${seg(userId)}`, { token, signal, ...READ })).user;
}

/** What the editor changed. `apiKey`: a new key replaces the binding, `null` clears it. */
export interface AdminUserChanges {
  username?: string;
  role?: string;
  is_banned?: boolean;
  bio?: string;
  gender?: string;
  /** `''` clears the birthday. */
  birthday?: string;
  email?: string;
  password?: string;
  apiKey?: string | null;
}

export interface AdminUserUpdate { applied: string[]; login_required: boolean }

/**
 * A save is up to four writes — profile, email, password, upstream credential — each guarded by the
 * account revision the previous one answered. They run in that order; when one is refused the error
 * says which parts were already saved, because those are not undone.
 */
export async function adminUpdateUser(token: string, user: AdminUserDetail, changes: AdminUserChanges): Promise<AdminUserUpdate> {
  let revision = user.account_revision;
  const applied: string[] = [];
  let loginRequired = false;
  const step = async (label: string, run: () => Promise<AdminRow>) => {
    try {
      const data = await run();
      if (typeof data.applied_revision === 'number') revision = data.applied_revision;
      if (data.login_required === true) loginRequired = true;
      applied.push(label);
    } catch (error) {
      if (!applied.length || !(error instanceof ApiError)) throw error;
      throw new ApiError(error.kind, { status: error.status, code: error.code, retryable: false, message: `已保存${applied.join('、')}；${label}未保存：${error.message}` });
    }
  };
  const profile: AdminRow = {};
  for (const key of ['username', 'role', 'is_banned', 'bio', 'gender'] as const) if (changes[key] !== undefined) profile[key] = changes[key];
  if (changes.birthday !== undefined) profile.birthday = changes.birthday || null;
  if (Object.keys(profile).length) {
    await step('资料', () => adminWrite('PATCH', `/admin/users/${seg(user.id)}`, { token, json: { expected_revision: revision, changes: profile } }));
  }
  if (changes.email !== undefined) {
    await step('邮箱', () => adminWrite('PUT', `/admin/users/${seg(user.id)}/email`, { token, json: { expected_revision: revision, email: changes.email || null } }));
  }
  if (changes.password) {
    await step('密码', () => adminWrite('PUT', `/admin/users/${seg(user.id)}/password`, { token, json: { request_id: requestUuid(), expected_revision: revision, password: changes.password } }));
  }
  if (changes.apiKey !== undefined) {
    const expected = user.upstream_credential.revision;
    await step('API Key', () => changes.apiKey === null
      ? adminWrite('DELETE', `/admin/users/${seg(user.id)}/upstream-credential`, { token, json: { request_id: requestUuid(), expected_revision: expected } })
      : adminWrite('PUT', `/admin/users/${seg(user.id)}/upstream-credential`, { token, json: { request_id: requestUuid(), expected_revision: expected, api_key: changes.apiKey } }));
  }
  return { applied, login_required: loginRequired };
}

/** Ban or unban from the list: the list carries no account revision, so the account is read first. */
export async function adminSetBanned(token: string, userId: number, banned: boolean): Promise<AdminRow> {
  const user = await adminGetUser(token, userId);
  return adminWrite('PATCH', `/admin/users/${seg(userId)}`, { token, json: { expected_revision: user.account_revision, changes: { is_banned: banned } } });
}

/**
 * `admin_delete_user` is an **erasure**: the account row stays (ledger and audit integrity) under
 * `deleted-user-{id}`, banned and stripped of every identifying field, session and private record.
 */
export async function adminDeleteUser(token: string, targetId: number, reason?: string) {
  return adminWrite('POST', `/admin/users/${seg(targetId)}/erasure`, { token, json: reason ? { reason } : {} });
}

export interface WealthAdjustment {
  expected_coins: number;
  expected_experience: number;
  coins?: { operation: 'add' | 'subtract' | 'set'; amount: number };
  experience?: number;
  coins_reason?: string;
  experience_reason?: string;
}

export async function adminUpdateWealth(token: string, userId: number, body: WealthAdjustment) {
  return adminWrite('POST', `/admin/users/${seg(userId)}/wealth-adjustments`, { token, json: body });
}

// ---------------------------------------------------------------------------
// Shop
// ---------------------------------------------------------------------------

export interface AdminShopItem {
  id: number;
  name: string;
  description: string;
  image_url: string | null;
  price: number;
  stock: number;
  active: boolean;
  revision: number;
  created_at: string;
}

/** Every item, inactive ones included (an administrator's token makes `/shop/items` list them). */
export async function adminGetShopItems(token: string, signal?: AbortSignal): Promise<AdminShopItem[]> {
  return everyCursor(async (before) => {
    const data = await api<{ items: AdminShopItem[]; next_cursor: number | null }>('GET', '/shop/items', { token, signal, query: { before, limit: 1000 }, ...READ });
    return { rows: data.items, next: data.next_cursor };
  });
}

export interface ShopItemBody { name: string; description: string; image_url: string | null; price: number; stock: number; active: boolean }

/** A new item (`id` absent) or an edit of one, guarded by the revision the list carried. */
export async function adminSaveShopItem(token: string, body: ShopItemBody, target?: { id: number; revision: number }) {
  return target
    ? adminWrite('PUT', `/admin/shop/items/${seg(target.id)}`, { token, json: { ...body, expected_revision: target.revision } })
    : adminWrite('POST', '/admin/shop/items', { token, json: body });
}

/** A tombstone: purchases keep their item and can still be refunded. */
export async function adminDeleteShopItem(token: string, id: number) {
  return adminWrite('DELETE', `/admin/shop/items/${seg(id)}`, { token });
}

// ---------------------------------------------------------------------------
// Image moderation
// ---------------------------------------------------------------------------

export type ReportStatus = 'pending' | 'processed' | 'rejected';

export interface AdminReport {
  id: number;
  image_id: number;
  reason: string;
  status: ReportStatus;
  revision: number;
  created_at: string;
  updated_at: string;
  reporter: { id: number; username: string };
}

/** Every report, pending first (the backend's order). */
export async function adminGetReports(token: string, signal?: AbortSignal): Promise<AdminReport[]> {
  return everyPage(async (page) => {
    const data = await api<{ reports: AdminReport[]; total_pages: number }>('GET', '/admin/image-reports', { token, signal, query: { page, limit: 100 }, ...READ });
    return { rows: data.reports, totalPages: data.total_pages };
  });
}

export async function adminHandleReport(token: string, report: { id: number; revision: number }, status: Exclude<ReportStatus, 'pending'>) {
  return adminWrite('PATCH', `/admin/image-reports/${seg(report.id)}`, { token, json: { expected_revision: report.revision, status } });
}

export interface AdminBlock { image_id: number; reason: string; actor: { id: number; username: string }; created_at: string; updated_at: string }
export interface AdminBlocklist { revision: number; items: AdminBlock[] }

/** The whole blocklist at one policy revision (each page is read at it, so the pages agree). */
export async function adminGetBlacklist(token: string, signal?: AbortSignal): Promise<AdminBlocklist> {
  let revision: number | undefined;
  const items = await everyPage(async (page) => {
    const data = await api<{ revision: number; blocks: AdminBlock[]; total_pages: number }>('GET', '/admin/image-blocklist', { token, signal, query: { page, limit: 1000, revision }, ...READ });
    revision = data.revision;
    return { rows: data.blocks, totalPages: data.total_pages };
  });
  return { revision: revision ?? 0, items };
}

/** Answers `{ applied_revision, current_revision, changed }`. */
export async function adminAddBlacklist(token: string, revision: number, imageId: number, reason: string) {
  return adminWrite('PUT', `/admin/image-blocklist/${seg(imageId)}`, { token, json: { expected_revision: revision, reason } });
}

export async function adminRemoveBlacklist(token: string, revision: number, imageId: number) {
  return adminWrite('DELETE', `/admin/image-blocklist/${seg(imageId)}`, { token, json: { expected_revision: revision } });
}

// ---------------------------------------------------------------------------
// Announcements, notifications, messages
// ---------------------------------------------------------------------------

export async function saveAnnouncement(token: string, data: { version: string; title: string; content: string }) {
  return adminWrite('POST', '/admin/announcements', { token, json: data });
}

export async function adminDeleteAnnouncement(token: string, id: number) {
  return adminWrite('DELETE', `/admin/announcements/${seg(id)}`, { token });
}

export interface AuditMessageRow {
  id: number;
  sender_id: number;
  sender_name: string;
  receiver_id: number;
  receiver_name: string;
  content: string;
  read_at: string | null;
  created_at: string;
}

/** One page of the private-message audit, newest first; `next` is the cursor of the page after. */
export async function adminGetAllMessages(
  token: string,
  params: { userId?: number; before?: number; limit?: number },
  signal?: AbortSignal,
): Promise<{ messages: AuditMessageRow[]; next: number | null }> {
  const data = await api<{ messages: AuditMessageRow[]; next_cursor: number | null }>('GET', '/admin/messages', {
    token, signal, ...READ,
    query: { user_id: params.userId, before: params.before, limit: params.limit ?? 50 },
  });
  return { messages: data.messages, next: data.next_cursor };
}

/** `recipient_id` null is a broadcast; `important` also mails it (to every account, for a broadcast). */
export async function adminSendNotification(
  token: string,
  data: { recipient_id: number | null; title: string; content: string; important: boolean },
) {
  return adminWrite('POST', '/admin/notifications', { token, json: data });
}

export interface AdminNotification {
  id: number;
  recipient_id: number | null;
  username: string | null;
  kind: string;
  title: string;
  content: string;
  important: boolean;
  created_at: string;
}

/** One page of the sent-notification history, newest first. */
export async function adminGetNotifications(
  token: string,
  params: { scope: 'all' | 'broadcast' | 'personal'; before?: number; limit: number; keyword?: string },
  signal?: AbortSignal,
): Promise<{ notifications: AdminNotification[]; next: number | null }> {
  const data = await api<{ notifications: AdminNotification[]; next_cursor: number | null }>('GET', '/admin/notifications', {
    token, signal, ...READ,
    query: { scope: params.scope, before: params.before, limit: params.limit, keyword: params.keyword || undefined },
  });
  return { notifications: data.notifications, next: data.next_cursor };
}

export async function adminDeleteNotification(token: string, id: number) {
  return adminWrite('DELETE', `/admin/notifications/${seg(id)}`, { token });
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

/** Either `user_ids` or a registration window (Beijing dates, inclusive); `expires_on` absent is permanent. */
export interface BadgeGrant {
  name: string;
  color: string;
  expires_on?: string;
  user_ids?: number[];
  registered_from?: string;
  registered_through?: string;
}

/** Answers `{ granted, user_ids }`. */
export async function adminGrantBadge(token: string, data: BadgeGrant) {
  return adminWrite('POST', '/admin/badges/awards', { token, json: data });
}

/** A claim campaign. Its token is shown once, at creation or rotation — the list never carries it. */
export interface AdminBadgeLink {
  id: number;
  name: string;
  color: string;
  active: boolean;
  badge_expires_at: string | null;
  link_expires_at: string | null;
  required_location: string | null;
  location_error_message: string | null;
  created_at: string;
}

export async function adminGetBadgeLinks(token: string, signal?: AbortSignal): Promise<AdminBadgeLink[]> {
  return everyCursor(async (before) => {
    const data = await api<{ links: AdminBadgeLink[]; next_cursor: number | null }>('GET', '/admin/badges/campaigns', { token, signal, query: { before, limit: 1000 }, ...READ });
    return { rows: data.links, next: data.next_cursor };
  });
}

export interface BadgeCampaign {
  name: string;
  color: string;
  badge_expires_on?: string;
  link_expires_on?: string;
  required_location?: string;
  location_error_message?: string;
}

/** Answers `{ id, token }` — the only time this token is readable. */
export async function adminCreateBadgeLink(token: string, data: BadgeCampaign) {
  return adminWrite<{ id: number; token: string }>('POST', '/admin/badges/campaigns', { token, json: data });
}

/** A new claim token for the campaign; the previous link stops working. Answers `{ id, token }`. */
export async function adminRotateBadgeLink(token: string, id: number) {
  return adminWrite<{ id: number; token: string }>('POST', `/admin/badges/campaigns/${seg(id)}/token-rotations`, { token });
}

export async function adminToggleBadgeLink(token: string, id: number, active: boolean) {
  return adminWrite('PATCH', `/admin/badges/campaigns/${seg(id)}`, { token, json: { active } });
}

export async function adminDeleteBadge(token: string, badgeId: number) {
  return adminWrite('DELETE', `/admin/badges/awards/${seg(badgeId)}`, { token });
}

/** Rename or recolour a held badge. Its expiry travels too — absent would make it permanent. */
export async function adminEditBadge(token: string, badge: { id: number; name: string; color: string; expires_at: string | null }) {
  return adminWrite('PUT', `/admin/badges/awards/${seg(badge.id)}`, {
    token,
    json: { name: badge.name, color: badge.color, expires_on: beijingDay(badge.expires_at) },
  });
}

// ---------------------------------------------------------------------------
// Site switches and statistics
// ---------------------------------------------------------------------------

export interface MaintenanceStatus { maintenance_mode: boolean; maintenance_message: string }

/** The console's read of the maintenance switch (an administrator's own session). */
export async function getMaintenanceStatus(token: string, signal?: AbortSignal): Promise<MaintenanceStatus> {
  return api<MaintenanceStatus>('GET', '/me/maintenance-status', { token, signal, ...READ });
}

export async function adminToggleMaintenance(token: string, data: MaintenanceStatus) {
  return adminWrite('PUT', '/admin/maintenance', { token, json: data });
}

export async function adminToggleTranslate(token: string, data: { translate_enabled: boolean }) {
  return adminWrite('PUT', '/admin/translation', { token, json: data });
}

/** `GET /admin/translation`: the image-translation switch, its provider, and the queue by status. */
export interface TranslationQueue { pending: number; translating: number; completed: number; failed: number }
export interface AdminTranslation { translate_enabled: boolean; image_translation_provider: string; queue: TranslationQueue }
export async function adminGetTranslation(token: string, signal?: AbortSignal): Promise<AdminTranslation> {
  return api<AdminTranslation>('GET', '/admin/translation', { token, signal, ...READ });
}

export interface SiteStats { images: number; tags: number; comments: number; updated_at: string | null }

export async function getSiteStats(signal?: AbortSignal): Promise<SiteStats> {
  return api<SiteStats>('GET', '/site-stats', { signal, ...READ });
}

export async function adminSyncSiteStats(token: string, data: { images: number; tags: number; comments: number }) {
  return adminWrite('PUT', '/admin/site-stats', { token, json: data });
}

// ---------------------------------------------------------------------------
// Mascots (the catalogue's own adapters are in `adminCatalogTools.ts`)
// ---------------------------------------------------------------------------

/** Answers `{ asset, url, mime, size_bytes, width, height }`; `url` is the site path a mascot stores. */
export async function adminUploadMascotImage(token: string, file: File) {
  const body = new FormData();
  body.append('image', file);
  return adminWrite<{ url: string }>('POST', '/admin/mascots/images', { token, body });
}

// ---------------------------------------------------------------------------
// Search filters
// ---------------------------------------------------------------------------

export interface BlockTagRow { id: number; filter: string; tag: string }

/** The site-wide search rules: every row, and the same tags grouped by rule. */
export async function getBlockTags(signal?: AbortSignal): Promise<{ tags: BlockTagRow[]; filters: Record<string, string[]> }> {
  return api('GET', '/filters/block-tags', { signal, ...READ });
}

export async function adminAddBlockTag(token: string, data: { filter: string; tag: string }) {
  return adminWrite<{ id: number }>('POST', '/admin/filters/block-tags', { token, json: data });
}

export async function adminRemoveBlockTag(token: string, id: number) {
  return adminWrite('DELETE', `/admin/filters/block-tags/${seg(id)}`, { token });
}

// ---------------------------------------------------------------------------
// Developer access
// ---------------------------------------------------------------------------

export interface MaintenancePassword {
  password: string;
  generation: number;
  updated_at: string | null;
  expires_at: string | null;
  ready: boolean;
}

/** Reveals the current maintenance password (initialising it if there is none); audited. */
export async function adminGetDeveloperPassword(token: string, signal?: AbortSignal): Promise<MaintenancePassword> {
  return api<MaintenancePassword>('POST', '/admin/developer-access/password/revelations', { token, signal, json: {} });
}

/** A new password; the current one stops working. Guarded by the generation shown. */
export async function adminRefreshDeveloperPassword(token: string, expectedGeneration: number) {
  return adminWrite<MaintenancePassword>('POST', '/admin/developer-access/password/rotations', {
    token, json: { request_id: requestUuid(), expected_generation: expectedGeneration },
  });
}

export interface DeveloperAccess {
  user_id: number;
  revision: number;
  enabled: boolean;
  active: boolean;
  banned: boolean;
  source: string | null;
  inactive_reason: string | null;
}

export interface DeveloperUser {
  id: number;
  username: string;
  email: string | null;
  role: string;
  created_at: string;
  key_hint: string | null;
  upstream_identity: { id: number; name: string | null } | null;
  developer_access: DeveloperAccess;
}

/** Every account that has developer mode or is banned from it. */
export async function adminGetDeveloperUsers(token: string, signal?: AbortSignal): Promise<DeveloperUser[]> {
  return everyCursor(async (after) => {
    const data = await api<{ users: DeveloperUser[]; next_cursor: number | null }>('GET', '/admin/developer-access/users', { token, signal, query: { after, limit: 100 }, ...READ });
    return { rows: data.users, next: data.next_cursor };
  });
}

/**
 * One account's developer state (`GET /admin/users/{id}/developer-access`), the list's row shape —
 * also for an account that never had a grant, and so is not in the list. Its revision is what a
 * change to an account outside the list names: one that was changed once and later dropped out of
 * the list is not at revision 0.
 */
export async function adminGetDeveloperAccess(token: string, userId: number, signal?: AbortSignal): Promise<DeveloperUser> {
  return (await api<{ user: DeveloperUser }>('GET', `/admin/users/${seg(userId)}/developer-access`, { token, signal, ...READ })).user;
}

/** The four developer-access changes, each guarded by the account's developer revision (`409` when stale). */
type DeveloperChange = 'grant' | 'ban';
function developerWrite(method: 'PUT' | 'DELETE', change: DeveloperChange, token: string, userId: number, revision: number) {
  return adminWrite<DeveloperAccess>(method, `/admin/users/${seg(userId)}/developer-access/${change}`, { token, json: { expected_revision: revision } });
}
export const adminEnableDeveloper = (token: string, userId: number, revision: number) => developerWrite('PUT', 'grant', token, userId, revision);
export const adminRevokeDeveloper = (token: string, userId: number, revision: number) => developerWrite('DELETE', 'grant', token, userId, revision);
export const adminBanDeveloper = (token: string, userId: number, revision: number) => developerWrite('PUT', 'ban', token, userId, revision);
export const adminUnbanDeveloper = (token: string, userId: number, revision: number) => developerWrite('DELETE', 'ban', token, userId, revision);

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

export interface AdminTeamMember {
  id: number;
  name: string;
  role: string;
  category: string;
  avatar_url: string;
  link_url: string;
  order_num: number;
  user_id: number | null;
  account_avatar: string | null;
}

export interface TeamMemberBody { name: string; role: string; category: string; avatar_url: string; link_url: string; order_num: number; user_id: number | null }

/** The roster and the revision every roster write names. */
export async function adminGetTeamMembers(token: string, signal?: AbortSignal): Promise<{ revision: number; members: AdminTeamMember[] }> {
  let revision = 0;
  const members = await everyPage(async (page) => {
    const data = await api<{ revision: number; members: AdminTeamMember[]; total_pages: number }>('GET', '/team-members', { token, signal, query: { page, limit: 100 }, ...READ });
    revision = data.revision;
    return { rows: data.members, totalPages: data.total_pages };
  });
  return { revision, members };
}

export async function addTeamMember(token: string, revision: number, member: TeamMemberBody) {
  return adminWrite('POST', '/admin/team-members', { token, json: { expected_revision: revision, member } });
}

export async function updateTeamMember(token: string, revision: number, id: number, member: TeamMemberBody) {
  return adminWrite('PUT', `/admin/team-members/${seg(id)}`, { token, json: { expected_revision: revision, member } });
}

export async function deleteTeamMember(token: string, revision: number, id: number) {
  return adminWrite('DELETE', `/admin/team-members/${seg(id)}`, { token, json: { expected_revision: revision } });
}

// ---------------------------------------------------------------------------
// The glossary's feedback queue and batch writes
// ---------------------------------------------------------------------------

export interface TagFeedbackRow {
  id: number;
  user_id: number | null;
  username: string | null;
  tag: string;
  content: string;
  status: 'pending' | 'processed' | 'rejected';
  handled_by: number | null;
  handler_username: string | null;
  handled_at: string | null;
  created_at: string;
}

/** One page of tag feedback, newest first. */
export async function getTagFeedback(
  token: string,
  params: { status?: string; keyword?: string; before?: number; limit?: number } = {},
  signal?: AbortSignal,
): Promise<{ feedback: TagFeedbackRow[]; next: number | null }> {
  const data = await api<{ feedback: TagFeedbackRow[]; next_cursor: number | null }>('GET', '/editor/dictionary/feedback', {
    token, signal, ...READ,
    query: { status: params.status || undefined, keyword: params.keyword || undefined, before: params.before, limit: params.limit ?? 40 },
  });
  return { feedback: data.feedback, next: data.next_cursor };
}

export async function handleTagFeedback(token: string, id: number, status: 'pending' | 'processed' | 'rejected') {
  return adminWrite('PUT', `/editor/dictionary/feedback/${seg(id)}`, { token, json: { status } });
}

/** Pages of the keyword search `checkTagExists` reads before it answers "absent". */
const TAG_EXISTS_PAGE = 200;
const TAG_EXISTS_MAX_PAGES = 5;

export async function checkTagExists(token: string, enTag: string, signal?: AbortSignal) {
  const wanted = enTag.toLowerCase();
  /* `keyword` is a substring match, so a popular stem (`pony`) can push the exact entry past the
     first page; reading only page 1 answered "absent" and the glossary created a duplicate (review
     P1-F17). Pages are read until a short one, bounded. */
  for (let page = 1; page <= TAG_EXISTS_MAX_PAGES; page += 1) {
    const data = await api<{ tags: { en: string }[] }>('GET', '/dictionary/tags', { token, signal, ...READ, query: { page, limit: TAG_EXISTS_PAGE, keyword: enTag } });
    if (data.tags.some((t) => t.en.toLowerCase() === wanted)) return true;
    if (data.tags.length < TAG_EXISTS_PAGE) return false;
  }
  return false;
}

export interface DictionaryImportTask { en: string; cn: string; aliases: string[]; cat: string; count: number; description: string }

/**
 * The glossary's batch import, create-only. The backend has no batch endpoint, so each tag is one
 * `POST /editor/dictionary/tags`; a tag the dictionary already holds answers `409 ALREADY_EXISTS`
 * and is counted as skipped. Answers `{ created, skipped, failed }` — every count known.
 */
export async function batchImportDictionaryTags(token: string, tasks: DictionaryImportTask[]) {
  let created = 0, skipped = 0, failed = 0;
  for (const task of tasks) {
    try {
      await adminWrite('POST', '/editor/dictionary/tags', {
        token,
        json: { en: task.en, cn: task.cn, aliases: task.aliases, category: task.cat, search_count: task.count, description: task.description },
      });
      created += 1;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) skipped += 1;
      else if (error instanceof ApiError && (error.status === 401 || error.status === 403)) throw error;
      else failed += 1;
    }
  }
  return { created, skipped, failed };
}

/** Deletes the given rows one by one (no batch endpoint); a row already gone counts as deleted. */
export async function batchDeleteDictionaryTags(token: string, ids: number[]) {
  let deleted = 0;
  for (const id of ids) {
    try {
      await adminWrite('DELETE', `/editor/dictionary/tags/${seg(id)}`, { token });
      deleted += 1;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) { deleted += 1; continue; }
      if (deleted && error instanceof ApiError) throw new ApiError(error.kind, { status: error.status, retryable: false, message: `已删除 ${deleted} 个标签，其余未删除：${error.message}` });
      throw error;
    }
  }
  return { deleted_count: deleted };
}

// ---------------------------------------------------------------------------
// Derpibooru thumbnails for the moderation queue
// ---------------------------------------------------------------------------

/** Derpibooru's Everything filter: a reported picture must never be filtered out of its own report. */
const EVERYTHING_FILTER_ID = 56027;

function isImage(value: unknown): value is PonyImage {
  const id = (value as { id?: unknown } | null)?.id;
  return typeof id === 'number' && Number.isSafeInteger(id);
}

/**
 * The pictures a page of reports names, for the moderation queue's thumbnails: one search for
 * every id on the page, under the Everything filter and outside the site's public blacklist, so a
 * reported picture that has since been blacklisted still shows what was reported. Keyed by id; an
 * id Derpibooru no longer has is simply absent.
 */
export async function adminReportedImages(ids: readonly number[], signal?: AbortSignal): Promise<Map<number, PonyImage>> {
  const unique = [...new Set(ids)].filter((id) => Number.isSafeInteger(id) && id > 0).slice(0, 50);
  if (unique.length === 0) return new Map();
  const query = unique.map((id) => `id:${id}`).join(' || ');
  const res = await proxyFetch(
    `${DERPIBOORU_API_BASE}/search/images?q=${encodeURIComponent(query)}&per_page=50&filter_id=${EVERYTHING_FILTER_ID}`,
    { cache: 'no-store', signal },
  );
  const data = await readObject<{ images?: unknown }>(res);
  if (!Array.isArray(data.images)) throw new ApiError('invalid');
  return new Map(data.images.filter(isImage).map((image) => [image.id, applyImageLine(image)] as const));
}
