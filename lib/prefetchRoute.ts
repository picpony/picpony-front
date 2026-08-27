'use client';

/**
 * What each route reads first — in one place, so a link can start it before the route exists.
 *
 * A `<Link>` already prefetches the *route*: Next fetches the RSC payload and the JS chunk when the
 * link is in the viewport. That is real and it is not the expensive half. Every screen in this app
 * is a client component that begins its own reads in its first effect, so a warm chunk still means
 * an empty screen, a skeleton and a round trip on arrival. The code was prefetched and the content
 * was not.
 *
 * This is the missing half. It is a table rather than a per-link prop because the knowledge is
 * "what does /favorites read", which belongs next to the resource catalogue and not scattered
 * across the four components that happen to link there.
 *
 * ## What it deliberately does not cover
 *
 * The image detail. `lib/useHero.ts` has its own warmer with the flight's frame capture and its own
 * priority promotion, and folding it in here would flatten a distinction that file spends
 * paragraphs on.
 *
 * And any route whose first read needs something only the destination knows. A prefetch is a guess
 * with a strict budget; a guess that needs a round trip of its own to become useful is not one.
 */

import { readToken, readUserInfo } from '@/lib/hooks';
import { getBrowsingSettings } from '@/lib/api/client';
import {
  blockGroups,
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
 * Warm whatever the given path reads first.
 *
 * Safe to call repeatedly and safe to call for a path with no entry — an unknown route simply warms
 * nothing, which is the right answer for `/settings` and `/upload`, whose first reads all depend on
 * a form the visitor has not filled in yet.
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

  const token = readToken();
  const settings = getBrowsingSettings();

  /* The home route serves two tabs off one path, so the query decides which one to warm. Warming
     both would double the cost of hovering one link for a tab the visitor did not ask for. */
  if (path === '/') {
    if (search.get('tab') === 'forum') {
      forumPosts.prefetch({ page: 1 });
      return;
    }
    homeFeed.prefetch({ page: 1, sort: settings.homeSort });
    featuredImage.prefetch({ apiKey: (readUserInfo()?.api_key as string) || undefined });
    return;
  }

  /* `/forum` redirects to `/?tab=forum` in `next.config.ts`, so a link to it lands on the home
     route's forum pane and wants the same read. Checking for the redirect rather than assuming the
     path is deep is the rule AGENTS.md already states about this route. */
  if (path === '/forum') {
    forumPosts.prefetch({ page: 1 });
    return;
  }

  if (path.startsWith('/forum/')) {
    const id = path.slice('/forum/'.length);
    if (id && id !== 'create') forumThread.prefetch({ id });
    return;
  }

  if (path.startsWith('/user/')) {
    const id = path.slice('/user/'.length);
    if (!id) return;
    /* Both, because they are independent — the profile for the heading and the uploads for the tab
       the visitor lands on. Warming only the profile would leave the arrival still a round trip
       away from anything to look at, which is the waterfall this screen just had removed. */
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
