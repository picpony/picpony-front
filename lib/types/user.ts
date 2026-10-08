import type { ImagePreview } from './image';

export interface DerpiProfileAward {
  image_url?: string;
  badge_url?: string;
  url?: string;
  image?: string;
  title?: string;
  /** The award's supporting line on Derpibooru ("Best Artist - Providing quality…"); often empty. */
  label?: string;
}

export interface DerpiProfileUser {
  id: number;
  name: string;
  /** The site's profile address is keyed by this, not the name (`derpiLinks.ts`). */
  slug?: string;
  avatar: string | null;
  avatar_url: string | null;
  description: string;
  created_at: string;
  uploads_count: number;
  comments_count: number;
  posts_count: number;
  awards: DerpiProfileAward[];
}

export interface DerpiProfileResponse {
  user: DerpiProfileUser;
}

export interface UserComment {
  id: number;
  target_id: number;
  body: string;
  created_at: string;
  type: 'post' | 'image';
  cover_image: string | null;
}

export interface UserCommentsResponse {
  success: boolean;
  comments: UserComment[];
  total_pages: number;
}

export interface UserPost {
  id: number;
  title: string;
  cover_image: string | null;
  created_at: string;
  reply_count: number;
  like_count: number;
}

export interface UserPostsResponse {
  success: boolean;
  posts: UserPost[];
  total_pages: number;
}

export type UserUpload = ImagePreview;

/**
 * A profile's upload grid. PicPony has no uploads action (the old `get_user_uploads` answered
 * an HTML 404 for every user); uploads are the profile's Derpibooru account's, searched by
 * `uploader_id`. `binding` says why a list is empty when it is not simply empty: the profile
 * has no Derpibooru account bound, or its owner hides the tab from visitors.
 */
export interface UserUploadsResponse {
  uploads: UserUpload[];
  totalPages: number;
  total: number;
  binding: 'bound' | 'unbound' | 'hidden';
}

/**
 * A public profile (`get_user_profile`). The fields the app reads are named; the rest of the
 * record (settings, badges, counters) passes through untyped.
 */
export interface ProfileUser {
  id: number;
  username: string;
  avatar?: string | null;
  banner?: string | null;
  role?: string | null;
  bio?: string | null;
  gender?: string | null;
  birthday?: string | null;
  race?: string | null;
  created_at?: string | null;
  last_online?: string | null;
  ip_location?: string | null;
  derpi_username?: string | null;
  derpi_user_id?: string | number | null;
  has_api_key?: boolean;
  experience?: number;
  /** Every badge the user holds (`{ name, color, expires_at }` rows) — read by `lib/userBadges.ts`. */
  badges?: unknown;
  /** The worn set (`{ badge_name, badge_color }` rows, sometimes their JSON string). */
  equipped_badges?: unknown;
  settings?: Record<string, unknown> | null;
  [key: string]: unknown;
}

/**
 * One of a profile's public favourite folders (`get_profile_fave_folders`) — the folders the owner
 * made public, and nothing else. `latestImageId` is the folder's newest picture, its cover.
 */
export interface ProfileFaveFolder {
  id: number;
  name: string;
  isMain: boolean;
  itemCount: number;
  latestImageId: number | null;
}
