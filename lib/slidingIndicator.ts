'use client';

import { useLayoutEffect, useRef, type RefObject } from 'react';
import { motionTier } from '@/lib/appearance';
import { springTiming } from '@/lib/springTiming';

/**
 * The tab indicator's glide, on Web Animations — NOT GSAP: four lines of GSAP were
 * `components/Tabs.tsx`'s only reason to import `lib/motion` (which registers GSAP and five
 * plugins at module scope), putting the whole engine into the root shell of every route, and
 * moving one element to an `x` and a `width` on a spring is a thing WAAPI does natively.
 * `springTiming` rather than `spring()` because it is renderer-neutral and returns a duration
 * already scaled by the speed preference (WAAPI has no `gsap.globalTimeline.timeScale`
 * equivalent).
 *
 * Spring-paired: shape and duration move together. The first placement does not animate — a
 * pill gliding in from `x=0` on mount is an entrance nobody asked for and would run on every
 * cold load whose tab comes out of the URL; `placed` distinguishes "position it" from "move
 * it", and the off tier takes that branch for ever. The reduced tier still slides: the
 * indicator's job is to connect two labels, and a mark that vanishes here and reappears there
 * is the one shape that does not — `springTiming` hands that tier the critically damped table,
 * so it loses the overshoot, not the travel.
 */
export function useSlidingIndicator<
  C extends HTMLElement = HTMLDivElement,
  I extends HTMLElement = HTMLSpanElement,
>(
  active: string,
  extraDeps: unknown[] = [],
): { containerRef: RefObject<C | null>; indicatorRef: RefObject<I | null> } {
  const containerRef = useRef<C>(null);
  const indicatorRef = useRef<I>(null);
  const placed = useRef(false);
  const running = useRef<Animation | null>(null);

  /* Layout effect, so the pill is in place in the frame the new tab first paints: a passive
     effect lands it one frame later — a visible jump from x=0 on first placement, or a frame
     of the old position under the new label on a glide. */
  useLayoutEffect(
    () => {
      const indicator = indicatorRef.current;
      /* `CSS.escape`, because `active` is a caller's value: a tab key containing a quote or
         a bracket would otherwise throw and take the indicator down with it. */
      const target = containerRef.current?.querySelector<HTMLElement>(
        `[data-tab="${CSS.escape(active)}"]`,
      );
      if (!indicator || !target) return;

      const to = { transform: `translateX(${target.offsetLeft}px)`, width: `${target.offsetWidth}px` };

      /* GSAP's `overwrite: 'auto'` has no WAAPI equivalent, so the previous glide is
         cancelled by hand — *committed* first, or a tab tapped mid-glide would snap back to
         where the cancelled animation started before setting off again. */
      const previous = running.current;
      if (previous) {
        try {
          previous.commitStyles();
        } catch {
          /* `commitStyles` throws on a non-replaceable animation; the style write below
             is the answer either way. */
        }
        previous.cancel();
        running.current = null;
      }

      if (!placed.current || motionTier() === 'off') {
        placed.current = true;
        Object.assign(indicator.style, to);
        return;
      }

      const from = {
        transform: getComputedStyle(indicator).transform,
        width: getComputedStyle(indicator).width,
      };
      const animation = indicator.animate([from, to], {
        ...springTiming('defaultSpatial'),
        fill: 'forwards',
      });
      running.current = animation;
      /* The final position is written to the element and `fill: 'forwards'` dropped, so the
         indicator is not left holding an animation's fill for the life of the page — which
         would make the next `getComputedStyle` read the fill rather than the style, and
         would keep a composited layer alive on every tab row in the app. */
      animation.finished
        .then(() => {
          if (running.current !== animation) return;
          Object.assign(indicator.style, to);
          animation.cancel();
          running.current = null;
        })
        .catch(() => {
          /* Cancelled by the next glide, which has already taken over. */
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `extraDeps` is the caller's list.
    [active, ...extraDeps],
  );

  return { containerRef, indicatorRef };
}
