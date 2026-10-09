/**
 * The PicPony backend this server talks to — one answer for every server-side reader and proxy
 * (review P1-F7 / P2-F7).
 *
 * `PICPONY_UPSTREAM_ORIGIN` points a deployment (staging, the browser suites' fixture server) at
 * another backend. It used to be read in ten places, each with its own `|| …` default, and three
 * of them (share.php's create, the admin import proxy, the `/search-api` rewrite) once skipped it
 * and reached production from a fixture — with an administrator's Bearer token. One function, so
 * a new reader cannot forget the override or invent a different default.
 *
 * **A malformed value fails loudly** instead of falling back to production: a typo in a staging
 * deployment would otherwise send that deployment's sessions to the live backend without a
 * trace. Accepted: an `http:` / `https:` origin with no credentials, path, query or fragment (a
 * trailing `/` is tolerated). The answer is the canonical origin, with no trailing slash, so call
 * sites can append `/api.php` directly.
 *
 * Server-only by convention (the repo does not depend on `server-only`): nothing on the client
 * may read it — the browser goes through this server's own routes.
 */

/** The production backend; the default when the override is unset or empty. */
export const DEFAULT_UPSTREAM_ORIGIN = 'https://picpony.top';

export function parseUpstreamOrigin(raw: string | undefined | null): string {
  const value = (raw ?? '').trim();
  if (!value) return DEFAULT_UPSTREAM_ORIGIN;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`PICPONY_UPSTREAM_ORIGIN is not a URL: ${JSON.stringify(value)}`);
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username || url.password || url.search || url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new Error(`PICPONY_UPSTREAM_ORIGIN must be a bare http(s) origin: ${JSON.stringify(value)}`);
  }
  return url.origin;
}

/** The backend origin for this process, from `PICPONY_UPSTREAM_ORIGIN`. */
export function upstreamOrigin(): string {
  return parseUpstreamOrigin(process.env.PICPONY_UPSTREAM_ORIGIN);
}
