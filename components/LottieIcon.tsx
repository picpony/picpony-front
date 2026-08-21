'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { cn } from '@/lib/utils';
import { prefersReducedMotion } from '@/lib/motion';

interface LottieIconProps {
  /** Resolves the animation JSON. A function so the chunk stays out of the
   *  first-load bundle and is only fetched when this actually mounts. */
  load: () => Promise<unknown>;
  /**
   * Drawn until the animation is ready, and **instead of it** under reduced
   * motion. The type is `ReactElement`, not `ReactNode`, and that is the whole
   * point: `ReactNode` accepts `null`, both call sites passed `null`, and so the
   * one branch this component exists to serve rendered nothing at all — /search's
   * empty state had no illustration whatsoever for anyone with the preference on,
   * and the sign-in dialog had an empty 60% pane. A prop whose documented
   * contract is "never empty" should not be typed to permit empty.
   */
  fallback: ReactElement;
  /**
   * `width / height` of the composition, used to reserve the box before the player
   * injects its SVG. Required rather than optional because the host is 0px tall
   * until the chunk resolves and then pushes everything below it down — a layout
   * shift on every visit, and the component cannot read the ratio without first
   * fetching the thing it is trying to reserve space for.
   */
  aspect: number;
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
  aspect,
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
      /* The box is reserved from the caller's width and the composition's ratio,
         so the fallback, the player's SVG and the empty pre-load state all occupy
         exactly the same space. */
      style={{ aspectRatio: aspect }}
      // Labelled only when the caller gives it meaning; otherwise it is
      // decoration and must not be announced at all.
      {...(ariaLabel ? { role: 'img', 'aria-label': ariaLabel } : { 'aria-hidden': true })}
    >
      <span ref={hostRef} className="contents" />
      {!playing && fallback}
    </span>
  );
}
