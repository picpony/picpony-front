'use client';

import { useLayoutEffect, useRef, type RefObject } from 'react';
import { motionTier } from '@/lib/appearance';
import { springTiming } from '@/lib/springTiming';

/**
 * The tab indicator's glide, on Web Animations — NOT GSAP: four lines of GSAP were
 * `components/Tabs.tsx`'s only reason to import `lib/motion` (which registers GSAP and five
 * plugins at module scope), putting the whole engine into the root shell of every route, and
 * moving one element along a spring is a thing WAAPI does natively — on the compositor, as a
 * transform (see the keyframes below for how a change of width stays one).
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
      const container = containerRef.current;
      /* `CSS.escape`, because `active` is a caller's value: a tab key containing a quote or
         a bracket would otherwise throw and take the indicator down with it. */
      const target = container?.querySelector<HTMLElement>(
        `[data-tab="${CSS.escape(active)}"]`,
      );
      if (!indicator || !container || !target) return;

      const toX = target.offsetLeft;
      const toWidth = target.offsetWidth;
      /* The end state is written inline first and the glide runs *to* it with no fill, so a
         finished (or cancelled) animation already rests where it should. */
      const rest = () => {
        indicator.style.transformOrigin = '0 0';
        indicator.style.width = `${toWidth}px`;
        indicator.style.transform = `translateX(${toX}px)`;
      };

      if (!placed.current || motionTier() === 'off') {
        running.current?.cancel();
        running.current = null;
        placed.current = true;
        rest();
      } else {
        /* Where the mark is *now*, read before the previous glide is let go — a tab tapped
           mid-glide sets off from the pose on screen, not from where the cancelled one began. */
        const style = getComputedStyle(indicator);
        const matrix = style.transform === 'none' ? null : new DOMMatrixReadOnly(style.transform);
        const fromX = matrix?.m41 ?? 0;
        const fromWidth = (parseFloat(style.width) || toWidth) * (matrix?.a ?? 1);
        const thin = indicator.offsetHeight <= 4;
        running.current?.cancel();
        running.current = null;
        rest();
        /* **Compositor-only whenever it can be.** A `width` keyframe is laid out on the main
           thread every frame, and the home pill glides during a tab switch, when the main thread
           has the route's commit to render. Equal widths (the pill's two tabs) are a pure
           translate; a thin bar (the underline, 2dp) takes the width change as a scale from its
           left edge, where the stretch of a 1px cap cannot be seen; only a tall mark whose width
           really changes keeps the width keyframe — a rounded pill would show the scale. */
        const keyframes: Keyframe[] =
          Math.abs(fromWidth - toWidth) < 0.5
            ? [{ transform: `translateX(${fromX}px)` }, { transform: `translateX(${toX}px)` }]
            : thin
              ? [
                  { transform: `translateX(${fromX}px) scaleX(${fromWidth / toWidth})` },
                  { transform: `translateX(${toX}px) scaleX(1)` },
                ]
              : [
                  { transform: `translateX(${fromX}px)`, width: `${fromWidth}px` },
                  { transform: `translateX(${toX}px)`, width: `${toWidth}px` },
                ];
        const animation = indicator.animate(keyframes, springTiming('defaultSpatial'));
        running.current = animation;
        animation.finished
          .then(() => {
            if (running.current === animation) running.current = null;
          })
          .catch(() => {
            /* Cancelled by the next glide, which has already taken over. */
          });
      }

      /* Font loading, badge counts and viewport changes can move a tab without
         changing its value. Keep the mark under its label in those cases, too.
         Geometry changes place it immediately: reflow is not a tab selection.
         Observing all tabs also catches a preceding label getting wider. The baseline is
         the geometry read above: read again here, after the writes, it forced a second
         style and layout pass inside the tap's own task. */
      let left = toX;
      let width = toWidth;
      const observer = new ResizeObserver(() => {
        const nextLeft = target.offsetLeft;
        const nextWidth = target.offsetWidth;
        if (nextLeft === left && nextWidth === width) return;
        left = nextLeft;
        width = nextWidth;
        running.current?.cancel();
        running.current = null;
        indicator.style.transformOrigin = '0 0';
        indicator.style.width = `${width}px`;
        indicator.style.transform = `translateX(${left}px)`;
      });
      observer.observe(container);
      container.querySelectorAll<HTMLElement>('[data-tab]').forEach((tab) => observer.observe(tab));
      return () => observer.disconnect();
    },
    [active],
  );

  useLayoutEffect(() => () => {
    running.current?.cancel();
    running.current = null;
  }, []);

  return { containerRef, indicatorRef };
}
