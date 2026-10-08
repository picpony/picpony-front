'use client';

import Image, { getImageProps } from 'next/image';
import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type SyntheticEvent,
} from 'react';
import { MdFullscreen, MdRefresh } from 'react-icons/md';
import IconButton from './IconButton';
import Skeleton from './Skeleton';
import ErrorRetry from './ErrorRetry';
import { getHeroMediaRenderedWidth, getHeroMediaResponsiveSizes } from '@/lib/hero/geometry';
import { HERO_PREVIEW_FALLBACK_MS } from '@/lib/hero/constants';
import {
  getRawImageUrl,
  OPTIMIZER_ACTIVE,
  resolveNextAttempt,
  type ImageTier,
  type LoadAttempt,
} from '@/lib/imageLoader';
import { IMAGE_CDN_BASE, IMAGE_WORKER_BASE } from '@/lib/constants';
import { DURATION } from '@/lib/motionTokens';
import { MOTION_SPEED_SCALE } from '@/lib/appearance';
import { warmImageHeroFrame } from '@/lib/hero';
import { cn } from '@/lib/utils';

type DetailMediaTargetCallback = (surfaceId: string, target: HTMLDivElement | null) => void;

type DetailMediaReadyCallback = (surfaceId: string, target: HTMLDivElement) => void;

type DetailImageProps = {
  imageId: number;
  previewSrc?: string;
  finalSrc: string;
  alt: string;
  width: number;
  height: number;
  style: CSSProperties;
  /** Preview stays on top until swap (heroActive true). */
  heroActive: boolean;
  /**
   * Mount the full-resolution layer under the preview while still heroActive.
   * Lets decode finish without a mid-scroll mount when preview is cleared.
   */
  preloadFinal?: boolean;
  surfaceId?: string;
  onTargetChange?: DetailMediaTargetCallback;
  onPreviewReady?: DetailMediaReadyCallback;
  onFinalReady?: DetailMediaReadyCallback;
  /** The preview will never paint. Lets the route drop `heroActive` and show the final. */
  onPreviewFailed?: (surfaceId: string) => void;
  /** Neither layer will ever paint. The terminal answer the handoff waits for. */
  onMediaUnavailable?: (surfaceId: string) => void;
  onOpen: () => void;
  /**
   * The picture's translation (the one-click image translation), laid over the original while
   * `showTranslation` holds. It cross-fades in once decoded, and while it is shown it is the
   * layer the hero flies home, since it is what the reader is looking at.
   */
  translationSrc?: string | null;
  showTranslation?: boolean;
  /** The translated picture could not be shown. */
  onTranslationError?: () => void;
};

type ImagePrefetchLease = {
  source: string;
  release: () => void;
};

/**
 * Derpibooru's own derivatives: `large`, `medium`, `small`, the thumbs. These are already
 * size-appropriate files off a CDN, which is what makes running them through `/_next/image` a pure
 * loss — see `shouldBypassImageOptimization`.
 *
 * Matched on the *raw* URL, because the image line may have wrapped it in a proxy's `?url=`.
 */
const CDN_DERIVATIVE = /\/(?:large|medium|small|tall|thumb|thumb_small|thumb_tiny)\.[a-z0-9]+$/;

/**
 * **The detail's picture is served as-is, not re-encoded — this is the fix for the
 * blur.** The source is already one of Derpibooru's CDN derivatives, sized for
 * exactly this job; running it through `/_next/image` at `q=82` measurably destroys
 * it (a real picture, at identical pixel dimensions: 373KB source → 171KB re-encoded)
 * and costs 3–4 seconds of server CPU per variant. That is why the report was
 * "production is soft, dev is completely fine": dev skips the optimizer. The bytes
 * given up are the right way round — the picture *is* the content — and gallery
 * cards keep the optimizer, where a small card from a large source is a real saving.
 */
