import { PICPONY_API_BASE, SEARCH_IMAGE_API } from '@/lib/constants';
import type { ForumPostsResponse, ForumPostDetailResponse } from '@/lib/types/forum';
import type {
  ContactsResponse,
  MessagesResponse,
  InteractionNotificationsResponse,
  UnreadCountsResponse,
} from '@/lib/types/message';
import type { UserCommentsResponse, UserPostsResponse } from '@/lib/types/user';
import type {
  FavesResponse,
  SharedFavesResponse,
  CommentsResponse,
  Comment,
} from '@/lib/types/image';
import type { CaptchaGetResponse, CaptchaVerifyResponse } from '@/lib/types/captcha';
import { proxyFetch, readJson } from './client';
import { DERPIBOORU_API_BASE } from '@/lib/constants';

// ---------------------------------------------------------------------------
// 认证
// ---------------------------------------------------------------------------

export async function login(data: Record<string, unknown>) {
  return fetch(`${PICPONY_API_BASE}?action=login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function register(data: Record<string, unknown>) {
  return fetch(`${PICPONY_API_BASE}?action=register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

// ---------------------------------------------------------------------------
// 用户
// ---------------------------------------------------------------------------

export async function getUser(token: string) {
  return fetch(`${PICPONY_API_BASE}?action=get_user`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getUserProfile(userId: string) {
  const res = await fetch(`${PICPONY_API_BASE}?action=get_user_profile&user_id=${userId}`);
  return readJson(res);
}

export async function changeUsername(token: string, newUsername: string) {
  return fetch(`${PICPONY_API_BASE}?action=change_username`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_username: newUsername }),
  });
}

export async function changePassword(token: string, data: Record<string, unknown>) {
  return fetch(`${PICPONY_API_BASE}?action=change_password`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
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
  return fetch(`${PICPONY_API_BASE}?action=save_profile`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function uploadAvatar(token: string, file: File) {
  const formData = new FormData();
  formData.append('avatar', file);
  return fetch(`${PICPONY_API_BASE}?action=upload_avatar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
}

export async function uploadBanner(token: string, file: File) {
  const formData = new FormData();
  formData.append('banner', file);
  return fetch(`${PICPONY_API_BASE}?action=upload_banner`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
}

export async function getFaves(token: string): Promise<FavesResponse> {
  const res = await fetch(`${PICPONY_API_BASE}?action=get_faves`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return readJson(res);
}

export async function toggleFave(token: string, imageId: number) {
  return fetch(`${PICPONY_API_BASE}?action=toggle_fave`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_id: imageId }),
  });
}

export async function getSharedFaves(username: string): Promise<SharedFavesResponse> {
  const res = await fetch(
    `${PICPONY_API_BASE}?action=get_shared_faves&username=${encodeURIComponent(username)}`,
  );
  if (!res.ok) throw new Error('获取收藏夹失败');
  return readJson(res);
}

export async function getSharedFavesByUsername(username: string): Promise<SharedFavesResponse> {
  const res = await fetch(
    `${PICPONY_API_BASE}?action=get_shared_faves&username=${encodeURIComponent(username)}`,
  );
  if (!res.ok) throw new Error('获取收藏夹失败');
  return readJson(res);
}

// ---------------------------------------------------------------------------
// 评论
// ---------------------------------------------------------------------------

export async function postComment(token: string, imageId: number, body: string) {
  return fetch(`${PICPONY_API_BASE}?action=post_comment`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_id: imageId, body }),
  });
}

export async function getComments(imageId: string): Promise<CommentsResponse> {
  try {
    const [picponyRes, trixieRes] = await Promise.all([
      fetch(`${PICPONY_API_BASE}?action=get_comments&image_id=${imageId}`).catch(() => null),
      proxyFetch(
        `${DERPIBOORU_API_BASE}/search/comments?q=image_id:${imageId}&page=1&per_page=25`,
      ).catch(() => null),
    ]);

    let comments: Comment[] = [];

    if (picponyRes && picponyRes.ok) {
      const picponyData = await picponyRes.json();
      if (picponyData.success && picponyData.comments) {
        comments = comments.concat(
          picponyData.comments.map((c: Comment) => ({
            ...c,
            source: 'picpony' as const,
          })),
        );
      }
    }

    if (trixieRes && trixieRes.ok) {
      const trixieData = await trixieRes.json();
      if (trixieData.comments) {
        comments = comments.concat(
          trixieData.comments.map(
            (c: {
              id: number;
              body: string;
              created_at: string;
              user_id: number;
              author: string;
              avatar: string | null;
            }) => ({
              id: c.id,
              body: c.body,
              created_at: c.created_at,
              user_id: c.user_id,
              username: c.author,
              avatar: c.avatar,
              source: 'trixiebooru' as const,
            }),
          ),
        );
      }
    }

    comments.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    return { success: true, comments };
  } catch (err) {
    console.error('Failed to fetch comments', err);
    return { success: false, comments: [] };
  }
}

export async function getUserComments(
  userId: string,
  page: number = 1,
): Promise<UserCommentsResponse> {
  const res = await fetch(
    `${PICPONY_API_BASE}?action=get_user_comments&user_id=${userId}&page=${page}`,
    {
      cache: 'no-store',
    },
  );
  if (!res.ok) throw new Error('获取用户评论失败');
  return readJson(res);
}

export async function getUserPosts(userId: string, page: number = 1): Promise<UserPostsResponse> {
  const res = await fetch(
    `${PICPONY_API_BASE}?action=get_user_posts&user_id=${userId}&page=${page}`,
    {
      cache: 'no-store',
    },
  );
  if (!res.ok) throw new Error('获取用户帖子失败');
  return readJson(res);
}

// ---------------------------------------------------------------------------
// 论坛
// ---------------------------------------------------------------------------

export async function getForumPosts(page: number = 1): Promise<ForumPostsResponse> {
  const res = await fetch(`${PICPONY_API_BASE}?action=get_forum_posts&page=${page}`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('Failed to fetch forum posts');
  return readJson(res);
}

export async function getForumPostDetail(
  id: string,
  page: number = 1,
): Promise<ForumPostDetailResponse> {
  const res = await fetch(
    `${PICPONY_API_BASE}?action=get_forum_post_detail&id=${id}&page=${page}`,
    {
      cache: 'no-store',
    },
  );
  if (!res.ok) throw new Error('Failed to fetch forum post detail');
  return readJson(res);
}

export async function createForumPost(
  token: string,
  data: {
    title: string;
    content: string;
    cover_image?: string;
    category?: string;
  },
) {
  return fetch(`${PICPONY_API_BASE}?action=create_forum_post`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function createForumComment(
  token: string,
  postId: number,
  content: string,
  replyToUserId?: number,
  replyToCommentId?: number,
) {
  const body: Record<string, unknown> = { post_id: postId, content };
  if (replyToUserId) body.reply_to_user_id = replyToUserId;
  if (replyToCommentId) body.reply_to_comment_id = replyToCommentId;
  return fetch(`${PICPONY_API_BASE}?action=create_forum_comment`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function toggleForumPostLike(token: string, postId: number) {
  return fetch(`${PICPONY_API_BASE}?action=toggle_forum_post_like`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: postId }),
  });
}

export async function uploadForumImage(token: string, file: File) {
  const formData = new FormData();
  formData.append('image', file);
  return fetch(`${PICPONY_API_BASE}?action=upload_forum_image`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
}

// ---------------------------------------------------------------------------
// 消息 & 通知
// ---------------------------------------------------------------------------

export async function getNotifications(token: string) {
  const res = await fetch(`${PICPONY_API_BASE}?action=get_notifications`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return readJson(res);
}

export async function getInteractionNotifications(
  token: string,
  page: number = 1,
): Promise<InteractionNotificationsResponse> {
  const timestamp = Date.now();
  const res = await fetch(
    `${PICPONY_API_BASE}?action=get_notifications&type=interaction&page=${page}&_t=${timestamp}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return readJson(res);
}

export async function getRecentContacts(token: string): Promise<ContactsResponse> {
  const res = await fetch(`${PICPONY_API_BASE}?action=get_recent_contacts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return readJson(res);
}

export async function getMessages(token: string, withUserId: number): Promise<MessagesResponse> {
  const res = await fetch(`${PICPONY_API_BASE}?action=get_messages&with_user_id=${withUserId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return readJson(res);
}

export async function getUnreadCounts(token: string): Promise<UnreadCountsResponse> {
  const res = await fetch(`${PICPONY_API_BASE}?action=get_unread_counts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return readJson(res);
}

export async function sendMessage(token: string, receiverId: number, content: string) {
  return fetch(`${PICPONY_API_BASE}?action=send_message`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ receiver_id: receiverId, content }),
  });
}

// ---------------------------------------------------------------------------
// 验证码
// ---------------------------------------------------------------------------

export async function captchaGet(): Promise<CaptchaGetResponse> {
  const res = await fetch(`${PICPONY_API_BASE}?action=captcha_get`, {
    cache: 'no-store',
  });
  return readJson(res);
}

export async function captchaVerify(x: number, track?: string): Promise<CaptchaVerifyResponse> {
  const body: Record<string, unknown> = { x };
  if (track) body.track = track;
  const res = await fetch(`${PICPONY_API_BASE}?action=captcha_verify`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readJson(res);
}

// ---------------------------------------------------------------------------
// 公告
// ---------------------------------------------------------------------------

export async function getAnnouncement() {
  const res = await fetch(`${PICPONY_API_BASE}?action=get_announcement`);
  return readJson(res);
}

export async function getAnnouncementHistory() {
  const res = await fetch(`${PICPONY_API_BASE}?action=get_announcement_history`);
  return readJson(res);
}

// ---------------------------------------------------------------------------
// API Key / Derpibooru 帐号关联
// ---------------------------------------------------------------------------

export async function saveApikey(
  token: string,
  data: { api_key: string; derpi_user_id: string; derpi_username: string },
) {
  return fetch(`${PICPONY_API_BASE}?action=save_apikey`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

export async function updateSettings(token: string, data: Record<string, unknown>) {
  return fetch(`${PICPONY_API_BASE}?action=update_settings`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function updateEmail(token: string, email: string) {
  return fetch(`${PICPONY_API_BASE}?action=update_email`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

export async function verifyEmail(token: string, code: string) {
  return fetch(`${PICPONY_API_BASE}?action=verify_email`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
}

export async function resendVerifyCode(token: string) {
  return fetch(`${PICPONY_API_BASE}?action=resend_verify_code`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

export async function verifyEmailById(userId: number, code: string) {
  return fetch(`${PICPONY_API_BASE}?action=verify_email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, code }),
  });
}

export async function resendVerifyCodeById(userId: number) {
  return fetch(`${PICPONY_API_BASE}?action=resend_verify_code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId }),
  });
}

// ---------------------------------------------------------------------------
// 报告
// ---------------------------------------------------------------------------

export async function reportImage(token: string, imageId: number, reason: string) {
  return fetch(`${PICPONY_API_BASE}?action=report_image`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_id: imageId, reason }),
  });
}

// ---------------------------------------------------------------------------
// 密码重置
// ---------------------------------------------------------------------------

export async function resetPasswordRequest(email: string) {
  return fetch(`${PICPONY_API_BASE}?action=reset_password_request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

export async function resetPassword(data: { email: string; code: string; new_password: string }) {
  return fetch(`${PICPONY_API_BASE}?action=reset_password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

// ---------------------------------------------------------------------------
// 以图搜图
// ---------------------------------------------------------------------------

export async function searchImage(imageFile: File, distance: number) {
  const formData = new FormData();
  formData.append('imageFile', imageFile);
  formData.append('distance', distance.toString());

  const response = await fetch(SEARCH_IMAGE_API, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error('搜索请求失败');
  }

  return readJson(response);
}

// ---------------------------------------------------------------------------
// 浏览历史
// ---------------------------------------------------------------------------

export async function getBrowsingHistory(token: string, page: number = 1) {
  const res = await fetch(
    `${PICPONY_API_BASE}?action=get_browsing_history&page=${page}&_t=${Date.now()}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  return readJson(res);
}

export async function clearBrowsingHistory(token: string) {
  return fetch(`${PICPONY_API_BASE}?action=clear_browsing_history`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function deleteBrowsingHistoryItem(token: string, imageId: number) {
  return fetch(`${PICPONY_API_BASE}?action=delete_browsing_history_item`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_id: imageId }),
  });
}

/** 记录每周上传任务进度（上传作品成功后调用，fire-and-forget） */
export async function recordWeeklyUpload(token: string) {
  return fetch(`${PICPONY_API_BASE}?action=record_weekly_upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}

/** 记录浏览历史（打开图片详情时调用，与完整版前端 add_browsing_history 一致） */
export async function addBrowsingHistory(
  token: string,
  params: { image_id: number; preview_url: string; uploader: string },
) {
  return fetch(`${PICPONY_API_BASE}?action=add_browsing_history`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

// ---------------------------------------------------------------------------
// 隐私收藏（需要隐私密码）
// ---------------------------------------------------------------------------

export async function checkHasPrivacyPassword(token: string) {
  const res = await fetch(
    `${PICPONY_API_BASE}?action=check_has_privacy_password&_t=${Date.now()}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  return readJson(res);
}

export async function setPrivacyPassword(token: string, password: string) {
  return fetch(`${PICPONY_API_BASE}?action=set_privacy_password`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
}

export async function verifyPrivacyPassword(token: string, password: string) {
  return fetch(`${PICPONY_API_BASE}?action=verify_privacy_password`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
}

export async function getPrivacyFaves(token: string) {
  const res = await fetch(`${PICPONY_API_BASE}?action=get_privacy_faves&_t=${Date.now()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return readJson(res);
}

export async function addPrivacyFave(
  token: string,
  imageId: number,
  imageData: Record<string, unknown>,
) {
  return fetch(`${PICPONY_API_BASE}?action=add_privacy_fave`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_id: imageId, image_data: imageData }),
  });
}

export async function removePrivacyFave(token: string, imageId: number) {
  return fetch(`${PICPONY_API_BASE}?action=remove_privacy_fave`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_id: imageId }),
  });
}

// ---------------------------------------------------------------------------
// 徽章
// ---------------------------------------------------------------------------

export async function getMyBadges(token: string) {
  const res = await fetch(`${PICPONY_API_BASE}?action=get_my_badges&_t=${Date.now()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return readJson(res);
}

export async function equipBadge(token: string, badgeName: string | null) {
  return fetch(`${PICPONY_API_BASE}?action=equip_badge`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ badge_name: badgeName }),
  });
}

// ---------------------------------------------------------------------------
// 任务 / 等级
// ---------------------------------------------------------------------------

export async function getTasks(token: string) {
  const res = await fetch(`${PICPONY_API_BASE}?action=get_tasks&_t=${Date.now()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return readJson(res);
}

export async function claimTask(token: string, taskType: string) {
  return fetch(`${PICPONY_API_BASE}?action=claim_task`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_type: taskType }),
  });
}

export async function getCoinTransactions(token: string, page: number = 1) {
  const res = await fetch(
    `${PICPONY_API_BASE}?action=get_coin_transactions&page=${page}&_t=${Date.now()}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  return readJson(res);
}

// ---------------------------------------------------------------------------
// 屏蔽组
// ---------------------------------------------------------------------------

export async function getBlockGroups(token: string) {
  const res = await fetch(`${PICPONY_API_BASE}?action=get_block_groups&_t=${Date.now()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return readJson(res);
}

export async function saveBlockGroup(
  token: string,
  data: {
    id?: number;
    name: string;
    tags: string[];
    hidden_tags?: string | string[];
    spoilered_tags?: string | string[];
  },
) {
  return fetch(`${PICPONY_API_BASE}?action=save_block_group`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function deleteBlockGroup(token: string, id: number) {
  return fetch(`${PICPONY_API_BASE}?action=delete_block_group`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
}

export async function toggleBlockGroup(token: string, id: number, isActive: number) {
  return fetch(`${PICPONY_API_BASE}?action=toggle_block_group`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, is_active: isActive }),
  });
}

// ---------------------------------------------------------------------------
// 词典 / 标签翻译
// ---------------------------------------------------------------------------

export async function getGlossaryEntries(token: string) {
  const res = await fetch(`${PICPONY_API_BASE}?action=get_glossary_entries`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return readJson(res);
}

export async function createGlossaryEntry(
  token: string,
  data: { term: string; definition: string },
) {
  return fetch(`${PICPONY_API_BASE}?action=create_glossary_entry`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function updateGlossaryEntry(
  token: string,
  id: number,
  data: { term: string; definition: string },
) {
  return fetch(`${PICPONY_API_BASE}?action=update_glossary_entry`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...data }),
  });
}

export async function deleteGlossaryEntry(token: string, id: number) {
  return fetch(`${PICPONY_API_BASE}?action=delete_glossary_entry`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
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
) {
  const searchParams = new URLSearchParams();
  searchParams.append('action', 'get_dictionary');
  if (params.page) searchParams.append('page', params.page.toString());
  if (params.limit) searchParams.append('limit', params.limit.toString());
  if (params.keyword) searchParams.append('keyword', params.keyword);
  if (params.sort) searchParams.append('sort', params.sort);
  if (params.category) searchParams.append('category', params.category);
  if (params.untranslated !== undefined)
    searchParams.append('untranslated', params.untranslated.toString());
  if (params.wiki_overlap !== undefined)
    searchParams.append('wiki_overlap', params.wiki_overlap.toString());
  searchParams.append('_t', Date.now().toString());

  const res = await fetch(`${PICPONY_API_BASE}?${searchParams.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return readJson(res);
}

export async function getDictionaryDuplicates(token: string) {
  const res = await fetch(`${PICPONY_API_BASE}?action=get_duplicates&_t=${Date.now()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return readJson(res);
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
  return fetch(`${PICPONY_API_BASE}?action=save_dictionary_tag`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function deleteDictionaryTag(token: string, id: number) {
  return fetch(`${PICPONY_API_BASE}?action=delete_dictionary_tag`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
}

export async function getDictionaryLeaderboard() {
  const res = await fetch(`${PICPONY_API_BASE}?action=get_dictionary_leaderboard&_t=${Date.now()}`);
  return readJson(res);
}

/** 获取某个词库标签的编辑历史（按时间倒序） */
export async function getDictionaryTagHistory(token: string, tagId: number) {
  const res = await fetch(
    `${PICPONY_API_BASE}?action=get_dictionary_tag_history&tag_id=${encodeURIComponent(tagId)}&_t=${Date.now()}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return readJson(res);
}

// ---------------------------------------------------------------------------
// 标签组
// ---------------------------------------------------------------------------

export async function getTagGroups(token: string) {
  const res = await fetch(`${PICPONY_API_BASE}?action=get_tag_groups&_t=${Date.now()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return readJson(res);
}

export async function saveTagGroup(
  token: string,
  data: { id?: number; name: string; tags: string[] },
) {
  return fetch(`${PICPONY_API_BASE}?action=save_tag_group`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function deleteTagGroup(token: string, id: number) {
  return fetch(`${PICPONY_API_BASE}?action=delete_tag_group`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
}
