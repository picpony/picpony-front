import type { SiteStatusResponse } from '@/lib/types/site';
import type { AuditMessagesResponse } from '@/lib/types/message';
import type { PonyImage } from '@/lib/types/image';
import { DERPIBOORU_API_BASE } from '@/lib/constants';
import { applyImageLine, proxyFetch } from './client';
import { envelopeMessage, picponyPostJson, picponyRequest, readJson, readObject } from './http';
import { ApiError } from './errors';

/*
 * The admin console's adapters. Reads resolve with the backend's envelope (the console's
 * `adminData` / `adminList` decide what a failed or malformed one means); a failed HTTP status is
 * kept on the envelope as `status`, so a refusal (403 权限不足) reads as one and is not offered 重试.
 * Writes resolve with the `Response`; `useAdminMutation` reads it.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readAdmin<T = any>(res: Response): Promise<T> {
  const data = await readJson(res);
  if (!res.ok) return { ...data, success: false, status: res.status } as T;
  return data as T;
}

export async function adminGetUsers(token: string, signal?: AbortSignal) {
  const res = await picponyRequest('admin_get_users', { token, query: { _t: Date.now() }, signal });
  return readAdmin(res);
}

export async function adminUpdateUser(token: string, data: Record<string, unknown>) {
  return picponyPostJson('admin_update_user', data, { token });
}

export async function adminDeleteUser(token: string, targetId: number) {
  return picponyPostJson('admin_delete_user', { target_id: targetId }, { token });
}

export async function adminUpdateWealth(token: string, data: Record<string, unknown>) {
  return picponyPostJson('admin_update_wealth', data, { token });
}

export async function adminGetShopItems(token: string, signal?: AbortSignal) {
  const res = await picponyRequest('get_shop_items', { token, query: { _t: Date.now() }, signal });
  return readAdmin(res);
}

export async function adminSaveShopItem(token: string, data: Record<string, unknown>) {
  return picponyPostJson('admin_save_shop_item', data, { token });
}

export async function adminDeleteShopItem(token: string, id: number) {
  return picponyPostJson('admin_delete_shop_item', { id }, { token });
}

export async function adminGetReports(token: string, signal?: AbortSignal) {
  const res = await picponyRequest('admin_get_reports', { token, query: { _t: Date.now() }, signal });
  return readAdmin(res);
}

export async function adminHandleReport(token: string, reportId: number, status: string) {
  return picponyPostJson('admin_handle_report', { report_id: reportId, status }, { token });
}

export async function adminGetBlacklist(token: string, signal?: AbortSignal) {
  const res = await picponyRequest('admin_get_blacklist', { token, query: { _t: Date.now() }, signal });
  return readAdmin(res);
}

export async function adminAddBlacklist(token: string, imageId: number, reason: string) {
  return picponyPostJson('admin_add_blacklist', { image_id: imageId, reason }, { token });
}

export async function adminRemoveBlacklist(token: string, imageId: number) {
  return picponyPostJson('admin_remove_blacklist', { image_id: imageId }, { token });
}

export async function saveAnnouncement(
  token: string,
  data: { version: string; title: string; content: string },
) {
  return picponyPostJson('save_announcement', data, { token });
}

export async function adminDeleteAnnouncement(token: string, id: number) {
  return picponyPostJson('admin_delete_announcement', { id }, { token });
}

export async function adminGetAllMessages(
  token: string,
  userId?: number,
  signal?: AbortSignal,
): Promise<AuditMessagesResponse> {
  const res = await picponyRequest('admin_get_all_messages', {
    token,
    query: { _t: Date.now(), user_id: userId || undefined },
    signal,
  });
  return readAdmin(res);
}

/**
 * The original console's contract: `user_id` 0 is a broadcast to every account; `is_important`
 * also mails the message to the recipient (to every account, for a broadcast).
 */
export async function adminSendNotification(
  token: string,
  data: { user_id: number; title: string; content: string; is_important: boolean },
) {
  return picponyPostJson('admin_send_notification', data, { token });
}

/** One page of the sent-notification history: `{ notifications, page, total_pages, total }`. */
export async function adminGetNotifications(
  token: string,
  params: { filter: string; page: number; perPage: number; keyword?: string },
  signal?: AbortSignal,
) {
  const res = await picponyRequest('admin_get_notifications', {
    token,
    query: {
      filter: params.filter,
      page: params.page,
      per_page: params.perPage,
      keyword: params.keyword || undefined,
      _t: Date.now(),
    },
    signal,
  });
  return readAdmin(res);
}

