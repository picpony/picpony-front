'use client';

import Image, { getImageProps } from 'next/image';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type SyntheticEvent,
} from 'react';
import { MdFullscreen } from 'react-icons/md';
import IconButton from './IconButton';
import { getHeroMediaRenderedWidth, getHeroMediaResponsiveSizes } from '@/lib/hero/geometry';
import { HERO_PREVIEW_FALLBACK_MS } from '@/lib/hero/constants';
import { getRawImageUrl } from '@/lib/imageLoader';
import { warmImageHeroFrame } from '@/lib/hero';
import { ICON } from '@/lib/icons';

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
 * **The detail's picture is served as-is, not re-encoded, and this is the fix for the blur.**
 *
 * `.gif` / `.svg` / `.apng` were here because the optimizer mangles them. The larger case is
 * everything else: the source is already one of Derpibooru's derivatives, sized for exactly this
 * job, and putting it through `/_next/image` at `q=82` measurably destroys it. For one real
 * picture, at **identical pixel dimensions** — the optimizer clamps to the source, so `w=1920` and
 * `w=3840` return the same image:
 *
 *     source large.jpg      373,365 bytes
 *     /_next/image q=82     170,826 bytes   (46%)
 *     /_next/image q=88     217,511 bytes   (58%)
 *
 * Less than half the bytes for the same resolution, on a detailed photograph. That is why the
 * report was "production is soft, dev is completely fine": `next.config.ts` sets
 * `images.unoptimized` in development, so dev has always been showing the untouched file. Nothing
 * about the flight or its timing was ever involved — resolution was not the problem either, since
 * `sizes` resolves to 944px and the srcset offers 1920.
 *
 * It also costs **3–4 seconds of this server's CPU** per variant, measured, which is the latency
 * the picture used to take to sharpen.
 *
 * What it gives up is bytes: 373KB instead of 171KB for an opened picture. That is the right way
 * round — the picture *is* the content here, and it now arrives in one hop from a CDN instead of
 * waiting on our own re-encode. The gallery cards keep the optimizer, where it earns its place:
 * a 308px card from a 1280px source is a real saving.
 */
function shouldBypassImageOptimization(src: string) {
  const pathname = getRawImageUrl(src).split(/[?#]/, 1)[0].toLowerCase();
  if (pathname.endsWith('.gif') || pathname.endsWith('.svg') || pathname.endsWith('.apng')) {
    return true;
  }
  return CDN_DERIVATIVE.test(pathname);
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

  /* The preview layer needs no resolution ladder of its own. It paints the bitmap the gallery card
     already decoded — instant, and soft, because that bitmap was picked for a ~300px slot — and the
     final layer above now arrives as the CDN's own file in one hop rather than waiting on a local
     re-encode, so there is nothing left for a middle rung to be faster than. One was built and
     removed: it asked the optimizer for an in-between variant, which is the very thing that was
     making the picture soft in the first place. */

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
   * The preview will never paint: it errored, or it went quiet past the grace above.
   *
   * Two things follow. The route is told first so `heroActive` drops and the CSS swap puts the
   * *final* layer on top — the same path `revealedHeroSeedAt` takes on a normal open — and then
   * paintability is published. If neither layer will ever paint, that is the terminal answer the
   * flight is waiting for and it goes out instead.
   *
   * **The order is the call order and nothing stronger, which is worth stating rather than
   * implying.** `onPreviewFailed` schedules a React state update while `markPreviewReady()`
   * publishes synchronously, so the controller can learn the preview is paintable in the same
   * task, while `data-image-detail-hero-active` is still `'true'` and the final layer is still at
   * `opacity: 0`. The handoff frame is an rAF later, which is usually enough and is not
   * guaranteed to be. Making it a guarantee means waiting for the flag to land before publishing,
   * i.e. another round trip on the failure path — against a 30-second hang, one possibly blank
   * frame is the trade taken here.
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

  /** A paintable preview is still a handoff target, so only escalate when there is none. */
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
    /* A decoded final is enough on its own when there is no preview to wait for, or when
       the one there was has already failed. Otherwise it starts the grace — this used to
       be `if (!previewSrc)` and nothing else, which is what let a 404'd preview hold the
       flight for the full `HERO_DETAIL_ROUTE_TIMEOUT_MS` while the picture the user asked
       for sat decoded underneath it. */
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

  const markFinalDecoded = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      const element = event.currentTarget;
      const loadedSrc = element.currentSrc;
      void (async () => {
        try {
          await element.decode();
        } catch {
          if (!element.complete || element.naturalWidth === 0) return;
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
          if (!element.complete || element.naturalWidth === 0) return;
        }
        requestAnimationFrame(() => {
          if (
            sourceRef.current.previewSrc !== previewSrc ||
            !element.isConnected ||
            element.currentSrc !== loadedSrc
          )
            return;
          markPreviewReady();
        });
      })();
    },
    [markPreviewReady, previewSrc],
  );

  return (
    <div
      ref={targetRef}
      data-image-hero-role="detail"
      data-image-hero-id={imageId}
      data-image-detail-hero-active={heroActive ? 'true' : 'false'}
      className="group relative flex-none cursor-zoom-in overflow-hidden rounded-lg bg-surface-container-low"
      style={style}
      onClick={onOpen}
    >
      {finalSrc && mountFinal && (
        <Image
          src={finalSrc}
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
          unoptimized={shouldBypassImageOptimization(finalSrc)}
          onLoad={markFinalDecoded}
          /* `next/image` re-assigns `src` to itself so a lost error re-fires, and there
             was nothing here to receive it — so a final that 404s was indistinguishable
             from one still in flight. */
          onError={markFinalFailed}
          data-image-detail-layer="final"
          className="image-detail-final pointer-events-none absolute inset-0 z-0 block h-full w-full object-contain"
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
          // Absolute so preloading final never shifts the box.
          className="image-detail-preview-native pointer-events-none absolute inset-0 z-10 block h-full w-full object-contain"
        />
      )}
      {/* Hover veil, and nothing else — `pointer-events-none` so it never eats
          the press the media box below it is listening for. */}
      <div className="media-hover-scrim pointer-events-none absolute inset-0 z-20" />
      {/* The zoom affordance was a 32px glyph dead-centre over the subject,
          revealed on `group-hover` — so on a touch device, where there is no
          hover, the primary action of this screen had no affordance at all. And
          the press target was the `<div onClick>` above: not focusable, no key
          handler, so the screen's main action could not be reached from a
          keyboard.

          It is now a real control on the media plate, in the corner rather than
          over the picture, present by default and hover-revealed from `sm` up —
          the same rule the gallery tiles' captions follow. The box click stays as
          a pointer convenience; this button is what makes it reachable. */}
      <IconButton
        variant="media"
        icon={<MdFullscreen size={ICON.standard} />}
        aria-label="放大查看原图"
        /* Stops the press reaching the media box's own handler underneath, which
           would open the lightbox a second time in the same tick. */
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
        /* Hidden for the length of a hero flight — see the rule in globals.css. Below `sm`
           this control is `opacity-100` rather than hover-revealed, and `HeroStage`'s
           landing target renders no children at all, so on a phone the handoff frame was
           conjuring a 40dp button into the picture's corner out of nothing. */
        data-image-detail-zoom
        className="absolute right-3 bottom-3 z-30 cursor-zoom-in opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
      />
    </div>
  );
}
