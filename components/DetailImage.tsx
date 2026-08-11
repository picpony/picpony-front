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
import { warmImageHeroFrame } from '@/lib/hero';

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
  onOpen: () => void;
};

type ImagePrefetchLease = {
  source: string;
  release: () => void;
};

function shouldBypassImageOptimization(src: string) {
  const pathname = src.split(/[?#]/, 1)[0].toLowerCase();
  return pathname.endsWith('.gif') || pathname.endsWith('.svg') || pathname.endsWith('.apng');
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
  onOpen,
}: DetailImageProps) {
  const targetRef = useRef<HTMLDivElement>(null);
  const prefetchLeaseRef = useRef<ImagePrefetchLease | null>(null);
  const sourceRef = useRef({ previewSrc, finalSrc });
  const surfaceIdRef = useRef(surfaceId);
  const onPreviewReadyRef = useRef(onPreviewReady);
  const onFinalReadyRef = useRef(onFinalReady);
  const previewReadyRef = useRef(false);
  const finalReadyRef = useRef(false);
  const publishedPreviewSurfaceRef = useRef<string | null>(null);
  const publishedFinalSurfaceRef = useRef<string | null>(null);
  const hasPreview = Boolean(previewSrc);
  // Always keep a stable preview on top while heroActive. Optionally preload
  // final underneath so clearing heroActive is only a CSS swap (no mount jank).
  const mountFinal = Boolean(finalSrc) && (!heroActive || !hasPreview || preloadFinal);
  const responsiveSizes = getHeroMediaResponsiveSizes({ width, height });

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

  const markPreviewReady = useCallback(() => {
    previewReadyRef.current = true;
    publishPreviewReady();
  }, [publishPreviewReady]);

  const markFinalReady = useCallback(() => {
    const target = targetRef.current;
    if (!target) return;
    finalReadyRef.current = true;
    target.setAttribute('data-image-detail-final-ready', 'true');
    publishFinalReady();
    if (!sourceRef.current.previewSrc) markPreviewReady();
  }, [markPreviewReady, publishFinalReady]);

  useLayoutEffect(() => {
    const target = targetRef.current;
    const previous = sourceRef.current;
    if (!target) return;

    if (previous.previewSrc !== previewSrc) {
      previewReadyRef.current = false;
      publishedPreviewSurfaceRef.current = null;
    }
    if (previous.finalSrc !== finalSrc) {
      finalReadyRef.current = false;
      publishedFinalSurfaceRef.current = null;
      target.removeAttribute('data-image-detail-final-ready');
      if (!previewSrc) {
        previewReadyRef.current = false;
        publishedPreviewSurfaceRef.current = null;
      }
    }
    sourceRef.current = { previewSrc, finalSrc };
    if (!previewSrc && finalReadyRef.current) previewReadyRef.current = true;
  }, [finalSrc, previewSrc]);

  useLayoutEffect(() => {
    if (mountFinal) return;
    finalReadyRef.current = false;
    publishedFinalSurfaceRef.current = null;
    targetRef.current?.removeAttribute('data-image-detail-final-ready');
  }, [mountFinal]);

  useLayoutEffect(() => {
    onPreviewReadyRef.current = onPreviewReady;
    onFinalReadyRef.current = onFinalReady;
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
        icon={<MdFullscreen size={22} />}
        aria-label="放大查看原图"
        /* Stops the press reaching the media box's own handler underneath, which
           would open the lightbox a second time in the same tick. */
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
        className="absolute right-3 bottom-3 z-30 cursor-zoom-in opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
      />
    </div>
  );
}
