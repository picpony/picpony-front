'use client';

import { useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { entranceMotion, motionTier } from '@/lib/appearance';
import { isAppPainted } from '@/lib/splash';

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
 * How long to wait before deciding this cold start is slow enough to be worth animating.
 *
 * Two frames at 60Hz plus a little slack. Short enough that a genuinely slow start loses
 * almost nothing off the front of the signature, long enough that a warm start — where the
 * shell paints on the frame after its first commit — has always reported in by the time this
 * fires, so the 60KB player is never requested at all. See the intro effect below.
 */
const INTRO_PROBE_MS = 40;

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
 * Below the standard tier nothing is loaded at all and the base simply stays — the player
 * is a 60KB chunk plus the artwork, warmed speculatively on idle, and a colour reveal is
 * decorative where the mark is legible without it. That is the reduced tier's own rule
 * ("drop the performance … decorative loops, Lottie playback"), and the tier's audience is a
 * device that cannot afford the flight, let alone a speculative fetch for a hover.
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
    /* Standard only, and this one stays that way while the hover trace below does not.
       The splash is on the critical path: a 60KB player chunk fetched before anything else
       is on screen, and `LoadingOverlay` holds the whole app until it reports done. The
       reduced tier's audience is a device that cannot spare either. It is also the one
       animation here whose weak form would be *worse* than nothing — the overlay's own
       short hold would cut the trace off mid-stroke — so the two agree instead: no player,
       static mark, overlay gone in under a second.

       `entranceMotion()` for the same reason the overlay reads it: the splash is the app's
       first entrance, and the two have to answer the question the same way or the overlay
       waits for a draw that never starts. */
    if (!intro || !entranceMotion() || motionTier() !== 'standard') return;
    /* The chunk is only requested if this is actually a slow start.
     *
     * It used to be requested immediately, on the reasoning that the splash is the first
     * thing on screen and cannot afford to warm on idle. That was right while the overlay
     * dismissed on a timer — it was going to be there for ~1.8s regardless, so the animation
     * had time to arrive and play. It is wrong now that the overlay leaves as soon as the app
     * paints (`lib/splash.ts`): on a warm load the mark is gone within a couple of frames, so
     * requesting the player meant downloading 60KB plus a 27KB artwork that nobody would ever
     * see — and downloading it in the one window where it competes with the gallery's own
     * images for bandwidth.
     *
     * So: wait one short beat, and only load if the app still has nothing on screen. A slow
     * start still gets the full signature, over a wait that is genuinely happening. A fast one
     * never pays for it at all.
     */
    let cancelled = false;
    let deadline = 0;
    const probe = window.setTimeout(() => {
      if (cancelled) return;
      if (isAppPainted()) {
        /* Nothing to cover. Report settled so the overlay does not sit on its ceiling
           waiting for a draw that is deliberately never going to start. */
        settledRef.current?.();
        return;
      }
      /* Past the budget the splash gives up: the overlay is told to carry on
         without the animation rather than holding a cold start open for a
         decoration. */
      deadline = window.setTimeout(() => {
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
    }, INTRO_PROBE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(probe);
      window.clearTimeout(deadline);
      animationRef.current?.destroy();
      animationRef.current = null;
    };
  }, [ensure, intro]);

  useEffect(() => {
    if (intro || !interactive || motionTier() !== 'standard') return;
    /* Warm on idle. The player is a 60KB chunk and the first hover would
       otherwise wait on the network for it — which is the one moment the
       animation has to be instant, because the pointer is already there.
       Standard only: below it there is no hover trace to warm for. */
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
    /* Standard only. This was `off` only, on the argument that a hover trace is a response
       to something the pointer just did and plays once — true, and it ignored the cost: the
       trace needs a 60KB player and six layers of trim paths rasterised per frame, which is
       the second most expensive thing in the app and exactly what the reduced tier's rule
       names. Below standard the static mark is the answer. */
    if (intro || !interactive || motionTier() !== 'standard') return;
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
