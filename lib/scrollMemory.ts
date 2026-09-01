'use client';

/**
 * One owner for the app scroller's vertical position: RouteScrollMemory, mounted once in
 * AppLayout. `<body>` never scrolls — the real scroller is the app's `<main>` — so the
 * browser's own restoration targets a document that never moves, and Next's handler (it
 * scrollIntoViews the route segment) cannot be coordinated with the other writers: it measures
 * the segment against the document viewport, so a start-aligned jump lands off
 * `scrollTop === 0` by the page gutter, it fires after the commit and races the route
 * cross-fade, and it moves focus. So every `router.push`/`replace` and every `<Link>` passes
 * `scroll: false` — a suppression; the position is written explicitly here.
 *
 * A new pathname jumps to 0; back/forward restores the history entry's offset. Page turns
 * (`?page=`, owned by `Pagination`) and tab switches (`?tab=`, owned by `startTabTransition`)
 * never reach this hook: it depends on `pathname` alone — deliberately no `useSearchParams`.
 *
 * The image detail stays owned by the hero subsystem, which captures and restores its own
 * `routeScroll` and keeps two scrollers in lockstep mid-flight. `heroIsMoving()` stands this
 * module down for a gesture; the `/pic/` test covers a cold load where no session exists.
 */

import { usePathname } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { getImageHeroRuntime } from '@/lib/hero';
import { getAppScroller, heroOwnsScreen } from '@/lib/appScroller';

/** The Navigation API surface this needs, which TypeScript's DOM lib does not have yet. */
type NavigationEntryLike = { key?: string };
type NavigationLike = { currentEntry?: NavigationEntryLike | null };

/**
 * Offsets by history entry, for the session. Module scope like `lib/pageCache.ts`: reload is
 * a legitimate reset.
 */
const offsets = new Map<string, number>();

/**
 * The entry a `popstate` landed on, consumed by the next apply. Keyed, not boolean, and that
 * is load-bearing: it is set on *every* traversal, including ones that do not change the
 * pathname (`?page=`/`?tab=` backs, the hero's own history work), while the apply only runs
 * on a pathname change. A boolean survived those and made the *next push* look like a
 * traversal; a push mints a new key, so it never matches what a traversal recorded.
 */
let traversedKey: string | null = null;

/**
 * A key per history *entry* (Navigation API `currentEntry.key`), not per URL: stable for the
 * life of a history slot, distinct for two entries at one URL, untouched by Next.
 *
 * **Do not merge a key into `history.state` instead** — the App Router rebuilds that object
 * on *every* commit and drops anything it does not own, erasing a key written at push time.
 * `lib/hero/history.ts` already works around exactly this for its own state; one tenant there
 * is enough.
 *
 * Fallback (no Navigation API) is the URL, so two entries at one URL share a slot: a push
 * after scrolling `/` again lands at 0, but a *back* into either entry restores whichever
 * offset was written last — same collision class as the per-tab memory.
 */
function entryKey(pathname: string) {
  const nav = (window as unknown as { navigation?: NavigationLike }).navigation;
  const key = nav?.currentEntry?.key;
  return key ?? `url:${pathname}${window.location.search}`;
}

/**
 * Whether the hero is mid-gesture — narrower than `heroOwnsScreen()`, which is true for as
 * long as a picture is *open*. Using the wider predicate cost the two navigations that leave
 * a detail open (to `/search`, to a profile): neither jump nor restore ran while Next's
 * handler was suppressed, so both inherited the gallery's offset. What must not be fought is
 * the hero *writing* the app scroller, which only happens inside a session (mid-flight and
 * the background restore home) — both non-idle phases. A close is safe: the hero intercepts
 * the pop and the phase is already `closing.flight` by the commit this effect runs in.
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

  /* Declarative only: the document scroller never moves, so the browser had nothing to
     restore either way; `manual` keeps that true if `<body>`'s overflow ever changes. */
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

  /* Saving is continuous and coalesced, keyed to the entry current *while* the scrolling
     happens. `scrollend` where it exists, else a rAF — enough, since the value is only read
     on a navigation. Registering both `remember` and the coalescer on `scroll` would be a
     write plus an uncancelled frame per event. */
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

  /* Layout effect: the offset is in place before the frame the new page paints in. It cannot
     disturb `RouteCrossFade`'s clone — pinned from the *pre-commit* rect, in a layer that is
     a sibling of the scroller, so it does not scroll with the content. This component renders
     as the sibling immediately above that layer, making the ordering stated: an earlier
     sibling's layout effect runs first, and `getSnapshotBeforeUpdate` runs before either. */
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
    /* No growth watcher and no second attempt: `lib/pageCache.ts` re-seeds a returning page
       from the render it was showing, so the height is usually right on the first commit;
       when it is short the browser clamps and the landing is as close as it can be — the same
       rule the per-tab memory applies through its own clamp. */
    scroller.scrollTop = wasTraversal ? (offsets.get(key) ?? 0) : 0;
  }, [pathname]);
}

/** Renders nothing; exists so the hook can be ordered against `RouteCrossFade`. */
export default function RouteScrollMemory() {
  useRouteScrollMemory();
  return null;
}
