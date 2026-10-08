'use client';

import { useCallback, useEffect, useRef } from 'react';
import { cn, runWhenIdle } from '@/lib/utils';
import {
  MOTION_SPEED_SCALE,
  entranceMotion,
  motionScale,
  motionTier,
  useMotionSpeed,
  useMotionTier,
} from '@/lib/appearance';
import { loadLottiePlayer } from '@/lib/lottieAssets';

interface LogoProps {
  className?: string;
  /**
   * Draws a hairline in the current colour around the animated mark.
   *
   * For the brand bar only: the colour wordmark's own hues sit close to the pink
   * fill and the letterforms lose their edges without it. Elsewhere the mark
   * already contrasts with its surface and the outline only thickens the strokes.
   *
   * Four offset drop-shadows rather than a blur: a blur reads as a glow and
   * thickens the strokes; the point is for the colour mark to keep exactly the
   * weight of the base underneath.
   */
  keyline?: boolean;
  /** `false` for a mark nobody points at on purpose — the footer's. */
  interactive?: boolean;
  /**
   * The app's boot signature: the colour mark writes itself on once per document load, then
   * settles back to the resting wordmark. The app bar's mark only — two marks writing
   * themselves on at once is a competition rather than an entrance.
   */
  introOnce?: boolean;
}

type TraceKind = 'hover' | 'intro';

type TraceAnimation = {
  goToAndPlay: (f: number, isFrame: boolean) => void;
  setSpeed: (s: number) => void;
  addEventListener: (event: 'complete', handler: () => void) => void;
  destroy: () => void;
};

/** Resolved once and shared: the player is 60KB and each artwork is 27KB. */
const dataPromises: Partial<Record<TraceKind, Promise<unknown>>> = {};

/**
 * Two cuts of the same drawing.
 *
 * `hover` is the pointer-triggered signature. `intro` is the boot cut: the same artwork with
 * the colour layer held back until the outline has drawn itself, so it reads as the mark
 * being written rather than filled in.
 */
function loadTrace(kind: TraceKind) {
  dataPromises[kind] ??=
    (kind === 'intro'
      ? import('@/lib/lottie/logoNonParallel.json').then((m) => m.default)
      : import('@/lib/lottie/logoTrace.json').then((m) => m.default)).catch((error) => {
      delete dataPromises[kind];
      throw error;
    });
  return Promise.all([loadLottiePlayer(), dataPromises[kind]!] as const);
}

/**
 * The boot cut plays at 1.65x: 140 frames at 60fps is 2.33s, and the first thing anyone sees
 * is not the place to spend it. At this speed the signature lands in 1.41s.
 */
const INTRO_SPEED = 1.65;
/**
 * How late after navigation start the boot signature may still begin. It is an arrival, and
 * an arrival that starts several seconds into a visit — a slow phone, a slow chunk — is a
 * logo animating at someone who is already scrolling; past this it is simply not played.
 */
const INTRO_LATEST_START_MS = 2500;
/** How long the finished signature holds before the colour mark fades back to the base. */
const INTRO_HOLD_MS = 600;
/** `.logo-trace`'s exit fade — the exit step of the duration scale (globals.css). */
const TRACE_EXIT_MS = 200;

/* Once per document, whatever remounts: the app bar's mark mounts once per load, but a
   development double-mount must not play it twice. */
let introClaimed = false;

/** A pointer that can hover — the only device on which a hover trace can ever be seen. */
const canHover = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/**
 * The wordmark.
 *
 * Two layers, and the split is the whole design: a masked base that takes its colour from
 * whatever text role it is sitting in (see `.logo-mask` in globals.css), and a colour mark on
 * top that draws itself on when you point at it. The base never leaves, so there is no frame
 * in which the logo is missing and no fade gap on the way out.
 *
 * The trace is a Lottie: six layers with nine trim paths, 140 frames at 60fps, exactly the
 * file the mark was drawn in. Player and artwork are a dynamic import so neither is in the
 * first-load bundle. Only a device that can hover warms them (on an idle callback, so the
 * first hover is not the one that pays) — a phone never can, so it never paid for a trace it
 * could not show — and the player is instantiated on the first hover, not while warming.
 *
 * Below the standard tier nothing is loaded at all and the base simply stays: a colour
 * reveal is decorative where the mark is legible without it, which is exactly what the
 * reduced tier's rule drops (decorative loops, Lottie playback).
 */
