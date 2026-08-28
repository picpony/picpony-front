'use client';

import { setHeroBusyCheck } from '@/lib/appScroller';
import { setThemeWipeGuard } from '@/lib/pageTransit';
import { motionTier } from '@/lib/appearance';

import { getImageHeroRuntime, subscribeImageHeroRuntime } from '@/lib/hero';
import { captureVisualClone, type RouteSnapshot } from '@/lib/pageSnapshot';

/**
 * Cross-fade between routes.
 *
 * `AppLayout` renders `{children}` inside a div keyed on the pathname, so React
 * unmounts the old page in the very commit that mounts the new one. The entry
 * keyframe then starts at `opacity: 0`, which guarantees at least one frame of
 * bare `bg-surface` — the blank you see going from the gallery to /settings.
 *
 * A still frame of the outgoing page is laid over that gap and faded out while
 * the new page fades in. See `lib/pageSnapshot.ts` for why it is a clone rather
 * than the retained React tree.
 *
 * Everything here is gated on the hero being idle. That system owns the same
 * pixels during a flight — it transforms the background, freezes the pathname,
 * and paints a flyer on top — so a stale gallery clone during one would be
 * strictly worse than no transition at all.
 */

/** Watchdog: nothing may outlive the fade by more than this. */
const MAX_LIFETIME_MS = 900;

/**
 * Where each screen sits on the app's notional plane.
 *
 * Search and messages are a row *above* the home page and neighbours of each
 * other, which is what makes the moves between them read as one continuous
 * space rather than three unrelated fades: going up to search sends the home
 * page down and brings search in over the top of it, going sideways between
 * search and messages is the same slide the two home tabs use, and every one of
 * them reverses correctly on the way back because the direction is derived from
 * the cells rather than hard-coded.
 *
 * Anything not listed keeps the plain cross-fade below. A screen only belongs
 * here if its neighbours are genuinely reachable from it — a coordinate is a
 * claim that the user can feel where the page is, and inventing that for
 * somewhere you can only reach from a menu is worse than not claiming it.
 */
const ROUTE_CELL: Record<string, { x: number; y: number }> = {
  '/': { x: 0, y: 0 },
  '/search': { x: 0, y: -1 },
  '/messages': { x: 1, y: -1 },
};

/**
 * The axis and sign for a move, or null for "just cross-fade it".
 *
 * Vertical wins when both differ: `/messages` back to `/` is a move down out of
 * that row and the sideways component is incidental. `direction: +1` means the
 * outgoing side exits towards the negative end, so a move *up* the grid — to a
 * smaller `y` — is `-1`, and the page you were on slides down.
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
 * The mount-time entry keyframes, by name.
 *
 * Every page that fades itself up on arrival uses one of these three, so naming
 * them is both precise and complete — precise because it cannot touch the
 * shimmer on a skeleton or the spinner on a button (both of which iterate
 * forever, and `finish()` on an infinite animation throws), complete because
 * `@layer base` offers nothing else for the job.
 */
const ENTRY_KEYFRAMES = new Set(['fadeIn', 'pageIn', 'popIn']);

/**
 * Land every entry keyframe inside the incoming page before it starts moving.
 *
 * `pageIn` on `[data-page-content]` is dealt with by the caller, because that
 * node is the one being animated. But the pages carry their own on top of it —
 * `animate-fade-in` sits on the root of /search, /upload, /tasks, /history and
 * half a dozen more. During a shared-axis flight that is precisely the wrong
 * thing: the plate slides in at full opacity while the ink on it fades up, which
 * is the two-stacked-layers look the axis exists to avoid. Measured on the way
 * into /search: the page was already at x=0 with its own contents at opacity
 * 0.47, reaching 1.0 only at 370ms. That is the flash.
 *
 * `finish()`, not `cancel()`: all three fill forwards, so finishing lands on the
 * end state and stays there, where cancelling would snap back to the unanimated
 * value and leave the animation eligible to play again later.
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
 * `lib/routeCrossFadePlay.ts` is the only thing here that touches GSAP, and this module is
 * mounted by `AppLayout` on every route — so a static import of it put the engine and its five
 * plugins on `/policy`, a page of text, to serve a transition that cannot run until you navigate.
 *
 * The failure mode is deliberately the one the app already ships: with the chunk absent
 * `captureRouteSnapshot` declines to clone, so the navigation is a cut. That is the 关闭 tier's
 * own behaviour, documented and reachable today, rather than a new path — and it is strictly
 * better than the alternatives, since a `await` inside `getSnapshotBeforeUpdate` is impossible
 * (React does not wait) and cloning something nothing can animate would leave a stale page frozen
 * over the new one.
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
      /* A failed chunk fetch leaves `loading` set, so this does not retry on every navigation of
         a session that has lost the network. Every navigation is then a cut, which is what the
         module's absence already means. */
    },
  );
}

