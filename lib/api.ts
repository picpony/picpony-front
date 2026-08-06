/**
 * lib/api.ts — 兼容性导出层
 *
 * 此文件将逐步被废弃。各 API 方法已按域拆分到 lib/api/ 子目录:
 *   - lib/api/client.ts   — HTTP 客户端、浏览设置、搜索查询构建
 *   - lib/api/derpi.ts    — Derpibooru 图片/标签/用户 API
 *   - lib/api/picpony.ts  — PicPony 用户/论坛/消息/认证等 API
 *   - lib/api/admin.ts    — 管理后台 API
 *
 * 类型定义已移动到 lib/types/:
 *   - lib/types/image.ts, forum.ts, user.ts, message.ts, captcha.ts
 *
 * 请在页面/组件中将 import 逐步迁移到新的拆分路径。
 */

// ---------------------------------------------------------------------------
// 类型重导出
// ---------------------------------------------------------------------------

export type {
  ImageRepresentation,
  PonyImage,
  FeaturedImage,
  ApiResponse,
  FavesResponse,
  SharedFavesResponse,
  Comment,
  CommentsResponse,
} from '@/lib/types/image';

export type {
  ForumPost,
  ForumPostsResponse,
  ForumComment,
  ForumPostDetail,
  ForumPostDetailResponse,
} from '@/lib/types/forum';

export type {
  DerpiProfileAward,
  DerpiProfileUser,
  DerpiProfileResponse,
  UserComment,
  UserCommentsResponse,
  UserPost,
  UserPostsResponse,
} from '@/lib/types/user';

export type {
  Contact,
  ContactsResponse,
  Message,
  MessagesResponse,
  Notification,
  InteractionNotificationsResponse,
  UnreadCountsResponse,
} from '@/lib/types/message';

export type { CaptchaGetResponse, CaptchaVerifyResponse } from '@/lib/types/captcha';

// ---------------------------------------------------------------------------
// API 方法重导出 (命名导出)
// ---------------------------------------------------------------------------

export { getBrowsingSettings, applyCdn, buildSearchQuery, proxyFetch } from '@/lib/api/client';

export {
  getImage,
  getImages,
  getFeatured,
  searchDerpiImages,
  searchImagesByIds,
  searchDerpiTags,
  getDerpiPopularTags,
  getDerpiProfile,
  uploadImageToDerpi,
} from '@/lib/api/derpi';

export {
  login,
  register,
  getUser,
  getUserProfile,
  changeUsername,
  changePassword,
  saveProfile,
  uploadAvatar,
  uploadBanner,
  getFaves,
  toggleFave,
  getSharedFaves,
  getSharedFavesByUsername,
  postComment,
  getComments,
  getUserComments,
  getUserPosts,
  getForumPosts,
  getForumPostDetail,
  createForumPost,
  createForumComment,
  toggleForumPostLike,
  uploadForumImage,
  getNotifications,
  getInteractionNotifications,
  getRecentContacts,
  getMessages,
  getUnreadCounts,
  sendMessage,
  captchaGet,
  captchaVerify,
  getAnnouncement,
  getAnnouncementHistory,
  saveApikey,
  updateSettings,
  updateEmail,
  verifyEmail,
  resendVerifyCode,
  verifyEmailById,
  resendVerifyCodeById,
  reportImage,
  resetPasswordRequest,
  resetPassword,
  searchImage,
  getBrowsingHistory,
  clearBrowsingHistory,
  deleteBrowsingHistoryItem,
  recordWeeklyUpload,
  checkHasPrivacyPassword,
  setPrivacyPassword,
  verifyPrivacyPassword,
  getPrivacyFaves,
  addPrivacyFave,
  removePrivacyFave,
  getMyBadges,
  equipBadge,
  getTasks,
  claimTask,
  getCoinTransactions,
  getBlockGroups,
  saveBlockGroup,
  deleteBlockGroup,
  toggleBlockGroup,
  getGlossaryEntries,
  createGlossaryEntry,
  updateGlossaryEntry,
  deleteGlossaryEntry,
  getDictionary,
  getDictionaryDuplicates,
  saveDictionaryTag,
  deleteDictionaryTag,
  getDictionaryLeaderboard,
  getTagGroups,
  saveTagGroup,
  deleteTagGroup,
} from '@/lib/api/picpony';

export {
  adminGetUsers,
  adminUpdateUser,
  adminDeleteUser,
  adminGetWealth,
  adminUpdateWealth,
  adminGetShopItems,
  adminSaveShopItem,
  adminDeleteShopItem,
  adminGetReports,
  adminHandleReport,
  adminGetBlacklist,
  adminAddBlacklist,
  adminRemoveBlacklist,
  saveAnnouncement,
  adminDeleteAnnouncement,
  adminGetAllMessages,
  adminSendNotification,
  adminGetNotifications,
  adminDeleteNotification,
  adminGrantBadge,
  adminGetBadgeLinks,
  adminCreateBadgeLink,
  adminToggleBadgeLink,
  adminDeleteBadge,
  adminEditBadge,
  getMaintenanceStatus,
  adminToggleMaintenance,
  adminToggleTranslate,
  getSiteStats,
  adminSyncSiteStats,
  adminGetMascotConfig,
  adminSaveMascotConfig,
  adminUploadMascotImage,
  adminDeleteMascotImage,
  getBlockTags,
  adminAddBlockTag,
  adminRemoveBlockTag,
  adminGetDeveloperPassword,
  adminRefreshDeveloperPassword,
  adminGetDeveloperUsers,
  adminRevokeDeveloper,
  adminEnableDeveloper,
  getTeamMembers,
  addTeamMember,
  updateTeamMember,
  deleteTeamMember,
  getTagFeedback,
  handleTagFeedback,
  checkTagExists,
} from '@/lib/api/admin';

// ---------------------------------------------------------------------------
// 兼容性 api 命名空间对象
// 保持原有的 `import { api } from '@/lib/api'` 模式仍然可用
// ---------------------------------------------------------------------------

import * as derpi from '@/lib/api/derpi';
import * as picpony from '@/lib/api/picpony';
import * as admin from '@/lib/api/admin';
import { applyCdn, proxyFetch, buildSearchQuery } from '@/lib/api/client';

export const api = {
  // Derpibooru
  ...derpi,
  // PicPony
  ...picpony,
  // Admin
  ...admin,
  // 工具
  applyCdn,
  proxyFetch,
  buildSearchQuery,
};
