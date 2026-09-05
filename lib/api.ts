/**
 * lib/api.ts — 兼容性导出层,将逐步废弃:方法在 lib/api/(client|derpi|picpony|admin).ts,
 * 类型在 lib/types/(image/forum/user/message/captcha)。新代码请直接从拆分路径导入。
 */

// --- 类型重导出 ---

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
  Announcement,
} from '@/lib/types/message';

export type { CaptchaGetResponse, CaptchaVerifyResponse } from '@/lib/types/captcha';

// --- API 方法重导出 (命名导出) ---

export { getBrowsingSettings, applyImageLine, buildSearchQuery, proxyFetch } from '@/lib/api/client';

/* Admin surface deliberately **not** re-exported: every gallery route imports lib/api.ts, and a
   re-export would pin the admin module into their graph. The eleven admin tabs use
   `import * as adminApi from '@/lib/api/admin'` instead — each already a dynamic(…, { ssr: false }) chunk. */

// --- 兼容性 api 命名空间对象:保持原有的 `import { api } from '@/lib/api'` 模式仍可用 ---

import * as derpi from '@/lib/api/derpi';
import * as picpony from '@/lib/api/picpony';
import { applyImageLine, proxyFetch, buildSearchQuery } from '@/lib/api/client';

/**
 * Built by spreading modules, `api` is a runtime value no bundler can tree-shake: every
 * importer pulls every member — so the admin surface must stay out of here. It lives on
 * `adminApi` (`@/lib/api/admin`), whose only importers are the eleven admin tabs, each
 * already dynamic(…, { ssr: false }) and so in its own chunk.
 * TODO: split this object into named re-exports — the intended end state.
 */
export const api = {
  // Derpibooru
  ...derpi,
  // PicPony
  ...picpony,
  // 工具
  applyImageLine,
  proxyFetch,
  buildSearchQuery,
};
