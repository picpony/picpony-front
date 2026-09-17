'use client';

import { setHeroBusyCheck } from '@/lib/appScroller';
import { setRouteTransit, setThemeWipeGuard } from '@/lib/pageTransit';
import { motionTier } from '@/lib/appearance';

import { getImageHeroRuntime, subscribeImageHeroRuntime } from '@/lib/hero';
import { captureVisualClone, type RouteSnapshot } from '@/lib/pageSnapshot';

/**
 * Cross-fade between routes.
 *
 * `AppLayout` keys `{children}` on the pathname, so React unmounts the old page in the commit
 * that mounts the new one and the entry keyframe (opacity 0) guarantees a blank frame; a still
 * clone of the outgoing page (see `lib/pageSnapshot.ts`) covers the gap and fades out.
 *
 * Everything here is gated on the hero being idle — that system owns the same pixels during a
 * flight. The gate lives in `captureRouteSnapshot`, NOT in `playRouteCrossFade`: cloning a page
 * nothing can animate leaves a stale frozen frame over the new one, worse than no transition.
 * The snapshot runs in `getSnapshotBeforeUpdate`, the only lifecycle before React mutates the
 * DOM. The GSAP half is `lib/routeCrossFadePlay.ts`, loaded on demand below.
 */

/** Watchdog: nothing may outlive the fade by more than this. */
const MAX_LIFETIME_MS = 900;

/**
 * Where each screen sits on the app's notional plane, so moves between listed screens read as
 * one continuous space (direction derives from the cells, so it reverses); anything unlisted
 * keeps the plain cross-fade. A coordinate claims the user can feel where the page is.
 */
const ROUTE_CELL: Record<string, { x: number; y: number }> = {
  '/': { x: 0, y: 0 },
  '/search': { x: 0, y: -1 },
  '/messages': { x: 1, y: -1 },
};

/**
 * The axis and sign for a move, or null for "just cross-fade it". Vertical wins when both axes
 * differ. `direction: +1` means the outgoing side exits towards the negative end, so a move up
 * the grid (smaller `y`) is `-1`.
 */
export function routeMove(from: string, to: string): { axis: 'x' | 'y'; direction: 1 | -1 } | null {
  const a = ROUTE_CELL[from];
  const b = ROUTE_CELL[to];
  if (!a || !b) return null;
  if (a.y !== b.y) return { axis: 'y', direction: b.y > a.y ? 1 : -1 };
  if (a.x !== b.x) return { axis: 'x', direction: b.x > a.x ? 1 : -1 };
  return null;
}

type ActiveFade = {
  layer: HTMLElement;
  stop: () => void;
  timer: number;
  unsubscribe: () => void;
};

/**
 * Mount-time entry keyframes, by name — precise (skeleton shimmer and button spinner iterate
 * forever, and `finish()` on those throws) and complete (nothing else in `@layer base` counts).
 */
const ENTRY_KEYFRAMES = new Set(['fadeIn', 'pageIn', 'popIn']);

/**
 * Land every entry keyframe inside the incoming page before it starts moving: pages carry their
 * own entry animations, and during a shared-axis flight the ink fading up over an already-sliding
 * plate is the two-stacked-layers look the axis exists to avoid. `finish()`, not `cancel()` — the
 * keyframes fill forwards, so finishing lands on the end state instead of snapping back.
 */
export function settleEntryAnimations(root: HTMLElement) {
  for (const animation of root.getAnimations({ subtree: true })) {
    if (animation instanceof CSSAnimation && ENTRY_KEYFRAMES.has(animation.animationName)) {
      animation.finish();
    }
  }
}

let active: ActiveFade | null = null;

/**
 * The animated half, which arrives on an idle callback rather than in the document.
 *
 * GSAP boundary: this module is mounted by `AppLayout` on every route, so the GSAP half must
 * stay dynamically imported — a static import would put the engine and its plugins into every
 * route's first document. If the chunk is absent, `captureRouteSnapshot` declines to clone (an
 * `await` inside `getSnapshotBeforeUpdate` is impossible — React does not wait) and the
 * navigation is a cut, which beats a stale frozen frame.
 */
let play: typeof import('@/lib/routeCrossFadePlay') | null = null;
let loading = false;

