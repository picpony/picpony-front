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
  Announcement,
} from '@/lib/types/message';

export type { CaptchaGetResponse, CaptchaVerifyResponse } from '@/lib/types/captcha';

// ---------------------------------------------------------------------------
// API 方法重导出 (命名导出)
// ---------------------------------------------------------------------------

export { getBrowsingSettings, applyCdn, buildSearchQuery, proxyFetch } from '@/lib/api/client';

/* The admin surface is deliberately **not** re-exported here.
   `lib/api.ts` is imported by every gallery route, and a re-export keeps the
   admin module in their graph even when nothing calls it. The eleven admin tabs
   do `import * as adminApi from '@/lib/api/admin'` instead — each of them is
   already a `dynamic(…, { ssr: false })` chunk. */

// ---------------------------------------------------------------------------
// 兼容性 api 命名空间对象
// 保持原有的 `import { api } from '@/lib/api'` 模式仍然可用
// ---------------------------------------------------------------------------

import * as derpi from '@/lib/api/derpi';
import * as picpony from '@/lib/api/picpony';
import { applyCdn, proxyFetch, buildSearchQuery } from '@/lib/api/client';

/**
 * The admin surface is **not** in here, and that is the one thing about this
 * object worth knowing.
 *
 * It is built by spreading modules, so it is a runtime value rather than a set of
 * re-exports and no bundler can tree-shake it: every importer of `api` pulls every
 * member. Thirty-nine files import it, including `app/page.tsx`, `ImageCard`,
 * `MasonryGrid` and `FeaturedBanner` — so while `lib/api/admin.ts`'s 43 functions
 * were spread in here, the home page shipped the entire admin console's API layer.
 *
 * They live on `adminApi` (`@/lib/api/admin`) now, whose only importers are the
 * eleven admin tabs — each of which is already `dynamic(…, { ssr: false })` and so
 * in its own chunk. Splitting the whole object into named re-exports is still the
 * end state; this is the half of it that pays for itself immediately.
 */
export const api = {
  // Derpibooru
  ...derpi,
  // PicPony
  ...picpony,
  // 工具
  applyCdn,
  proxyFetch,
  buildSearchQuery,
};
