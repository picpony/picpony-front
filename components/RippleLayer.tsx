'use client';

import { useEffect } from 'react';
import { rippleHostOf, spawnRipple, trackPress, type RippleHandle } from '@/lib/ripple';

/**
 * Global press-ripple system. Mount once (root layout); any element carrying
 * `data-ripple` gets a Material-style ripple on press via event delegation.
 * `[data-ripple]` in globals.css provides positioning, clipping and tap-highlight
 * removal; the ripple inherits `currentColor`. A control whose hit area extends past
 * its painted box clips the wave in an inner `[data-ripple-host]` span instead —
 * see `rippleHostOf`.
 *
 * **A finger waits for the tap timeout.** `trackPress` holds a touch's wave until it is
 * clearly a press, plays it at once on a quick tap, and lets it go when the touch becomes
 * a scroll — a list no longer flashes a wave under every flick. Mouse and pen are immediate.
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

      /* The contact point, in host coordinates, taken now: the host may move (a list
         scrolling under a held finger) before a deferred wave starts. */
      const host = rippleHostOf(target);
      const rect = host.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      let wave: RippleHandle | null = null;
      const start = () => {
        // A deferred press can outlive its control: re-check before painting.
        if (!host.isConnected || target.matches(':disabled, [aria-disabled="true"]')) return;
        wave = spawnRipple(host, x, y);
      };
      trackPress(event, { press: start, tap: start, cancel: () => wave?.cancel() });
    };

    document.addEventListener('pointerdown', onPointerDown, { passive: true });
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  return null;
}
