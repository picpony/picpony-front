'use client';

import { useEffect } from 'react';
import { spawnRipple } from '@/lib/motion';

/**
 * Global press-ripple system. Mount once (root layout); any element carrying
 * `data-ripple` gets a Material-style ripple on pointerdown via event
 * delegation — no per-component wiring. `[data-ripple]` in globals.css
 * provides positioning, clipping and tap-highlight removal; the ripple
 * inherits `currentColor`, so it adapts to any surface automatically.
 *
 * The animation preference is `spawnRipple`'s to read, not this delegator's: the wave has to
 * be created for the tier that still paints one, which a guard here would prevent. It is two
 * answers rather than three now — spread, or nothing at all under `off`.
 */
export default function RippleLayer() {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = (event.target as Element | null)?.closest<HTMLElement>('[data-ripple]');
      if (!target || target.hasAttribute('disabled')) return;

      const rect = target.getBoundingClientRect();
      spawnRipple(target, event.clientX - rect.left, event.clientY - rect.top);
    };

    document.addEventListener('pointerdown', onPointerDown, { passive: true });
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  return null;
}
