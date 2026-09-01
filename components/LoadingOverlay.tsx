'use client';

import { useCallback, useEffect, useState } from 'react';
import Logo, { INTRO_DURATION_MS } from './Logo';
import { MOTION_SPEED_SCALE, entranceMotion, motionTier } from '@/lib/appearance';
import { isAppPainted, subscribeAppPainted } from '@/lib/splash';

/** How long the finished mark holds before the overlay leaves. */
const HOLD_MS = 200;
/**
 * The fade out. `short4` paired with `accelerate` — the leaves-the-screen pairing.
 */
const FADE_MS = 200;
/* The unmount has to outlast the fade at *every* speed, and `duration-exit` goes
 * through `--motion-scale` — so the slowest multiplier rather than the live one:
 * this number bounds the animation, so it has to be the maximum the animation can
 * ever take. Holding an already-invisible node 40% longer costs nothing. */
const FADE_HOLD_MS = Math.round(FADE_MS * MOTION_SPEED_SCALE.slow);
/** Reduced motion loads nothing, so there is no animation to wait for. */
const REDUCED_HOLD_MS = 300;

/**
 * The splash.
 *
 * The mark writes itself on — the same Lottie the header plays on hover — and the
 * overlay leaves once it lands. **Once it lands, not "after `INTRO_DURATION_MS`"**:
 * the player's 60KB chunk takes a few hundred ms to arrive, so a mount-time timer
 * runs ahead of the animation and the last strokes were written onto an
 * already-dissolving screen. `Logo` reports when it is genuinely done — including
 * when it has given up on a slow chunk — and the hold counts from there.
 *
 * The ceiling is the backstop for the case where that report never comes at all.
 * A splash is a decoration and must never be why the app is unreachable.
 *
 * Below the standard motion tier nothing is loaded and the static mark simply
 * fades, so the whole overlay is over in well under a second.
 */
export default function LoadingOverlay() {
  /* Read synchronously rather than defaulted to `true`: a client navigation (or
     a fast refresh) can remount this, and an overlay that fades in over a
     painted app to fade straight back out is worse than no overlay. */
  const [isVisible, setIsVisible] = useState(() => !isAppPainted());
  const [isMounted, setIsMounted] = useState(() => !isAppPainted());
  const [settled, setSettled] = useState(false);

  const onSettled = useCallback(() => setSettled(true), []);

  /**
   * The dismissal is the app's to trigger, not the animation's.
   * `subscribeAppPainted` fires on the frame after the shell's first commit is
   * presented, so the overlay covers exactly the gap it was supposed to and
   * nothing more. The timers below survive as *ceilings*, for the case where
   * that signal never arrives.
   */
  useEffect(() => subscribeAppPainted(onSettled), [onSettled]);

  useEffect(() => {
    /* Read through `motionTier()`, an attribute lookup — the tier is on `<html>`
        before the first paint, so there is nothing to justify a private copy of
        the OS media query here.
        `entranceMotion()` joins it because `Logo` reads the same pair before it
        loads a player: if the two disagreed, this would sit waiting for a
        `settled` report from a draw that was never going to start. */
    if (!entranceMotion() || motionTier() !== 'standard') {
      const timer = setTimeout(() => setSettled(true), REDUCED_HOLD_MS);
      return () => clearTimeout(timer);
    }
    /* `INTRO_CHUNK_BUDGET_MS` is deliberately *not* in this sum: it is the grace
        period `Logo` gives its own chunk, and adding it here meant the screen
        stayed covered while a decoration downloaded. */
    const ceiling = setTimeout(() => setSettled(true), INTRO_DURATION_MS + FADE_MS);
    return () => clearTimeout(ceiling);
  }, []);

  useEffect(() => {
    if (!settled) return;
    /* No hold once the app has painted: the point of the paint signal is that
       there is something behind this to look at. The hold survives only for the
       ceiling path, where nothing has reported. */
    const hold = isAppPainted() ? 0 : HOLD_MS;
    const fadeOutTimer = setTimeout(() => setIsVisible(false), hold);
    const unmountTimer = setTimeout(() => setIsMounted(false), hold + FADE_HOLD_MS);
    return () => {
      clearTimeout(fadeOutTimer);
      clearTimeout(unmountTimer);
    };
  }, [settled]);

  if (!isMounted) return null;

  return (
    <div
      /* `pointer-events-none` unconditionally, not only once it has begun
         fading. The overlay is decoration over a live app from the first
         frame; leaving it hit-testable meant a tap in its first seconds went
         nowhere at all. */
      className={`bg-surface pointer-events-none fixed inset-0 z-app-loading flex items-center justify-center transition-opacity duration-exit ease-[var(--ease-accelerate)] ${
        isVisible ? 'opacity-100' : 'opacity-0'
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
