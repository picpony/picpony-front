'use client';

import { gsap, playSharedAxis } from '@/lib/motion';
import { DURATION } from '@/lib/motionTokens';
import { motionTier } from '@/lib/appearance';
import { beginPageTransit } from '@/lib/pageTransit';
import { arm, cancelRouteCrossFade, routeMove, settleEntryAnimations } from '@/lib/routeCrossFade';
import type { RouteSnapshot } from '@/lib/pageSnapshot';

/**
 * The animated half of the route cross-fade, loaded on demand.
 *
 * The split is not about this code being rare — every navigation runs it. It is about *when*:
 * `lib/routeCrossFade.ts` is imported by `<RouteCrossFade>`, which `AppLayout` mounts on every
 * route, so a static `gsap` import here put the engine and its five plugins in the root shell of
 * a page of text. Nothing on a cold document needs it, because nothing has navigated yet.
 *
 * `warmRouteCrossFade()` pulls it in on an idle callback after first paint, so in practice it is
 * always resident before the first navigation; and if it is not, `captureRouteSnapshot` declines
 * to clone and the navigation is a cut — which is exactly what the 关闭 tier does, an outcome the
 * app already ships and already documents.
 */
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
  /* Reduced halves the outgoing leg's rise rather than removing it. 12px was never the
     performative part of this transition — the clone itself is — and a screen that leaves
     without moving at all reads as a cut with a fade on it. 8px is what every other
     entrance in the app travels under this tier. */
  const rise = motionTier() === 'reduced' ? -8 : -12;
  timeline
    .set(snapshot.node, { willChange: 'transform, opacity' })
    /* The outgoing leg is the mirror of `pageIn`: it leaves upward over the
       full duration while its opacity is spent in the first 100ms, so the
       incoming page takes over inside the overlap rather than after it.
       `DURATION.press`, i.e. `short2` — the shortest step M3 defines above a
       micro-interaction, and the same value the press feedback uses. It was a
       bare 0.12, which is not on the scale. */
    .to(snapshot.node, { opacity: 0, duration: DURATION.press, ease: 'accelerate' }, 0)
    .to(snapshot.node, { y: rise, duration: DURATION.long, ease: 'standard' }, 0);

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