export async function adminDeleteNotification(token: string, id: number) {
  return picponyPostJson('admin_delete_notification', { id }, { token });
}

export async function adminGrantBadge(token: string, data: Record<string, unknown>) {
  return picponyPostJson('admin_grant_badge', data, { token });
}

export async function adminGetBadgeLinks(token: string, signal?: AbortSignal) {
  const res = await picponyRequest('admin_list_badge_links', { token, query: { _t: Date.now() }, signal });
  return readAdmin(res);
}

export async function adminCreateBadgeLink(token: string, data: Record<string, unknown>) {
  return picponyPostJson('admin_create_badge_link', data, { token });
}

export async function adminToggleBadgeLink(token: string, id: number, isActive: number) {
  return picponyPostJson('admin_toggle_badge_link', { id, is_active: isActive }, { token });
}

export async function adminDeleteBadge(token: string, badgeId: number) {
  return picponyPostJson('admin_delete_badge', { badge_id: badgeId }, { token });
}

export async function adminEditBadge(
  token: string,
  data: { badge_id: number; badge_name: string; badge_color: string },
) {
  return picponyPostJson('admin_edit_badge', data, { token });
}

/**
 * The site status document for the console's editors; also carries the global route policy.
 *
 * `lib/route.ts` reads the same document with its own `fetch` on purpose: that module sits on
 * every page's request path, while this one may not be imported outside `/admin` (`api` is a
 * runtime spread, so an import here would pull all 48 admin calls into a gallery bundle).
 * `SiteStatusResponse` is the shared shape, so the two cannot drift on it.
 *
 * **Read with the session's token**, because it is the console's one read of this document
 * (`siteStatusQuery`): the site tools' settings (智能搜索's cloud model, 全站线路's third-party list)
 * are in it too, and they used to be a second, token-bearing read of the same action beside this
 * anonymous one (G2-019).
 */
export async function getMaintenanceStatus(token: string, signal?: AbortSignal): Promise<SiteStatusResponse & Record<string, unknown>> {
  const res = await picponyRequest('get_maintenance_status', { token, query: { _t: Date.now() }, signal, cache: 'no-store' });
  return readAdmin(res);
}

export async function adminToggleMaintenance(
  token: string,
  data: { maintenance_mode: boolean; maintenance_message: string },
) {
  return picponyPostJson('admin_toggle_maintenance', data, { token });
}

export async function adminToggleTranslate(token: string, data: { translate_enabled: boolean }) {
  return picponyPostJson('admin_toggle_translate', data, { token });
}

export async function getSiteStats(signal?: AbortSignal) {
  const res = await picponyRequest('get_site_stats', { query: { _t: Date.now() }, signal });
  return readAdmin(res);
}

export async function adminSyncSiteStats(
  token: string,
  data: { images: number; tags: number; comments: number },
) {
  return picponyPostJson('admin_sync_site_stats', data, { token });
}

export async function adminSaveMascotConfig(
  token: string,
  data: { enabled: boolean; tips?: string[] },
) {
  return picponyPostJson('admin_save_mascot_config', data, { token });
}

export async function adminUploadMascotImage(token: string, file: File) {
  const formData = new FormData();
  formData.append('mascot_file', file);
  return picponyRequest('admin_upload_mascot_image', { token, method: 'POST', body: formData });
}

export async function getBlockTags(token: string, signal?: AbortSignal) {
  const res = await picponyRequest('get_block_tags', { token, query: { _t: Date.now() }, signal });
  return readAdmin(res);
}

export async function adminAddBlockTag(
  token: string,
  data: { filter_key: string; tag_name: string },
) {
  return picponyPostJson('admin_add_block_tag', data, { token });
}

export async function adminRemoveBlockTag(token: string, id: number) {
  return picponyPostJson('admin_remove_block_tag', { id }, { token });
}

export async function adminGetDeveloperPassword(token: string, signal?: AbortSignal) {
  const res = await picponyRequest('admin_get_developer_password', { token, query: { _t: Date.now() }, signal });
  return readAdmin(res);
}

