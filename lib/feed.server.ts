import { DERPIBOORU_API_BASE } from '@/lib/constants';
import {
  buildSearchQueryFrom,
  parseBrowsingFingerprint,
  parseSortField,
  UNMIRRORABLE_FINGERPRINT,
  withDerpiContentFilter,
} from '@/lib/searchQuery';
import type { ApiResponse, PonyImage } from '@/lib/types/image';
import { featuredKey, homeFeedKey } from '@/lib/feedKeys';
import type { ImageLine } from '@/lib/route';
import { buildImageUrl, getRawImageUrl } from '@/lib/imageLoader';
import { createServerMemo } from '@/lib/serverMemo';
import { readBlockFilters, readPublicBlacklist } from '@/lib/blockFilters.server';
import { withBlockFiltersFingerprint, type BlockFilters, type PublicBlacklist } from '@/lib/blockFilters';
import { isWithheldBy } from '@/lib/imageFilters';

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
 * which the server does not have — it goes direct.
 *
 * **The rows come back on no image line** — raw `derpicdn.net` URLs — because the line is the
 * visitor's, not the server's, and this memo is shared. The page puts them on the line the
 * document renders with (`seedOnImageLine`), per request and after the memo read; nothing on the
 * client re-applies it to a seed. (Cards re-derive their own URLs either way; everything that
 * renders a row's URL directly — a WEBM card's `<video>`, a download — takes it as it is.)
 *
 * Two feeds get no seed at all, and render the gallery skeleton instead: a fingerprint the
 * device could not mirror into its cookie (`UNMIRRORABLE_FINGERPRINT` — the *default* feed in its
 * place put pictures the user had hidden into the server HTML), and the random sort (a shared
 * memo would hand every visitor the same "random" page, under a seed the browser does not have).
 */

/** Matches `homeFeed`'s own TTL in `lib/resources.ts`, so both sides of the handoff share a clock. */
const REVALIDATE_S = 120;

/** How long the document may wait: longer than the route policy's 1500ms — this is the content,
 *  not a hint — but bounded, so a wedged upstream cannot hold every visitor's document open.
 *  The feed and the featured picture are read in parallel, so this is the wait for both. */
const TIMEOUT_MS = 2500;

/** Matches `featuredImage`'s own TTL: the featured picture changes once a day. */
const FEATURED_TTL_MS = 10 * 60 * 1000;

/** The deepest page a document seeds. A deep link past it reads on the client like any page
 *  turn, so a crawler walking `?page=` cannot fill the memo with one visit per page. */
const MAX_SEEDED_PAGE = 20;

/** `lib/api/derpi.ts`'s `getImages` uses 50, and the client's `hasMore` test compares against it. */
const PER_PAGE = 50;

/**
 * Memo slots. Every visitor whose hidden-tag list differs is its own key; eight slots churned as
 * soon as more fingerprints than that were in play, and each churned document was an upstream
 * request. A slot is one 50-picture page.
 */
const MAX_SLOTS = 24;

/**
 * After a rate limit or an outage, how long this server leaves the upstream alone. Every SSR read
 * comes from one IP, so a 429 is the whole site's, not one visitor's: without a pause, each new
 * document (of any fingerprint) re-hit the limit and extended it. `Retry-After` is honoured up to
 * the cap. The browser's own read is unaffected — it goes out on the visitor's line.
 */
const BACKOFF_DEFAULT_MS = 15_000;
const BACKOFF_MAX_MS = 60_000;
let upstreamBackoffUntil = 0;

function backoffFrom(response: Response): number {
  const header = response.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
    if (Number.isFinite(ms) && ms > 0) return Math.min(ms, BACKOFF_MAX_MS);
  }
  return BACKOFF_DEFAULT_MS;
}

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
 * Keyed on the full fingerprint (preferences, public rules, blacklist) and the sort.
 */
