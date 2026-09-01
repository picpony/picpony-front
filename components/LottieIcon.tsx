'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { cn } from '@/lib/utils';
import { motionTier } from '@/lib/appearance';

interface LottieIconProps {
  /** Resolves the animation JSON. A function so the chunk stays out of the
   *  first-load bundle and is only fetched when this actually mounts. */
  load: () => Promise<unknown>;
  /**
   * Drawn until the animation is ready, and **instead of it** under reduced
   * motion. Typed `ReactElement`, not `ReactNode` — the documented contract is
   * "never empty", so the type must not permit empty.
   */
  fallback: ReactElement;
  /**
   * `width / height` of the composition, used to reserve the box before the
   * player injects its SVG. Required: the host is 0px tall until the chunk
   * resolves, which is a layout shift on every visit.
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
 * A decorative Lottie, played once on mount — plays, lands, and stays put. A
 * loop in an empty state says "wait" without saying what for.
 *
 * Under any tier below standard nothing is fetched at all and the static
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
      animation from frame 0. */
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    /* Standard only; the `fallback` is what the other tiers get. Both call
       sites are large decorative artwork behind a 60KB player, and the reduced
       tier's rule names Lottie playback among the things it drops. A small
       earned-badge mark, if one ever arrives, wants its own component. */
    if (motionTier() !== 'standard') return;
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
