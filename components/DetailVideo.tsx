'use client';

import Image from 'next/image';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type SyntheticEvent,
} from 'react';
import { getHeroMediaPreviewSizes } from '@/lib/hero/geometry';

const HERO_MEDIA_PREVIEW_SIZES = getHeroMediaPreviewSizes();

type DetailVideoProps = {
  imageId: number;
  previewSrc?: string;
  previewKind?: 'image' | 'video';
  finalSrc: string;
  alt: string;
  style: CSSProperties;
  heroActive: boolean;
  onOpen: () => void;
};

type VideoFrameElement = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

function afterVideoFrame(video: HTMLVideoElement, callback: () => void) {
  const frameVideo = video as VideoFrameElement;
  let settled = false;
  let videoFrame = 0;
  let firstFrame = 0;
  let secondFrame = 0;
  const finish = () => {
    if (settled) return;
    settled = true;
    callback();
  };

  if (frameVideo.requestVideoFrameCallback) {
    videoFrame = frameVideo.requestVideoFrameCallback(finish);
  }
  firstFrame = requestAnimationFrame(() => {
    secondFrame = requestAnimationFrame(finish);
  });

  return () => {
    settled = true;
    if (videoFrame) frameVideo.cancelVideoFrameCallback?.(videoFrame);
    cancelAnimationFrame(firstFrame);
    cancelAnimationFrame(secondFrame);
  };
}

export default function DetailVideo({
  imageId,
  previewSrc,
  previewKind = 'image',
  finalSrc,
  alt,
  style,
  heroActive,
  onOpen,
}: DetailVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef({ previewSrc, finalSrc });
  const cancelFinalReadyRef = useRef<(() => void) | null>(null);
  const hasPreview = Boolean(previewSrc);

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

  useEffect(() => () => {
    cancelFinalReadyRef.current?.();
    cancelFinalReadyRef.current = null;
  }, []);

  const markFinalReady = useCallback((video: HTMLVideoElement) => {
    cancelFinalReadyRef.current?.();
    cancelFinalReadyRef.current = afterVideoFrame(video, () => {
      cancelFinalReadyRef.current = null;
      if (!video.isConnected || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      const target = targetRef.current;
      if (!target) return;
      target.setAttribute('data-image-detail-final-ready', 'true');
      if (!hasPreview) target.setAttribute('data-image-hero-ready', 'true');
    });
  }, [hasPreview]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (heroActive) {
      video.pause();
      return;
    }
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) markFinalReady(video);
    void video.play().catch(() => undefined);
  }, [heroActive, markFinalReady]);

  const handleFinalLoaded = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    markFinalReady(event.currentTarget);
  }, [markFinalReady]);

  const markPreviewReady = useCallback(() => {
    const target = targetRef.current;
    if (!target) return;
    target.setAttribute('data-image-detail-preview-ready', 'true');
    target.setAttribute('data-image-hero-ready', 'true');
  }, []);

  const handlePreviewImageLoaded = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    const loadedSrc = image.currentSrc;
    void image.decode().catch(() => undefined).then(() => {
      requestAnimationFrame(() => {
        if (image.isConnected && image.currentSrc === loadedSrc) markPreviewReady();
      });
    });
  }, [markPreviewReady]);

  return (
    <div
      ref={targetRef}
      data-image-hero-role="detail"
      data-image-hero-id={imageId}
      data-image-hero-ready={previewReady || (!heroActive && videoReady) ? 'true' : undefined}
      data-image-detail-hero-active={heroActive ? 'true' : 'false'}
      className="group relative flex-none cursor-zoom-in overflow-hidden rounded-lg bg-slate-50 dark:bg-slate-900"
      style={style}
    >
      {finalSrc && (
        <video
          ref={videoRef}
          src={finalSrc}
          aria-label={heroActive ? undefined : alt}
          aria-hidden={heroActive ? 'true' : undefined}
          controls={!heroActive}
          autoPlay={!heroActive}
          loop
          muted={heroActive}
          playsInline
          preload={heroActive && hasPreview ? 'metadata' : 'auto'}
          onLoadedData={handleFinalLoaded}
          data-image-detail-layer="final"
          className="image-detail-final absolute inset-0 z-0 block h-full w-full object-contain"
        />
      )}
      {previewSrc && (previewKind === 'video' ? (
        <video
          src={previewSrc}
          aria-hidden="true"
          muted
          playsInline
          preload="auto"
          onLoadedData={markPreviewReady}
          data-image-detail-layer="preview"
          className="image-detail-preview-native pointer-events-none absolute inset-0 z-10 block h-full w-full object-contain"
        />
      ) : (
        <Image
          src={previewSrc}
          alt=""
          aria-hidden="true"
          fill
          sizes={HERO_MEDIA_PREVIEW_SIZES}
          loading="eager"
          fetchPriority={heroActive ? 'low' : 'high'}
          unoptimized
          onLoad={handlePreviewImageLoaded}
          data-image-detail-layer="preview"
          className="image-detail-preview-native pointer-events-none absolute inset-0 z-10 block h-full w-full object-contain"
        />
      ))}
    </div>
  );
}
