/**
 * The cache keys the home page's server seeds and its client resources must agree on.
 *
 * A seed applies only when the key the server built equals the key the island computes
 * (`useResource`'s `initial`), so the two sides share one definition. Plain module: the server
 * (`lib/feed.server.ts`, `app/page.tsx`) and the resource catalogue (`lib/resources.ts`, a client
 * module whose exports a Server Component cannot call) both import it.
 */

/** `homeFeed`'s key: the sort, the page and the browsing fingerprint. */
export function homeFeedKey(page: number, sort: string, fp: string): string {
  return `${sort}:${page}:${fp}`;
}

/**
 * `featuredImage`'s key: whether a Derpibooru key was sent, and the content filter (developer
 * mode reads through another upstream filter). The server only ever seeds the keyless read.
 */
export function featuredKey(apiKey: string | undefined, contentFilter: string): string {
  return `${apiKey ?? ''}:${contentFilter}`;
}