const read = createServerMemo<[string, string, number, BlockFilters, PublicBlacklist], FeedSeed>({
  ttlMs: REVALIDATE_S * 1000,
  max: MAX_SLOTS,
  keyOf: (fp, sort, page) => homeFeedKey(page, sort, fp),
  load: async (
    fp: string,
    sort: string,
    page: number,
    filters: BlockFilters,
    blacklist: PublicBlacklist,
  ): Promise<FeedSeed | null> => {
    if (Date.now() < upstreamBackoffUntil) return null;
    const key = homeFeedKey(page, sort, fp);
    const settings = parseBrowsingFingerprint(fp);
    const q = buildSearchQueryFrom(settings, undefined, filters, blacklist);
    /* Re-validated here, not just at the call site: this string goes into a server-side URL and
       into two cache keys, and one validator at one call site is one edit from being bypassed. */
    const field = parseSortField(sort);
    const url = withDerpiContentFilter(
      `${UPSTREAM}/search/images?q=${q}&page=${page}&per_page=${PER_PAGE}&sf=${field}&sd=desc`,
      settings.contentFilter,
    );

    try {
      const res = await fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        /* A server may name itself (Derpibooru asks API clients to); only a *browser* request
           must not, where the header is dropped or costs a CORS preflight. */
        headers: { 'User-Agent': 'PicPony/1.0' },
      });
      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) upstreamBackoffUntil = Date.now() + backoffFrom(res);
        void res.body?.cancel().catch(() => {});
        return null;
      }
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

export async function readHomeFeed(fp: string, sort: string, page = 1): Promise<FeedSeed | null> {
  if (fp === UNMIRRORABLE_FINGERPRINT) return null;
  const field = parseSortField(sort);
  if (field === 'random') return null;
  if (!Number.isSafeInteger(page) || page < 1 || page > MAX_SEEDED_PAGE) return null;
  const [filters, blacklist] = await Promise.all([readBlockFilters(), readPublicBlacklist()]);
  return read(withBlockFiltersFingerprint(fp, filters, blacklist), field, page, filters, blacklist);
}

// ---------------------------------------------------------------------------
// 近日推荐, anonymously
// ---------------------------------------------------------------------------

export interface FeaturedSeed {
  /** `featuredImage`'s key for the keyless read under this filter (`lib/feedKeys.ts`). */
  key: string;
  /** `null` when Derpibooru features nothing — an answer, not a failure. */
  data: PonyImage | null;
  generatedAt: number;
  /** The content filter the read was made under, so the island's first key agrees. */
  contentFilter: string;
  /** Whether the document's own settings (the fingerprint cookie) withhold the picture. */
  hidden: boolean;
}

/**
 * The featured picture as an anonymous visitor sees it, so the banner — the home page's largest
 * element, and the phone's LCP — arrives in the first byte instead of after hydration, a session
 * read and a client fetch (R12-003).
 *
 * Only the keyless read: `getFeatured` with the user's own Derpibooru key stays in the browser
 * (a shared server cache would leak it), and a signed-in visitor with a key re-reads on the
 * client over this one. Keyed on the content filter, which changes the upstream filter.
 */
const readFeaturedMemo = createServerMemo<[string], Omit<FeaturedSeed, 'hidden'>>({
  ttlMs: FEATURED_TTL_MS,
  max: 3,
  keyOf: (contentFilter) => contentFilter,
  load: async (contentFilter: string) => {
    if (Date.now() < upstreamBackoffUntil) return null;
    const url = withDerpiContentFilter(`${UPSTREAM}/images/featured`, contentFilter);
    try {
      const res = await fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': 'PicPony/1.0' },
      });
      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) upstreamBackoffUntil = Date.now() + backoffFrom(res);
        void res.body?.cancel().catch(() => {});
        return null;
      }
      const body = (await res.json()) as { image?: unknown };
      const image = body?.image;
      const key = featuredKey(undefined, contentFilter);
      if (image === null || image === undefined) return { key, data: null, generatedAt: Date.now(), contentFilter };
      const row = image as PonyImage;
      if (typeof row !== 'object' || !Number.isSafeInteger(row.id)) return null;
      return { key, data: row, generatedAt: Date.now(), contentFilter };
    } catch {
      return null;
    }
  },
});

