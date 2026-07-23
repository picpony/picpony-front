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
import {
  getHeroMediaRenderedWidth,
  getHeroMediaResponsiveSizes,
} from '@/lib/hero/geometry';

type DetailImageProps = {
  imageId: number;
  previewSrc?: string;
  finalSrc: string;
  alt: string;
  width: number;
  height: number;
  style: CSSProperties;
  heroActive: boolean;
  onOpen: () => void;
};

function shouldBypassImageOptimization(src: string) {
  const pathname = src.split(/[?#]/, 1)[0].toLowerCase();
  return pathname.endsWith('.gif') || pathname.endsWith('.svg') || pathname.endsWith('.apng');
}

function getPrefetchCandidate(srcSet: string | undefined, fallback: string, width: number, height: number) {
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

  return candidates.find((candidate) => candidate.width >= targetWidth)?.url
    ?? candidates.at(-1)?.url
    ?? fallback;
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
  onOpen,
}: DetailImageProps) {
  const targetRef = useRef<HTMLDivElement>(null);
  const prefetchLinkRef = useRef<HTMLLinkElement | null>(null);
  const sourceRef = useRef({ previewSrc, finalSrc });
  const shouldPrefetchFinal = heroActive;
  const hasPreview = Boolean(previewSrc);
  const mountFinal = !heroActive || !hasPreview;
  const responsiveSizes = getHeroMediaResponsiveSizes({ width, height });

  useLayoutEffect(() => {
    const target = targetRef.current;
    const previous = sourceRef.current;
    if (!target) return;

    if (previous.previewSrc !== previewSrc) {
      target.removeAttribute('data-image-detail-preview-ready');
      target.removeAttribute('data-image-hero-ready');
    }
    if (previous.finalSrc !== finalSrc) {
      target.removeAttribute('data-image-detail-final-ready');
      if (!hasPreview) target.removeAttribute('data-image-hero-ready');
    }
    sourceRef.current = { previewSrc, finalSrc };
  }, [finalSrc, hasPreview, previewSrc]);

  useEffect(() => {
    if (!shouldPrefetchFinal || !finalSrc) return;

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
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.as = 'image';
    link.fetchPriority = 'low';
    link.href = getPrefetchCandidate(props.srcSet, props.src, width, height);
    document.head.appendChild(link);
    prefetchLinkRef.current = link;

    return () => {
      link.remove();
      if (prefetchLinkRef.current === link) prefetchLinkRef.current = null;
    };
  }, [alt, finalSrc, height, responsiveSizes, shouldPrefetchFinal, width]);

  const markFinalDecoded = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    const element = event.currentTarget;
    const loadedSrc = element.currentSrc;
    void (async () => {
      try {
        await element.decode();
      } catch {
        if (!element.complete || element.naturalWidth === 0) return;
      }
      requestAnimationFrame(() => {
        if (!element.isConnected || element.currentSrc !== loadedSrc) return;
        const target = targetRef.current;
        if (!target) return;
        target.setAttribute('data-image-detail-final-ready', 'true');
        if (!hasPreview) target.setAttribute('data-image-hero-ready', 'true');
        prefetchLinkRef.current?.remove();
        prefetchLinkRef.current = null;
      });
    })();
  }, [hasPreview]);

  const markPreviewDecoded = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    if (!previewSrc) return;
    const element = event.currentTarget;
    const loadedSrc = element.currentSrc;
    void (async () => {
      try {
        await element.decode();
      } catch {
        // `load` already guarantees a paintable thumbnail in browsers that do
        // not implement decode reliably for every image format.
        if (!element.complete || element.naturalWidth === 0) return;
      }
      requestAnimationFrame(() => {
        if (!element.isConnected || element.currentSrc !== loadedSrc) return;
        const target = targetRef.current;
        if (!target) return;
        target.setAttribute('data-image-detail-preview-ready', 'true');
        target.setAttribute('data-image-hero-ready', 'true');
      });
    })();
  }, [previewSrc]);

  return (
    <div
      ref={targetRef}
      data-image-hero-role="detail"
      data-image-hero-id={imageId}
      data-image-detail-hero-active={heroActive ? 'true' : 'false'}
      className="group relative flex-none cursor-zoom-in overflow-hidden rounded-lg bg-slate-50 dark:bg-slate-900"
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
          fetchPriority={heroActive ? 'low' : 'high'}
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
          fetchPriority={heroActive ? 'low' : 'high'}
          unoptimized
          onLoad={markPreviewDecoded}
          data-image-detail-layer="preview"
          className="image-detail-preview-native pointer-events-none block h-full w-full object-contain"
        />
      )}
      <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/10">
        <MdFullscreen size={32} className="text-white/0 transition-all group-hover:text-white/70" />
      </div>
    </div>
  );
}
