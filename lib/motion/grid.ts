'use client';
/* useGSAP owns dependency cleanup; preserve its existing compiler boundary. */
'use no memo';

import { useRef, type RefObject } from 'react';
import { motionRatio, useEntranceMotion, useMotionTier } from '@/lib/appearance';
import { getAppScroller } from '@/lib/appScroller';
import { STAGGER, TRAVEL_PX } from '@/lib/motionTokens';
import { routeTransitActive } from '@/lib/pageTransit';
import { replacedSkeleton } from '@/lib/masonry';
import { gsap, surfaceArrival, useGSAP } from './engine';

/* ---------------------------------------------------------------------------
 * Entrance / list motion
 *
 * `useStaggerGrid` here and `<Reveal>` (components/Reveal.tsx) are the two, both
 * playing on mount; there is no scroll-driven reveal. If one is ever wanted, an
 * `IntersectionObserver` with the app scroller as `root` suffices (see
 * `components/PicDetail.tsx`) under two constraints: never wrap a gallery card
 * (it parks targets at a `y` offset, and the hero flight reads
 * `getBoundingClientRect` on press) and never sit inside a tab pane whose content
 * swaps (the pane transition already animates the same nodes' `autoAlpha` and `y`).
 * ------------------------------------------------------------------------ */

/** Distance an entering element travels, px, on the 4dp grid. Small on purpose: a long
 *  throw reads as decoration, a short one reads as the content settling. The shared
 *  entrance travel, as `Reveal` takes it. */
const REVEAL_SHIFT = TRAVEL_PX.standard;

/**
 * Cascade for grid/masonry children, played on mount rather than on scroll — a
 * stagger reads as the grid filling in instead of one rectangle arriving. Order is
 * by *visual* position, not DOM order: the masonry's DOM is feed order and a card's
 * slot is shortest-column-first, so two neighbours in the list can sit a whole card
 * apart vertically. Sorting by row band then by x makes cards arrive left to right,
 * top to bottom.
 */
/** Rows are banded before sorting: masonry cards on the same visual row rarely
 *  share an exact `top`, and comparing raw values would zig-zag between them. */
const ROW_BAND_PX = 48;
/** Cards this far below the viewport still cascade: the next row, about to scroll in. */
const STAGGER_NEAR_MARGIN = 240;

/**
 * The ref is a **parameter**, not something this creates. **Whatever renders this must
 * be a *sibling after* the ref'd element, never a child of it**: React attaches a
 * parent's ref only after its children's layout effects have run, so a component
 * rendered *inside* the grid reads `ref.current === null` on the mounting commit —
 * and once `warmMotion()` has made the engine resident before first paint, nothing
 * re-runs the mount pass, so the gallery silently gets no entrance on load. The
 * caller owns the `useRef`; this owns the animation (`lib/motionLazy.tsx` mounts it
 * from a child that only exists once GSAP has arrived).
 */
