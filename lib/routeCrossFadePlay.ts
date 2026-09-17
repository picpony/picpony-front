'use client';

import { gsap, playSharedAxis } from '@/lib/motion';
import { DURATION, PAGE_FADE_TIMING } from '@/lib/motionTokens';
import { motionTier } from '@/lib/appearance';
import { setRouteTransit } from '@/lib/pageTransit';
import { arm, cancelRouteCrossFade, routeMove, settleEntryAnimations } from '@/lib/routeCrossFade';
import type { RouteSnapshot } from '@/lib/pageSnapshot';

/**
 * The animated half of the route cross-fade, loaded on demand — the sanctioned GSAP half. The
 * split is about *when*: the front half is mounted on every route, so a static `gsap` import
 * here would put the engine and its plugins into the root shell of every route's first
 * document, and nothing on a cold document has navigated yet. `warmRouteCrossFade()` pulls it
 * in after first paint; if it is absent, `captureRouteSnapshot` declines to clone and the
 * navigation is a cut.
 */
export function playRouteCrossFade(
  layer: HTMLElement,
  snapshot: RouteSnapshot,
  from: string,
  to: string,
) {
  /* A second navigation mid-fade drops the older frame rather than stacking two stale layers;
     the snapshot just taken is of whatever was on screen a moment ago, the truer thing to fade. */
  cancelRouteCrossFade();
  setRouteTransit(true);

  /* Before the clone goes in, so this cannot resolve into it — belt and braces beside the
     attribute strip in `pageSnapshot`. */
  const page = document.querySelector<HTMLElement>('[data-page-content]');
  layer.appendChild(snapshot.node);

  /* An image detail leaves on a plain fade, never the shared axis: the axis is a move *within*
     the app's plane, but the pathnames handed here are the background's — while the overlay is
     open that is `/`, so closing an image into /search would read as the gallery sliding with
     the picture pasted on top. A detail is a layer above the plane, not a cell in it. */
  const fadeOnly = snapshot.node.dataset.routeFadeOnly !== undefined;
  const move = from === to || fadeOnly ? null : routeMove(from, to);
  /* The footer is already inside `page`, so it travels and fades on this same
     clock. Only a tab switch needs to hide it separately: there the moving
     panes sit above the footer, and their final height changes at settlement. */
  if (move && page) {
    /* The entry keyframe has to go: it is a fade with a 12px rise that outranks inline styles
       while running, so leaving it in place would fight every frame GSAP writes. Never restore
       it either — the node is keyed on the pathname and discarded at the next navigation, and
       clearing the animation at settle would re-arm its `both` fill and replay the whole rise. */
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
    /* Nothing may leave a residual transform on an ancestor of a gallery card — the hero flight
       reads a plain `getBoundingClientRect` on press. This node is such an ancestor, and
       `lean: false` starts it a full viewport off, so the pointerdown fast-finishes the move
       rather than letting cards sit pressable-but-offset; `arm()` covers the rest. No removal:
       `handle.finish` is idempotent and the node is discarded at the next navigation. */
    page.addEventListener('pointerdown', () => handle.finish(), { capture: true });
    arm(layer, handle.finish);
    return;
  }

  const timeline = gsap.timeline({ onComplete: () => cancelRouteCrossFade() });
  /* Reduced halves the outgoing leg's rise rather than removing it — 12px was never the
     performative part (the clone is), and a screen that leaves without moving at all reads as
     a cut with a fade on it. */
  const rise = motionTier() === 'reduced' ? -8 : -12;
  timeline
    .set(snapshot.node, { willChange: 'transform, opacity' })
    /* The outgoing leg is the mirror of `pageIn`: it leaves upward over the full duration
       while its opacity is spent early, so the incoming page takes over inside the overlap.
       `DURATION.press` (`short2`) is the shortest M3 step above a micro-interaction. */
    .to(snapshot.node, { opacity: 0, duration: DURATION.press, ease: 'accelerate' }, 0)
    .to(snapshot.node, { y: rise, duration: DURATION.long, ease: 'standard' }, 0);

  /* The incoming page's entrance is driven here, on opacity alone, instead of `pageIn`:
     `pageIn` holds a real translateY(12px) transform on `[data-page-content]` for its delay
     plus its run, and that node is an ancestor of every gallery card — the hero flight
     measures the pressed card with a plain `getBoundingClientRect`, so a residual offset
     there launches the flyer from a box above the thumbnail. Settle uses clearProps, never
     a zero translate; a fade with no transform is also the honest description of this move. */
  if (page) {
    page.style.animation = 'none';
    settleEntryAnimations(page);
    timeline.fromTo(
      page,
      { autoAlpha: 0 },
      {
        autoAlpha: 1,
        duration: PAGE_FADE_TIMING.duration,
        ease: 'decelerate',
        clearProps: 'opacity,visibility',
      },
      PAGE_FADE_TIMING.delay,
    );
  }

  arm(layer, () => {
    timeline.kill();
    /* A theme wipe or hero press can cancel before the incoming leg completes.
       Its clearProps callback never runs after kill(), leaving the live page
       dimmed — or hidden during the overlap delay. Land it on the same clean
       state as a completed fade before releasing the transition. */
    if (page) gsap.set(page, { clearProps: 'opacity,visibility' });
  });
}

