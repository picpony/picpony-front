import { DERPIBOORU_API_BASE } from '@/lib/constants';
import { buildSearchQueryFrom, parseBrowsingFingerprint, parseSortField } from '@/lib/searchQuery';
import type { ApiResponse } from '@/lib/types/image';
import { cacheSeconds, createServerMemo } from '@/lib/serverMemo';

/**
 * The first page of the home feed, read on the server so `/` arrives with pictures in it.
 *
 * This is the change the whole performance pass is for. `/` was a client component that rendered
 * a skeleton, hydrated, waited for the route policy, then sent its first request — so the HTML
 * contained no content at all and the gallery was a full round trip behind first paint.
 *
 * ## Why it is safe to share this across visitors
 *
 * The home feed is **anonymous**: `lib/resources.ts` calls `derpi.getImages(undefined, page)` and
 * that first argument is the API key. There is no per-user secret in the response, so one
 * visitor's page can legitimately be another's. What *does* vary is the browsing settings, and
 * those are in the URL — `q=` encodes the content filter, the anthro/pony toggles and the blocked
 * tags; `sf=` the sort — so Next's Data Cache, which keys on the URL, is fingerprint-partitioned
 * by construction.
 *
 * `getFeatured` is the counter-example and is deliberately **not** given this treatment: it puts
 * the user's own Derpibooru key in the query string, so a shared cache of it would hand one
 * visitor's keyed results to another. The banner stays a client read.
 *
 * ## Why it does not go through `proxyFetch`
 *
 * Three reasons, and they are the same three `lib/route.server.ts` gives:
 *
 * 1. `proxyFetch` awaits `ensureRoutePolicy()` — a client-side one-shot whose entire purpose is to
 *    gate the *browser's* first request — and then runs up to three attempts across three line
 *    switches with a linear backoff. Against an upstream measured at ~9s that is a document that
 *    can hang for a minute, and `lib/route.server.ts` already wrote the rule: a server read *may
 *    not slow the document down*.
 * 2. It reads `localStorage` through `buildSearchQuery` and `getSortParams`. The pure half of that
 *    is `lib/searchQuery.ts`, which is what this uses.
 * 3. The four API lines exist to route around *the visitor's* network. The server has no such
 *    problem and goes direct.
 *
 * One consequence worth stating: because this bypasses the line policy, `applyImageLine` has not
 * run on these URLs. That is correct and must stay that way — it is applied on the client after
 * the seed lands, where the visitor's own forced line (if any) is known. It is idempotent by
 * design, so re-applying it to seeded rows is safe.
 */

/** Matches `homeFeed`'s own TTL in `lib/resources.ts`, so both sides of the handoff share a clock. */
const REVALIDATE_S = 120;

/**
 * How long the document may wait for the feed.
 *
 * Longer than the route policy's 1500ms because this is the content, not a hint — falling back
 * costs a visible skeleton and a round trip. Still bounded, because a wedged upstream must not be
 * able to hold every visitor's document open.
 */
const TIMEOUT_MS = 2500;

/** `lib/api/derpi.ts`'s `getImages` uses 50, and the client's `hasMore` test compares against it. */
const PER_PAGE = 50;

const UPSTREAM = process.env.PICPONY_DERPI_ORIGIN || DERPIBOORU_API_BASE;

export interface FeedSeed {
  key: string;
  data: ApiResponse;
  generatedAt: number;
  /** The fingerprint the key was built from, so the island can render its first frame with it. */
  fp: string;
  sort: string;
}

/**
 * A process-local memo, for the reason `lib/serverMemo.ts` documents at length.
 *
 * `next: { revalidate }` is a request Next honours only if the upstream does not send
 * `Cache-Control: no-store`, and every visible `<Link>` to `/` — the sidebar's 图库 row, the
 * wordmark, the tab bar — has its RSC payload prefetched, which re-runs this. Without a cache
 * that cannot be overruled from outside, browsing anywhere in the app would fetch the home feed
 * repeatedly.
 *
 * Keyed on the fingerprint and sort, so it partitions exactly the way the URL does.
 */
export const readHomeFeed = createServerMemo({
  ttlMs: REVALIDATE_S * 1000,
  max: 8,
  keyOf: (fp: string, sort: string) => `${sort}:1:${fp}`,
  load: async (fp: string, sort: string): Promise<FeedSeed | null> => {
    const key = `${sort}:1:${fp}`;
    const q = buildSearchQueryFrom(parseBrowsingFingerprint(fp));
    /* Re-validated here as well as at the call site. This string goes straight into a URL the
       *server* fetches and into the key of two caches; one validator at one call site is one
       edit away from being bypassed. */
    const field = parseSortField(sort);
    const dir = field === 'random' ? '' : '&sd=desc';
    const url = `${UPSTREAM}/search/images?q=${q}&page=1&per_page=${PER_PAGE}&sf=${field}${dir}`;

    try {
      const res = await fetch(url, {
        next: { revalidate: cacheSeconds(REVALIDATE_S) },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': 'PicPony/1.0' },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as ApiResponse;
      if (!Array.isArray(data?.images)) return null;
      return { key, data, generatedAt: Date.now(), fp, sort };
    } catch {
      /* Timeout, offline upstream, HTML error page — all mean "no seed", which the island already
         handles by reading it itself. Swallowed rather than logged: it would log on every request
         of a site whose upstream is briefly unhappy. */
      return null;
    }
  },
});
