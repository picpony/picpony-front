import { cookies } from 'next/headers';
import HomeContent from './HomeContent';
import { readHomeFeed } from '@/lib/feed.server';
import { COOKIE_KEYS } from '@/lib/constants';
import { parseFingerprintCookie, parseSortField } from '@/lib/searchQuery';

/**
 * Server shell for the home page. The gallery itself is unchanged and still a client
 * component; what moved is the first page of the feed — fetched here, cached across
 * visitors that share a filter, and handed down as a seed, so the HTML arrives with
 * fifty pictures in it instead of a skeleton and a round trip.
 *
 * The feed depends on the content filter, three toggles and the blocked-tag list, all in
 * `localStorage`, which the server cannot read. `syncBrowsingCookie` (lib/resources.ts)
 * mirrors `browsingFingerprint()`'s output into a cookie so this computes the same cache
 * key the client will — the fingerprint rather than the five inputs, so the derivation
 * has one owner. A missing cookie is the *default* filter; a stale one costs one request
 * (the island renders the server's fingerprint first, then switches after mount, and
 * `keepPrevious` keeps the server's rows on screen while it lands). `readHomeFeed`
 * returns null on timeout or unhappy upstream, and the island falls back to the client
 * fetch.
 */
export default async function HomePage() {
  const jar = await cookies();
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
  const seed = await readHomeFeed(fp, sort);
  return <HomeContent seed={seed} />;
}
