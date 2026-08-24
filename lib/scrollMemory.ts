'use client';

/**
 * One owner for the app scroller's vertical position.
 *
 * `<body>` is `overflow: hidden` and the real scroller is `<main class="app-scroller">`, so
 * the browser's own scroll restoration targets a document that never moves and does nothing
 * at all. Next's handler *does* reach the app scroller — `layout-router.js` falls through to
 * `domNode.scrollIntoView()`, which walks up to the nearest scrollable ancestor — but it is
 * the one writer here that cannot be coordinated with the others, it aims at the wrong box
 * (it tests the segment's top against `document.documentElement.clientHeight`, and
 * `block: 'start'` lands on the segment's top edge rather than on `scrollTop === 0`, which
 * differs by the page gutter on every navigation), it fires after the commit and so races
 * `RouteCrossFade`, and it moves focus to the route segment on the way out. So every
 * `router.push`/`replace` and every `<Link>` passes `scroll: false` and this module decides
 * instead.
 *
 * Four situations, and the third and fourth are the same rule:
 *
 * | a new pathname, pushed        | jump to 0 — a new page starts at its top      |
 * | back / forward                | restore what that entry had                   |
 * | a page turn (`?page=`)        | not ours: `Pagination` owns it                |
 * | a tab switch (`?tab=`)        | not ours: `startTabTransition` owns it        |
 *
 * The last two are search-only changes, and this hook depends on `pathname` alone — so it
 * does not run for them at all, which is stronger than checking for them. (It is also why
 * there is no `useSearchParams` here: the dependency it would add is one we specifically do
 * not want.)
 *
 * The image detail is the hero subsystem's, not ours: it captures and restores its own
 * `routeScroll` across a reversed open/close, and `HeroScrollContinuity` keeps two scrollers
 * in lockstep during a flight. Both guards below are deliberate — `heroIsMoving()` stands this
 * module down for the length of a gesture, and the `/pic/` test covers a cold load of that
 * route where no session exists.
 */

import { usePathname } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { getImageHeroRuntime } from '@/lib/hero';
import { getAppScroller, heroOwnsScreen } from '@/lib/motion';

/** The Navigation API surface this needs, which TypeScript's DOM lib does not have yet. */
type NavigationEntryLike = { key?: string };
type NavigationLike = { currentEntry?: NavigationEntryLike | null };

/**
 * Offsets by history entry, for the session.
 *
 * Module scope for the same reason `lib/pageCache.ts` gives: this is per-session state, and a
 * reload is a legitimate reset.
 */
const offsets = new Map<string, number>();

/**
 * The entry a `popstate` landed on, consumed by the next apply.
 *
 * Keyed rather than a boolean, and that is load-bearing: this is set on *every* traversal,
 * including the ones that do not change the pathname — back over a `?page=` or `?tab=`, or the
 * hero's own history work — and the apply only runs when the pathname changes. A boolean
 * therefore survived those and made the *next push* look like a traversal. Comparing the key
 * cannot: a push mints a new entry, so it never matches what a traversal recorded.
 */
let traversedKey: string | null = null;

/**
 * A key per history *entry*, not per URL.
 *
 * `window.navigation.currentEntry.key` is stable for the life of a history slot, distinct for
 * two entries at the same URL, and Next does not touch it — its own source still carries a
 * "TODO: Use Navigation API if available".
 *
 * **Do not be tempted to merge a key into `history.state` instead.** The App Router rebuilds
 * that object on *every* commit as `{...(preserveCustomHistoryState ? history.state : {}),
 * __NA, __PRIVATE_NEXTJS_INTERNALS_TREE}`, and `preserveCustomHistoryState` is false on a soft
 * navigation — so a key written at push time is erased by the commit that follows it. That is
 * what `lib/hero/history.ts` spends `collapseOrphanMarker`, `recoverSkippedBackground` and a
 * `position` shadow working around, and one tenant in there is enough.
 *
 * The fallback is the URL, and its one observable difference is worth stating: two entries at
 * the same URL share a slot, so `/` at 1200 → a picture → back → scroll to 300 → push `/`
 * again lands correctly at 0 (the traversal flag is off), but a *back* into either `/` entry
 * restores whichever offset was written last. Same class of collision as the per-tab memory.
 */
