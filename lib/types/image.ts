export interface ImageRepresentation {
  full: string;
  small: string;
  thumb_tiny: string;
  thumb_small: string;
  thumb: string;
  medium: string;
  large: string;
  tall: string;
}

export interface PonyImage {
  id: number;
  width: number;
  height: number;
  aspect_ratio: number;
  representations: ImageRepresentation;
  format?: string;
  name: string;
  view_url: string;
  source_url: string | null;
  uploader: string;
  uploader_id?: number;
  created_at: string;
  size: number;
  score: number;
  comment_count: number;
  tags: string[];
  description: string;
  upvotes: number;
  downvotes: number;
}

export interface FeaturedImage {
  image: PonyImage;
  interactions: [];
}

export interface ApiResponse {
  total: number;
  images: PonyImage[];
}

export interface FavesResponse {
  success: boolean;
  faves?: number[];
  message?: string;
}

export interface SharedFavesResponse {
  success: boolean;
  username: string;
  faves: number[];
}

export interface Comment {
  id: number;
  body: string;
  created_at: string;
  user_id: number | null;
  username: string;
  avatar: string | null;
  source?: 'picpony' | 'trixiebooru';
}

export interface CommentsResponse {
  success: boolean;
  comments: Comment[];
  message?: string;
}