function shouldBypassImageOptimization(src: string) {
  const raw = getRawImageUrl(src);
  /* A URL the image line has wrapped is the line's to deliver, never the optimizer's:
     `remotePatterns` admits only the raw hosts, so `/_next/image` answers it with a 400. It
     reaches here only for a record with no `large`/`medium` rendition — the `full` / `view_url`
     fallback, the one detail source that is not a derivative. */
  if (raw !== src) return true;
  const pathname = raw.split(/[?#]/, 1)[0].toLowerCase();
  if (pathname.endsWith('.gif') || pathname.endsWith('.svg') || pathname.endsWith('.apng')) {
    return true;
  }
  return CDN_DERIVATIVE.test(pathname);
}

/** The line a URL is already on: the worker's, the CDN's, or none (direct). */
function tierOf(src: string): ImageTier {
  if (src.startsWith(IMAGE_WORKER_BASE)) return 0;
  if (src.startsWith(IMAGE_CDN_BASE)) return 1;
  return 2;
}

/**
 * The final layer's first attempt is the URL it was handed, exactly — the one the prefetch lease
 * warmed and the one the hero expects — and only a failure walks the image-line ladder from it
 * (`lib/imageLoader.ts`): the line's own retry, then the next line, then direct with a backoff.
 */
function firstAttempt(src: string): LoadAttempt {
  return {
    url: src,
    optimized: OPTIMIZER_ACTIVE && !shouldBypassImageOptimization(src),
    tier: tierOf(src),
    retries: 0,
    giveUp: false,
    delayMs: 0,
  };
}

interface FinalLadder {
  src: string;
  attempt: LoadAttempt;
  /** The attempt on screen — behind `attempt` only while a backoff runs. */
  shown: LoadAttempt;
  /** Bumped to re-issue the shown attempt (a retry, the network coming back). */
  generation: number;
}

function freshLadder(src: string, generation = 0): FinalLadder {
  const attempt = firstAttempt(src);
  return { src, attempt, shown: attempt, generation };
}

function getPrefetchCandidate(
  srcSet: string | undefined,
  fallback: string,
  width: number,
  height: number,
) {
  if (!srcSet || typeof window === 'undefined') return fallback;

  const renderedWidth = getHeroMediaRenderedWidth(
    { width, height },
    { width: window.innerWidth, height: window.innerHeight },
  );
  const targetWidth = renderedWidth * Math.max(1, window.devicePixelRatio || 1);
  const candidates = srcSet
    .split(',')
    .map((candidate) => {
      const match = candidate.trim().match(/^(.*)\s+(\d+)w$/);
      return match ? { url: match[1], width: Number(match[2]) } : null;
    })
    .filter((candidate): candidate is { url: string; width: number } => Boolean(candidate))
    .sort((a, b) => a.width - b.width);

  return (
    candidates.find((candidate) => candidate.width >= targetWidth)?.url ??
    candidates.at(-1)?.url ??
    fallback
  );
}

function createImagePrefetchLease(source: string, href: string): ImagePrefetchLease {
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.as = 'image';
  link.fetchPriority = 'low';
  link.href = href;
  document.head.appendChild(link);

  let released = false;
  return {
    source,
    release() {
      if (released) return;
      released = true;
      link.remove();
    },
  };
}

/** Decoded and on screen: `complete` alone is also true for an image that failed. */
function decodedIn(element: HTMLImageElement) {
  return element.complete && element.naturalWidth > 0;
}

export default function DetailImage({
  imageId,
  previewSrc,
  finalSrc,
  alt,
  width,
  height,
  style,
  heroActive,
  preloadFinal = false,
  surfaceId,
  onTargetChange,
  onPreviewReady,
  onFinalReady,
  onPreviewFailed,
  onMediaUnavailable,
  onOpen,
  translationSrc = null,
  showTranslation = false,
  onTranslationError,
}: DetailImageProps) {
  const targetRef = useRef<HTMLDivElement>(null);
  const prefetchLeaseRef = useRef<ImagePrefetchLease | null>(null);
  const sourceRef = useRef({ previewSrc, finalSrc });
  const surfaceIdRef = useRef(surfaceId);
  const onPreviewReadyRef = useRef(onPreviewReady);
  const onFinalReadyRef = useRef(onFinalReady);
  const onPreviewFailedRef = useRef(onPreviewFailed);
  const onMediaUnavailableRef = useRef(onMediaUnavailable);
  const previewReadyRef = useRef(false);
  const finalReadyRef = useRef(false);
  const previewFailedRef = useRef(false);
  const finalFailedRef = useRef(false);
  const previewFallbackRef = useRef<number | null>(null);
  const publishedPreviewSurfaceRef = useRef<string | null>(null);
  const publishedFinalSurfaceRef = useRef<string | null>(null);
  const hasPreview = Boolean(previewSrc);
  // Always keep a stable preview on top while heroActive. Optionally preload
  // final underneath so clearing heroActive is only a CSS swap (no mount jank).
  const mountFinal = Boolean(finalSrc) && (!heroActive || !hasPreview || preloadFinal);
  const responsiveSizes = getHeroMediaResponsiveSizes({ width, height });

  /* The final layer's ladder, reset when the picture changes (during render, so a new picture
     never paints a frame with the previous one's attempt). */
  const [ladder, setLadder] = useState<FinalLadder>(() => freshLadder(finalSrc));
  const current = ladder.src === finalSrc ? ladder : freshLadder(finalSrc);
  if (ladder.src !== finalSrc) setLadder(current);
  const finalGivenUp = current.attempt.giveUp;
  /* A failure while the device is offline says nothing about the picture: the attempt is held
     and re-issued when the connection returns, instead of walking the ladder into the plate. */
  const [heldOffline, setHeldOffline] = useState(false);

  /* Whether anything is on screen yet — the placeholder shimmers until then, and leaves one
     fade later (the wall-clock rule: a timer bounding a motion takes the slowest speed). */
  const [painted, setPainted] = useState<{ src: string; at: 'preview' | 'final' } | null>(null);
  const isPainted = painted?.src === finalSrc;
  const [placeholderGone, setPlaceholderGone] = useState<string | null>(null);
  useEffect(() => {
    if (!isPainted) return;
    const timer = window.setTimeout(
      () => startTransition(() => setPlaceholderGone(finalSrc)),
      DURATION.short * 1000 * MOTION_SPEED_SCALE.slow,
    );
    return () => window.clearTimeout(timer);
  }, [finalSrc, isPainted]);
  const showPlaceholder = placeholderGone !== finalSrc && !finalGivenUp;

  /* The translation layer: decoded before it is shown, so the swap is a fade, not a load. */
  const [translationDecoded, setTranslationDecoded] = useState<string | null>(null);
  const translationVisible = Boolean(
    translationSrc && showTranslation && translationDecoded === translationSrc,
  );
  /* The original stands down once the translation has faded in over it — not before, or the fade
     would dip to the empty box, and not never, or a translation with transparent parts would show
     the original through them. Going back, it is there at once, under the fade out. The timer
     bounds the fade at the slowest speed (the wall-clock rule). */
  const [coveredBy, setCoveredBy] = useState<string | null>(null);
  useEffect(() => {
    if (!translationVisible || !translationSrc) return;
    const timer = window.setTimeout(
      () => setCoveredBy(translationSrc),
      DURATION.short * 1000 * MOTION_SPEED_SCALE.slow,
    );
    return () => window.clearTimeout(timer);
  }, [translationSrc, translationVisible]);
  const originalCovered = translationVisible && coveredBy === translationSrc;

  /* The preview layer needs no resolution ladder of its own. It paints the bitmap
     the gallery card already decoded — instant, and soft, because that bitmap was
     picked for a small slot — or, on a direct load, the record's thumbnail, and the
     final layer arrives as the CDN's own file in one hop. */

  const publishPreviewReady = useCallback(() => {
    const readySurfaceId = surfaceIdRef.current;
    const target = targetRef.current;
    const callback = onPreviewReadyRef.current;
    if (
      !readySurfaceId ||
      !target ||
      !callback ||
      publishedPreviewSurfaceRef.current === readySurfaceId
    ) {
      return;
    }
    publishedPreviewSurfaceRef.current = readySurfaceId;
    callback(readySurfaceId, target);
  }, []);

  const publishFinalReady = useCallback(() => {
    const readySurfaceId = surfaceIdRef.current;
    const target = targetRef.current;
    const callback = onFinalReadyRef.current;
    if (
      !readySurfaceId ||
      !target ||
      !callback ||
      publishedFinalSurfaceRef.current === readySurfaceId
    ) {
      return;
    }
    publishedFinalSurfaceRef.current = readySurfaceId;
    callback(readySurfaceId, target);
  }, []);

  const clearPreviewFallback = useCallback(() => {
    if (previewFallbackRef.current === null) return;
    window.clearTimeout(previewFallbackRef.current);
    previewFallbackRef.current = null;
  }, []);

  const markPreviewReady = useCallback(() => {
    clearPreviewFallback();
    previewReadyRef.current = true;
    publishPreviewReady();
  }, [clearPreviewFallback, publishPreviewReady]);

  /**
   * The preview will never paint: it errored, or it went quiet past the grace
   * timer. The route is told first so `heroActive` drops and the CSS swap puts the
   * *final* layer on top; then paintability is published — or, if neither layer
   * will ever paint, the terminal answer the flight waits for goes out instead.
   *
   * **The order is the call order and nothing stronger.** `onPreviewFailed`
   * schedules a React state update while `markPreviewReady()` publishes
   * synchronously, so the controller can learn the preview is paintable in the
   * same task, while the hero-active flag is still set and the final layer is
   * still transparent. Guaranteeing the order would mean waiting for the flag to
   * land before publishing — another round trip on the failure path. Against a
   * 30-second hang, one possibly blank frame is the trade taken here.
   */
  const markPreviewFailed = useCallback(() => {
    clearPreviewFallback();
    if (previewFailedRef.current) return;
    previewFailedRef.current = true;
    const failedSurfaceId = surfaceIdRef.current;
    if (failedSurfaceId) onPreviewFailedRef.current?.(failedSurfaceId);
    if (finalReadyRef.current) markPreviewReady();
    else if (finalFailedRef.current && failedSurfaceId) {
      onMediaUnavailableRef.current?.(failedSurfaceId);
    }
  }, [clearPreviewFallback, markPreviewReady]);

  /** Every line has failed. A paintable preview is still a handoff target, so only escalate
   *  when there is none. */
  const markFinalFailed = useCallback(() => {
    finalFailedRef.current = true;
    const failedSurfaceId = surfaceIdRef.current;
    if (!failedSurfaceId || previewReadyRef.current) return;
    onMediaUnavailableRef.current?.(failedSurfaceId);
  }, []);

  const markFinalReady = useCallback(() => {
    const target = targetRef.current;
    if (!target) return;
    finalReadyRef.current = true;
    target.setAttribute('data-image-detail-final-ready', 'true');
    publishFinalReady();
    /* A decoded final is enough on its own when there is no preview to wait for, or
       when the one there was has already failed. Otherwise it starts the grace
       timer — gated on both, or a dead preview holds the flight for the full
       timeout while the picture sits decoded underneath it. */
    if (!sourceRef.current.previewSrc || previewFailedRef.current) {
      markPreviewReady();
      return;
    }
    if (previewReadyRef.current || previewFallbackRef.current !== null) return;
    previewFallbackRef.current = window.setTimeout(markPreviewFailed, HERO_PREVIEW_FALLBACK_MS);
  }, [markPreviewFailed, markPreviewReady, publishFinalReady]);

  useEffect(() => clearPreviewFallback, [clearPreviewFallback]);

  useLayoutEffect(() => {
    const target = targetRef.current;
    const previous = sourceRef.current;
    if (!target) return;

    if (previous.previewSrc !== previewSrc) {
      previewReadyRef.current = false;
      previewFailedRef.current = false;
      clearPreviewFallback();
      publishedPreviewSurfaceRef.current = null;
    }
    if (previous.finalSrc !== finalSrc) {
      finalReadyRef.current = false;
      finalFailedRef.current = false;
      publishedFinalSurfaceRef.current = null;
      target.removeAttribute('data-image-detail-final-ready');
      if (!previewSrc) {
        previewReadyRef.current = false;
        publishedPreviewSurfaceRef.current = null;
      }
    }
    sourceRef.current = { previewSrc, finalSrc };
    if (!previewSrc && finalReadyRef.current) previewReadyRef.current = true;
  }, [clearPreviewFallback, finalSrc, previewSrc]);

  useLayoutEffect(() => {
    if (mountFinal) return;
    finalReadyRef.current = false;
    publishedFinalSurfaceRef.current = null;
    targetRef.current?.removeAttribute('data-image-detail-final-ready');
  }, [mountFinal]);

  useLayoutEffect(() => {
    onPreviewReadyRef.current = onPreviewReady;
    onFinalReadyRef.current = onFinalReady;
    onPreviewFailedRef.current = onPreviewFailed;
    onMediaUnavailableRef.current = onMediaUnavailable;
    surfaceIdRef.current = surfaceId;
    if (!surfaceId) {
      publishedPreviewSurfaceRef.current = null;
      publishedFinalSurfaceRef.current = null;
      return;
    }
    if (previewReadyRef.current) publishPreviewReady();
    if (finalReadyRef.current) publishFinalReady();
  }, [
    finalSrc,
    onFinalReady,
    onMediaUnavailable,
    onPreviewFailed,
    onPreviewReady,
    previewSrc,
    publishFinalReady,
    publishPreviewReady,
    surfaceId,
  ]);

  useLayoutEffect(() => {
    if (!surfaceId || !onTargetChange) return;
    onTargetChange(surfaceId, targetRef.current);
    return () => onTargetChange(surfaceId, null);
  }, [onTargetChange, surfaceId]);

  useEffect(() => {
    if (heroActive || !finalReadyRef.current) return;
    // Capture a static final frame away from the close intent. GIF/APNG media
    // is intentionally ignored by the warmer and is captured live on return.
    return warmImageHeroFrame(targetRef.current);
  }, [finalSrc, heroActive]);

  useEffect(() => {
    if ((!heroActive && !preloadFinal) || !finalSrc || mountFinal) return;

    const { props } = getImageProps({
      src: finalSrc,
      alt,
      width: Math.max(1, width),
      height: Math.max(1, height),
      sizes: responsiveSizes,
      quality: 82,
      loading: 'eager',
      unoptimized: shouldBypassImageOptimization(finalSrc),
    });
    const lease = createImagePrefetchLease(
      finalSrc,
      getPrefetchCandidate(props.srcSet, props.src, width, height),
    );
    prefetchLeaseRef.current = lease;

    return () => {
      lease.release();
      if (prefetchLeaseRef.current === lease) prefetchLeaseRef.current = null;
    };
  }, [alt, finalSrc, height, heroActive, mountFinal, preloadFinal, responsiveSizes, width]);

  /* The backoff: the next attempt goes on screen once its wait has passed. */
  useEffect(() => {
    const { attempt, shown } = current;
    if (attempt === shown || attempt.giveUp) return;
    const timer = window.setTimeout(() => {
      setLadder((state) => (state.src === finalSrc && state.attempt === attempt ? { ...state, shown: attempt } : state));
    }, attempt.delayMs);
    return () => window.clearTimeout(timer);
  }, [current, finalSrc]);

  /* Every rung spent: the flight (if any) hears it once, and the box shows why. */
  useEffect(() => {
    if (finalGivenUp) markFinalFailed();
  }, [finalGivenUp, markFinalFailed]);

  /* Offline: re-issue the held attempt, or start over after a give-up, when the network is back. */
  useEffect(() => {
    if (!heldOffline && !finalGivenUp) return;
    const onOnline = () => {
      setHeldOffline(false);
      finalFailedRef.current = false;
      setLadder((state) => (state.attempt.giveUp ? freshLadder(state.src, state.generation + 1) : { ...state, generation: state.generation + 1 }));
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [finalGivenUp, heldOffline]);

  const handleFinalError = useCallback(() => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setHeldOffline(true);
      return;
    }
    setLadder((state) => {
      if (state.src !== finalSrc || state.attempt !== state.shown || state.attempt.giveUp) return state;
      const next = resolveNextAttempt(getRawImageUrl(state.src), state.attempt);
      return { ...state, attempt: next, shown: next.delayMs > 0 && !next.giveUp ? state.shown : next };
    });
  }, [finalSrc]);

  const retryFinal = useCallback(() => {
    finalFailedRef.current = false;
    setLadder((state) => freshLadder(state.src, state.generation + 1));
  }, []);

  const markFinalDecoded = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      const element = event.currentTarget;
      const loadedSrc = element.currentSrc;
      void (async () => {
        try {
          await element.decode();
        } catch {
          if (!decodedIn(element)) return;
        }
        requestAnimationFrame(() => {
          if (
            sourceRef.current.finalSrc !== finalSrc ||
            !element.isConnected ||
            element.currentSrc !== loadedSrc
          )
            return;
          const lease = prefetchLeaseRef.current;
          if (lease?.source === finalSrc) {
            prefetchLeaseRef.current = null;
            lease.release();
          }
          markFinalReady();
          setPainted({ src: finalSrc, at: 'final' });
        });
      })();
    },
    [finalSrc, markFinalReady],
  );

  const markPreviewDecoded = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      if (!previewSrc) return;
      const element = event.currentTarget;
      const loadedSrc = element.currentSrc;
      void (async () => {
        try {
          await element.decode();
        } catch {
          if (!decodedIn(element)) return;
        }
        requestAnimationFrame(() => {
          if (
            sourceRef.current.previewSrc !== previewSrc ||
            !element.isConnected ||
            element.currentSrc !== loadedSrc
          )
            return;
          markPreviewReady();
          setPainted((state) => (state?.src === finalSrc ? state : { src: finalSrc, at: 'preview' }));
        });
      })();
    },
    [finalSrc, markPreviewReady, previewSrc],
  );

  const markTranslationDecoded = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      const element = event.currentTarget;
      const loadedSrc = translationSrc;
      void element
        .decode()
        .catch(() => undefined)
        .then(() => {
          if (!loadedSrc || !element.isConnected || !decodedIn(element)) return;
          setTranslationDecoded(loadedSrc);
        });
    },
    [translationSrc],
  );

  const failedWithNothing = finalGivenUp && !isPainted;
  /* The shown attempt, keyed so a retry is a fresh element: `next/image` re-fires a lost error on
     its own element, but a new URL on the same element keeps the old one's load state. */
  const shown = current.shown;

  return (
    <div
      ref={targetRef}
      data-image-hero-role="detail"
      data-image-hero-id={imageId}
      data-image-detail-hero-active={heroActive ? 'true' : 'false'}
      className={cn(
        'group relative flex-none overflow-hidden rounded-lg bg-surface-container-low',
        failedWithNothing ? 'cursor-default' : 'cursor-zoom-in',
      )}
      style={style}
      onClick={failedWithNothing ? undefined : onOpen}
    >
      {showPlaceholder && (
        /* The destination's own shape while nothing is on screen — the box is already at the
           picture's aspect ratio — rather than a flat plate that pops into a picture. */
        <Skeleton aria-hidden="true" className="absolute inset-0 rounded-lg" />
      )}
      {finalSrc && mountFinal && !finalGivenUp && (
        <Image
          key={`${current.generation}:${shown.url}`}
          src={shown.url}
          alt={alt}
          width={Math.max(1, width)}
          height={Math.max(1, height)}
          sizes={responsiveSizes}
          quality={82}
          loading="eager"
          // A confirmed detail route owns the final image request even while
          // its preview is still the visual authority. Deferring this behind
          // input activity made a held touch/wheel appear to stop loading.
          fetchPriority="high"
          unoptimized={!shown.optimized}
          onLoad={markFinalDecoded}
          /* `next/image` re-assigns `src` to itself so a lost error re-fires; this is what
             walks the ladder, so a final that 404s on one line is asked for on the next. */
          onError={handleFinalError}
          data-image-detail-layer={translationVisible ? 'original' : 'final'}
          style={originalCovered ? { opacity: 0 } : undefined}
          className={cn(
            'image-detail-final pointer-events-none absolute inset-0 z-0 block h-full w-full object-contain',
            /* With nothing under it but the placeholder, the final fades in; over a preview it
               appears at once and the preview fades out above it, so no frame shows neither. */
            !previewSrc && 'transition-opacity spring-default-effects',
          )}
        />
      )}
      {previewSrc && (
        <Image
          src={previewSrc}
          alt=""
          aria-hidden="true"
          width={Math.max(1, width)}
          height={Math.max(1, height)}
          loading="eager"
          fetchPriority="high"
          unoptimized
          onLoad={markPreviewDecoded}
          onError={markPreviewFailed}
          data-image-detail-layer="preview"
          style={originalCovered ? { opacity: 0 } : undefined}
          // Absolute so preloading final never shifts the box.
          className="image-detail-preview-native pointer-events-none absolute inset-0 z-10 block h-full w-full object-contain transition-opacity spring-fast-effects"
        />
      )}
      {translationSrc && (
        /* After the preview in the tree, so at the same layer it paints above it. A plain image:
           the translation service's own host, delivered as it is — neither a Derpibooru
           rendition nor on an image line, so there is nothing for the optimizer to do. */
        /* eslint-disable-next-line @next/next/no-img-element -- see above */
        <img
          src={translationSrc}
          alt={translationVisible ? `${alt}（译图）` : ''}
          aria-hidden={translationVisible ? undefined : true}
          decoding="async"
          onLoad={markTranslationDecoded}
          onError={onTranslationError}
          data-image-detail-layer={translationVisible ? 'final' : 'translation'}
          className="pointer-events-none absolute inset-0 z-10 block h-full w-full object-contain transition-opacity spring-default-effects"
          style={{ opacity: translationVisible ? 1 : 0 }}
        />
      )}
      {failedWithNothing && (
        <div className="absolute inset-0 z-20 flex items-center justify-center overflow-hidden">
          <ErrorRetry size="inline" title="图片加载失败" onRetry={retryFinal} />
        </div>
      )}
      {/* Hover veil, and nothing else — `pointer-events-none` so it never eats
          the press the media box below it is listening for. */}
      {!failedWithNothing && <div className="media-hover-scrim pointer-events-none absolute inset-0 z-20" />}
      {finalGivenUp && isPainted && (
        /* The full-size file failed on every line, but a softer version is on screen: say so,
           and offer it again, without taking the picture away. */
        <IconButton
          variant="media"
          icon={<MdRefresh />}
          aria-label="原图加载失败，重新加载"
          onClick={(event) => {
            event.stopPropagation();
            retryFinal();
          }}
          className="absolute bottom-3 left-3 z-30"
        />
      )}
      {/* The zoom affordance is a real control on the media plate, in the corner
          rather than over the picture, present on compact and touch screens and
          hover-revealed on desktop — the same rule the gallery captions follow. The box click
          stays as a pointer convenience; this button is what makes the action
          reachable from a keyboard (and present on touch, where there is no
          hover). */}
      {!failedWithNothing && (
        <IconButton
          variant="media"
          icon={<MdFullscreen />}
          aria-label="放大查看原图"
          /* Stops the press reaching the media box's own handler underneath, which
             would open the lightbox a second time in the same tick. */
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          /* Hidden for the length of a hero flight — see the rule in globals.css. On touch
             this control stays visible, and `HeroStage`'s
             landing target renders no children at all, so on a phone the handoff frame was
             conjuring a 40dp button into the picture's corner out of nothing. */
          data-image-detail-zoom
          className="hover-reveal absolute right-3 bottom-3 z-30 cursor-zoom-in"
        />
      )}
    </div>
  );
}