/**
 * Pull the animation half in after first paint.
 *
 * Called once from the shell. `runWhenIdle` rather than an effect body, because the whole point
 * is that this must not compete with hydration — it is needed at the *first navigation*, which is
 * at minimum a user gesture away.
 */
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
  /* Unreachable with the gate in `captureRouteSnapshot`, which is what stops a clone being taken
     that nothing can animate. Kept because the two are separate calls and a future caller could
     pair them differently. */
  if (!play) {
    layer.replaceChildren();
    return;
  }
  play.playRouteCrossFade(layer, snapshot, from, to);
}

/**
 * Takes the still frame. Must run *before* React mutates the DOM — the caller
 * does that from `getSnapshotBeforeUpdate`.
 */
export function captureRouteSnapshot(layer: HTMLElement | null): RouteSnapshot | null {
  if (!layer) return null;
  /* Only `off` skips the snapshot. Under `reduced` there is still a cross-fade — the
     branches below drop the 12px rise and the shared axis becomes a fade — and skipping
     here would have taken that away before either had a chance to. */
  if (motionTier() === 'off') return null;
  /* Nothing may be cloned that nothing can animate: a still frame laid over the new page with no
     tween to remove it is worse than no transition. The chunk is warmed after first paint, so
     this only bites on a navigation inside the first idle window of a cold load. */
  if (!play) {
    ensurePlay();
    return null;
  }
  // A backgrounded tab would animate a frame nobody saw and resume mid-way.
  if (document.visibilityState !== 'visible') return null;

  const hero = getImageHeroRuntime();
  if (hero.phase !== 'gallery-idle' || hero.background) return null;

  /* Leaving an image detail fades the *detail*, not the gallery behind it.
   *
   * The intercepted `/pic/:id` route renders as an overlay above
   * `[data-page-content]`, which still holds the gallery — so snapshotting the
   * page content meant the picture vanished in one frame while the gallery it
   * was covering cross-faded to the new route. Going from a forum post to
   * /search faded properly and going from an image to /search cut, and the two
   * are the same kind of move: leaving a detail view for a sibling screen.
   *
   * The overlay is the truer "what was on screen a moment ago", so it wins when
   * one is mounted. `data-route-fade-only` rides along on the clone because the
   * *direction* has to change too — see `playRouteCrossFade`.
   */
  const overlay = document.querySelector<HTMLElement>('[data-image-detail-overlay]');
  const source = overlay ?? document.querySelector<HTMLElement>('[data-page-content]');
  if (!source) return null;
  const snapshot = captureVisualClone(source, layer);
  if (snapshot && overlay) snapshot.node.dataset.routeFadeOnly = '';
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

/* Registered here because this module already depends on both `lib/motion` and
   `lib/hero`, so it is the one place the two can be joined without giving
   `lib/motion` a dependency on the hero controller. `background` is part of the
   condition for the same reason the route cross-fade checks it: a detail overlay
   open over the gallery means the flight still owns the layer even when its phase
   has settled. */
setHeroBusyCheck(() => {
  const hero = getImageHeroRuntime();
  return hero.phase !== 'gallery-idle' || Boolean(hero.background);
});