export default function Logo({
  className = 'w-32 h-auto',
  keyline = false,
  interactive = true,
  introOnce = false,
}: LogoProps) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const animationRef = useRef<{ kind: TraceKind; animation: TraceAnimation } | null>(null);
  /* While the boot signature owns the host, a hover neither starts nor stops anything. */
  const introRunningRef = useRef(false);
  const wantedRef = useRef(false);
  const generationRef = useRef(0);
  const tier = useMotionTier();
  const speed = useMotionSpeed();
  const traced = interactive || introOnce;

  const destroy = useCallback(() => {
    animationRef.current?.animation.destroy();
    animationRef.current = null;
  }, []);

  /* The boot cut has done its one job once it has faded; the hover cut is loaded on demand.
     Destroyed after the fade — `.logo-trace`'s exit transition, at the slowest speed, since a
     timer that bounds an animation takes the maximum — not during it: removing the SVG
     mid-fade cut the colour mark off. */
  const retireIntro = useCallback(
    () =>
      window.setTimeout(() => {
        if (animationRef.current?.kind === 'intro' && !introRunningRef.current) destroy();
      }, TRACE_EXIT_MS * MOTION_SPEED_SCALE.slow),
    [destroy],
  );

  /** The player for `kind`, created on demand; null when the tier or the node says no. */
  const ensure = useCallback(async (kind: TraceKind) => {
    if (motionTier() !== 'standard' || !hostRef.current) return null;
    if (animationRef.current?.kind === kind) return animationRef.current.animation;
    const generation = generationRef.current;
    const [player, data] = await loadTrace(kind);
    const host = hostRef.current;
    // A second request may have resolved first, or the node may have gone.
    if (!host || generation !== generationRef.current || motionTier() !== 'standard') return null;
    if (animationRef.current?.kind === kind) return animationRef.current.animation;
    destroy();
    const animation = player.default.loadAnimation({
      container: host,
      renderer: 'svg',
      loop: false,
      autoplay: false,
      animationData: data as object,
    }) as unknown as TraceAnimation;
    animation.setSpeed((kind === 'intro' ? INTRO_SPEED : 1) / motionScale());
    animationRef.current = { kind, animation };
    return animation;
  }, [destroy]);

  /* Whatever cut is loaded goes with a tier change or unmount; the generation also
     invalidates an import that resolves afterwards. */
  useEffect(() => {
    const host = hostRef.current;
    const generation = generationRef.current;
    return () => {
      generationRef.current = generation + 1;
      wantedRef.current = false;
      introRunningRef.current = false;
      destroy();
      host?.removeAttribute('data-shown');
    };
  }, [destroy, tier, traced]);

  useEffect(() => {
    const loaded = animationRef.current;
    if (loaded && motionTier() === 'standard') {
      loaded.animation.setSpeed((loaded.kind === 'intro' ? INTRO_SPEED : 1) / motionScale());
    }
  }, [speed, tier]);

  /* The boot signature. Non-occluding by construction — it is drawn over the resting wordmark
     in the app bar, which is on screen from the first paint — so nothing waits for it: it
     starts once the browser is idle after hydration, and only on a cold load that is still
     young enough for it to read as an arrival. An entrance, so it answers to 入场动画 as well
     as to the tier. */
  useEffect(() => {
    if (!introOnce || introClaimed || !entranceMotion() || motionTier() !== 'standard') return;
    introClaimed = true;
    let cancelled = false;
    let hold = 0;
    const cancelIdle = runWhenIdle(() => {
      if (cancelled || performance.now() > INTRO_LATEST_START_MS) return;
      void ensure('intro').then((animation) => {
        if (cancelled || !animation || performance.now() > INTRO_LATEST_START_MS + 1000) {
          if (animationRef.current?.kind === 'intro') destroy();
          return;
        }
        introRunningRef.current = true;
        hostRef.current?.setAttribute('data-shown', '');
        animation.addEventListener('complete', () => {
          hold = window.setTimeout(() => {
            introRunningRef.current = false;
            /* A pointer resting on the mark keeps the finished signature until it leaves,
               which then retires it the way a hover does. */
            if (wantedRef.current) return;
            hostRef.current?.removeAttribute('data-shown');
            hold = retireIntro();
          }, INTRO_HOLD_MS * motionScale());
        });
        animation.goToAndPlay(0, true);
      }).catch(() => {
        /* A decoration that failed to load is simply not played. */
      });
    }, INTRO_LATEST_START_MS);
    return () => {
      cancelled = true;
      cancelIdle();
      window.clearTimeout(hold);
    };
  }, [destroy, ensure, introOnce, retireIntro]);

  /* Warm the hover cut on idle — only where a hover can happen. The player is a 60KB chunk and
     the first hover would otherwise wait on the network for it: the one moment the animation
     has to be instant, because the pointer is already there. Chunks only; the player is built
     on the first hover. */
  useEffect(() => {
    if (!interactive || motionTier() !== 'standard' || !canHover()) return;
    return runWhenIdle(() => void loadTrace('hover').catch(() => {}));
  }, [interactive, tier]);

  const onEnter = useCallback(() => {
    /* Standard only. The trace needs a 60KB player and six layers of trim paths rasterised
       per frame — exactly what the reduced tier's rule names. */
    if (!interactive || motionTier() !== 'standard') return;
    wantedRef.current = true;
    if (introRunningRef.current) return;
    hostRef.current?.setAttribute('data-shown', '');
    void ensure('hover').then((animation) => {
      // The pointer may have left while the chunk was in flight.
      if (
        animation && animationRef.current?.animation === animation && wantedRef.current &&
        !introRunningRef.current && motionTier() === 'standard'
      ) animation.goToAndPlay(0, true);
    }).catch(() => {
      hostRef.current?.removeAttribute('data-shown');
    });
  }, [ensure, interactive]);

  const onLeave = useCallback(() => {
    wantedRef.current = false;
    if (introRunningRef.current) return;
    hostRef.current?.removeAttribute('data-shown');
    if (animationRef.current?.kind === 'intro') retireIntro();
  }, [retireIntro]);

  return (
    <span
      className="relative inline-block"
      onPointerEnter={interactive ? onEnter : undefined}
      onPointerLeave={interactive ? onLeave : undefined}
      onFocus={interactive ? onEnter : undefined}
      onBlur={interactive ? onLeave : undefined}
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
