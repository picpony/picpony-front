'use client';

import { ReactNode, useRef } from 'react';
import { gsap, useGSAP, prefersReducedMotion, DURATION } from '@/lib/motion';

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
      if (!ref.current || prefersReducedMotion()) return;
      gsap.from(ref.current.children, {
        autoAlpha: 0,
        y: distance,
        duration: DURATION.emphasized,
        ease: 'decelerate',
        stagger,
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
