import { DERPIBOORU_API_BASE } from '@/lib/constants';
import { buildSearchQueryFrom, parseBrowsingFingerprint, parseSortField, withDerpiContentFilter } from '@/lib/searchQuery';
import type { ApiResponse } from '@/lib/types/image';
import { createServerMemo } from '@/lib/serverMemo';
import { readBlockFilters } from '@/lib/blockFilters.server';
import { withBlockFiltersFingerprint, type BlockFilters } from '@/lib/blockFilters';

/**
 * The first page of the home feed, read on the server so `/` arrives with pictures in it; the
 * island takes it as `initial` and seeds it into `homeFeed` via `resource.seed()`.
 *
 * Safe to share across visitors: the feed is anonymous (`derpi.getImages(undefined, page)` sends
 * no API key), and the browsing settings that do vary are in the URL (`q=` filters and toggles,
 * `filter_id=` the upstream preset, `sf=` the sort), so the memo is fingerprint-partitioned.
 * Island and server compute the same key because the fingerprint is mirrored
 * into a cookie (`syncBrowsingCookie`); the server never reads the `localStorage` it cannot see.
 * The counter-example is `getFeatured`, which puts the user's own Derpibooru key in the query
 * string: a shared cache of it would leak one visitor's keyed results to another, so the banner
 * stays a client read.
 *
 * Not `proxyFetch`, for the same reasons `lib/route.server.ts` gives: it awaits the client-side
 * `ensureRoutePolicy()` and then runs a retry ladder across line switches, and a server read may
 * not slow the document down; it reads `localStorage` through `buildSearchQuery` (the pure half,
 * `lib/searchQuery.ts`, is what this uses); and the API lines route around the visitor's network,
 * which the server does not have — it goes direct. So `applyImageLine` has not run here, and must
 * not: the client applies it after the seed lands, where the visitor's own forced line is known.
 * Idempotent, so re-applying to seeded rows is safe.
 */

/** Matches `homeFeed`'s own TTL in `lib/resources.ts`, so both sides of the handoff share a clock. */
const REVALIDATE_S = 120;

/** How long the document may wait: longer than the route policy's 1500ms — this is the content,
 *  not a hint — but bounded, so a wedged upstream cannot hold every visitor's document open. */
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
 * A process-local memo, because every visible `<Link>` to `/` has its RSC payload prefetched and
 * rendering that payload re-runs this read — without a cache, browsing anywhere in the app
 * reads the feed again (see `lib/serverMemo.ts`). This is the feed's only server cache:
 * Next's stale-while-revalidate Data Cache could return an old response which would then
 * receive a new generatedAt, preventing the browser from refreshing those old pictures.
 * The memo still coalesces concurrent reads and keeps the actual seed timestamp for 120s.
 * Keyed on fingerprint and sort, matching the URL.
 */
const read = createServerMemo({
  ttlMs: REVALIDATE_S * 1000,
  max: 8,
  keyOf: (fp: string, sort: string, filters: BlockFilters) =>
    `${sort}:1:${withBlockFiltersFingerprint(fp, filters)}`,
  load: async (fp: string, sort: string, filters: BlockFilters): Promise<FeedSeed | null> => {
    const key = `${sort}:1:${fp}`;
    const settings = parseBrowsingFingerprint(fp);
    const q = buildSearchQueryFrom(settings, undefined, filters);
    /* Re-validated here, not just at the call site: this string goes into a server-side URL and
       into two cache keys, and one validator at one call site is one edit from being bypassed. */
    const field = parseSortField(sort);
    const dir = field === 'random' ? '' : '&sd=desc';
    const url = withDerpiContentFilter(
      `${UPSTREAM}/search/images?q=${q}&page=1&per_page=${PER_PAGE}&sf=${field}${dir}`,
      settings.contentFilter,
    );

    try {
      const res = await fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': 'PicPony/1.0' },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as ApiResponse;
      if (!Array.isArray(data?.images)) return null;
      return { key, data, generatedAt: Date.now(), fp, sort };
    } catch {
      /* Timeout, offline upstream, HTML error page — all mean "no seed", which the island already
         handles by reading it itself. Swallowed rather than logged: it would log on every hit. */
      return null;
    }
  },
});

export async function readHomeFeed(fp: string, sort: string): Promise<FeedSeed | null> {
  const filters = await readBlockFilters();
  return read(withBlockFiltersFingerprint(fp, filters), sort, filters);
}
