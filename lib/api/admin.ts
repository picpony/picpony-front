import { PICPONY_API_BASE } from '@/lib/constants';
import { readJson } from './client';

// ---------------------------------------------------------------------------
// 用户管理
// ---------------------------------------------------------------------------

export async function adminGetUsers(token: string) {
  const res = await fetch(`${PICPONY_API_BASE}?action=admin_get_users&_t=${Date.now()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return readJson(res);
}

export async function adminUpdateUser(token: string, data: Record<string, unknown>) {
  return fetch(`${PICPONY_API_BASE}?action=admin_update_user`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function adminDeleteUser(token: string, targetId: number) {
  return fetch(`${PICPONY_API_BASE}?action=admin_delete_user`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_id: targetId }),
  });
}

// ---------------------------------------------------------------------------
// 财富管理
// ---------------------------------------------------------------------------

export async function adminGetWealth(token: string) {
  const res = await fetch(`${PICPONY_API_BASE}?action=admin_get_users&_t=${Date.now()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return readJson(res);
}

export async function adminUpdateWealth(token: string, data: Record<string, unknown>) {
  return fetch(`${PICPONY_API_BASE}?action=admin_update_wealth`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

// ---------------------------------------------------------------------------
// 商店管理
// ---------------------------------------------------------------------------

export async function adminGetShopItems(token: string) {
  const res = await fetch(`${PICPONY_API_BASE}?action=get_shop_items&_t=${Date.now()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return readJson(res);
}

export async function adminSaveShopItem(token: string, data: Record<string, unknown>) {
  return fetch(`${PICPONY_API_BASE}?action=admin_save_shop_item`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function adminDeleteShopItem(token: string, id: number) {
  return fetch(`${PICPONY_API_BASE}?action=admin_delete_shop_item`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
}

// ---------------------------------------------------------------------------
// 举报管理
// ---------------------------------------------------------------------------

export async function adminGetReports(token: string) {
  const res = await fetch(`${PICPONY_API_BASE}?action=admin_get_reports&_t=${Date.now()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return readJson(res);
}

export async function adminHandleReport(token: string, reportId: number, status: string) {
  return fetch(`${PICPONY_API_BASE}?action=admin_handle_report`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ report_id: reportId, status }),
  });
}

// ---------------------------------------------------------------------------
// 黑名单管理
// ---------------------------------------------------------------------------

export async function adminGetBlacklist(token: string) {
  const res = await fetch(`${PICPONY_API_BASE}?action=admin_get_blacklist&_t=${Date.now()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return readJson(res);
}

export async function adminAddBlacklist(token: string, imageId: number, reason: string) {
  return fetch(`${PICPONY_API_BASE}?action=admin_add_blacklist`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_id: imageId, reason }),
  });
}

export async function adminRemoveBlacklist(token: string, imageId: number) {
  return fetch(`${PICPONY_API_BASE}?action=admin_remove_blacklist`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_id: imageId }),
  });
}

// ---------------------------------------------------------------------------
// 公告管理
// ---------------------------------------------------------------------------

export async function saveAnnouncement(
  token: string,
  data: { version: string; title: string; content: string },
) {
  return fetch(`${PICPONY_API_BASE}?action=save_announcement`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function adminDeleteAnnouncement(token: string, id: number) {
  return fetch(`${PICPONY_API_BASE}?action=admin_delete_announcement`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
}

// ---------------------------------------------------------------------------
// 消息审计
// ---------------------------------------------------------------------------

export async function adminGetAllMessages(token: string, userId?: number) {
  let url = `${PICPONY_API_BASE}?action=admin_get_all_messages&_t=${Date.now()}`;
  if (userId) url += `&user_id=${userId}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  return readJson(res);
}

// ---------------------------------------------------------------------------
// 通知管理
// ---------------------------------------------------------------------------

export async function adminSendNotification(
  token: string,
  data: { user_id: number; title: string; content: string },
) {
  return fetch(`${PICPONY_API_BASE}?action=admin_send_notification`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function adminGetNotifications(token: string, filter: string = 'all') {
  const res = await fetch(
    `${PICPONY_API_BASE}?action=admin_get_notifications&filter=${filter}&_t=${Date.now()}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  return readJson(res);
}

export async function adminDeleteNotification(token: string, id: number) {
  return fetch(`${PICPONY_API_BASE}?action=admin_delete_notification`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
}

// ---------------------------------------------------------------------------
// 徽章管理
// ---------------------------------------------------------------------------

export async function adminGrantBadge(token: string, data: Record<string, unknown>) {
  return fetch(`${PICPONY_API_BASE}?action=admin_grant_badge`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function adminGetBadgeLinks(token: string) {
  const res = await fetch(`${PICPONY_API_BASE}?action=admin_list_badge_links&_t=${Date.now()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return readJson(res);
}

export async function adminCreateBadgeLink(token: string, data: Record<string, unknown>) {
  return fetch(`${PICPONY_API_BASE}?action=admin_create_badge_link`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function adminToggleBadgeLink(token: string, id: number, isActive: number) {
  return fetch(`${PICPONY_API_BASE}?action=admin_toggle_badge_link`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, is_active: isActive }),
  });
}

export async function adminDeleteBadge(token: string, badgeId: number) {
  return fetch(`${PICPONY_API_BASE}?action=admin_delete_badge`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ badge_id: badgeId }),
  });
}

export async function adminEditBadge(
  token: string,
  data: { badge_id: number; badge_name: string; badge_color: string },
) {
  return fetch(`${PICPONY_API_BASE}?action=admin_edit_badge`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

// ---------------------------------------------------------------------------
// 运维管理
// ---------------------------------------------------------------------------

export async function getMaintenanceStatus() {
  const res = await fetch(`${PICPONY_API_BASE}?action=get_maintenance_status&_t=${Date.now()}`);
  return readJson(res);
}

export async function adminToggleMaintenance(
  token: string,
  data: { maintenance_mode: boolean; maintenance_message: string },
) {
  return fetch(`${PICPONY_API_BASE}?action=admin_toggle_maintenance`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function adminToggleTranslate(token: string, data: { translate_enabled: boolean }) {
  return fetch(`${PICPONY_API_BASE}?action=admin_toggle_translate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function getSiteStats() {
  const res = await fetch(`${PICPONY_API_BASE}?action=get_site_stats&_t=${Date.now()}`);
  return readJson(res);
}

export async function adminSyncSiteStats(
  token: string,
  data: { images: number; tags: number; comments: number },
) {
  return fetch(`${PICPONY_API_BASE}?action=admin_sync_site_stats`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

// ---------------------------------------------------------------------------
// 吉祥物管理
// ---------------------------------------------------------------------------

export async function adminGetMascotConfig(token: string) {
  const res = await fetch(`${PICPONY_API_BASE}?action=admin_get_mascot_config&_t=${Date.now()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return readJson(res);
}

export async function adminSaveMascotConfig(
  token: string,
  data: { enabled: boolean; tips: string[] },
) {
  return fetch(`${PICPONY_API_BASE}?action=admin_save_mascot_config`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function adminUploadMascotImage(token: string, file: File) {
  const formData = new FormData();
  formData.append('mascot_file', file);
  return fetch(`${PICPONY_API_BASE}?action=admin_upload_mascot_image`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
}

export async function adminDeleteMascotImage(token: string) {
  return fetch(`${PICPONY_API_BASE}?action=admin_delete_mascot_image`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ---------------------------------------------------------------------------
// 屏蔽标签管理
// ---------------------------------------------------------------------------

export async function getBlockTags(token: string) {
  const res = await fetch(`${PICPONY_API_BASE}?action=get_block_tags&_t=${Date.now()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return readJson(res);
}

export async function adminAddBlockTag(
  token: string,
  data: { filter_key: string; tag_name: string },
) {
  return fetch(`${PICPONY_API_BASE}?action=admin_add_block_tag`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function adminRemoveBlockTag(token: string, id: number) {
  return fetch(`${PICPONY_API_BASE}?action=admin_remove_block_tag`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
}

// ---------------------------------------------------------------------------
// 开发者管理
// ---------------------------------------------------------------------------

export async function adminGetDeveloperPassword(token: string) {
  const res = await fetch(
    `${PICPONY_API_BASE}?action=admin_get_developer_password&_t=${Date.now()}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  return readJson(res);
}

export async function adminRefreshDeveloperPassword(token: string) {
  return fetch(`${PICPONY_API_BASE}?action=admin_refresh_developer_password`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
}

export async function adminGetDeveloperUsers(token: string) {
  const res = await fetch(`${PICPONY_API_BASE}?action=admin_get_developer_users&_t=${Date.now()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return readJson(res);
}

export async function adminRevokeDeveloper(token: string, targetId: number) {
  return fetch(`${PICPONY_API_BASE}?action=admin_revoke_developer`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_id: targetId }),
  });
}

export async function adminEnableDeveloper(token: string, targetId: number) {
  return fetch(`${PICPONY_API_BASE}?action=admin_enable_developer`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_id: targetId }),
  });
}

// ---------------------------------------------------------------------------
// 团队管理
// ---------------------------------------------------------------------------

export async function getTeamMembers() {
  const res = await fetch(`${PICPONY_API_BASE}?action=get_team_members&_t=${Date.now()}`);
  return readJson(res);
}

export async function addTeamMember(token: string, data: Record<string, unknown>) {
  return fetch(`${PICPONY_API_BASE}?action=add_team_member`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function updateTeamMember(token: string, data: Record<string, unknown>) {
  return fetch(`${PICPONY_API_BASE}?action=update_team_member`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function deleteTeamMember(token: string, id: number) {
  return fetch(`${PICPONY_API_BASE}?action=delete_team_member`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
}

// ---------------------------------------------------------------------------
// 标签反馈管理
// ---------------------------------------------------------------------------

export async function getTagFeedback(
  token: string,
  params: { status?: string; keyword?: string; page?: number; limit?: number } = {},
) {
  const search = new URLSearchParams();
  search.set('action', 'admin_get_tag_feedback');
  if (params.status) search.set('status', params.status);
  if (params.keyword) search.set('keyword', params.keyword);
  search.set('page', String(params.page ?? 1));
  search.set('limit', String(params.limit ?? 40));
  search.set('_t', String(Date.now()));
  const res = await fetch(`${PICPONY_API_BASE}?${search}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return readJson(res);
}

export async function handleTagFeedback(token: string, id: number, status: string) {
  return fetch(`${PICPONY_API_BASE}?action=admin_handle_tag_feedback`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, status }),
  });
}

export async function checkTagExists(token: string, enTag: string) {
  const url = `${PICPONY_API_BASE}?action=get_dictionary&page=1&limit=50&keyword=${encodeURIComponent(enTag)}&_t=${Date.now()}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await readJson(res);
  if (data.success && data.tags) {
    return data.tags.some((t: { en: string }) => t.en.toLowerCase() === enTag.toLowerCase());
  }
  return false;
}
