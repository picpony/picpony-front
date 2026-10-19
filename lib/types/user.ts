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
 * A public profile (`GET /users/{id}`, mapped by `profileFromWire` in `lib/profiles.ts`). The owner's
 * four tab choices arrive as `visibility` and are kept as `settings` — the only settings a visitor
 * sees. The Derpibooru account is the verified upstream binding, so `has_api_key` is true exactly
 * when one is named. A public profile carries no birthday.
 */
export interface ProfileUser {
  id: number;
  username: string;
  avatar: string | null;
  banner: string | null;
  role: string;
  bio: string;
  gender: string;
  race: string;
  experience: number;
  level: number;
  /** The Beijing calendar day the account was made (`created_on`). */
  created_at: string;
  last_online: string | null;
  ip_location: string;
  derpi_username: string | null;
  derpi_user_id: number | null;
  has_api_key: boolean;
  /** Not public on the Rust backend; always absent on a profile. */
  birthday?: string | null;
  /** Every badge the user holds (`{ id, name, color, expires_at }` rows) — read by `lib/userBadges.ts`. */
  badges: unknown;
  /** The worn set, in order (`{ id, name, color, expires_at, position }` rows). */
  equipped_badges: unknown;
  /** `showUploads` / `showFaves` / `showPosts` / `showComments`, and `hideIpLocation` on the owner's own view. */
  settings: Record<string, unknown>;
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
