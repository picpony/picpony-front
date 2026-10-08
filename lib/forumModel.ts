import type {
  EquippedBadge,
  ForumCategory,
  ForumComment,
  ForumPostDetail,
} from '@/lib/types/forum';

/**
 * The forum's vocabulary and its data model, pure: the categories and orders, the normalisation
 * every read goes through, and the two JSON bodies (a commission, a tag-group share). No imports
 * beyond types, so the server seed (`lib/forum.server.ts`), the transport (`lib/api/forum.ts`)
 * and the screens share one reading of the wire.
 */

/** A list field, normalised: anything that is not an array is an empty one. */
function listOf<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

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

/** An unknown or missing category is a discussion — the original front end's default. */
export function categoryOf(value: unknown): ForumCategory {
  return value === 'commission' || value === 'taggroups' ? value : 'discussion';
}

export type ForumCategoryFilter = 'all' | ForumCategory;

/**
 * The orders the backend sorts by. `updated_at` is bumped by every reply as well as an edit, so
 * it is the last activity — 最近活跃, not the original front end's 最新发布. `created_at` is
 * accepted by nobody (it falls back to `updated_at`), so it is not offered.
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

/** The page size the backend lists at (measured: 20 rows). */
export const FORUM_PAGE_SIZE = 20;

/** The staff who may remove anybody's post or reply (the original front end's list). */
export const FORUM_STAFF_ROLES: ReadonlySet<string> = new Set(['admin', 'superadmin', 'super_admin']);

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

const str = (value: unknown): string => (typeof value === 'string' ? value : value == null ? '' : String(value));
export const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const flag = (value: unknown): boolean => value === true || value === 1 || value === '1';
const nullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** Worn badges arrive as a JSON string (or, from some reads, as the array itself). */
export function badgesOf(value: unknown): EquippedBadge[] {
  let list: unknown = value;
  if (typeof value === 'string') {
    try {
      list = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list
    .filter(
      (badge): badge is EquippedBadge =>
        Boolean(badge) &&
        typeof badge.badge_name === 'string' &&
        badge.badge_name.trim() !== '' &&
        typeof badge.badge_color === 'string',
    )
    .map((badge) => ({ badge_name: badge.badge_name, badge_color: badge.badge_color }));
}

export function postOf(raw: Record<string, unknown>): ForumPostDetail {
  return {
    id: num(raw.id),
    user_id: num(raw.user_id),
    title: str(raw.title),
    content: str(raw.content),
    excerpt: str(raw.excerpt).trim(),
    category: categoryOf(raw.category),
    views: num(raw.views ?? raw.view_count),
    reply_count: num(raw.reply_count ?? raw.comment_count),
    like_count: num(raw.like_count),
    is_pinned: flag(raw.is_pinned),
    is_liked: flag(raw.is_liked),
    is_unread: flag(raw.is_unread),
    created_at: str(raw.created_at),
    updated_at: str(raw.updated_at || raw.created_at),
    cover_image: str(raw.cover_image).trim() || null,
    username: str(raw.username),
    avatar: str(raw.avatar).trim() || null,
    role: str(raw.role),
    experience: nullableNumber(raw.experience),
    badges: badgesOf(raw.equipped_badges),
    ...(raw.user_created_at ? { user_created_at: str(raw.user_created_at) } : {}),
  };
}

export function commentOf(raw: Record<string, unknown>): ForumComment {
  return {
    id: num(raw.id),
    post_id: num(raw.post_id),
    user_id: num(raw.user_id),
    content: str(raw.content),
    created_at: str(raw.created_at),
    username: str(raw.username),
    avatar: str(raw.avatar).trim() || null,
    role: str(raw.role),
    experience: nullableNumber(raw.experience),
    badges: badgesOf(raw.equipped_badges),
  };
}

export const records = (value: unknown) =>
  listOf<unknown>(value).filter(
    (row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && Number.isFinite(Number((row as { id?: unknown }).id)),
  );

// ---------------------------------------------------------------------------
// Bodies: a commission and a tag-group share
// ---------------------------------------------------------------------------

export interface CommissionBody {
  /** BBCode, from the editor. */
  description: string;
  /** An http(s) link to the artist's commission page, or empty. */
  link: string;
}

export interface SharedTagGroup {
  name: string;
  tags: string[];
}

export interface SharedBlockGroup {
  name: string;
  hidden_tags: string[];
  spoilered_tags: string[];
}

export interface SharedGroupsBody {
  /** Plain text. */
  description: string;
  tagGroups: SharedTagGroup[];
  blockGroups: SharedBlockGroup[];
}

const strings = (value: unknown): string[] =>
  listOf<unknown>(value).filter((item): item is string => typeof item === 'string' && item.trim() !== '');

function jsonObject(content: string): Record<string, unknown> | null {
  if (!content.trimStart().startsWith('{')) return null;
  try {
    const value: unknown = JSON.parse(content);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A link a commission may carry: http(s) only, as the original front end required. */
export function isCommissionLink(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim());
}

/** A commission post with a link stores `{type:'commission', description, commission_link}`;
 *  one without a link stores its description as it is. */
export function parseCommission(content: string): CommissionBody | null {
  const data = jsonObject(content);
  if (!data || data.type !== 'commission') return null;
  const link = str(data.commission_link).trim();
  return { description: str(data.description), link: isCommissionLink(link) ? link : '' };
}

export function encodeCommission(description: string, link: string): string {
  const trimmed = link.trim();
  return trimmed ? JSON.stringify({ type: 'commission', description, commission_link: trimmed }) : description;
}

/** The server writes a tag-group share as `{type:'taggroups', description, shared_tag_groups,
 *  shared_block_groups}` from the description and the groups a post was published with. */
export function parseSharedGroups(content: string): SharedGroupsBody | null {
  const data = jsonObject(content);
  if (!data || data.type !== 'taggroups') return null;
  const tagGroups = listOf<Record<string, unknown>>(data.shared_tag_groups)
    .filter((group) => group && typeof group === 'object')
    .map((group) => ({ name: str(group.name).trim() || '未命名标签组', tags: strings(group.tags) }));
  const blockGroups = listOf<Record<string, unknown>>(data.shared_block_groups)
    .filter((group) => group && typeof group === 'object')
    .map((group) => ({
      name: str(group.name).trim() || '未命名屏蔽组',
      hidden_tags: strings(group.hidden_tags),
      spoilered_tags: strings(group.spoilered_tags),
    }));
  return { description: str(data.description), tagGroups, blockGroups };
}

/** The document the server stores for a tag-group share — what `parseSharedGroups` reads back. */
export function sharedGroupsContent(
  description: string,
  groups: { tag_groups: SharedTagGroup[]; block_groups: SharedBlockGroup[] },
): string {
  return JSON.stringify({
    type: 'taggroups',
    description,
    shared_tag_groups: groups.tag_groups,
    shared_block_groups: groups.block_groups,
  });
}
