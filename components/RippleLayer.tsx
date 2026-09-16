'use client';

import { useEffect } from 'react';
import { spawnRipple } from '@/lib/ripple';

/**
 * Global press-ripple system. Mount once (root layout); any element carrying
 * `data-ripple` gets a Material-style ripple on pointerdown via event
 * delegation. `[data-ripple]` in globals.css provides positioning, clipping and
 * tap-highlight removal; the ripple inherits `currentColor`.
 *
 * The motion tier is `spawnRipple`'s to read, not this delegator's: the wave
 * has to be created for the tier that still paints one, which a guard here
 * would prevent.
 */
export default function RippleLayer() {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = (event.target as Element | null)?.closest<HTMLElement>('[data-ripple]');
      // Native fieldsets can disable a control without adding its own attribute; menu
      // options express the same state through ARIA. Neither should paint a press wave.
      if (!target || target.matches(':disabled, [aria-disabled="true"]')) return;

      const rect = target.getBoundingClientRect();
      spawnRipple(target, event.clientX - rect.left, event.clientY - rect.top);
    };

    document.addEventListener('pointerdown', onPointerDown, { passive: true });
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  return null;
}
