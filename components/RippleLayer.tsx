'use client';

import { useEffect } from 'react';
import { gsap, prefersReducedMotion } from '@/lib/motion';

/**
 * Global press-ripple system. Mount once (root layout); any element carrying
 * `data-ripple` gets a Material-style ripple on pointerdown via event
 * delegation — no per-component wiring. `[data-ripple]` in globals.css
 * provides positioning, clipping and tap-highlight removal; the ripple
 * inherits `currentColor`, so it adapts to any surface automatically.
 */
export default function RippleLayer() {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || prefersReducedMotion()) return;
      const target = (event.target as Element | null)?.closest<HTMLElement>('[data-ripple]');
      if (!target || target.hasAttribute('disabled')) return;

      const rect = target.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      // Radius reaching the farthest corner keeps the wave circular.
      const radius = Math.hypot(
        Math.max(x, rect.width - x),
        Math.max(y, rect.height - y),
      );

      const ripple = document.createElement('span');
      ripple.className = 'ripple';
      const size = radius * 2;
      ripple.style.width = `${size}px`;
      ripple.style.height = `${size}px`;
      ripple.style.left = `${x - radius}px`;
      ripple.style.top = `${y - radius}px`;
      target.appendChild(ripple);

      gsap.timeline({ onComplete: () => ripple.remove() })
        .fromTo(ripple,
          { scale: 0.25, opacity: 0.18 },
          { scale: 1, opacity: 0.12, duration: 0.45, ease: 'decelerate' },
        )
        .to(ripple, { opacity: 0, duration: 0.3, ease: 'none' }, '-=0.12');
    };

    document.addEventListener('pointerdown', onPointerDown, { passive: true });
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  return null;
}
