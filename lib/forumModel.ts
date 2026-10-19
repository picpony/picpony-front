import type {
  EquippedBadge,
  ForumCategory,
  ForumComment,
  ForumPostDetail,
  ForumPostsResponse,
  SharedBlockGroup,
  SharedTagGroup,
} from '@/lib/types/forum';

import { decodeSanitizedText } from '@/lib/sanitizedText';

export type { SharedBlockGroup, SharedGroups, SharedTagGroup } from '@/lib/types/forum';

/**
 * The forum's vocabulary and its data model, pure: the categories and orders, and the one reading
 * of the Rust backend's rows (src/pg/forum.rs) every read goes through. No imports beyond types,
 * so the server seed (`lib/forum.server.ts`), the transport (`lib/api/forum.ts`) and the screens
 * share it.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const FORUM_CATEGORIES: readonly { value: ForumCategory; label: string }[] = [
  { value: 'discussion', label: '帖子讨论' },
  { value: 'commission', label: '画师委托' },
  { value: 'taggroups', label: '标签组分享' },
];

export function categoryLabel(category: ForumCategory): string {
  return FORUM_CATEGORIES.find((entry) => entry.value === category)?.label ?? '帖子讨论';
}

/** A stored category (a draft's): an unknown or missing one is a discussion. */
export function categoryOf(value: unknown): ForumCategory {
  return value === 'commission' || value === 'taggroups' ? value : 'discussion';
}

export type ForumCategoryFilter = 'all' | ForumCategory;

/**
 * The orders the backend sorts by. `updated_at` is bumped by every reply as well as an edit, so
 * it is the last activity — 最近活跃. (`created_at` is accepted too, and not offered.)
 */
export type ForumSort = 'updated_at' | 'views' | 'like_count';

export const FORUM_SORTS: readonly { value: ForumSort; label: string }[] = [
  { value: 'updated_at', label: '最近活跃' },
  { value: 'views', label: '浏览最多' },
  { value: 'like_count', label: '点赞最多' },
];

export function sortOf(value: unknown): ForumSort {
  return value === 'views' || value === 'like_count' ? value : 'updated_at';
}

/** The page size the forum lists at (the backend's default). */
export const FORUM_PAGE_SIZE = 20;

/** The staff who may remove anybody's post or reply (the original front end's list). */
export const FORUM_STAFF_ROLES: ReadonlySet<string> = new Set(['admin', 'superadmin', 'super_admin']);

// ---------------------------------------------------------------------------
// The backend's rows
// ---------------------------------------------------------------------------

/** A badge as the backend's `author.equipped_badges` carries it (unexpired, in worn order). */
interface WireBadge {
  id: number;
  name: string;
  color: string;
}

/** `author` on a post or a reply. */
export interface WireAuthor {
  id: number;
  username: string;
  avatar: string | null;
  role: string;
  experience: number;
  equipped_badges: WireBadge[];
}

/** A tag group as a 标签组分享 document stores it: a name and its tags. */
interface WireGroup {
  name: string;
  tags: string[];
}

/**
 * A block group as a share stores it (`forum::BlockGroup`): the tags it hides and the tags it
 * spoilers. The backend projects shares stored in the first `{name, tags}` shape into this one
 * (`forum::normalize_post`), so both lists are always present.
 */
interface WireBlockGroup {
  name: string;
  hidden_tags: string[];
  spoilered_tags: string[];
}

/** A post's body: a typed document, by kind. */
export type WireContent =
  | { type: 'discussion'; html: string }
  | { type: 'commission'; description: string; commission_link: string }
  | { type: 'taggroups'; description: string; tag_groups: WireGroup[]; block_groups: WireBlockGroup[] };

/** A row of `GET /forum/posts`, the `post` of `GET /forum/posts/{id}`. */
export interface WirePost {
  id: number;
  user_id: number;
  title: string;
  excerpt: string;
  content: WireContent;
  cover_image: string | null;
  category: ForumCategory;
  is_pinned: boolean;
  views: number;
  revision: number;
  created_at: string;
  updated_at: string;
  author: WireAuthor;
  reply_count: number;
  like_count: number;
  is_liked: boolean;
}

/** A row of `GET /forum/posts/{id}/comments`. */
export interface WireComment {
  id: number;
  post_id: number;
  user_id: number;
  content: string;
  created_at: string;
  author: WireAuthor;
}

