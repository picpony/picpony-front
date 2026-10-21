'use client';

import { useEffect } from 'react';
import { motionTier, scaledMs } from '@/lib/appearance';
import { HANDOFF_MS } from '@/lib/motionTokens';
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
 * Every wave holds while its pointer is down and fades once it lifts (`spawnRipple`).
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
      let released = false;
      let pressedAt = 0;
      const start = () => {
        // A deferred press can outlive its control: re-check before painting.
        if (!host.isConnected || target.matches(':disabled, [aria-disabled="true"]')) return;
        wave = spawnRipple(host, x, y);
        /* `data-pressed` is the press as state, for the M3 Expressive press morph (a button's
           corners drawing in under the finger, on the fast spatial spring). Pointer-driven rather
           than `:active`, which a touch screen delays and holds (`ToggleSwitch`'s reasoning). */
        if (motionTier() !== 'off') {
          target.setAttribute('data-pressed', '');
          pressedAt = performance.now();
        }
        if (released) letGo(false);
      };
      /* A press too quick to see still shows its morph for a hand-off's worth, so a tap reads as
         a press rather than nothing. */
      const letGo = (cancelled: boolean) => {
        if (cancelled) wave?.cancel();
        else wave?.release();
        if (!pressedAt) return;
        const left = Math.max(0, scaledMs(HANDOFF_MS) - (performance.now() - pressedAt));
        window.setTimeout(() => target.removeAttribute('data-pressed'), left);
        pressedAt = 0;
      };
      /* The wave holds for as long as the press does (Compose's ripple): it is let go when this
         pointer lifts or is cancelled, whatever the pointer type. A quick tap's wave starts at the
         lift (`tap`) and is let go at once — it still spreads fully before fading. */
      const pointerId = event.pointerId;
      const end = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        window.removeEventListener('pointerup', end, true);
        window.removeEventListener('pointercancel', end, true);
        released = true;
        letGo(e.type === 'pointercancel');
      };
      window.addEventListener('pointerup', end, { capture: true, passive: true });
      window.addEventListener('pointercancel', end, { capture: true, passive: true });
      trackPress(event, {
        press: start,
        tap: start,
        cancel: () => letGo(true),
      });
    };

    document.addEventListener('pointerdown', onPointerDown, { passive: true });
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  return null;
}
