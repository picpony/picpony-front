export interface ForumPost {
  id: number;
  user_id: number;
  title: string;
  content: string;
  views: number;
  reply_count: number;
  is_pinned: number;
  created_at: string;
  updated_at: string;
  cover_image: string | null;
  like_count: number;
  username: string;
  avatar: string | null;
  role: string;
  experience: number;
  equipped_badges: string;
  is_liked: number;
}

export interface ForumPostsResponse {
  success: boolean;
  posts: ForumPost[];
  total: number;
  total_pages: number;
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
  experience: number;
  equipped_badges: string;
}

export interface ForumPostDetail {
  id: number;
  user_id: number;
  title: string;
  content: string;
  views: number;
  reply_count: number;
  is_pinned: number;
  created_at: string;
  updated_at: string;
  cover_image: string | null;
  like_count: number;
  username: string;
  avatar: string | null;
  role: string;
  experience: number;
  user_created_at: string;
  is_liked: number;
}

export interface ForumPostDetailResponse {
  success: boolean;
  post: ForumPostDetail;
  comments: ForumComment[];
  total_comments: number;
  total_pages: number;
}
