import type { ImagePreview, PonyImage } from '@/lib/types/image';

/* Dependency-free on purpose: the shell's `HeroStage` reads it, and `lib/detail.ts` pulls the hero
   controller in with it (`scripts/testArchitecture.mjs`). */

/**
 * A list row that already carries everything the detail renders — Derpibooru's search answers
 * with the very object `images/<id>` does (the home feed's server seed keeps the same fields,
 * `lib/feed.server.ts`). A profile's or PicPony's own rows lack some (no uploader, no counts), and
 * those still wait for the record. Returns the row typed as a record, or `null`.
 */
export function completeDetailRow(image: ImagePreview | null | undefined): PonyImage | null {
  if (!image) return null;
  const row = image as Partial<PonyImage>;
  return Array.isArray(row.tags) &&
    typeof row.description === 'string' &&
    'uploader' in row &&
    typeof row.created_at === 'string' &&
    typeof row.size === 'number' &&
    typeof row.upvotes === 'number' &&
    typeof row.downvotes === 'number' &&
    typeof row.comment_count === 'number' &&
    Array.isArray(row.source_urls)
    ? (image as PonyImage)
    : null;
}
