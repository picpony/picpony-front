/**
 * A subscription's address — pure, so the notification parser (`app/messages/messageText.ts`) and
 * the route share it without either pulling in the resource layer.
 *
 * One path segment per tag: `encodeURIComponent` carries any name through it, `/` and `%`
 * included. The router hands the segment back still percent-encoded (measured on this Next: both
 * `useParams()` and a page's `params` give `rainbow%20dash`), so it is decoded exactly once.
 */

export function subscriptionHref(tag: string): string {
  return `/subscriptions/${encodeURIComponent(tag.trim())}`;
}

export function tagFromSegment(segment: string | undefined): string {
  if (!segment) return '';
  try {
    return decodeURIComponent(segment).trim();
  } catch {
    return segment.trim();
  }
}

/**
 * A page of a subscription's gallery — the grid's page size, as /search and the favourites read
 * theirs — here so the route warmer and the screen share one number.
 */
export const SUBSCRIPTION_PER_PAGE = 50;

/**
 * The deepest page Derpibooru serves: from page 1000 on it answers a bot challenge instead of
 * JSON (measured for /search, 2026-09-26, which holds the same number). A tag with 300,000
 * pictures must not be offered page 6,000.
 */
export const DERPI_MAX_PAGE = 999;

/** Pages a gallery of `total` pictures can offer. */
export function subscriptionPages(total: number): number {
  return Math.max(1, Math.min(DERPI_MAX_PAGE, Math.ceil(total / SUBSCRIPTION_PER_PAGE)));
}
