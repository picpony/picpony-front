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
  /** Every source link Derpibooru holds for the picture; `source_url` is only the first. */
  source_urls?: string[];
  /** `null` for an anonymous upload — Derpibooru sends no name and no id for those. */
  uploader: string | null;
  uploader_id?: number | null;
  created_at: string;
  size: number;
  score: number;
  comment_count: number;
  tags: string[];
  description: string;
  upvotes: number;
  downvotes: number;
  /** Derpibooru's own flag: a GIF or an animated PNG that moves. */
  animated?: boolean;
}

/** A list can provide media geometry before the detail endpoint supplies metadata. */
export type ImagePreview = Pick<
  PonyImage,
  'id' | 'name' | 'representations' | 'view_url' | 'width' | 'height'
> & Partial<Omit<PonyImage, 'id' | 'name' | 'representations' | 'view_url' | 'width' | 'height'>>;

/**
 * The opened picture as a direct `/pic/:id` document read it on the server (`lib/detail.server.ts`),
 * handed to the page so its first paint is the picture's real header, media box and body.
 */
export interface DetailSeed {
  id: number;
  /** `null` when Derpibooru has no such picture (it answered 404) — an answer, not a failure. */
  image: PonyImage | null;
  /**
   * The glossary's Chinese names for the picture's tags — keys as `tagTranslationKey` makes
   * them, `null` for a tag the glossary lacks — or `null` when that read did not land in time.
   */
  translations: Record<string, string | null> | null;
  generatedAt: number;
}

export interface FeaturedImage {
  image: PonyImage;
  interactions: [];
}

export interface ApiResponse {
  total: number;
  images: PonyImage[];
}

export interface SharedFavesResponse {
  success: boolean;
  username: string;
  folder_name?: string;
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
  /** A PicPony author's experience points — their level is `floor(experience / 100) + 1`. */
  experience?: number;
  /** A PicPony author's equipped badges. */
  equipped_badges?: { badge_name: string; badge_color: string }[];
}
