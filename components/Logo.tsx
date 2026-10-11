'use client';

import { useCallback, useEffect, useRef } from 'react';
import { cn, runWhenIdle } from '@/lib/utils';
import { motionScale, motionTier, useMotionScale, useMotionTier } from '@/lib/appearance';
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
  /** `false` for a mark nobody points at on purpose — the footer's and the splash's. */
  interactive?: boolean;
  /**
   * The splash's mark (`SplashScreen`), under either 入场动画 mode that plays: write the boot cut on
   * now and keep it. While false the mark is the ground the trace is drawn onto.
   */
  intro?: boolean;
  /**
   * Fires once `intro` has finished drawing (`true`), or when it has been given up on (`false`):
   * too late in the load to read as an arrival, a chunk that failed, a tier that plays no
   * Lottie. The splash leaves off this rather than off a clock of its own.
   */
  onIntroSettled?: (played: boolean) => void;
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
/** The boot cut's length at the default speed. */
export const INTRO_DURATION_MS = Math.round((140 / 60 / INTRO_SPEED) * 1000);
/**
 * How late after the document's first byte the boot signature may still begin. It is an arrival,
 * and an arrival that starts several seconds into a visit — a slow phone, a slow chunk — is a
 * splash holding a page that has been there all along; past this it is simply not played.
 */
export const INTRO_LATEST_START_MS = 2500;

/**
 * Milliseconds since this document's first byte — the clock `INTRO_LATEST_START_MS` runs on, as
 * the splash's stylesheet deadline does (it counts from the splash's own parse, a moment later).
 * Counted from navigation start, a slow first byte — a route compiling on the dev server, a slow
 * network — spent the deadline before the splash was on screen, and it was dismissed unplayed.
 */
export function sinceFirstByte(): number {
  const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  return performance.now() - (entry?.responseStart || 0);
}

/**
 * Fetch the player and the boot cut ahead of the mark that plays them — the splash's, while the
 * rest of the app's script is still evaluating and hydrating — so the trace can start the moment
 * the splash takes over. Chunks only; the player is built by the mark.
 */
export function warmIntro() {
  void loadTrace('intro').catch(() => {});
}

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
 * The boot cut writes the mark on once per cold load, and only on the splash's mark (`intro`).
 *
 * Below the standard tier nothing is loaded at all and the base simply stays: a colour
 * reveal is decorative where the mark is legible without it, which is exactly what the
 * reduced tier's rule drops (decorative loops, Lottie playback).
 */
