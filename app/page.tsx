import { Suspense } from 'react';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import HomeContent from './HomeContent';
import { featuredOnImageLine, readFeatured, readHomeFeed, seedOnImageLine } from '@/lib/feed.server';
import { COOKIE_KEYS } from '@/lib/constants';
import { parseFingerprintCookie, parseSortField } from '@/lib/searchQuery';
import { searchPage } from '@/lib/searchState';
import { readRoutePolicyOnce, ssrImageLine } from '@/lib/imageLine.server';
import { FeaturedBannerSkeleton } from '@/components/FeaturedBanner';
import ImageGridSkeleton from '@/components/ImageGridSkeleton';
import HomeTabSkeleton from '@/components/forum/HomeTabSkeleton';
import { readForumFirstPage } from '@/lib/forum.server';

type HomeSearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const isForumTab = (params: Awaited<HomeSearchParams>) => first(params.tab) === 'forum';

/** The two tabs are two destinations, and the document title says which one is open. The pill
 *  keeps it in step on a switch (`HomeContent`), which does not re-run this. */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: HomeSearchParams;
}): Promise<Metadata> {
  return { title: isForumTab(await searchParams) ? '论坛' : '主页' };
}

/**
 * Server shell for the home page. The gallery itself is unchanged and still a client
 * component; what moved is its first read — fetched here, cached across visitors that share a
 * filter, and handed down as seeds, so the HTML arrives with the banner and fifty pictures in it
 * instead of skeletons and two round trips.
 *
 * The feed depends on the content filter, three toggles and the blocked-tag list, all in
 * `localStorage`, which the server cannot read. `syncBrowsingCookie` (lib/resources.ts)
 * mirrors `browsingFingerprint()`'s output into a cookie so this computes the same cache
 * key the client will — the fingerprint rather than the five inputs, so the derivation
 * has one owner. A missing cookie is the *default* filter; a stale one costs one request.
 * `readHomeFeed` returns null on timeout or unhappy upstream, and the island falls back to
 * the client fetch.
 *
 * **The page it seeds is the page in the URL** (`?page=`, C1), and the view (`?view=discussed`,
 * 本站讨论) seeds nothing — its read is client-side. The featured picture is read anonymously,
 * beside the feed and in parallel with it (`readFeatured`: a signed-in visitor's keyed read stays
 * in the browser).
 *
 * **Synchronous, with its own boundary in the gallery's shape.** The seed reads are awaited
 * inside the boundary, so while they run (up to their 2.5s bound) the first byte carries the
 * banner slot and the masonry skeleton — the geometry the page is about to have — rather than
 * the route's generic fallback, a column of blocks that then swapped for a grid.
 *
 * `/?tab=forum` waits for neither: the gallery is the pane not being shown, and it reads for
 * itself once the forum is on screen and the browser is idle (R12-006). It reads the forum's first
 * page instead (`lib/forum.server.ts`), behind the same boundary in the forum's shape — the one
 * list every visitor lands on, from PicPony's own backend, so the rows are in the first byte.
 */
export default function HomePage({ searchParams }: { searchParams: HomeSearchParams }) {
  /* Nothing is awaited out here — not even the search params — so the page itself never
     suspends and the route's generic fallback never stands in for it. */
  return (
    <Suspense fallback={<HomeTabSkeleton gallery={<HomeGallerySkeleton />} />}>
      <SeededHome searchParams={searchParams} />
    </Suspense>
  );
}

/** The gallery pane's shape — the same one `HomeContent`'s own boundary uses. */
function HomeGallerySkeleton() {
  return (
    <div className="max-w-7xl mx-auto">
      <FeaturedBannerSkeleton />
      <ImageGridSkeleton />
    </div>
  );
}

async function SeededHome({ searchParams }: { searchParams: HomeSearchParams }) {
  const params = await searchParams;
  if (isForumTab(params)) {
    return <HomeContent seed={null} featured={null} forumSeed={await readForumFirstPage()} />;
  }
  const [jar, policy] = await Promise.all([cookies(), readRoutePolicyOnce()]);
  /* The *default* fingerprint when the cookie is absent, not an empty string: a first-time
     visitor's browser computes `safe|-|d|-|` for the identical query, and the seed only
     applies when the two keys match — keying an absent cookie on `''` made every first
     load refetch what the server already had. */
  /* **No `decodeURIComponent` here**: `cookies()` already decodes, and a second pass
     throws on any surviving percent sign — a user who blocks the tag `20% cooler` got a
     `URIError` out of an async Server Component and `/` rendered the error boundary,
     for the life of the year-long cookie. It also silently rewrites the value, so the
     key stops matching the client's and the seed never applies.
     Both values are validated rather than trusted — they compose the upstream URL and
     two server cache keys. See `parseSortField` / `parseFingerprintCookie`. */
  const fp = parseFingerprintCookie(jar.get(COOKIE_KEYS.browsing)?.value);
  const sort = parseSortField(jar.get(COOKIE_KEYS.homeSort)?.value);
  const discussed = first(params.view) === 'discussed';
  const page = searchPage(first(params.page) ?? null);
  /* The seeds go out on the line this document renders with (a forced policy, else the
     device's cookie) — per request, after the shared memo read — so every URL a row carries
     (a WEBM card's `<video src>`, the banner's, a download) matches what the client renders. */
  const line = ssrImageLine(policy, jar.get(COOKIE_KEYS.imageLine)?.value);
  const [feed, featured] = await Promise.all([
    discussed ? Promise.resolve(null) : readHomeFeed(fp, sort, page),
    readFeatured(fp),
  ]);
  return <HomeContent seed={seedOnImageLine(feed, line)} featured={featuredOnImageLine(featured, line)} />;
}
