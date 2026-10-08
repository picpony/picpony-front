'use client';

import { type ReactNode, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { DURATION, EASE } from '@/lib/motionTokens';
import { entranceMotion, motionTier, scaledMs } from '@/lib/appearance';
import { routeTransitActive } from '@/lib/pageTransit';

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

/* A hydration probe: the server snapshot answers while React hydrates server HTML. */
const subscribeNothing = () => () => {};
const onClient = () => true;
const onServer = () => false;

/**
 * Staggered entrance for its direct children, played once on mount.
 *
 * Mount-time is the whole point: content already on screen when the route
 * commits (a login form, an error state) has to animate on mount, and a scroll
 * trigger would never fire for it. There is deliberately **no below-the-fold
 * counterpart** — one existed and was removed for having no call sites; an
 * entrance cascade is for picture content, and the gallery has its own.
 *
 * On Web Animations rather than GSAP: this is the entrance `StatusView` renders
 * on nearly every screen, and what it asks for (fade, rise, per-child delay)
 * does not need an engine whose plugins register at module scope.
 * `autoAlpha`'s visibility half is spelled into the keyframes, and the fill is
 * `backwards` only, so nothing is pinned once the run lands. `scaledMs` is
 * required because WAAPI has no time-scale equivalent — without it the 快速 and
 * 缓慢 speeds would not reach this.
 *
 * **Not on content the server rendered.** Hydrating is not arriving: the block has been on
 * screen since the first paint, so an entrance played at hydration hid it and faded it back —
 * the 404 painted at rest, vanished half a second later and rose in again. Only an instance
 * the client mounts plays; one that hydrates server HTML is already where it belongs.
 */
export default function Reveal({
  children,
  className,
  stagger = 0.06,
  distance = 16,
  delay = 0,
}: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  /* The first render's answer, kept: a hydrating render reads the server snapshot (false),
     a client mount the client one. React re-renders after hydration with `true`, which must
     not turn a hydrated block into one that plays. */
  const clientMounted = useSyncExternalStore(subscribeNothing, onClient, onServer);
  const playable = useRef(clientMounted);

  /* Layout effect, so the start state lands in the same frame the children
     first paint; a passive effect would show them at rest, then snap back. */
  useLayoutEffect(() => {
    if (!playable.current) return;
    const root = ref.current;
    /* `entranceMotion()` is the harder stop: this component *is* an entrance,
       so with the switch off there is nothing to reduce. Read once at mount —
       that is when the whole animation happens. */
    if (!root || !entranceMotion() || routeTransitActive(root)) return;
    const tier = motionTier();
    if (tier === 'off') return;

    /* Reduced tier: half the rise (the same 8px the other entrances take), no
       stagger — the cascade is the performance. */
    const reduced = tier === 'reduced';
    const rise = reduced ? distance / 2 : distance;
    const step = reduced ? 0 : stagger;
    /* `long`, the enters-the-screen duration. */
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
          /* `backwards`, so the start state holds through the delay — without
             it a staggered child sits at rest until its turn, then jumps. */
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