export default function Logo({
  className = 'w-32 h-auto',
  keyline = false,
  interactive = true,
  intro = false,
  onIntroSettled,
}: LogoProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const hostRef = useRef<HTMLSpanElement>(null);
  const animationRef = useRef<{ kind: TraceKind; animation: TraceAnimation } | null>(null);
  const wantedRef = useRef(false);
  const generationRef = useRef(0);
  const tier = useMotionTier(intro ? 'entrance' : 'ambient');
  const speed = useMotionScale(intro ? 'entrance' : 'ambient');
  const traced = interactive || intro;
  /* In a ref so the splash's write-on does not restart when its parent re-renders with a new
     closure — that would replay the cut from frame 0. */
  const settledRef = useRef(onIntroSettled);
  useEffect(() => {
    settledRef.current = onIntroSettled;
  }, [onIntroSettled]);

  const destroy = useCallback(() => {
    animationRef.current?.animation.destroy();
    animationRef.current = null;
  }, []);

  /** The player for `kind`, created on demand; null when the tier or the node says no. */
  const ensure = useCallback(async (kind: TraceKind) => {
    if (motionTier(kind === 'intro' ? 'entrance' : 'ambient') !== 'standard' || !hostRef.current) return null;
    if (animationRef.current?.kind === kind) return animationRef.current.animation;
    const generation = generationRef.current;
    const [player, data] = await loadTrace(kind);
    const host = hostRef.current;
    // A second request may have resolved first, or the node may have gone.
    if (!host || generation !== generationRef.current || motionTier(kind === 'intro' ? 'entrance' : 'ambient') !== 'standard') return null;
    if (animationRef.current?.kind === kind) return animationRef.current.animation;
    destroy();
    const animation = player.default.loadAnimation({
      container: host,
      renderer: 'svg',
      loop: false,
      autoplay: false,
      animationData: data as object,
    }) as unknown as TraceAnimation;
    animation.setSpeed((kind === 'intro' ? INTRO_SPEED : 1) / motionScale(kind === 'intro' ? 'entrance' : 'ambient'));
    animationRef.current = { kind, animation };
    return animation;
  }, [destroy]);

  /* Whatever cut is loaded goes with a tier change or unmount; the generation also
     invalidates an import that resolves afterwards. */
  useEffect(() => {
    const root = rootRef.current;
    const host = hostRef.current;
    const generation = generationRef.current;
    return () => {
      generationRef.current = generation + 1;
      wantedRef.current = false;
      destroy();
      host?.removeAttribute('data-shown');
      root?.removeAttribute('data-settled');
    };
  }, [destroy, tier, traced]);

  useEffect(() => {
    const loaded = animationRef.current;
    if (loaded && motionTier(loaded.kind === 'intro' ? 'entrance' : 'ambient') === 'standard') {
      loaded.animation.setSpeed((loaded.kind === 'intro' ? INTRO_SPEED : 1) / motionScale(loaded.kind === 'intro' ? 'entrance' : 'ambient'));
    }
  }, [speed, tier]);

  /* The boot signature, the splash's: it starts at once, and the finished mark stays — the splash
     leaves over it (阻塞), or leaves over it mid-stroke once the page has loaded (不阻塞). A cut that
     cannot start while the load still reads as an arrival is given up on, and the splash leaves
     without it rather than holding a page that is already there. It reports once, either way; a
     cleanup is not an answer (development's double invoke runs this twice, and only the second
     run is the mark's). */
  useEffect(() => {
    if (!intro) return;
    let answered = false;
    const answer = (played: boolean) => {
      if (answered) return;
      answered = true;
      settledRef.current?.(played);
    };
    const remaining = INTRO_LATEST_START_MS - sinceFirstByte();
    if (motionTier('entrance') !== 'standard' || remaining <= 0) {
      answer(false);
      return;
    }
    const late = window.setTimeout(() => answer(false), remaining);
    void ensure('intro').then((animation) => {
      window.clearTimeout(late);
      if (answered) return;
      if (!animation) return answer(false);
      hostRef.current?.setAttribute('data-shown', '');
      /* The base steps aside once the mark is written (`.logo-intro` in globals.css says why),
         and the splash leaves on the same signal — the player's own completion, not a second
         copy of the duration, which a chunk arriving late would run ahead of. */
      animation.addEventListener('complete', () => {
        rootRef.current?.setAttribute('data-settled', '');
        answer(true);
      });
      animation.goToAndPlay(0, true);
    }).catch(() => {
      window.clearTimeout(late);
      answer(false);
    });
    return () => {
      answered = true;
      window.clearTimeout(late);
    };
  }, [ensure, intro]);

  /* Warm the hover cut on idle — only where a hover can happen. The player is a 60KB chunk and
     the first hover would otherwise wait on the network for it: the one moment the animation
     has to be instant, because the pointer is already there. Chunks only; the player is built
     on the first hover. */
  useEffect(() => {
    if (!interactive || motionTier('ambient') !== 'standard' || !canHover()) return;
    return runWhenIdle(() => void loadTrace('hover').catch(() => {}));
  }, [interactive, tier]);

  const onEnter = useCallback(() => {
    /* Standard only. The trace needs a 60KB player and six layers of trim paths rasterised
       per frame — exactly what the reduced tier's rule names. */
    if (!interactive || motionTier('ambient') !== 'standard') return;
    wantedRef.current = true;
    hostRef.current?.setAttribute('data-shown', '');
    void ensure('hover').then((animation) => {
      // The pointer may have left while the chunk was in flight.
      if (
        animation && animationRef.current?.animation === animation && wantedRef.current &&
        motionTier('ambient') === 'standard'
      ) animation.goToAndPlay(0, true);
    }).catch(() => {
      hostRef.current?.removeAttribute('data-shown');
    });
  }, [ensure, interactive]);

  const onLeave = useCallback(() => {
    wantedRef.current = false;
    hostRef.current?.removeAttribute('data-shown');
  }, []);

  return (
    <span
      ref={rootRef}
      className={cn('relative inline-block', intro && 'logo-intro')}
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
