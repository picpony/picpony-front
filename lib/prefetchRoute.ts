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
  coinTransactions,
  faveFolders,
  faveIds,
  featuredImage,
  forumPosts,
  homeFeed,
  profileFaveFolders,
  quickTags,
  sharedFaveIds,
  shopItems,
  tagGallery,
  tagGroups,
  tagSubscriptions,
  tasks,
  teamMembers,
  userProfile,
  userUploads,
} from '@/lib/resources';
import { SUBSCRIPTION_PER_PAGE, tagFromSegment } from '@/components/subscriptions/href';

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

  /* The empty /search screen reads its quick tags on arrival, unconditionally, so warming them moves
     a request earlier and adds none; the artwork was warmed alone, and a hover landed on an empty
     row of tags (G0-001). */
  if (path === '/search' && !search.get('q')) {
    warmSearchArtwork();
    void quickTags.prefetch({});
    return;
  }

  const token = readToken();
  const settings = getBrowsingSettings();

  /* The home route serves two tabs off one path, so the query decides which one to warm; warming
     both doubles the cost of hovering one link for a tab the visitor did not ask for. */
  if (path === '/') {
    if (search.get('tab') === 'forum') {
      /* The token is part of the key: a signed-in list carries the reader's unread marks. */
      forumPosts.prefetch({ page: 1, token });
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
    forumPosts.prefetch({ page: 1, token });
    return;
  }

  /* A thread is never warmed ahead of a press: its read counts a view on the server, so warming
     a link the pointer only crossed would count one. The forum list warms a thread on the press
     itself (`components/ForumPostList.tsx`). */
  if (path.startsWith('/forum/')) return;

  if (path.startsWith('/user/')) {
    const id = path.slice('/user/'.length);
    if (!id) return;
    /* Both reads, independently: profile for the heading, uploads for the landing tab —
       warming only one leaves the arrival a round trip from anything to look at. */
    userProfile.prefetch({ id });
    /* `fp` spelled out, the same string the profile passes: a key function must not read
       storage itself, and the warm entry has to land under the key the screen will read. */
    userUploads.prefetch({ id, page: 1, perPage: PROFILE_PER_PAGE, token, fp: browsingFingerprint() });
    return;
  }

  /* Public, so it comes before the token guard. */
  if (path === '/about') {
    teamMembers.prefetch({});
    return;
  }

  /* The shop browses signed out; a signed-in read carries the token, so it is its own key. */
  if (path === '/shop') {
    shopItems.prefetch({ token });
    return;
  }

  /* A subscription's gallery is public pictures; the same key the screen computes. */
  if (path.startsWith('/subscriptions/')) {
    const tag = tagFromSegment(path.slice('/subscriptions/'.length));
    if (tag) {
      tagGallery.prefetch({
        tag,
        page: 1,
        perPage: SUBSCRIPTION_PER_PAGE,
        contentFilter: settings.contentFilter,
        fp: browsingFingerprint(),
      });
    }
    return;
  }

  /* Somebody's public folder: anonymous, so before the token guard. Its ids, and — for a folder
     other than the main one — the owner's public list the screen checks it against. */
  const shared = /^\/favorites\/shared\/([^/]+)\/(\d{1,10})$/.exec(path);
  if (shared) {
    let username = shared[1];
    try {
      username = decodeURIComponent(username);
    } catch {
      /* Warmed as it came; the screen decodes the same way. */
    }
    const folderId = Number(shared[2]);
    sharedFaveIds.prefetch({ username, folderId });
    if (folderId > 0) profileFaveFolders.prefetch({ username });
    return;
  }

  if (!token) return;

  /* The folder grid and the header's count; a folder's page reads the list and its own ids. */
  const folder = /^\/favorites\/folder\/(\d{1,10})$/.exec(path);
  if (folder) {
    faveFolders.prefetch({ token });
    faveIds.prefetch({ token, folderId: Number(folder[1]) });
    return;
  }
  if (path === '/favorites') {
    faveIds.prefetch({ token });
    if (!search.get('tab') || search.get('tab') === 'folders') faveFolders.prefetch({ token });
  } else if (path === '/history') browsingHistory.prefetch({ token, page: 1 });
  else if (path === '/tasks') tasks.prefetch({ token });
  else if (path === '/tasks/coins') coinTransactions.prefetch({ token, page: 1 });
  else if (path === '/block-groups') blockGroups.prefetch({ token });
  else if (path === '/tag-groups') tagGroups.prefetch({ token });
  else if (path === '/subscriptions') tagSubscriptions.prefetch({ token });
}