function entryKey(pathname: string) {
  const nav = (window as unknown as { navigation?: NavigationLike }).navigation;
  const key = nav?.currentEntry?.key;
  return key ?? `url:${pathname}${window.location.search}`;
}

/**
 * Whether the hero subsystem is mid-gesture, which is narrower than `heroOwnsScreen()`.
 *
 * That predicate is true for as long as a picture is *open* — its `background` term is what
 * makes the route cross-fade and the theme wipe stand down over an overlay — and using it here
 * cost the two navigations that leave an open detail: 检索此标签 to `/search` and the uploader
 * link to a profile got neither a jump to 0 nor a restore, while Next's own handler was
 * suppressed by `scroll: false`, so both inherited the gallery's offset. What must not be
 * fought is the hero *writing* the app scroller, and it only does that inside a session:
 * `HeroScrollContinuity` during a flight, and the background restore on the way home. Both of
 * those are non-idle phases. A close is safe too — the hero intercepts the pop and the phase is
 * already `closing.flight` by the commit this effect runs in.
 */
function heroIsMoving() {
  const phase = getImageHeroRuntime().phase;
  return phase !== 'gallery-idle' && phase !== 'detail-idle';
}

function mayOwn(pathname: string) {
  return !heroIsMoving() && !pathname.startsWith('/pic/');
}

function useRouteScrollMemory() {
  const pathname = usePathname();
  /** The pathname the last apply ran for; `null` until the first navigation. */
  const seenRef = useRef<string | null>(null);

  /* Declarative rather than load-bearing: nothing in the repo touched
     `scrollRestoration` before, and the document scroller never moves, so the browser had
     nothing to restore either way. Saying `manual` is what keeps that true if `<body>`'s
     overflow is ever changed. */
  useEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  }, []);

  useEffect(() => {
    const onPop = () => {
      traversedKey = entryKey(window.location.pathname);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /* Saving is continuous, coalesced, and keyed to the entry that is current *while* the
     scrolling happens. `scrollend` where it exists; a rAF elsewhere, which is enough because
     the value is only read on a navigation. The two are alternatives — registering `remember`
     on `scroll` *and* the coalescer on `scroll` is a write per event plus an uncancelled frame
     per event, which is what the first version of this did. */
  useEffect(() => {
    const scroller = getAppScroller();
    if (!scroller) return;
    let frame = 0;
    const remember = () => {
      frame = 0;
      if (heroOwnsScreen()) return;
      offsets.set(entryKey(window.location.pathname), scroller.scrollTop);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(remember);
    };
    const supportsScrollEnd = 'onscrollend' in window;
    const event = supportsScrollEnd ? 'scrollend' : 'scroll';
    const listener = supportsScrollEnd ? remember : onScroll;
    scroller.addEventListener(event, listener, { passive: true });
    window.addEventListener('pagehide', remember);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      scroller.removeEventListener(event, listener);
      window.removeEventListener('pagehide', remember);
    };
  }, [pathname]);

  /* Applied in a layout effect, so the offset is in place before the frame the new page is
     painted in. `RouteCrossFade`'s clone cannot be disturbed by it: the clone is pinned from
     the *pre-commit* rect and lives in a layer that is a sibling of the scroller, so it does
     not scroll with the content. This component renders as the sibling immediately above it,
     which is what makes the ordering stated rather than incidental — an earlier sibling's
     layout effect runs first, and `getSnapshotBeforeUpdate` runs before either. */
  useLayoutEffect(() => {
    const previous = seenRef.current;
    seenRef.current = pathname;
    const key = entryKey(pathname);
    const wasTraversal = traversedKey !== null && traversedKey === key;
    traversedKey = null;
    // First mount: the browser is already at the top, and a deep link's own anchor is its own.
    if (previous === null || previous === pathname) return;
    if (!mayOwn(pathname)) return;
    const scroller = getAppScroller();
    if (!scroller) return;
    /* No growth watcher and no second attempt. `lib/pageCache.ts` re-seeds a returning page
       from the render it was showing, so the height is usually right on the first commit; when
       it is short the browser clamps and the landing is as close as it can be — the same rule
       the per-tab memory applies through its own clamp. */
    scroller.scrollTop = wasTraversal ? (offsets.get(key) ?? 0) : 0;
  }, [pathname]);
}

/** Renders nothing; exists so the hook can be ordered against `RouteCrossFade`. */
export default function RouteScrollMemory() {
  useRouteScrollMemory();
  return null;
}
