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
    const pressTimers = new Map<HTMLElement, number>();
    const clearPressTimer = (target: HTMLElement) => {
      const pending = pressTimers.get(target);
      if (pending !== undefined) {
        window.clearTimeout(pending);
        pressTimers.delete(target);
      }
    };
    const releasePressMorph = (target: HTMLElement, pressedAt: number) => {
      if (!pressedAt) return;
      clearPressTimer(target);
      const left = Math.max(0, scaledMs(HANDOFF_MS) - (performance.now() - pressedAt));
      pressTimers.set(
        target,
        window.setTimeout(() => {
          pressTimers.delete(target);
          target.removeAttribute('data-pressed');
        }, left),
      );
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = (event.target as Element | null)?.closest<HTMLElement>(
        '[data-ripple], [data-ripple-own], .yarl__button',
      );
      // Selection controls (`Checkbox`, `Radio`, `ToggleSwitch`) own their own centred wave via
      // `data-ripple-own`; stop delegation here without blocking outside-click listeners.
      if (!target || target.hasAttribute('data-ripple-own')) return;
      // Native fieldsets can disable a control without adding its own attribute; menu
      // options express the same state through ARIA. Neither should paint a press wave.
      if (target.matches(':disabled, [aria-disabled="true"]')) return;

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
          clearPressTimer(target);
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
        releasePressMorph(target, pressedAt);
        pressedAt = 0;
      };
      /* The wave holds for as long as the press does: it is let go when this pointer lifts, is
         cancelled, or the window loses focus (e.g. Alt-Tab mid-press). A quick tap's wave starts
         at the lift (`tap`) and is let go at once — it still completes its sweep before fading. */
      const pointerId = event.pointerId;
      const cleanup = () => {
        window.removeEventListener('pointerup', end, true);
        window.removeEventListener('pointercancel', end, true);
        window.removeEventListener('blur', onBlur);
      };
      const end = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        cleanup();
        released = true;
        letGo(e.type === 'pointercancel');
      };
      const onBlur = () => {
        cleanup();
        released = true;
        letGo(true);
      };
      window.addEventListener('pointerup', end, { capture: true, passive: true });
      window.addEventListener('pointercancel', end, { capture: true, passive: true });
      window.addEventListener('blur', onBlur, { passive: true });
      trackPress(event, {
        press: start,
        tap: start,
        cancel: () => {
          cleanup();
          released = true;
          letGo(true);
        },
      });
    };

    /* Keyboard activation (`Enter` / `Space` on a focused control) spawns a centred wave and
       shares the same press-morph lifecycle, matching Vuetify's keyboard ripple behaviour. */
    const activeKeyReleases = new Map<HTMLElement, (immediate?: boolean) => void>();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const raw = event.target as Element | null;
      if (!raw || raw.matches('input, textarea, select, [contenteditable="true"]')) return;
      const target = raw.closest<HTMLElement>('[data-ripple], .yarl__button');
      if (!target || target !== raw || target.matches(':disabled, [aria-disabled="true"]')) return;
      if (event.key === ' ' && target.tagName === 'A') return;
      if (activeKeyReleases.has(target)) return;

      const host = rippleHostOf(target);
      const rect = host.getBoundingClientRect();
      const wave = spawnRipple(host, rect.width / 2, rect.height / 2);
      let pressedAt = 0;
      if (motionTier() !== 'off') {
        clearPressTimer(target);
        target.setAttribute('data-pressed', '');
        pressedAt = performance.now();
      }
      const key = event.key;
      const release = (immediate = false) => {
        if (!activeKeyReleases.delete(target)) return;
        window.removeEventListener('keyup', onKeyUp, true);
        target.removeEventListener('blur', onBlur);
        window.removeEventListener('blur', onBlur);
        if (immediate) {
          wave?.cancel();
          clearPressTimer(target);
          target.removeAttribute('data-pressed');
        } else {
          wave?.release();
          releasePressMorph(target, pressedAt);
        }
        pressedAt = 0;
      };
      const onBlur = () => release(false);
      const onKeyUp = (e: KeyboardEvent) => {
        if (e.key === key) release(false);
      };
      activeKeyReleases.set(target, release);
      window.addEventListener('keyup', onKeyUp, { capture: true, passive: true });
      target.addEventListener('blur', onBlur, { passive: true });
      window.addEventListener('blur', onBlur, { passive: true });
    };

    document.addEventListener('pointerdown', onPointerDown, { passive: true });
    document.addEventListener('keydown', onKeyDown, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      for (const release of activeKeyReleases.values()) release(true);
      activeKeyReleases.clear();
      for (const [target, timer] of pressTimers) {
        window.clearTimeout(timer);
        target.removeAttribute('data-pressed');
      }
      pressTimers.clear();
    };
  }, []);

  return null;
}
