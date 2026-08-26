'use client';

import { ReactNode, useRef } from 'react';
import { gsap, useGSAP, DURATION } from '@/lib/motion';
import { entranceMotion, motionTier } from '@/lib/appearance';

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
 * This is *not* superseded by `useScrollReveal` — the two answer different
 * questions. Content that is already on screen when the route commits (a login
 * form, the first settings card, an error state) has to animate on mount;
 * hanging it off a ScrollTrigger means it never plays, because it never
 * crosses the trigger line. Use `useScrollReveal` for anything below the fold,
 * where a mount-time animation would have finished before you scrolled to it.
 */
export default function Reveal({
  children,
  className,
  stagger = 0.06,
  distance = 16,
  delay = 0,
}: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const tier = motionTier();
      /* `entranceMotion()` is the harder stop: this component *is* an entrance, so with the
         switch off there is nothing to reduce. Read once at mount rather than subscribed,
         because that is when the whole of this animation happens — the two reactive readers
         are the scroll reveal and the grid, which keep firing all session. */
      if (!ref.current || !entranceMotion() || tier === 'off') return;
      /* Reduced halves the rise and drops the stagger. The rise is what makes an entrance
         read as arriving rather than as a repaint; the cascade is the performance, and it is
         also a tween per child. Half of 16 is the same 8px the detail overlay and the grid
         take under this tier, so the three entrances agree. */
      const reduced = tier === 'reduced';
      gsap.from(ref.current.children, {
        autoAlpha: 0,
        y: reduced ? distance / 2 : distance,
        /* `long`, the enters-the-screen duration. It was `emphasized` (500),
           which the spec reserves for a large container transform — and the two
           scroll-driven helpers in `lib/motion.ts` use `long`, so the same
           entrance ran at two speeds depending on which helper produced it. */
        duration: DURATION.long,
        ease: 'decelerate',
        stagger: reduced ? 0 : stagger,
        delay,
        clearProps: 'all',
      });
    },
    { scope: ref },
  );

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
