'use client';

import {
  gsap,
  prefersReducedMotion,
  DURATION,
  playSharedAxis,
  setThemeWipeGuard,
  setHeroBusyCheck,
  beginPageTransit,
} from '@/lib/motion';
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
function routeMove(from: string, to: string): { axis: 'x' | 'y'; direction: 1 | -1 } | null {
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
function settleEntryAnimations(root: HTMLElement) {
  for (const animation of root.getAnimations({ subtree: true })) {
    if (animation instanceof CSSAnimation && ENTRY_KEYFRAMES.has(animation.animationName)) {
      animation.finish();
    }
  }
}

let active: ActiveFade | null = null;

/**
 * Takes the still frame. Must run *before* React mutates the DOM — the caller
 * does that from `getSnapshotBeforeUpdate`.
 */
export function captureRouteSnapshot(layer: HTMLElement | null): RouteSnapshot | null {
  if (!layer) return null;
  if (prefersReducedMotion()) return null;
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

export function playRouteCrossFade(
  layer: HTMLElement,
  snapshot: RouteSnapshot,
  from: string,
  to: string,
) {
  /* A second navigation mid-fade drops the older frame outright rather than
     stacking two stale layers. The snapshot just taken is of whatever was on
     screen a moment ago, which is the more truthful thing to fade out. */
  cancelRouteCrossFade();

  /* Before the clone goes in, so this cannot resolve into it — belt and braces
     beside the attribute strip in `pageSnapshot`, since document order is the
     only other thing keeping them apart. */
  const page = document.querySelector<HTMLElement>('[data-page-content]');
  layer.appendChild(snapshot.node);

  /* An image detail leaves on a plain fade, never on the shared axis.
   *
   * The axis is a move *within* the app's plane, and the pathnames it is handed
   * here are the background's — while the overlay is open that is `/`, so
   * closing an image straight into /search would have read as the *gallery*
   * sliding up, with the picture pasted on top of it. A detail view is a layer
   * above the plane rather than a cell in it, so leaving one is a fade. That is
   * also exactly what a forum post already does, and the two screens are the
   * same kind of thing. */
  const fadeOnly = snapshot.node.dataset.routeFadeOnly !== undefined;
  const move = from === to || fadeOnly ? null : routeMove(from, to);
  /* Holds the incoming page's footer out until the move settles, so the mark
     never arrives ahead of the page it belongs to. Both branches below arm it;
     both release it when they finish. */
  const endTransit = beginPageTransit();
  if (move && page) {
    /* The entry keyframe has to go: `pageIn` is a fade with a 12px rise, which
       is the generic answer, and this is the specific one. It also outranks
       inline styles for as long as it is running, so leaving it in place would
       fight every frame GSAP writes.
       Never put back, either. `[data-page-content]` is keyed on the pathname,
       so this node is discarded at the next navigation and there is nothing to
       restore it for — whereas clearing it at settle re-arms a `both`-filled
       keyframe and replays the whole 12px rise from transparent. Measured as a
       jump to `y: 12` on the frame after every route transition landed. */
    page.style.animation = 'none';
    settleEntryAnimations(page);
    const handle = playSharedAxis({
      leaving: snapshot.node,
      entering: page,
      axis: move.axis,
      direction: move.direction,
      // A route change swaps the page's whole subtree the moment its data
      // lands; only `[data-page-content]` itself is guaranteed to survive.
      lean: false,
      onSettle: cancelRouteCrossFade,
    });
    /* `[data-page-content]` is an ancestor of every gallery card, `ROUTE_CELL`
       includes `/`, and `lean: false` starts this node a full viewport off — so
       for the whole 500ms the cards are on screen, pressable, and offset. The
       hero reads a plain `getBoundingClientRect` on press, and `arm()` below
       only fires once the phase changes, which is after `useHeroLink` has
       already measured. `runTabTransition` and the masonry cascade guard the
       same rows the same way.
       No removal: `handle.finish` is idempotent, and this node is keyed on the
       pathname and discarded at the next navigation, so the listener goes with
       it. */
    page.addEventListener('pointerdown', () => handle.finish(), { capture: true });
    arm(layer, () => {
      handle.finish();
      endTransit();
    });
    return;
  }

  const timeline = gsap.timeline({ onComplete: () => cancelRouteCrossFade() });
  timeline
    .set(snapshot.node, { willChange: 'transform, opacity' })
    /* The outgoing leg is the mirror of `pageIn`: it leaves upward over the
       full duration while its opacity is spent in the first 100ms, so the
       incoming page takes over inside the overlap rather than after it.
       `DURATION.press`, i.e. `short2` — the shortest step M3 defines above a
       micro-interaction, and the same value the press feedback uses. It was a
       bare 0.12, which is not on the scale. */
    .to(snapshot.node, { opacity: 0, duration: DURATION.press, ease: 'accelerate' }, 0)
    .to(snapshot.node, { y: -12, duration: DURATION.long, ease: 'standard' }, 0);

  /* The incoming page's entrance is driven here, on opacity alone, instead of
     being left to `pageIn`.
     `pageIn` interpolates `translateY(12px) → none` under a `both` fill, so it
     holds a real transform on `[data-page-content]` for its 80ms delay plus its
     320ms run. `[data-page-content]` is an ancestor of every gallery card, and
     the hero flight measures the pressed card with a plain
     `getBoundingClientRect` on press — so for ~400ms after arriving at `/` the
     flyer launched from a box up to 12px above the thumbnail it grew out of.
     The shared-axis branch above already strips the keyframe for its own
     reasons; it was only this branch, which is the one most routes take to reach
     the gallery, that still relied on it.
     A fade with no transform is also the honest description of what this
     transition is: the 12px rise belonged to the axis move, which has its own. */
  if (page) {
    page.style.animation = 'none';
    settleEntryAnimations(page);
    timeline.fromTo(
      page,
      { autoAlpha: 0 },
      {
        autoAlpha: 1,
        duration: DURATION.long,
        ease: 'decelerate',
        clearProps: 'opacity,visibility',
      },
      0.08,
    );
  }

  arm(layer, () => {
    timeline.kill();
    endTransit();
  });
}

/** Hangs the watchdog and the hero guard on whichever animation is running. */
function arm(layer: HTMLElement, stop: () => void) {
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