/**
 * The anonymous featured picture under the fingerprint's content filter, with the document's
 * verdict on it: `hidden` when the fingerprint's own settings (content filter, ban toggles,
 * hidden tags, only-pony) withhold it — the same test the banner applies in the browser
 * (`lib/imageFilters.ts`), so the server renders the slot the island will keep.
 */
export async function readFeatured(fp: string): Promise<FeaturedSeed | null> {
  const unknownDevice = fp === UNMIRRORABLE_FINGERPRINT;
  const settings = parseBrowsingFingerprint(unknownDevice ? undefined : fp);
  const [seed, filters] = await Promise.all([readFeaturedMemo(settings.contentFilter), readBlockFilters()]);
  if (!seed) return null;
  /* An unmirrorable fingerprint means this device's hidden tags are unknown here: render no
     picture rather than one the user may have hidden, and let the browser decide. */
  const hidden = unknownDevice || (seed.data ? isWithheldBy(seed.data.tags, settings, filters) : false);
  return { ...seed, hidden };
}

const TIER_OF = { picpony: 0, cdn: 1, direct: 2 } as const;

function onLine(url: string | null | undefined, tier: 0 | 1 | 2): string {
  return typeof url === 'string' && url ? buildImageUrl(getRawImageUrl(url), tier) : (url ?? '');
}

/**
 * The row fields anything in the app reads — the card, the hero's preview, the detail's first
 * paint. Derpibooru sends about twice as many (two SHA-512 hashes, tag ids, intensities, source
 * lists, processing flags), and every one rode in the seeded document's RSC payload, which was
 * ≈170KB of a 446KB home document (R12-002). A browser-fetched page keeps them; nothing reads them.
 */
const ROW_FIELDS = [
  'id', 'width', 'height', 'aspect_ratio', 'representations', 'format', 'name', 'view_url',
  'source_url', 'uploader', 'uploader_id', 'created_at', 'updated_at', 'first_seen_at', 'size',
  'score', 'comment_count', 'tags', 'description', 'upvotes', 'downvotes', 'faves', 'animated',
  'duration', 'mime_type', 'spoilered',
] as const;

function trimRow(image: PonyImage): PonyImage {
  const row: Record<string, unknown> = {};
  const source = image as unknown as Record<string, unknown>;
  for (const field of ROW_FIELDS) if (field in source) row[field] = source[field];
  return row as unknown as PonyImage;
}

function rowOnLine(image: PonyImage, tier: 0 | 1 | 2): PonyImage {
  return {
    ...trimRow(image),
    representations: Object.fromEntries(
      Object.entries(image.representations ?? {}).map(([name, url]) => [name, onLine(url as string, tier)]),
    ) as unknown as PonyImage['representations'],
    view_url: onLine(image.view_url, tier),
  };
}

/** The featured seed with its row on the document's image line — see `seedOnImageLine`. */
export function featuredOnImageLine(seed: FeaturedSeed | null, line: ImageLine | null): FeaturedSeed | null {
  if (!seed?.data) return seed;
  return { ...seed, data: rowOnLine(seed.data, TIER_OF[line ?? 'picpony']) };
}

/**
 * A seed with its rows on the image line the document renders with — the same URLs
 * `applyImageLine` gives rows the browser fetches itself, so a server-rendered `<video src>` and
 * its hydration agree. `line` is the page's resolved line (a forced policy first, then the
 * device's cookie); `null` means the defaults, which resolve to the PicPony worker on both sides.
 * Per request and after the memo read: the memo is shared across visitors on every line.
 */
export function seedOnImageLine(seed: FeedSeed | null, line: ImageLine | null): FeedSeed | null {
  if (!seed) return seed;
  const tier = TIER_OF[line ?? 'picpony'];
  const images = seed.data.images.map((image) => rowOnLine(image, tier));
  return { ...seed, data: { ...seed.data, images } };
}
