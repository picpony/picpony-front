'use client';

/**
 * What each route reads first — one table, so a link can start it before the route exists.
 *
 * A `<Link>` prefetch is not a data prefetch: Next warms the RSC payload and chunk, but every
 * screen begins its own reads in its first effect, so a warm chunk still means a round trip on
 * arrival. Not covered: the image detail (`lib/useHero.ts` owns a warmer entangled with the hero
 * flight) and routes whose first read needs destination-only state.
 */

import { readToken, readUserInfo } from '@/lib/hooks';
import { getBrowsingSettings } from '@/lib/api/client';
import { warmSearchArtwork } from '@/lib/lottieAssets';
import {
  blockGroups,
  browsingFingerprint,
  browsingHistory,
  faveIds,
  featuredImage,
  forumPosts,
  forumThread,
  homeFeed,
  tasks,
  teamMembers,
  userProfile,
  userUploads,
} from '@/lib/resources';

/** The profile grid's page size, which the screen also declares. Kept in step by being small. */
const PROFILE_PER_PAGE = 12;

/**
 * Warm whatever the given path reads first. Safe to call repeatedly; an unknown path warms
 * nothing — right for /settings and /upload, whose first reads depend on an unfilled form.
 */
export function prefetchRoute(href: string) {
  if (typeof window === 'undefined') return;

  let path: string;
  let search: URLSearchParams;
  try {
    const url = new URL(href, window.location.origin);
    path = url.pathname;
    search = url.searchParams;
  } catch {
    return;
  }

  if (path === '/search' && !search.get('q')) {
    warmSearchArtwork();
    return;
  }

  const token = readToken();
  const settings = getBrowsingSettings();

  /* The home route serves two tabs off one path, so the query decides which one to warm; warming
     both doubles the cost of hovering one link for a tab the visitor did not ask for. */
  if (path === '/') {
    if (search.get('tab') === 'forum') {
      forumPosts.prefetch({ page: 1 });
      return;
    }
    /* `fp` must be the same string the screen will compute (`homeFeed` in `lib/resources.ts`),
       or the warm entry lands under a key nothing reads. */
    homeFeed.prefetch({ page: 1, sort: settings.homeSort, fp: browsingFingerprint() });
    featuredImage.prefetch({ apiKey: (readUserInfo()?.api_key as string) || undefined });
    return;
  }

  /* `/forum` redirects to `/?tab=forum` in `next.config.ts`, so a link to it lands on the home
     route's forum pane and wants the same read. */
  if (path === '/forum') {
    forumPosts.prefetch({ page: 1 });
    return;
  }

  if (path.startsWith('/forum/')) {
    const id = path.slice('/forum/'.length);
    if (id && id !== 'create') forumThread.prefetch({ id, page: 1 });
    return;
  }

  if (path.startsWith('/user/')) {
    const id = path.slice('/user/'.length);
    if (!id) return;
    /* Both reads, independently: profile for the heading, uploads for the landing tab —
       warming only one leaves the arrival a round trip from anything to look at. */
    userProfile.prefetch({ id });
    userUploads.prefetch({ id, page: 1, perPage: PROFILE_PER_PAGE, token });
    return;
  }

  /* Public, so it comes before the token guard. */
  if (path === '/about') {
    teamMembers.prefetch({});
    return;
  }

  if (!token) return;

  if (path === '/favorites') faveIds.prefetch({ token });
  else if (path === '/history') browsingHistory.prefetch({ token, page: 1 });
  else if (path === '/tasks') tasks.prefetch({ token });
  else if (path === '/block-groups') blockGroups.prefetch({ token });
}
