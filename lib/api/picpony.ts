import { DERPIBOORU_API_BASE, SEARCH_IMAGE_API } from '@/lib/constants';
import type { ForumPostsResponse, ForumPostDetailResponse } from '@/lib/types/forum';
import type {
  ContactsResponse,
  MessagesResponse,
  InteractionNotificationsResponse,
  UnreadCountsResponse,
} from '@/lib/types/message';
import type { UserCommentsResponse, UserPostsResponse, UserUpload, UserUploadsResponse } from '@/lib/types/user';
import type {
  FavesResponse,
  SharedFavesResponse,
  CommentsResponse,
  Comment,
} from '@/lib/types/image';
import type { CaptchaGetResponse, CaptchaVerifyResponse } from '@/lib/types/captcha';
import { proxyFetch } from './client';
import { picponyPostJson, picponyRequest, readJson } from './http';

export async function login(data: Record<string, unknown>) {
  return picponyPostJson('login', data);
}

export async function register(data: Record<string, unknown>) {
  return picponyPostJson('register', data);
}

export async function getUser(token: string, signal?: AbortSignal) {
  return picponyRequest('get_user', { token, signal });
}

export async function getUserProfile(userId: string, signal?: AbortSignal) {
  const res = await picponyRequest('get_user_profile', { query: { user_id: userId }, signal });
  return readJson(res);
}

