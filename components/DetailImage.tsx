'use client';

import Image, { getImageProps } from 'next/image';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type SyntheticEvent,
} from 'react';
import { MdFullscreen } from 'react-icons/md';
import HeroFrame from '@/components/HeroFrame';

type DetailImageProps = {
  imageId: number;
  previewSrc?: string;
  previewFrame?: HTMLCanvasElement | null;
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

  const aspectRatio = Math.max(1, width) / Math.max(1, height);
  const horizontalPadding = window.innerWidth < 640 ? 48 : 128;
  const renderedWidth = Math.min(
    Math.max(1, width),
    1248,
    Math.max(1, window.innerWidth - horizontalPadding),
    Math.max(1, window.innerHeight * 0.8 * aspectRatio),
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
  previewFrame,
  finalSrc,
  alt,
  width,
  height,
  style,
  heroActive,
  onOpen,
}: DetailImageProps) {
  const [decodedPreviewSrc, setDecodedPreviewSrc] = useState<string | null>(null);
  const [decodedFinalSrc, setDecodedFinalSrc] = useState<string | null>(null);
  const [frameReady, setFrameReady] = useState(false);
  const prefetchLinkRef = useRef<HTMLLinkElement | null>(null);
  const [shouldPrefetchFinal] = useState(heroActive);
  const previewReady = previewFrame
    ? frameReady
    : Boolean(previewSrc && decodedPreviewSrc === previewSrc);
  const finalReady = Boolean(finalSrc && decodedFinalSrc === finalSrc);
  const hasPreview = Boolean(previewFrame || previewSrc);
  const transitionReady = hasPreview ? previewReady : finalReady;
  const showFinal = finalReady && !heroActive;
  const mountFinal = !heroActive || !hasPreview;
  const aspectRatio = Math.max(1, width) / Math.max(1, height);
  const intrinsicWidth = Math.max(1, width);
  const responsiveSizes = `(max-width: 639px) min(calc(100vw - 3rem), ${intrinsicWidth}px, calc(80dvh * ${aspectRatio})), min(calc(100vw - 8rem), 1248px, ${intrinsicWidth}px, calc(80dvh * ${aspectRatio}))`;

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

  useEffect(() => {
    if (!finalReady) return;
    prefetchLinkRef.current?.remove();
    prefetchLinkRef.current = null;
  }, [finalReady]);

  const markDecoded = useCallback((
    event: SyntheticEvent<HTMLImageElement>,
    src: string,
    setDecodedSrc: (value: string) => void,
  ) => {
    const element = event.currentTarget;
    void element.decode().catch(() => undefined).then(() => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (element.isConnected) setDecodedSrc(src);
      }));
    });
  }, []);

  return (
    <div
      data-image-hero-role="detail"
      data-image-hero-id={imageId}
      data-image-hero-ready={transitionReady ? 'true' : undefined}
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
          onLoad={(event) => markDecoded(event, finalSrc, setDecodedFinalSrc)}
          data-image-detail-layer="final"
          className={`absolute inset-0 z-0 block h-full w-full object-contain ${previewSrc ? showFinal ? 'opacity-100' : 'opacity-0' : finalReady ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
      {!showFinal && (previewFrame ? (
        <HeroFrame
          frame={previewFrame}
          onDrawn={() => setFrameReady(true)}
          data-image-detail-layer="preview"
          className={`absolute inset-0 z-10 block h-full w-full object-contain ${showFinal ? 'opacity-0' : 'opacity-100'}`}
        />
      ) : previewSrc ? (
        <Image
          src={previewSrc}
          alt={alt}
          width={Math.max(1, width)}
          height={Math.max(1, height)}
          sizes={responsiveSizes}
          quality={82}
          loading="eager"
          unoptimized={shouldBypassImageOptimization(previewSrc)}
          onLoad={(event) => markDecoded(event, previewSrc, setDecodedPreviewSrc)}
          data-image-detail-layer="preview"
          className={`absolute inset-0 z-10 block h-full w-full object-contain ${showFinal ? 'opacity-0' : 'opacity-100'}`}
        />
      ) : null)}
      <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/10">
        <MdFullscreen size={32} className="text-white/0 transition-all group-hover:text-white/70" />
      </div>
    </div>
  );
}
