import { cookies } from 'next/headers';
import HomeContent from './HomeContent';
import { readHomeFeed } from '@/lib/feed.server';
import { COOKIE_KEYS } from '@/lib/constants';
import { parseFingerprintCookie, parseSortField } from '@/lib/searchQuery';

/**
 * The server shell for the home page.
 *
 * The gallery itself is unchanged and still a client component — it owns the hero flight's launch
 * points, the tab shared axis and the masonry cascade, none of which belong on the server. What
 * moved is the first page of the feed: it is fetched here, cached across visitors that share a
 * filter, and handed down as a seed, so the HTML arrives with fifty pictures in it instead of a
 * skeleton and a round trip.
 *
 * ## The cookie, and why the fingerprint rather than the settings
 *
 * The feed depends on the content filter, three toggles and the blocked-tag list — all of which
 * live in `localStorage`, which the server cannot read. `syncBrowsingCookie` (lib/resources.ts)
 * mirrors `browsingFingerprint()`'s output into a cookie, so this can compute the same cache key
 * the client will. The fingerprint rather than the five inputs, so the derivation has one owner.
 *
 * A missing cookie is the *default* filter, which is what a visitor who has never opened
 * /settings has anyway. A stale one costs exactly one request: the island renders its first frame
 * with the server's fingerprint (so hydration matches the HTML byte for byte), then switches to
 * the device's own after mount, which changes the key and sends one read. `keepPrevious` keeps
 * the server's rows on screen while that lands.
 *
 * `readHomeFeed` returns `null` on a timeout or an unhappy upstream, and the island falls straight
 * back to the client fetch it has always done.
 */
export default async function HomePage() {
  const jar = await cookies();
  /* The *default* fingerprint when the cookie is absent, not an empty string. A first-time
     visitor's browser computes `safe|-|d|-|` for the identical query, and the seed only applies
     when the two keys match — so keying an absent cookie on `''` made every first load fetch what
     the server had already fetched. */
  /* **No `decodeURIComponent` here.** `cookies()` already decodes — Next's cookie parser runs
     `decodeURIComponent` on every value — so decoding again is a second pass over text that is
     already plain, and it *throws* on any surviving percent sign. That is not hypothetical: a
     user who blocks the tag `20% cooler` gets a fingerprint of `safe|-|d|-|20% cooler`, the
     second decode hits `% c`, `URIError` escapes an async Server Component, and `/` renders the
     error boundary. The cookie lives a year, so the route stays broken for that browser until
     cookies are cleared. Even when it does not throw it silently rewrites the value, so the key
     stops matching the client's and the seed never applies.

     Both values are validated rather than trusted: they are cookies, and they compose both the
     upstream URL and two server cache keys. See `parseSortField` / `parseFingerprintCookie`. */
  const fp = parseFingerprintCookie(jar.get(COOKIE_KEYS.browsing)?.value);
  const sort = parseSortField(jar.get(COOKIE_KEYS.homeSort)?.value);
  const seed = await readHomeFeed(fp, sort);
  return <HomeContent seed={seed} />;
}