/** This endpoint takes the owner's token in the query, unlike the Bearer-based APIs. */
export async function getUserUploads(
  userId: string,
  page: number = 1,
  perPage: number = 12,
  token?: string | null,
  signal?: AbortSignal,
): Promise<UserUploadsResponse> {
  const res = await picponyRequest('get_user_uploads', {
    query: { user_id: userId, page, per_page: perPage, token: token || undefined },
    signal,
  });
  const data = await readJson<{
    success?: boolean;
    message?: string;
    uploads?: UserUpload[];
    total_pages?: number;
  }>(res);
  if (!res.ok || !data.success) throw new Error(data.message || '获取用户上传记录失败');
  return { uploads: data.uploads ?? [], totalPages: Math.max(1, data.total_pages || 1) };
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

export async function getFaves(token: string, signal?: AbortSignal): Promise<FavesResponse> {
  const res = await picponyRequest('get_faves', { token, signal });
  return readJson(res);
}

export async function toggleFave(token: string, imageId: number) {
  return picponyPostJson('toggle_fave', { image_id: imageId }, { token });
}

export async function getSharedFaves(username: string, signal?: AbortSignal): Promise<SharedFavesResponse> {
  const res = await picponyRequest('get_shared_faves', { query: { username }, signal });
  if (!res.ok) throw new Error('获取收藏夹失败');
  return readJson(res);
}

export const getSharedFavesByUsername = getSharedFaves;

export async function postComment(token: string, imageId: number, body: string) {
  return picponyPostJson('post_comment', { image_id: imageId, body }, { token });
}

export async function getComments(imageId: string, signal?: AbortSignal): Promise<CommentsResponse> {
  /* Settle the whole read, including JSON decoding, independently for each source. An HTML
     error page from one host must not discard the other host's successfully loaded comments. */
  const sources = await Promise.allSettled([
    (async (): Promise<Comment[]> => {
      const res = await picponyRequest('get_comments', { query: { image_id: imageId }, signal });
      const data = await readJson(res);
      if (!res.ok || !data.success || !Array.isArray(data.comments)) throw new Error('评论读取失败');
      return data.comments.map((comment: Comment) => ({ ...comment, source: 'picpony' as const }));
    })(),
    (async (): Promise<Comment[]> => {
      const res = await proxyFetch(
        `${DERPIBOORU_API_BASE}/search/comments?q=${encodeURIComponent(`image_id:${imageId}`)}&page=1&per_page=25`,
        { signal },
      );
      const data = await readJson(res);
      if (!res.ok || !Array.isArray(data.comments)) throw new Error('评论读取失败');
      return data.comments.map((comment: {
        id: number; body: string; created_at: string; user_id: number;
        author: string; avatar: string | null;
      }) => ({
        id: comment.id, body: comment.body, created_at: comment.created_at,
        user_id: comment.user_id, username: comment.author, avatar: comment.avatar,
        source: 'trixiebooru' as const,
      }));
    })(),
  ]);
  signal?.throwIfAborted();
  const available = sources.filter((result): result is PromiseFulfilledResult<Comment[]> => result.status === 'fulfilled');
  if (available.length === 0) return { success: false, comments: [] };
  const comments = available.flatMap((result) => result.value);
  comments.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  return { success: true, comments };
}

export async function getUserComments(
  userId: string,
  page: number = 1,
  signal?: AbortSignal,
): Promise<UserCommentsResponse> {
  const res = await picponyRequest('get_user_comments', {
    query: { user_id: userId, page },
    cache: 'no-store',
    signal,
  });
  if (!res.ok) throw new Error('获取用户评论失败');
  return readJson(res);
}

export async function getUserPosts(userId: string, page: number = 1, signal?: AbortSignal): Promise<UserPostsResponse> {
  const res = await picponyRequest('get_user_posts', {
    query: { user_id: userId, page },
    cache: 'no-store',
    signal,
  });
  if (!res.ok) throw new Error('获取用户帖子失败');
  return readJson(res);
}

export async function getForumPosts(page: number = 1, signal?: AbortSignal): Promise<ForumPostsResponse> {
  const res = await picponyRequest('get_forum_posts', { query: { page }, cache: 'no-store', signal });
  if (!res.ok) throw new Error('Failed to fetch forum posts');
  return readJson(res);
}

export async function getForumPostDetail(
  id: string,
  page: number = 1,
  signal?: AbortSignal,
): Promise<ForumPostDetailResponse> {
  const res = await picponyRequest('get_forum_post_detail', {
    query: { id, page },
    cache: 'no-store',
    signal,
  });
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
  return picponyPostJson('create_forum_post', data, { token });
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
  return picponyPostJson('create_forum_comment', body, { token });
}

export async function toggleForumPostLike(token: string, postId: number) {
  return picponyPostJson('toggle_forum_post_like', { id: postId }, { token });
}

export async function uploadForumImage(token: string, file: File) {
  const formData = new FormData();
  formData.append('image', file);
  return picponyRequest('upload_forum_image', { token, method: 'POST', body: formData });
}

export async function getNotifications(token: string) {
  const res = await picponyRequest('get_notifications', { token });
  return readJson(res);
}

export async function getInteractionNotifications(
  token: string,
  page: number = 1,
): Promise<InteractionNotificationsResponse> {
  const timestamp = Date.now();
  const res = await picponyRequest('get_notifications', {
    token,
    query: { type: 'interaction', page, _t: timestamp },
  });
  return readJson(res);
}

export async function getRecentContacts(token: string): Promise<ContactsResponse> {
  const res = await picponyRequest('get_recent_contacts', { token });
  return readJson(res);
}

export async function getMessages(token: string, withUserId: number): Promise<MessagesResponse> {
  const res = await picponyRequest('get_messages', { token, query: { with_user_id: withUserId } });
  return readJson(res);
}

export async function getUnreadCounts(token: string, signal?: AbortSignal): Promise<UnreadCountsResponse> {
  const res = await picponyRequest('get_unread_counts', { token, signal });
  return readJson(res);
}

export async function sendMessage(token: string, receiverId: number, content: string) {
  return picponyPostJson('send_message', { receiver_id: receiverId, content }, { token });
}

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

export async function getAnnouncement() {
  const res = await picponyRequest('get_announcement');
  return readJson(res);
}

export async function getAnnouncementHistory() {
  const res = await picponyRequest('get_announcement_history');
  return readJson(res);
}

export async function saveApikey(
  token: string,
  data: { api_key: string; derpi_user_id: string; derpi_username: string },
) {
  return picponyPostJson('save_apikey', data, { token });
}

export async function updateSettings(token: string, data: Record<string, unknown>) {
  return picponyPostJson('update_settings', data, { token });
}

export async function updateEmail(token: string, email: string) {
  return picponyPostJson('update_email', { email }, { token });
}

export async function verifyEmail(token: string, code: string) {
  return picponyPostJson('verify_email', { code }, { token });
}

export async function resendVerifyCode(token: string) {
  return picponyPostJson('resend_verify_code', {}, { token });
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

export async function resetPasswordRequest(email: string) {
  return picponyPostJson('reset_password_request', { email });
}

export async function resetPassword(data: { email: string; code: string; new_password: string }) {
  return picponyPostJson('reset_password', data);
}

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

export async function getBrowsingHistory(token: string, page: number = 1, signal?: AbortSignal) {
  const res = await picponyRequest('get_browsing_history', { token, query: { page, _t: Date.now() }, signal });
  return readJson(res);
}

export async function clearBrowsingHistory(token: string) {
  return picponyRequest('clear_browsing_history', { token, method: 'POST' });
}

export async function deleteBrowsingHistoryItem(token: string, imageId: number) {
  return picponyPostJson('delete_browsing_history_item', { image_id: imageId }, { token });
}

/** 记录每周上传任务进度（上传作品成功后调用，fire-and-forget） */
export async function recordWeeklyUpload(token: string) {
  return picponyRequest('record_weekly_upload', { token, method: 'POST' });
}

/** 记录浏览历史（打开图片详情时调用，与完整版前端 add_browsing_history 一致） */
export async function addBrowsingHistory(
  token: string,
  params: { image_id: number; preview_url: string; uploader: string },
) {
  return picponyPostJson('add_browsing_history', params, { token });
}

export async function checkHasPrivacyPassword(token: string) {
  const res = await picponyRequest('check_has_privacy_password', { token, query: { _t: Date.now() } });
  return readJson(res);
}

export async function setPrivacyPassword(token: string, password: string) {
  return picponyPostJson('set_privacy_password', { password }, { token });
}

export async function verifyPrivacyPassword(token: string, password: string) {
  return picponyPostJson('verify_privacy_password', { password }, { token });
}

export async function getPrivacyFaves(token: string) {
  const res = await picponyRequest('get_privacy_faves', { token, query: { _t: Date.now() } });
  return readJson(res);
}

export async function addPrivacyFave(
  token: string,
  imageId: number,
  imageData: Record<string, unknown>,
) {
  return picponyPostJson('add_privacy_fave', { image_id: imageId, image_data: imageData }, { token });
}

export async function removePrivacyFave(token: string, imageId: number) {
  return picponyPostJson('remove_privacy_fave', { image_id: imageId }, { token });
}

export async function getMyBadges(token: string) {
  const res = await picponyRequest('get_my_badges', { token, query: { _t: Date.now() } });
  return readJson(res);
}

export async function equipBadge(token: string, badgeName: string | null) {
  return picponyPostJson('equip_badge', { badge_name: badgeName }, { token });
}

export async function getTasks(token: string, signal?: AbortSignal) {
  const res = await picponyRequest('get_tasks', { token, query: { _t: Date.now() }, signal });
  return readJson(res);
}

export async function claimTask(token: string, taskType: string) {
  return picponyPostJson('claim_task', { task_type: taskType }, { token });
}

export async function getCoinTransactions(token: string, page: number = 1) {
  const res = await picponyRequest('get_coin_transactions', { token, query: { page, _t: Date.now() } });
  return readJson(res);
}

export async function getBlockGroups(token: string, signal?: AbortSignal) {
  const res = await picponyRequest('get_block_groups', { token, query: { _t: Date.now() }, signal });
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
  return picponyPostJson('save_block_group', data, { token });
}

export async function deleteBlockGroup(token: string, id: number) {
  return picponyPostJson('delete_block_group', { id }, { token });
}

export async function toggleBlockGroup(token: string, id: number, isActive: number) {
  return picponyPostJson('toggle_block_group', { id, is_active: isActive }, { token });
}

export async function getGlossaryEntries(token: string) {
  const res = await picponyRequest('get_glossary_entries', { token });
  return readJson(res);
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
) {
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
  return readJson(res);
}

/** 批量获取词库中文翻译（旧前端 get_tag_translations 接口） */
export async function getTagTranslations(tags: string[]) {
  const res = await picponyPostJson('get_tag_translations', { tags });
  return readJson(res);
}

/** 开发者模式状态：返回 is_developer / is_developer_banned / prerequisites */
export async function getDeveloperStatus(token: string, signal?: AbortSignal) {
  const res = await picponyRequest('get_developer_status', { token, query: { _t: Date.now() }, signal });
  return readJson(res);
}

/** 输入 8 位维护密码开启开发者模式 */
export async function enableDeveloperMode(token: string, password: string) {
  return picponyPostJson('enable_developer_mode', { password }, { token });
}

/** 关闭开发者模式 */
export async function disableDeveloperMode(token: string) {
  return picponyRequest('disable_developer_mode', { token, method: 'POST' });
}

export async function getDictionaryDuplicates(token: string) {
  const res = await picponyRequest('get_duplicates', { token, query: { _t: Date.now() } });
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
  return picponyPostJson('save_dictionary_tag', data, { token });
}

export async function deleteDictionaryTag(token: string, id: number) {
  return picponyPostJson('delete_dictionary_tag', { id }, { token });
}

export async function getDictionaryLeaderboard() {
  const res = await picponyRequest('get_dictionary_leaderboard', { query: { _t: Date.now() } });
  return readJson(res);
}

/** 获取某个词库标签的编辑历史（按时间倒序） */
export async function getDictionaryTagHistory(token: string, tagId: number) {
  const res = await picponyRequest('get_dictionary_tag_history', { token, query: { tag_id: tagId, _t: Date.now() } });
  return readJson(res);
}

export async function getTagGroups(token: string) {
  const res = await picponyRequest('get_tag_groups', { token, query: { _t: Date.now() } });
  return readJson(res);
}

export async function saveTagGroup(
  token: string,
  data: { id?: number; name: string; tags: string[] },
) {
  return picponyPostJson('save_tag_group', data, { token });
}

export async function deleteTagGroup(token: string, id: number) {
  return picponyPostJson('delete_tag_group', { id }, { token });
}

/** The运营团队 list for /about — a public, tokenless read kept out of the admin module so
 *  /about need not import the un-tree-shakeable admin surface. */
export async function getTeamMembers(signal?: AbortSignal) {
  const res = await picponyRequest('get_team_members', { query: { _t: Date.now() }, signal });
  return readJson(res);
}
