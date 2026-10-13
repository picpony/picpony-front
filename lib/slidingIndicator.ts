'use client';

import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';
import { motionTier } from '@/lib/appearance';
import { springTiming } from '@/lib/springTiming';

/** Where the mark sits along its row, and how wide it is, px. */
type Pose = { x: number; width: number };

/** The mark's state between renders. */
type Mark = {
  /** Positioned once: every move after the first is a glide. */
  placed: boolean;
  /** The glide in flight and its two ends. */
  glide: { animation: Animation; from: Pose; to: Pose } | null;
  /** Where the mark rests: the inline style it was last given. */
  rest: Pose | null;
  /** Each tab's box as the last layout left it, by value. */
  boxes: Map<string, Pose>;
  /** The value the mark is under, for the observer. */
  value: string;
  /** A thin bar (the underline) rather than a container (the pill): measured once. */
  thin: boolean | null;
};

const near = (a: Pose, b: Pose) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.width - b.width) < 0.5;

function stopGlide(mark: Mark) {
  mark.glide?.animation.cancel();
  mark.glide = null;
}

function restAt(mark: Mark, indicator: HTMLElement, pose: Pose) {
  mark.rest = pose;
  indicator.style.transformOrigin = '0 0';
  indicator.style.width = `${pose.width}px`;
  indicator.style.transform = `translateX(${pose.x}px)`;
}

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
 *
 * **A selection reads no layout.** Each tab's box is kept by a `ResizeObserver`, which reads it
 * where layout is already clean, and the pose of a glide in flight is read off the animation's own
 * progress rather than off the computed style — so a glide can start anywhere, inside a tap
 * included, without forcing a style or layout pass.
 *
 * **`glideTo` starts the glide ahead of the selection**: a tab row whose switch is already moving
 * renders its new selection a frame later (`Tabs`), and the mark leaves with the panes rather than
 * after them. The commit that then selects the same tab finds the mark on its way and leaves it.
 */
export function useSlidingIndicator<
  C extends HTMLElement = HTMLDivElement,
  I extends HTMLElement = HTMLSpanElement,
