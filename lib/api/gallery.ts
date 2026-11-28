/**
 * PicPony's two gallery reads (decision 15): the pictures PicPony users have discussed, and
 * PicPony's own comment counts for a page of pictures. Both are public — no token, the original
 * front end sent none — and both throw `ApiError` on any failure, like every typed adapter.
 */
import { api } from './http';

/** One discussed picture: its Derpibooru id and PicPony's own comment count on it. */
export interface DiscussedImage {
  imageId: number;
  comments: number;
  lastCommentedAt: string;
}

export interface DiscussedPage {
  images: DiscussedImage[];
  total: number;
  totalPages: number;
}

/** A page of 本站讨论 (the backend allows up to 100). */
export const DISCUSSED_PAGE_SIZE = 50;

/**
 * `GET /images/discussed?page=&limit=` → `{ images: [{ image_id, comment_count,
 * last_commented_at }], total, total_pages }`, most recently discussed first.
 */
export async function getDiscussedImages(page: number, signal?: AbortSignal): Promise<DiscussedPage> {
  const data = await api<{
    images: { image_id: number; comment_count: number; last_commented_at: string }[];
    total: number;
    total_pages: number;
  }>('GET', '/images/discussed', {
    query: { limit: DISCUSSED_PAGE_SIZE, page },
    cache: 'no-store',
    signal,
  });
  return {
    images: data.images.map((row) => ({
      imageId: row.image_id,
      comments: row.comment_count,
      lastCommentedAt: row.last_commented_at,
    })),
    total: data.total,
    totalPages: Math.max(1, data.total_pages),
  };
}

/**
 * `POST /images/comment-counts { image_ids }` → `{ counts: { id: n } }` (at most 1000 ids). An
 * id the backend leaves out has no PicPony comments.
 */
export async function getBatchCommentCounts(
  ids: readonly number[],
  signal?: AbortSignal,
): Promise<Record<number, number>> {
  if (ids.length === 0) return {};
  /* A read that travels as a POST: bounded like a read, since a count that arrives late is
     worth nothing and aborting it changes nothing on the server. */
  const data = await api<{ counts: Record<string, number> }>('POST', '/images/comment-counts', {
    json: { image_ids: ids },
    signal,
    timeoutMs: 15_000,
  });
  const counts: Record<number, number> = {};
  for (const [key, value] of Object.entries(data.counts)) counts[Number(key)] = value;
  return counts;
}
