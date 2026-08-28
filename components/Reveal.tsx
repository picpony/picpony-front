'use client';

import { ReactNode, useLayoutEffect, useRef } from 'react';
import { DURATION, EASE } from '@/lib/motionTokens';
import { entranceMotion, motionTier, scaledMs } from '@/lib/appearance';

interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Seconds between each direct child (default 0.06). */
  stagger?: number;
  /** Initial vertical offset in px (default 16). */
  distance?: number;
  /** Delay in seconds before the sequence starts. */
  delay?: number;
}

/**
 * Staggered entrance for its direct children, played once on mount.
 *
 * Mount-time is the whole point, and it is why this is the app's only general entrance helper.
 * Content that is already on screen when the route commits — a login form, the first settings
 * card, an error state — has to animate on mount; hanging it off a scroll trigger would mean it
 * never plays at all, because it never crosses the trigger line.
 *
 * There is deliberately no below-the-fold counterpart. One existed (`useScrollReveal`, on GSAP's
 * ScrollTrigger) and was removed: it had no call sites, because an entrance cascade is for
 * *picture* content and the gallery has its own in `useStaggerGrid`.
 *
 * ## On Web Animations rather than GSAP
 *
 * This is `EmptyState`'s and `ErrorRetry`'s entrance — `StatusView` renders it unconditionally —
 * so it is reached from very nearly every screen in the app, and it was importing `lib/motion`,
 * which registers GSAP and five plugins at module scope. What it asks for is a fade, a rise and a
 * per-child delay, none of which needs an engine.
 *
 * Two GSAP conveniences had to be spelled out. `autoAlpha` is opacity plus `visibility`, so the
 * `hidden → visible` pair is written into the keyframes — it is what keeps a child that has not
 * started yet out of the hit-testing as well as out of sight. And GSAP's `clearProps: 'all'`
 * needs no counterpart here: the keyframes carry `fill: 'backwards'` only, so once the run
 * lands nothing is held at all. A `forwards` fill would pin a composited layer on every empty
 * state in the app and make the element's computed style report the fill rather than the
 * stylesheet. (There is no `finished` handler — an earlier version of this paragraph claimed
 * one; the only `cancel()` is the unmount cleanup.)
 *
 * `scaledMs`, because WAAPI has no equivalent of `gsap.globalTimeline.timeScale`: without it the
 * 快速 and 缓慢 speeds would not reach this.
 */
export default function Reveal({
  children,
  className,
  stagger = 0.06,
  distance = 16,
  delay = 0,
}: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  /* Layout effect, so the start state is applied in the same frame the children first paint. A
     passive effect would show them at rest for one frame and then snap them back to the start,
     which is the flash `gsap.from` inside `useGSAP` (also a layout effect) was avoiding. */
  useLayoutEffect(() => {
    const root = ref.current;
    /* `entranceMotion()` is the harder stop: this component *is* an entrance, so with the switch
       off there is nothing to reduce. Read once at mount rather than subscribed, because that is
       when the whole of this animation happens — the one reactive reader left is the grid, which
       keeps firing all session. */
    if (!root || !entranceMotion()) return;
    const tier = motionTier();
    if (tier === 'off') return;

    /* Reduced halves the rise and drops the stagger. The rise is what makes an entrance read as
       arriving rather than as a repaint; the cascade is the performance. Half of 16 is the same
       8px the detail overlay and the grid take under this tier, so the three entrances agree. */
    const reduced = tier === 'reduced';
    const rise = reduced ? distance / 2 : distance;
    const step = reduced ? 0 : stagger;
    /* `long`, the enters-the-screen duration. It was `emphasized` (500), which the spec reserves
       for a large container transform. */
    const duration = scaledMs(DURATION.long * 1000);

    const running = [...root.children].map((child, index) =>
      (child as HTMLElement).animate(
        [
          { opacity: 0, visibility: 'hidden', transform: `translateY(${rise}px)` },
          { opacity: 1, visibility: 'visible', transform: 'none' },
        ],
        {
          duration,
          delay: scaledMs((delay + index * step) * 1000),
          easing: EASE.decelerate,
          /* `backwards`, so the start state holds through the delay — without it a staggered
             child is at rest until its turn comes and then jumps back to begin. */
          fill: 'backwards',
        },
      ),
    );

    return () => {
      for (const animation of running) animation.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only, by definition.
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