export async function adminRefreshDeveloperPassword(token: string) {
  return picponyRequest('admin_refresh_developer_password', {
    token,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function adminGetDeveloperUsers(token: string, signal?: AbortSignal) {
  const res = await picponyRequest('admin_get_developer_users', { token, query: { _t: Date.now() }, signal });
  return readAdmin(res);
}

export async function adminRevokeDeveloper(token: string, targetId: number) {
  return picponyPostJson('admin_revoke_developer', { target_id: targetId }, { token });
}

export async function adminEnableDeveloper(token: string, targetId: number) {
  return picponyPostJson('admin_enable_developer', { target_id: targetId }, { token });
}

/**
 * The roster as the console edits it: `include_all=1`, the original console's read, which also
 * carries each member's bound account (`user_id`, `account_avatar`) and the editors' automatic
 * ranking. /about reads the public roster (`getTeamMembers`).
 */
export async function adminGetTeamMembers(token: string, signal?: AbortSignal) {
  const res = await picponyRequest('get_team_members', { token, query: { include_all: 1, _t: Date.now() }, signal });
  return readAdmin(res);
}

export async function addTeamMember(token: string, data: Record<string, unknown>) {
  return picponyPostJson('add_team_member', data, { token });
}

export async function updateTeamMember(token: string, data: Record<string, unknown>) {
  return picponyPostJson('update_team_member', data, { token });
}

export async function deleteTeamMember(token: string, id: number) {
  return picponyPostJson('delete_team_member', { id }, { token });
}

/** Envelope read for the glossary's feedback panel; `feedbacks` is always an array. */
export async function getTagFeedback(
  token: string,
  params: { status?: string; keyword?: string; page?: number; limit?: number } = {},
  signal?: AbortSignal,
) {
  const res = await picponyRequest('admin_get_tag_feedback', {
    token,
    query: {
      status: params.status || undefined,
      keyword: params.keyword || undefined,
      page: params.page ?? 1,
      limit: params.limit ?? 40,
      _t: Date.now(),
    },
    signal,
  });
  const data = await readAdmin(res);
  if (data?.success === true) {
    if (!Array.isArray(data.feedbacks)) throw new ApiError('invalid', { message: '反馈加载失败' });
    data.feedbacks = data.feedbacks.filter((row: unknown) => row && typeof row === 'object');
    if (!data.summary || typeof data.summary !== 'object') delete data.summary;
    if (!data.pagination || typeof data.pagination !== 'object') delete data.pagination;
  }
  return data;
}

export async function handleTagFeedback(
  token: string,
  id: number,
  status: string,
  note?: string,
  expectedStatus?: string,
) {
  const body: Record<string, unknown> = { id, status };
  if (note) body.note = note;
  if (expectedStatus) body.expected_status = expectedStatus;
  return picponyPostJson('admin_handle_tag_feedback', body, { token });
}

/** Pages of the keyword search `checkTagExists` reads before it answers "absent". */
const TAG_EXISTS_PAGE = 50;
const TAG_EXISTS_MAX_PAGES = 10;

export async function checkTagExists(token: string, enTag: string, signal?: AbortSignal) {
  /* A row with a null `en` must not throw an engine error into a Chinese toast. */
  const wanted = enTag.toLowerCase();
  /* `keyword` is a fuzzy match, so a popular stem (`pony`) can push the exact entry past the first
     page; reading only page 1 answered "absent" and the glossary created a duplicate (review
     P1-F17). Pages are read until a short one, bounded. */
  for (let page = 1; page <= TAG_EXISTS_MAX_PAGES; page += 1) {
    const res = await picponyRequest('get_dictionary', {
      token,
      query: { page, limit: TAG_EXISTS_PAGE, keyword: enTag, _t: Date.now() },
      signal,
    });
    const data = await readJson(res);
    if (!(res.ok && data.success && Array.isArray(data.tags))) throw new Error(envelopeMessage(data) || '标签查询失败');
    if (data.tags.some((t: { en?: unknown }) => String(t?.en ?? '').toLowerCase() === wanted)) return true;
    if (data.tags.length < TAG_EXISTS_PAGE) return false;
  }
  return false;
}

/**
 * The glossary's batch writes, as the original glossary editor (`ciku.html`) sends them: one
 * request, deduplicated and checked by the backend, instead of an existence read and a save per
 * line 60ms apart. `create_only` skips a tag the dictionary already holds. Answers
 * `{ created, skipped, failed }`.
 */
export async function batchImportDictionaryTags(
  token: string,
  tasks: { en: string; cn: string; aliases: string[]; cat: string; count: number; description: string }[],
) {
  return picponyPostJson('batch_import_dictionary_tags', { mode: 'create_only', tasks }, { token });
}

/** Deletes the given dictionary rows in one request; answers `{ deleted_count }`. */
export async function batchDeleteDictionaryTags(token: string, ids: number[]) {
  return picponyPostJson('batch_delete_dictionary_tags', { ids }, { token });
}

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