export function badgesOf(badges: readonly WireBadge[]): EquippedBadge[] {
  return badges.map((badge) => ({ badge_name: badge.name, badge_color: badge.color }));
}

/* A body's text arrives through the backend's HTML sanitizer, `&`/`<`/`>` as entities
   (`decodeSanitizedText`); decoded once here, so every reader — the body, the list's teaser, the
   reply quote and the edit form, which would otherwise send `&amp;` back to be escaped again —
   sees the characters the author wrote. */
function bodyOf(content: WireContent): Pick<ForumPostDetail, 'content' | 'commission_link' | 'shared_groups'> {
  switch (content.type) {
    case 'discussion':
      return { content: decodeSanitizedText(content.html), commission_link: '', shared_groups: null };
    case 'commission':
      return { content: decodeSanitizedText(content.description), commission_link: content.commission_link, shared_groups: null };
    case 'taggroups':
      return {
        content: decodeSanitizedText(content.description),
        commission_link: '',
        shared_groups: {
          tagGroups: content.tag_groups,
          blockGroups: content.block_groups.map(({ name, hidden_tags, spoilered_tags }): SharedBlockGroup => ({ name, hidden_tags, spoilered_tags })),
        },
      };
  }
}

export function postOf(raw: WirePost): ForumPostDetail {
  return {
    id: raw.id,
    user_id: raw.user_id,
    title: raw.title,
    ...bodyOf(raw.content),
    revision: raw.revision,
    excerpt: decodeSanitizedText(raw.excerpt.trim()),
    category: raw.category,
    views: raw.views,
    reply_count: raw.reply_count,
    like_count: raw.like_count,
    is_pinned: raw.is_pinned,
    is_liked: raw.is_liked,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    cover_image: raw.cover_image?.trim() || null,
    username: raw.author.username,
    avatar: raw.author.avatar,
    role: raw.author.role,
    experience: raw.author.experience,
    badges: badgesOf(raw.author.equipped_badges),
  };
}

/** `GET /forum/posts`. */
export interface WirePostPage {
  posts: WirePost[];
  total: number;
  page: number;
  total_pages: number;
}

/** The list query as the backend takes it — the client's and the server seed's. */
export function forumListParams(query: { page: number; category?: ForumCategoryFilter; sort?: ForumSort; search?: string }) {
  const search = query.search?.trim();
  return {
    page: query.page,
    category: query.category && query.category !== 'all' ? query.category : undefined,
    sort: query.sort ?? 'updated_at',
    search: search || undefined,
  };
}

export function forumPostsOf(data: WirePostPage, signedIn: boolean): ForumPostsResponse {
  return {
    posts: data.posts.map(postOf),
    total: data.total,
    totalPages: Math.max(1, data.total_pages),
    signedIn,
  };
}

export function commentOf(raw: WireComment): ForumComment {
  return {
    id: raw.id,
    post_id: raw.post_id,
    user_id: raw.user_id,
    content: decodeSanitizedText(raw.content),
    created_at: raw.created_at,
    username: raw.author.username,
    avatar: raw.author.avatar,
    role: raw.author.role,
    experience: raw.author.experience,
    badges: badgesOf(raw.author.equipped_badges),
  };
}

// ---------------------------------------------------------------------------
// Bodies: a commission and a tag-group share
// ---------------------------------------------------------------------------

/** A link a commission may carry: http(s) only, as the original front end required. */
export function isCommissionLink(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim());
}

/** The document an edit or a new post sends, by kind. */
export function contentWire(
  category: ForumCategory,
  text: string,
  commissionLink: string,
  groups: { tag_groups: SharedTagGroup[]; block_groups: SharedBlockGroup[] } | null,
): WireContent {
  switch (category) {
    case 'discussion':
      return { type: 'discussion', html: text };
    case 'commission':
      return { type: 'commission', description: text, commission_link: commissionLink.trim() };
    case 'taggroups':
      return {
        type: 'taggroups',
        description: text,
        tag_groups: (groups?.tag_groups ?? []).map(({ name, tags }) => ({ name, tags })),
        block_groups: (groups?.block_groups ?? []).map(({ name, hidden_tags, spoilered_tags }) => ({ name, hidden_tags, spoilered_tags })),
      };
  }
}
