'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { AnimationItem } from 'lottie-web';
import { cn } from '@/lib/utils';
import { motionScale, motionTier, useMotionSpeed, useMotionTier } from '@/lib/appearance';
import { loadLottiePlayer } from '@/lib/lottieAssets';

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
  const animationRef = useRef<AnimationItem | null>(null);
  const tier = useMotionTier();
  const speed = useMotionSpeed();
  const [playback, setPlayback] = useState({ tier, ready: false });
  // A destroyed player is no longer ready. Invalidate its ready state during
  // the tier change, before a return to standard can expose an empty host.
  if (playback.tier !== tier) setPlayback({ tier, ready: false });

  /* Held in a ref, so changing a callback does not replay the artwork. Call sites pass an inline
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
    let animation: AnimationItem | null = null;
    const started = performance.now();

    void Promise.all([loadLottiePlayer(), loadRef.current()]).then(([player, data]) => {
      const host = hostRef.current;
      if (cancelled || !host || motionTier() !== 'standard') return;
      const instance = player.default.loadAnimation({
        container: host,
        renderer: 'svg',
        loop: false,
        autoplay: false,
        animationData: data as object,
      });
      animation = instance;
      animationRef.current = instance;
      const ready = () => {
        if (cancelled || motionTier() !== 'standard') return;
        const scale = motionScale();
        instance.setSpeed(1 / scale);
        // The entrance clock starts with the view. A late chunk catches up to
        // that clock instead of starting a second entrance on a settled page.
        const frame = (performance.now() - started) * instance.frameRate / (1000 * scale);
        if (frame >= instance.totalFrames - 1) instance.goToAndStop(instance.totalFrames - 1, true);
        else instance.goToAndPlay(frame, true);
        setPlayback({ tier, ready: true });
      };
      if (instance.isLoaded) ready();
      else instance.addEventListener('DOMLoaded', ready);
    }).catch(() => {
      // A decorative chunk must never replace the fallback with a blank box.
      if (!cancelled) setPlayback({ tier, ready: false });
    });

    return () => {
      cancelled = true;
      animation?.destroy();
      if (animationRef.current === animation) animationRef.current = null;
    };
  }, [tier]);

  useEffect(() => {
    if (motionTier() === 'standard') animationRef.current?.setSpeed(1 / motionScale());
  }, [speed]);

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
      <span ref={hostRef} className="absolute inset-0 [&>svg]:h-full [&>svg]:w-full" />
      {(!playback.ready || playback.tier !== tier || tier !== 'standard') && fallback}
    </span>
  );
}
