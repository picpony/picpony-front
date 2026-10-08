/**
 * PicPony's two gallery reads (decision 15): the pictures PicPony users have discussed, and
 * PicPony's own comment counts for a page of pictures. Both are public — no token, the original
 * front end sent none — and both throw `ApiError` on any failure, like every typed adapter.
 */
import { picponyPostJson, picponyRequest, readEnvelope, listOf, pageCount } from './http';

/** One discussed picture: its Derpibooru id and PicPony's own comment count on it. */
export interface DiscussedImage {
  imageId: number;
  comments: number;
  lastCommentedAt: string | null;
}

export interface DiscussedPage {
  images: DiscussedImage[];
  total: number;
  totalPages: number;
}

/** The backend caps a page at 50 (asking for 100 returned 50 with `total_pages` to match). */
export const DISCUSSED_PAGE_SIZE = 50;

/**
 * `get_discussed_images&limit=&page=` → `{ success, images: [{ image_id, comment_count,
 * last_commented_at }], total, total_pages }`, most recently discussed first.
 */
export async function getDiscussedImages(page: number, signal?: AbortSignal): Promise<DiscussedPage> {
  const res = await picponyRequest('get_discussed_images', {
    query: { limit: DISCUSSED_PAGE_SIZE, page },
    cache: 'no-store',
    signal,
  });
  const data = await readEnvelope<{ images?: unknown; total?: unknown; total_pages?: unknown }>(res);
  const images: DiscussedImage[] = [];
  const seen = new Set<number>();
  for (const row of listOf<Record<string, unknown>>(data.images)) {
    const imageId = Number(row?.image_id);
    if (!Number.isSafeInteger(imageId) || imageId <= 0 || seen.has(imageId)) continue;
    seen.add(imageId);
    const comments = Number(row.comment_count);
    images.push({
      imageId,
      comments: Number.isFinite(comments) && comments > 0 ? Math.floor(comments) : 0,
      lastCommentedAt: typeof row.last_commented_at === 'string' ? row.last_commented_at : null,
    });
  }
  const total = Number(data.total);
  return {
    images,
    total: Number.isFinite(total) && total >= 0 ? total : images.length,
    totalPages: pageCount(data.total_pages),
  };
}

/**
 * `POST get_batch_comment_counts { image_ids }` → `{ success, counts: { id: n } }`. An id the
 * backend leaves out has no PicPony comments.
 */
export async function getBatchCommentCounts(
  ids: readonly number[],
  signal?: AbortSignal,
): Promise<Record<number, number>> {
  if (ids.length === 0) return {};
  /* A read that travels as a POST: bounded like a read, since a count that arrives late is
     worth nothing and aborting it changes nothing on the server. */
  const res = await picponyPostJson('get_batch_comment_counts', { image_ids: ids }, { signal, timeoutMs: 15_000 });
  const data = await readEnvelope<{ counts?: unknown }>(res);
  const counts: Record<number, number> = {};
  if (data.counts && typeof data.counts === 'object' && !Array.isArray(data.counts)) {
    for (const [key, value] of Object.entries(data.counts as Record<string, unknown>)) {
      const id = Number(key);
      const n = Number(value);
      if (Number.isSafeInteger(id) && Number.isFinite(n) && n > 0) counts[id] = Math.floor(n);
    }
  }
  return counts;
}
