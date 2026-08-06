'use client';

import { useCallback, useEffect, useState } from 'react';
import Logo, { INTRO_DURATION_MS, INTRO_CHUNK_BUDGET_MS } from './Logo';

/** How long the finished mark holds before the overlay leaves. */
const HOLD_MS = 220;
const FADE_MS = 400;
/** Reduced motion loads nothing, so there is no animation to wait for. */
const REDUCED_HOLD_MS = 300;

/**
 * The splash.
 *
 * The mark writes itself on — the same Lottie the header plays on hover, cut so
 * the colour layer waits for the outline instead of racing it — and the overlay
 * leaves once it lands. The logo used to sit still and breathe on a 1.6s loop,
 * which is a placeholder gesture: it says "wait" without saying what for, it
 * never ends, and the dismissal always cut it mid-cycle.
 *
 * "Once it lands", not "after `INTRO_DURATION_MS`". The player's chunk is 60KB
 * and takes a few hundred milliseconds to arrive, so a timer started at mount
 * runs ahead of the animation by exactly that much: measured, the overlay began
 * fading at 1534ms while the mark did not finish drawing until ~1714ms, and the
 * last strokes were written onto an already-dissolving screen. `Logo` reports
 * when it is genuinely done — including when it has given up on a slow chunk —
 * and the hold counts from there.
 *
 * The ceiling below is the backstop for the case where that report never comes
 * at all. A splash is a decoration and must never be why the app is unreachable.
 *
 * Under `prefers-reduced-motion` nothing is loaded and the static mark simply
 * fades, so the whole overlay is over in well under a second.
 */
export default function LoadingOverlay() {
  const [isVisible, setIsVisible] = useState(true);
  const [isMounted, setIsMounted] = useState(true);
  const [settled, setSettled] = useState(false);

  const onSettled = useCallback(() => setSettled(true), []);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const timer = setTimeout(() => setSettled(true), REDUCED_HOLD_MS);
      return () => clearTimeout(timer);
    }
    const ceiling = setTimeout(
      () => setSettled(true),
      INTRO_DURATION_MS + INTRO_CHUNK_BUDGET_MS + FADE_MS,
    );
    return () => clearTimeout(ceiling);
  }, []);

  useEffect(() => {
    if (!settled) return;
    const fadeOutTimer = setTimeout(() => setIsVisible(false), HOLD_MS);
    const unmountTimer = setTimeout(() => setIsMounted(false), HOLD_MS + FADE_MS);
    return () => {
      clearTimeout(fadeOutTimer);
      clearTimeout(unmountTimer);
    };
  }, [settled]);

  if (!isMounted) return null;

  return (
    <div
      className={`bg-surface fixed inset-0 z-[9999] flex items-center justify-center transition-opacity duration-400 ease-[var(--ease-accelerate)] ${
        isVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
    >
      {/* Nothing to point at on a splash, so the hover cut is never loaded.
          The base is `outline-variant` rather than the body's ink: it is a
          ground for the colour trace to be drawn onto, not a wordmark in its
          own right, and at full strength it read as the finished logo already
          being there — which leaves the trace with nothing to reveal. */}
      <Logo
        className="h-auto w-32 text-outline-variant"
        interactive={false}
        intro
        onIntroSettled={onSettled}
      />
    </div>
  );
}
