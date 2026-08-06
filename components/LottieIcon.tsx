'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { prefersReducedMotion } from '@/lib/motion';

interface LottieIconProps {
  /** Resolves the animation JSON. A function so the chunk stays out of the
   *  first-load bundle and is only fetched when this actually mounts. */
  load: () => Promise<unknown>;
  /** Drawn until the animation is ready, and instead of it under reduced
   *  motion. Never empty: the point is that the slot always has something in
   *  it, so the surrounding layout never shifts. */
  fallback: ReactNode;
  className?: string;
  /** Omit for pure decoration, which is the usual case — the illustration sits
   *  next to copy that already says the same thing. */
  'aria-label'?: string;
}

/** Resolved once and shared: the player is 60KB. */
let playerPromise: Promise<
  typeof import('lottie-web/build/player/esm/lottie_light.min.js')
> | null = null;

/**
 * A decorative Lottie, played once on mount.
 *
 * Once, not looped. A loop in an empty state is the same placeholder gesture as
 * the spinner the splash used to have — it says "wait" without saying what for,
 * and it never resolves. This plays, lands, and stays put.
 *
 * Under `prefers-reduced-motion` nothing is fetched at all and the static
 * `fallback` is the whole component.
 */
export default function LottieIcon({
  load,
  fallback,
  className,
  'aria-label': ariaLabel,
}: LottieIconProps) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const [playing, setPlaying] = useState(false);

  /* Held in a ref, and the effect runs once. Call sites pass an inline
     `() => import(...)`, so a dependency on `load` would be a new identity on
     every parent render — which would tear the player down and replay the
     animation from frame 0 each time the page's state changed. */
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    let cancelled = false;
    let animation: { destroy: () => void } | null = null;

    playerPromise ??= import('lottie-web/build/player/esm/lottie_light.min.js');
    void Promise.all([playerPromise, loadRef.current()]).then(([player, data]) => {
      const host = hostRef.current;
      if (cancelled || !host) return;
      animation = player.default.loadAnimation({
        container: host,
        renderer: 'svg',
        loop: false,
        autoplay: true,
        animationData: data as object,
      });
      setPlaying(true);
    });

    return () => {
      cancelled = true;
      animation?.destroy();
    };
  }, []);

  return (
    <span
      className={cn('relative grid place-items-center', className)}
      // Labelled only when the caller gives it meaning; otherwise it is
      // decoration and must not be announced at all.
      {...(ariaLabel ? { role: 'img', 'aria-label': ariaLabel } : { 'aria-hidden': true })}
    >
      <span ref={hostRef} className="contents" />
      {!playing && fallback}
    </span>
  );
}
