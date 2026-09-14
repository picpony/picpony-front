import type { SiteStatusResponse } from '@/lib/types/site';
import type { AuditMessagesResponse } from '@/lib/types/message';
import { picponyPostJson, picponyRequest, readJson } from './http';

export async function adminGetUsers(token: string, signal?: AbortSignal) {
  const res = await picponyRequest('admin_get_users', { token, query: { _t: Date.now() }, signal });
  return readJson(res);
}

export async function adminUpdateUser(token: string, data: Record<string, unknown>) {
  return picponyPostJson('admin_update_user', data, { token });
}

export async function adminDeleteUser(token: string, targetId: number) {
  return picponyPostJson('admin_delete_user', { target_id: targetId }, { token });
}

export const adminGetWealth = adminGetUsers;

export async function adminUpdateWealth(token: string, data: Record<string, unknown>) {
  return picponyPostJson('admin_update_wealth', data, { token });
}

export async function adminGetShopItems(token: string, signal?: AbortSignal) {
  const res = await picponyRequest('get_shop_items', { token, query: { _t: Date.now() }, signal });
  return readJson(res);
}

export async function adminSaveShopItem(token: string, data: Record<string, unknown>) {
  return picponyPostJson('admin_save_shop_item', data, { token });
}

export async function adminDeleteShopItem(token: string, id: number) {
  return picponyPostJson('admin_delete_shop_item', { id }, { token });
}

export async function adminGetReports(token: string, signal?: AbortSignal) {
  const res = await picponyRequest('admin_get_reports', { token, query: { _t: Date.now() }, signal });
  return readJson(res);
}

export async function adminHandleReport(token: string, reportId: number, status: string) {
  return picponyPostJson('admin_handle_report', { report_id: reportId, status }, { token });
}

export async function adminGetBlacklist(token: string, signal?: AbortSignal) {
  const res = await picponyRequest('admin_get_blacklist', { token, query: { _t: Date.now() }, signal });
  return readJson(res);
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
  return readJson(res);
}

export async function adminSendNotification(
  token: string,
  data: { user_id: number; title: string; content: string },
) {
  return picponyPostJson('admin_send_notification', data, { token });
}

export async function adminGetNotifications(token: string, filter: string = 'all', signal?: AbortSignal) {
  const res = await picponyRequest('admin_get_notifications', {
    token,
    query: { filter, _t: Date.now() },
    signal,
  });
  return readJson(res);
}

export async function adminDeleteNotification(token: string, id: number) {
  return picponyPostJson('admin_delete_notification', { id }, { token });
}

export async function adminGrantBadge(token: string, data: Record<string, unknown>) {
  return picponyPostJson('admin_grant_badge', data, { token });
}

export async function adminGetBadgeLinks(token: string, signal?: AbortSignal) {
  const res = await picponyRequest('admin_list_badge_links', { token, query: { _t: Date.now() }, signal });
  return readJson(res);
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
 */
export async function getMaintenanceStatus(signal?: AbortSignal): Promise<SiteStatusResponse> {
  const res = await picponyRequest('get_maintenance_status', { query: { _t: Date.now() }, signal });
  return readJson(res);
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
  return readJson(res);
}

export async function adminSyncSiteStats(
  token: string,
  data: { images: number; tags: number; comments: number },
) {
  return picponyPostJson('admin_sync_site_stats', data, { token });
}

export async function adminGetMascotConfig(token: string) {
  const res = await picponyRequest('admin_get_mascot_config', { token, query: { _t: Date.now() } });
  return readJson(res);
}

export async function adminSaveMascotConfig(
  token: string,
  data: { enabled: boolean; tips: string[] },
) {
  return picponyPostJson('admin_save_mascot_config', data, { token });
}

export async function adminUploadMascotImage(token: string, file: File) {
  const formData = new FormData();
  formData.append('mascot_file', file);
  return picponyRequest('admin_upload_mascot_image', { token, method: 'POST', body: formData });
}

export async function adminDeleteMascotImage(token: string) {
  return picponyRequest('admin_delete_mascot_image', { token, method: 'POST' });
}

export async function getBlockTags(token: string, signal?: AbortSignal) {
  const res = await picponyRequest('get_block_tags', { token, query: { _t: Date.now() }, signal });
  return readJson(res);
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
  return readJson(res);
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
  return readJson(res);
}

export async function adminRevokeDeveloper(token: string, targetId: number) {
  return picponyPostJson('admin_revoke_developer', { target_id: targetId }, { token });
}

export async function adminEnableDeveloper(token: string, targetId: number) {
  return picponyPostJson('admin_enable_developer', { target_id: targetId }, { token });
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

export async function getTagFeedback(
  token: string,
  params: { status?: string; keyword?: string; page?: number; limit?: number } = {},
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
  });
  return readJson(res);
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

export async function checkTagExists(token: string, enTag: string) {
  const res = await picponyRequest('get_dictionary', {
    token,
    query: { page: 1, limit: 50, keyword: enTag, _t: Date.now() },
  });
  const data = await readJson(res);
  if (res.ok && data.success && Array.isArray(data.tags)) {
    return data.tags.some((t: { en: string }) => t.en.toLowerCase() === enTag.toLowerCase());
  }
  throw new Error(data.error || data.message || '标签查询失败');
}
