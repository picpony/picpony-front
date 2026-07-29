'use client';

import { ReactNode, useRef } from 'react';
import { gsap, useGSAP, prefersReducedMotion } from '@/lib/motion';

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
 * Staggered entrance for its direct children — the standard way to bring
 * page sections in. Renders a plain wrapper; children animate once on mount.
 */
export default function Reveal({
  children,
  className,
  stagger = 0.06,
  distance = 16,
  delay = 0,
}: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    if (!ref.current || prefersReducedMotion()) return;
    gsap.from(ref.current.children, {
      autoAlpha: 0,
      y: distance,
      duration: 0.55,
      ease: 'decelerate',
      stagger,
      delay,
      clearProps: 'all',
    });
  }, { scope: ref });

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
