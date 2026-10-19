/**
 * The forum, as `lib/api/forum.ts` hands it to screens — normalised at the adapter, so no screen
 * compares `is_pinned === 1` or parses a badge list out of a JSON string itself.
 */

/** 帖子讨论 / 画师委托 / 标签组分享 — the original front end's three kinds of post. */
export type ForumCategory = 'discussion' | 'commission' | 'taggroups';

/** A badge a user wears beside their name (`UserBadge` renders it). */
export interface EquippedBadge {
  badge_name: string;
  badge_color: string;
}

/** A tag group as a 标签组分享 post carries it. */
export interface SharedTagGroup {
  name: string;
  tags: string[];
}

/** A block group as a 标签组分享 post carries it. */
export interface SharedBlockGroup {
  name: string;
  hidden_tags: string[];
  spoilered_tags: string[];
}

export interface SharedGroups {
  tagGroups: SharedTagGroup[];
  blockGroups: SharedBlockGroup[];
}

/** One row of the forum list — which carries the whole body, so a thread can open on it. */
export interface ForumPost {
  id: number;
  user_id: number;
  title: string;
  /**
   * The body's text, by kind (the backend stores a typed document): a discussion's BBCode, a
   * commission's description (BBCode), a tag-group share's plain-text note.
   */
  content: string;
  /** A commission's http(s) link to the artist's page; `''` for none and for the other kinds. */
  commission_link: string;
  /** A tag-group share's groups; `null` for the other kinds. */
  shared_groups: SharedGroups | null;
  /** The post's edit revision — an edit sends it back as `expected_revision`. */
  revision: number;
  /** The optional 简介; empty when the author wrote none. */
  excerpt: string;
  category: ForumCategory;
  views: number;
  reply_count: number;
  like_count: number;
  is_pinned: boolean;
  /** The viewer's own like — only meaningful on a read that carried their session. */
  is_liked: boolean;
  created_at: string;
  /** Bumped by an edit *and* by every reply: the last activity, not the last edit. */
  updated_at: string;
  cover_image: string | null;
  username: string;
  avatar: string | null;
  role: string;
  experience: number | null;
  badges: EquippedBadge[];
}

export type ForumPostDetail = ForumPost;

export interface ForumComment {
  id: number;
  post_id: number;
  user_id: number;
  content: string;
  created_at: string;
  username: string;
  avatar: string | null;
  role: string;
  experience: number | null;
  badges: EquippedBadge[];
}

export interface ForumPostsResponse {
  posts: ForumPost[];
  total: number;
  totalPages: number;
  /** The read carried a session: `is_liked` is this viewer's. */
  signedIn: boolean;
}

export interface ForumPostDetailResponse {
  post: ForumPostDetail;
  comments: ForumComment[];
  total_comments: number;
  total_pages: number;
  /** The page these comments are — a page past the end is answered with the last one. */
  page: number;
}
