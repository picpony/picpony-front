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

/** One row of the forum list — which carries the whole body, so a thread can open on it. */
export interface ForumPost {
  id: number;
  user_id: number;
  title: string;
  /** BBCode — or, for a commission or a tag-group share, the JSON body `lib/api/forum.ts` reads. */
  content: string;
  /** The optional 简介; empty when the author wrote none. */
  excerpt: string;
  category: ForumCategory;
  views: number;
  reply_count: number;
  like_count: number;
  is_pinned: boolean;
  /** The viewer's own like — only meaningful on a read that carried their session. */
  is_liked: boolean;
  /** New activity since the viewer last opened it — only meaningful on a read with a session. */
  is_unread: boolean;
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

export interface ForumPostDetail extends ForumPost {
  user_created_at?: string;
}

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
  /** The read carried a session: `is_unread` and `is_liked` are this viewer's. */
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
