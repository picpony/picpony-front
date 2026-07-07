export interface DerpiProfileAward {
  image_url?: string;
  badge_url?: string;
  url?: string;
  image?: string;
  title?: string;
}

export interface DerpiProfileUser {
  id: number;
  name: string;
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
