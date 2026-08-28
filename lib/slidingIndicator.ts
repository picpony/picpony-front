'use client';

import { useLayoutEffect, useRef, type RefObject } from 'react';
import { motionTier } from '@/lib/appearance';
import { springTiming } from '@/lib/springTiming';

/**
 * The tab indicator's glide, on Web Animations.
 *
 * It was four lines of GSAP, and those four lines were `components/Tabs.tsx`'s only reason to
 * import `lib/motion` — which registers GSAP and five plugins at module scope. `Tabs` is mounted
 * by `AppLayout`, so that import put the whole engine (127 KB raw / 43.5 KB brotli) into the root
 * shell of every route in the app, including the ones that are a page of text. What the tween
 * actually does is move one element to an `x` and a `width` on a spring, which is a thing WAAPI
 * does natively.
 *
 * `springTiming` rather than `spring()` for the same reason: it is the renderer-neutral half, and
 * it returns a duration already scaled by the speed preference, since WAAPI has no equivalent of
 * `gsap.globalTimeline.timeScale`.
 *
 * ## The two behaviours worth not losing
 *
 * **The first placement does not animate.** A pill that glides in from `x=0` on mount is an
 * entrance nobody asked for, and on a screen whose tab comes out of the URL it would run on every
 * cold load. `placed` is what distinguishes "position it" from "move it", and the 关闭 tier takes
 * the same branch for ever.
 *
 * **The reduced tier still slides.** It briefly cross-faded the pill from the old position to the
 * new instead, which is worse than it sounds: the indicator's whole job is to connect two labels,
 * and a mark that vanishes here and reappears there is the one shape that does not. `springTiming`
 * hands that tier the critically damped table, so what it loses is the overshoot, not the travel.
 *
 * `DefaultSpatial` is what `TabRow.kt` assigns (`MotionSchemeKeyTokens.DefaultSpatial`) on the
 * **standard** scheme, which is this app's. It ran on the expressive scheme's default spatial
 * spring for a while — ζ0.8 k380, settling in 326ms against standard's 194 — and before that on
 * `back.out(1.55)` over 400ms, a guess at a spring on a duration taken from the transition scale
 * rather than from the physics.
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

  /* Layout effect, so the pill is in place in the frame the new tab first paints. A passive
     effect would land it one frame later, which on the first placement is a visible jump from
     x=0 and on a glide is a frame of the old position under the new label. */
  useLayoutEffect(
    () => {
      const indicator = indicatorRef.current;
      /* `CSS.escape`, because `active` is a caller's value: a tab key containing a quote or a
         bracket would otherwise throw and take the indicator down with it. `paneOf` escapes for
         the same reason. */
      const target = containerRef.current?.querySelector<HTMLElement>(
        `[data-tab="${CSS.escape(active)}"]`,
      );
      if (!indicator || !target) return;

      const to = { transform: `translateX(${target.offsetLeft}px)`, width: `${target.offsetWidth}px` };

      /* GSAP's `overwrite: 'auto'` has no WAAPI equivalent, so the previous glide is cancelled by
         hand — and *committed* first, or a tab tapped mid-glide would snap back to where the
         cancelled animation started before setting off again. */
      const previous = running.current;
      if (previous) {
        try {
          previous.commitStyles();
        } catch {
          /* `commitStyles` throws on a non-replaceable animation; the style write below is the
             answer either way. */
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
      /* The final position is written to the element and the `fill: 'forwards'` dropped, so the
         indicator is not left holding an animation's fill for the life of the page — which would
         make the next `getComputedStyle` read the fill rather than the style, and would keep a
         composited layer alive on every tab row in the app. */
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