>(
  active: string,
): {
  containerRef: RefObject<C | null>;
  indicatorRef: RefObject<I | null>;
  glideTo: (value: string) => void;
} {
  const containerRef = useRef<C>(null);
  const indicatorRef = useRef<I>(null);
  const markRef = useRef<Mark>({ placed: false, glide: null, rest: null, boxes: new Map(), value: active, thin: null });

  /** Move the mark under `value`: placed on the first call (and under 关闭), glided after it. */
  const moveTo = useCallback((value: string) => {
    const mark = markRef.current;
    mark.value = value;
    const indicator = indicatorRef.current;
    const container = containerRef.current;
    /* `CSS.escape`, because `value` is a caller's: a tab key containing a quote or a bracket
       would otherwise throw and take the indicator down with it. */
    const target = container?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(value)}"]`);
    if (!indicator || !container || !target) return;

    /* The first placement measures (a mount, which lays out anyway); a selection after it reads
       the box the observer keeps. */
    const to = mark.boxes.get(value) ?? { x: target.offsetLeft, width: target.offsetWidth };

    if (!mark.placed || motionTier('tabs') === 'off') {
      stopGlide(mark);
      mark.placed = true;
      mark.thin ??= indicator.offsetHeight <= 4;
      restAt(mark, indicator, to);
      return;
    }

    /* Already on its way there (`glideTo`, ahead of the commit), or resting there. */
    const heading = mark.glide?.to ?? mark.rest;
    if (heading && near(heading, to)) return;

    /* Where the mark is *now* — a tab tapped mid-glide sets off from the pose on screen, not
       from where the cancelled glide began. The animation's own progress is its eased progress,
       overshoot included. */
    const flying = mark.glide;
    const progress =
      flying?.animation.playState === 'running' ? flying.animation.effect?.getComputedTiming().progress : null;
    const from =
      flying && typeof progress === 'number'
        ? {
            x: flying.from.x + (flying.to.x - flying.from.x) * progress,
            width: flying.from.width + (flying.to.width - flying.from.width) * progress,
          }
        : (mark.rest ?? to);
    stopGlide(mark);
    /* The end state is written inline first and the glide runs *to* it with no fill, so a
       finished (or cancelled) animation already rests where it should. */
    restAt(mark, indicator, to);
    /* **Compositor-only whenever it can be.** A `width` keyframe is laid out on the main
       thread every frame, and the home pill glides during a tab switch, when the main thread
       has the route's commit to render. Equal widths (the pill's two tabs) are a pure
       translate; a thin bar (the underline, 2dp) takes the width change as a scale from its
       left edge, where the stretch of a 1px cap cannot be seen; only a tall mark whose width
       really changes keeps the width keyframe — a rounded pill would show the scale. */
    const keyframes: Keyframe[] =
      Math.abs(from.width - to.width) < 0.5
        ? [{ transform: `translateX(${from.x}px)` }, { transform: `translateX(${to.x}px)` }]
        : mark.thin
          ? [
              { transform: `translateX(${from.x}px) scaleX(${from.width / to.width})` },
              { transform: `translateX(${to.x}px) scaleX(1)` },
            ]
          : [
              { transform: `translateX(${from.x}px)`, width: `${from.width}px` },
              { transform: `translateX(${to.x}px)`, width: `${to.width}px` },
            ];
    const animation = indicator.animate(keyframes, springTiming('defaultSpatial', 'tabs'));
    mark.glide = { animation, from, to };
    animation.finished
      .then(() => {
        if (mark.glide?.animation === animation) mark.glide = null;
      })
      .catch(() => {
        /* Cancelled by the next glide, which has already taken over. */
      });
  }, []);

  /* Layout effect, so the pill is in place in the frame the new tab first paints: a passive
     effect lands it one frame later — a visible jump from x=0 on first placement, or a frame
     of the old position under the new label on a glide. */
  useLayoutEffect(() => {
    moveTo(active);
  }, [moveTo, active]);

  /* **The boxes, kept current.** Font loading, badge counts and viewport changes can move a tab
     without changing its value, and the mark is kept under its label then too — placed at once:
     reflow is not a selection. Observing every tab also catches a preceding label getting wider,
     and a tab arriving or leaving re-observes the set. A `ResizeObserver` is delivered after
     layout, so the reads here cost nothing; the first delivery (one per observed element, in the
     frame after mounting) fills the map. */
  useLayoutEffect(() => {
    const container = containerRef.current;
    const indicator = indicatorRef.current;
    const mark = markRef.current;
    if (!container || !indicator) return;
    const measure = () => {
      const boxes = new Map<string, Pose>();
      for (const tab of container.querySelectorAll<HTMLElement>('[data-tab]')) {
        if (tab.dataset.tab !== undefined) boxes.set(tab.dataset.tab, { x: tab.offsetLeft, width: tab.offsetWidth });
      }
      mark.boxes = boxes;
      const box = boxes.get(mark.value);
      const at = mark.glide?.to ?? mark.rest;
      if (!mark.placed || !box || !at || near(box, at)) return;
      stopGlide(mark);
      restAt(mark, indicator, box);
    };
    const sizes = new ResizeObserver(measure);
    const watch = () => {
      sizes.disconnect();
      sizes.observe(container);
      for (const tab of container.querySelectorAll<HTMLElement>('[data-tab]')) sizes.observe(tab);
    };
    watch();
    const children = new MutationObserver(watch);
    children.observe(container, { childList: true });
    return () => {
      children.disconnect();
      sizes.disconnect();
      stopGlide(mark);
    };
  }, []);

  /* Ahead of a selection: the mark follows the value the commit is about to bring. */
  const glideTo = useCallback(
    (value: string) => {
      if (markRef.current.placed) moveTo(value);
    },
    [moveTo],
  );

  return { containerRef, indicatorRef, glideTo };
}