export function useStaggerGridOn<T extends HTMLElement = HTMLElement>(
  ref: RefObject<T | null>,
  selector: string,
  deps: unknown[] = [],
): void {
  // Reactive: this re-runs on every page of results, so a preference changed
  // mid-session still has work to skip.
  const tier = useMotionTier('entrance');
  const entrances = useEntranceMotion();
  /**
   * Once per mounted grid, not once per page of results. The cascade parks every
   * card at `autoAlpha: 0` and reveals them over up to 0.25s of stagger — right for a
   * grid *arriving*, wrong for a page turn, twice over: `Pagination` glides the
   * scroller to the top, so the viewport starts at the **bottom** of the grid where
   * cards are *last* in cascade order (looked-at content held invisible for the full
   * stagger); and a page turn is a content *replacement* inside a grid that never
   * left — the glide carries it, and a second entrance on top is the "动画重叠"
   * failure this file names elsewhere. A breakpoint reflow does not replay it
   * either — a resize is not an arrival. `deps` stays the full list because the
   * *early return* must re-evaluate: a grid that mounted empty has to cascade when
   * rows land, so the latch is set after the `items.length` check.
   */
  const played = useRef(false);

  useGSAP(
    () => {
      const root = ref.current;
      if (!root || !entrances || tier === 'off') return;
      const items = gsap.utils.toArray<HTMLElement>(root.querySelectorAll(selector));
      if (items.length === 0) return;
      if (played.current) return;
      played.current = true;
      /* The route's pre-commit marker is already present when this grid mounts.
         Its page is entering as one surface; a child cascade here adds a second
         clock and a transform per card during the most expensive first paint.
         Latch the skipped entrance too, so a later update cannot replay it. */
      if (routeTransitActive(root)) return;
      /* The grid took over from its own skeleton in this commit: the placeholder has been
         saying "arriving" for as long as it was up, and a cascade on top of it is the same
         news twice (the judgement a page turn gets). This is also every unseeded cold load
         of `/`, where the cascade used to park fifty cards and spend a second and a half of
         a slow phone's main thread revealing them. */
      if (replacedSkeleton()) return;

      /* Only what can be seen, plus the next row. Cards below the fold are revealed long
         before anyone scrolls to them, so tweening them was pure cost — 45 of 50 on a phone
         — and it held them at zero opacity through the stagger for nothing. The rest
         are left exactly as they are, which is visible. */
      const scroller = getAppScroller();
      const view = scroller?.getBoundingClientRect();
      const viewTop = view?.top ?? 0;
      const viewBottom = view?.bottom ?? window.innerHeight;
      const rootTop = root.getBoundingClientRect().top;
      const ordered = items
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { el, r, band: Math.round((r.top - rootTop) / ROW_BAND_PX), x: r.left };
        })
        .filter(({ r }) => r.bottom > viewTop && r.top < viewBottom + STAGGER_NEAR_MARGIN)
        .sort((a, b) => a.band - b.band || a.x - b.x)
        .map((m) => m.el);
      if (ordered.length === 0) return;

      /* Reduced halves the rise and drops the cascade: the cascade is a tween per
       * card on a device that cannot afford 100 of them, the rise says "arriving".
       * No scale at either tier — the same fade-and-rise `Reveal` plays, so the app
       * has one entrance cascade; the 0.985 it carried was a flourish no one could
       * see, and a card mid-tween carried a transform the hero flight measures. */
      const reduced = tier === 'reduced';
      /* Each card arrives as a surface does (`surfaceArrival`): the rise on the default spatial
         spring, the fade on the default effects one, so a card is visible before its crest and
         lands with the scheme's soft settle rather than the emphasized decelerate's hard stop.
         `spring()` already carries the entrance category's speed; the stagger is scaled to match. */
      const ratio = motionRatio('entrance');
      const { spatial, effects } = surfaceArrival('default', 'entrance');
      // Capped (`STAGGER`): however many cards are on screen, the spread never passes 250ms.
      const stagger = reduced
        ? 0
        : { each: STAGGER.step * ratio, from: 'start' as const, amount: Math.min((ordered.length - 1) * STAGGER.step, STAGGER.max) * ratio };
      const tween = gsap
        .timeline({ onComplete: () => gsap.set(ordered, { clearProps: 'opacity,visibility,transform' }) })
        .fromTo(ordered, { autoAlpha: 0 }, { autoAlpha: 1, ...effects, stagger }, 0)
        .fromTo(ordered, { y: reduced ? TRAVEL_PX.small : REVEAL_SHIFT }, { y: 0, ...spatial, stagger }, 0);

      // A transform on an ancestor shifts `getBoundingClientRect` for everything
      // under it, and the hero flight reads exactly that off a card the moment you
      // press it. Snapping to the end state on pointerdown means a card can never
      // be measured mid-cascade — a press during the cascade feels answered.
      const settle = () => tween.progress(1);
      root.addEventListener('pointerdown', settle, { capture: true });
      return () => root.removeEventListener('pointerdown', settle, { capture: true });
    },
    // `revertOnUpdate`: the `pointerdown` listener is removed by the returned
    // cleanup, which useGSAP otherwise defers to unmount — every page turn was
    // leaving another capture-phase listener calling `progress(1)` on a dead tween.
    { scope: ref, dependencies: [selector, tier, entrances, ...deps], revertOnUpdate: true },
  );
}

/** `useStaggerGridOn` as a component that renders nothing, for `lib/motionLazy.tsx` — see
 *  `DrawerSwipeHost`. Rendered as a sibling after the grid, which is what the ref needs. */
export function StaggerGridHost({
  gridRef,
  selector,
  deps,
}: {
  gridRef: RefObject<HTMLElement | null>;
  selector: string;
  deps: unknown[];
}) {
  useStaggerGridOn(gridRef, selector, deps);
  return null;
}