function ensurePlay() {
  if (play || loading) return;
  loading = true;
  void import('@/lib/routeCrossFadePlay').then(
    (module) => {
      play = module;
    },
    () => {
      /* A failed chunk fetch leaves `loading` set, so this never retries; every navigation is
         then a cut, which is what the module's absence already means. */
    },
  );
}

/** Pull the animation half in after first paint; `runWhenIdle` so it never competes with
 *  hydration — the first navigation is at minimum a user gesture away. */
export function warmRouteCrossFade() {
  ensurePlay();
}

/** Re-exported so `<RouteCrossFade>` has one import. */
export function playRouteCrossFade(
  layer: HTMLElement,
  snapshot: RouteSnapshot,
  from: string,
  to: string,
) {
  /* Unreachable with the gate in `captureRouteSnapshot`, but kept because the two are separate
     calls and a future caller could pair them differently. */
  if (!play) {
    layer.replaceChildren();
    setRouteTransit(false);
    return;
  }
  play.playRouteCrossFade(layer, snapshot, from, to);
}

/** Takes the still frame; must run *before* React mutates the DOM (the caller does that from
 *  `getSnapshotBeforeUpdate`). */
export function captureRouteSnapshot(layer: HTMLElement | null): RouteSnapshot | null {
  if (!layer) return null;
  /* Only `off` skips the snapshot: under `reduced` there is still a cross-fade (rise dropped,
     shared axis becomes a fade), and skipping here would take that away. */
  if (motionTier() === 'off') return null;
  /* Nothing may be cloned that nothing can animate — a still frame with no tween to remove it
     is worse than no transition. The chunk warms after first paint, so this only bites on a
     navigation inside the first idle window of a cold load. */
  if (!play) {
    ensurePlay();
    return null;
  }
  // A backgrounded tab would animate a frame nobody saw and resume mid-way.
  if (document.visibilityState !== 'visible') return null;

  const hero = getImageHeroRuntime();
  if (hero.phase !== 'gallery-idle' || hero.background) return null;

  /* Leaving an image detail fades the *detail*, not the gallery behind it: `/pic/:id` renders
   * as an overlay above `[data-page-content]`, which still holds the gallery, so snapshotting
   * the page content made the picture vanish while the gallery under it cross-faded. The
   * overlay is the truer "what was on screen a moment ago" and wins when mounted;
   * `data-route-fade-only` rides along because the *direction* must change too.
   */
  const overlay = document.querySelector<HTMLElement>('[data-image-detail-overlay]');
  const source = overlay ?? document.querySelector<HTMLElement>('[data-page-content]');
  if (!source) return null;
  const snapshot = captureVisualClone(source, layer);
  if (snapshot && overlay) snapshot.node.dataset.routeFadeOnly = '';
  /* getSnapshotBeforeUpdate runs before any incoming child's layout effect.
     The route supplies that page's entrance, so its grid and empty states must
     know before they seed their own opacity and transforms. */
  if (snapshot) setRouteTransit(true);
  return snapshot;
}

/** Hangs the watchdog and the hero guard on whichever animation is running. */
export function arm(layer: HTMLElement, stop: () => void) {
  const unsubscribe = subscribeImageHeroRuntime(() => {
    if (getImageHeroRuntime().phase !== 'gallery-idle') cancelRouteCrossFade();
  });
  const timer = window.setTimeout(cancelRouteCrossFade, MAX_LIFETIME_MS);
  active = { layer, stop, timer, unsubscribe };
}

export function cancelRouteCrossFade() {
  setRouteTransit(false);
  if (!active) return;
  const fade = active;
  active = null;
  window.clearTimeout(fade.timer);
  fade.unsubscribe();
  fade.stop();
  fade.layer.replaceChildren();
}

// The theme wipe must not snapshot a half-faded clone.
setThemeWipeGuard(cancelRouteCrossFade);

/* Registered here because this module already depends on both `lib/motion` and `lib/hero`, so
   it is the one place the two can be joined without giving `lib/motion` a dependency on the
   hero controller. `background` is in the condition for the same reason the cross-fade checks
   it: a detail overlay open over the gallery means the flight still owns the layer. */
setHeroBusyCheck(() => {
  const hero = getImageHeroRuntime();
  return hero.phase !== 'gallery-idle' || Boolean(hero.background);
});
