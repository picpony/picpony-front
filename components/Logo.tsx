'use client';

import { useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { prefersReducedMotion } from '@/lib/motion';

interface LogoProps {
  className?: string;
  /**
   * Draws a hairline in the current colour around the animated mark.
   *
   * For the brand bar only, where the colour wordmark's own hues sit close to
   * the pink fill and the letterforms lose their edges without it. Everywhere
   * else the mark sits on a `surface` tone it already contrasts with, and the
   * outline only thickens the strokes — the footer copy carried one for no
   * reason and read heavier than the header's at half the size.
   *
   * Four offset drop-shadows rather than a blur: a blur reads as a glow and
   * thickens the strokes, and the point is for the colour mark to keep exactly
   * the weight of the base underneath. Where the two overlap it is invisible.
   */
  keyline?: boolean;
  /** `false` for a logo nobody can point at — the loading overlay's. */
  interactive?: boolean;
  /**
   * Play the splash cut once on mount instead of waiting for a pointer. The
   * overlay uses this; nothing else should, because two marks writing
   * themselves on at the same time is a competition rather than an entrance.
   */
  intro?: boolean;
  /** Fires when the intro cut has finished drawing, or when it has been given
   *  up on. The overlay dismisses off this rather than off its own clock. */
  onIntroSettled?: () => void;
}

/** Resolved once and shared: the player is 60KB and each artwork is 27KB. */
let playerPromise: Promise<
  typeof import('lottie-web/build/player/esm/lottie_light.min.js')
> | null = null;
const dataPromises: Partial<Record<TraceKind, Promise<unknown>>> = {};

type TraceKind = 'hover' | 'intro';

/**
 * Two cuts of the same drawing.
 *
 * `hover` is the pointer-triggered signature. `intro` is the splash: the same
 * artwork with the colour layer held back until the outline has drawn itself,
 * so it reads as the mark being written rather than filled in.
 */
function loadTrace(kind: TraceKind) {
  playerPromise ??= import('lottie-web/build/player/esm/lottie_light.min.js');
  dataPromises[kind] ??=
    kind === 'intro'
      ? import('@/lib/lottie/logoNonParallel.json').then((m) => m.default)
      : import('@/lib/lottie/logoTrace.json').then((m) => m.default);
  return Promise.all([playerPromise, dataPromises[kind]!] as const);
}

/**
 * The splash plays at 1.65x.
 *
 * 140 frames at 60fps is 2.33s, and the first thing anyone sees is not the
 * place to spend two and a third seconds — the overlay it lives in used to be
 * gone in one. At this speed the whole signature lands in 1.41s, which is the
 * most of it that fits without the splash becoming the slowest part of a cold
 * start.
 */
const INTRO_SPEED = 1.65;
export const INTRO_DURATION_MS = Math.round((140 / 60 / INTRO_SPEED) * 1000);
/** If the chunk is slower than this, the splash leaves without it. */
export const INTRO_CHUNK_BUDGET_MS = 600;

/**
 * The wordmark.
 *
 * Two layers, and the split is the whole design: a masked base that takes its
 * colour from whatever text role it is sitting in (see `.logo-mask` in
 * globals.css), and a colour mark on top that draws itself on when you point at
 * it. The base never leaves, so there is no frame in which the logo is missing
 * and no fade gap on the way out.
 *
 * The hover used to be a `clip-path` wipe across a static colour SVG, which is
 * a curtain rather than a signature — and it was written out twice, here and
 * again inline in `AppLayout`'s header, where it had drifted to a different
 * width and gained a keyline the other copy never had. Both are now this.
 *
 * The trace is a Lottie: six layers with nine trim paths, 140 frames at 60fps,
 * exactly the file the mark was drawn in. Player and artwork are a dynamic
 * import so neither is in the first-load bundle, warmed on an idle callback so
 * the first hover is not the one that pays for it, and shared across every
 * instance on the page.
 *
 * Under `prefers-reduced-motion` nothing is loaded at all and the base simply
 * stays. A colour reveal is decorative; the mark is legible without it.
 */
export default function Logo({
  className = 'w-32 h-auto',
  keyline = false,
  interactive = true,
  intro = false,
  onIntroSettled,
}: LogoProps) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const animationRef = useRef<{
    goToAndPlay: (f: number, isFrame: boolean) => void;
    setSpeed: (s: number) => void;
    addEventListener: (event: 'complete', handler: () => void) => void;
    destroy: () => void;
  } | null>(null);
  const wantedRef = useRef(false);
  /* In a ref so the intro effect does not restart when the parent re-renders
     with a new closure — that would replay the animation from frame 0. */
  const settledRef = useRef(onIntroSettled);
  useEffect(() => {
    settledRef.current = onIntroSettled;
  }, [onIntroSettled]);
  const kind: TraceKind = intro ? 'intro' : 'hover';
  const traced = intro || interactive;

  const ensure = useCallback(async () => {
    if (animationRef.current || !hostRef.current) return animationRef.current;
    const [player, data] = await loadTrace(kind);
    const host = hostRef.current;
    // A second hover may have resolved first, or the node may have gone.
    if (!host || animationRef.current) return animationRef.current;
    animationRef.current = player.default.loadAnimation({
      container: host,
      renderer: 'svg',
      loop: false,
      autoplay: false,
      animationData: data as object,
    });
    return animationRef.current;
  }, [kind]);

  useEffect(() => {
    if (!intro || prefersReducedMotion()) return;
    /* The splash cannot warm on idle — it is the first thing on the screen and
       the chunk is 60KB. So it is requested immediately and *not* waited on:
       the masked base is server-rendered and already visible, so a slow network
       costs the animation, never the mark. Past the budget the splash gives up
       and lets the overlay leave on schedule rather than holding a cold start
       open for a decoration. */
    let cancelled = false;
    /* Past the budget the splash gives up: the overlay is told to carry on
       without the animation rather than holding a cold start open for a
       decoration. */
    const deadline = window.setTimeout(() => {
      cancelled = true;
      settledRef.current?.();
    }, INTRO_CHUNK_BUDGET_MS);
    void ensure().then((animation) => {
      window.clearTimeout(deadline);
      if (cancelled || !animation) return;
      hostRef.current?.setAttribute('data-shown', '');
      /* The base steps aside once the mark is written — see `.logo-intro` in
         globals.css for why it has to — and the overlay leaves on the same
         signal. Both key off the player's own completion rather than a second
         copy of the duration: the chunk takes a few hundred ms to arrive, so a
         clock started at mount runs ahead of the animation and was dismissing
         the splash while the mark was still drawing. */
      animation.addEventListener('complete', () => {
        hostRef.current?.setAttribute('data-settled', '');
        settledRef.current?.();
      });
      animation.setSpeed(INTRO_SPEED);
      animation.goToAndPlay(0, true);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(deadline);
      animationRef.current?.destroy();
      animationRef.current = null;
    };
  }, [ensure, intro]);

  useEffect(() => {
    if (intro || !interactive || prefersReducedMotion()) return;
    /* Warm on idle. The player is a 60KB chunk and the first hover would
       otherwise wait on the network for it — which is the one moment the
       animation has to be instant, because the pointer is already there. */
    const idle =
      typeof window.requestIdleCallback === 'function'
        ? window.requestIdleCallback(() => void ensure(), { timeout: 4000 })
        : window.setTimeout(() => void ensure(), 1500);
    return () => {
      if (typeof window.cancelIdleCallback === 'function')
        window.cancelIdleCallback(idle as number);
      else window.clearTimeout(idle as number);
      animationRef.current = null;
    };
  }, [ensure, interactive, intro]);

  const onEnter = useCallback(() => {
    if (intro || !interactive || prefersReducedMotion()) return;
    wantedRef.current = true;
    hostRef.current?.setAttribute('data-shown', '');
    void ensure().then((animation) => {
      // The pointer may have left while the chunk was in flight.
      if (animation && wantedRef.current) animation.goToAndPlay(0, true);
    });
  }, [ensure, interactive, intro]);

  const onLeave = useCallback(() => {
    if (intro) return;
    wantedRef.current = false;
    hostRef.current?.removeAttribute('data-shown');
  }, [intro]);

  return (
    <span
      className={cn('relative inline-block', intro && 'logo-intro')}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
    >
      <span role="img" aria-label="PicPony" className={cn('logo-mask', className)} />
      {traced && (
        <span
          ref={hostRef}
          aria-hidden="true"
          className={cn('logo-trace', keyline && 'logo-keyline')}
        />
      )}
    </span>
  );
}
