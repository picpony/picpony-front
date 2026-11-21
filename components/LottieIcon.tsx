'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { AnimationItem } from 'lottie-web';
import { cn } from '@/lib/utils';
import { motionScale, motionTier, useMotionScale, useMotionTier } from '@/lib/appearance';
import { loadLottiePlayer } from '@/lib/lottieAssets';

interface LottieIconProps {
  /** Resolves the animation JSON. A function so the chunk stays out of the
   *  first-load bundle and is only fetched when this actually mounts. */
  load: () => Promise<unknown>;
  /**
   * Drawn until the animation is ready, when loading fails, and — unless
   * `staticMode` is `'last-frame'` — instead of the animation when ambient
   * motion is below `standard`. Typed `ReactElement`, not `ReactNode` — the
   * documented contract is "never empty", so the type must not permit empty.
   */
  fallback: ReactElement;
  /**
   * `width / height` of the composition, used to reserve the box before the
   * player injects its SVG. Required: the host is 0px tall until the chunk
   * resolves, which is a layout shift on every visit.
   */
  aspect: number;
  /**
   * What to show when ambient motion is below `standard` (`reduced` or `off`).
   * `'fallback'` skips loading the player; `'last-frame'` loads the artwork and
   * holds it statically on its final frame without playback.
   */
  staticMode?: 'fallback' | 'last-frame';
  className?: string;
  /** Omit for pure decoration, which is the usual case — the illustration sits
   *  next to copy that already says the same thing. */
  'aria-label'?: string;
}

function lastFrameOf(animation: AnimationItem): number {
  return Math.max(0, animation.totalFrames - 1);
}

/**
 * A decorative Lottie, played once on mount — plays, lands, and stays put. A
 * loop in an empty state says "wait" without saying what for.
 *
 * Below the standard ambient tier, playback never runs: by default nothing is
 * fetched and `fallback` is the whole component; with `staticMode="last-frame"`
 * the artwork is rendered statically on its final frame.
 */
export default function LottieIcon({
  load,
  fallback,
  aspect,
  staticMode = 'fallback',
  className,
  'aria-label': ariaLabel,
}: LottieIconProps) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const animationRef = useRef<AnimationItem | null>(null);
  const tier = useMotionTier('ambient');
  const speed = useMotionScale('ambient');
  const mode = tier === 'standard' ? 'play' : staticMode;
  const shouldLoad = mode !== 'fallback';
  const [playback, setPlayback] = useState({ loaded: shouldLoad, ready: false });
  // A destroyed player is no longer ready. Invalidate its ready state when the
  // host tears down, before a return to a loaded mode can expose an empty host.
  if (playback.loaded !== shouldLoad) setPlayback({ loaded: shouldLoad, ready: false });

  /* Held in a ref, so changing a callback does not replay the artwork. Call sites pass an inline
      `() => import(...)`, so a dependency on `load` would be a new identity on
      every parent render — which would tear the player down and replay the
      animation from frame 0. */
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  const staticModeRef = useRef(staticMode);
  useEffect(() => {
    staticModeRef.current = staticMode;
  }, [staticMode]);

  useEffect(() => {
    if (!shouldLoad) return;
    let cancelled = false;
    let animation: AnimationItem | null = null;
    const started = performance.now();

    void Promise.all([loadLottiePlayer(), loadRef.current()]).then(([player, data]) => {
      const host = hostRef.current;
      const liveMode = motionTier('ambient') === 'standard' ? 'play' : staticModeRef.current;
      if (cancelled || !host || liveMode === 'fallback') return;
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
        const currentMode = motionTier('ambient') === 'standard' ? 'play' : staticModeRef.current;
        if (cancelled || currentMode === 'fallback') return;
        const lastFrame = lastFrameOf(instance);
        if (currentMode === 'last-frame') {
          instance.goToAndStop(lastFrame, true);
        } else {
          const scale = motionScale('ambient');
          instance.setSpeed(1 / scale);
          // The entrance clock starts with the view. A late chunk catches up to
          // that clock instead of starting a second entrance on a settled page.
          const frame = (performance.now() - started) * instance.frameRate / (1000 * scale);
          if (frame >= lastFrame) instance.goToAndStop(lastFrame, true);
          else instance.goToAndPlay(frame, true);
        }
        setPlayback({ loaded: true, ready: true });
      };
      if (instance.isLoaded) ready();
      else instance.addEventListener('DOMLoaded', ready);
    }).catch(() => {
      // A decorative chunk must never replace the fallback with a blank box.
      if (!cancelled) setPlayback({ loaded: shouldLoad, ready: false });
    });

    return () => {
      cancelled = true;
      animation?.destroy();
      if (animationRef.current === animation) animationRef.current = null;
    };
  }, [shouldLoad]);

  useEffect(() => {
    const animation = animationRef.current;
    if (!animation || !animation.isLoaded) return;
    if (mode === 'last-frame') {
      animation.goToAndStop(lastFrameOf(animation), true);
    } else if (mode === 'play') {
      animation.setSpeed(1 / motionScale('ambient'));
      animation.goToAndPlay(0, true);
    }
  }, [mode]);

  useEffect(() => {
    if (motionTier('ambient') === 'standard') animationRef.current?.setSpeed(1 / motionScale('ambient'));
  }, [speed]);

  const ready = playback.ready && playback.loaded === shouldLoad && shouldLoad;

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
      <span
        ref={hostRef}
        className={cn('absolute inset-0 [&>svg]:h-full [&>svg]:w-full', !ready && 'invisible')}
      />
      {!ready && fallback}
    </span>
  );
}
