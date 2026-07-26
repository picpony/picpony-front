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

type DetailMediaTargetCallback = (
  surfaceId: string,
  target: HTMLDivElement | null,
) => void;

type DetailMediaReadyCallback = (
  surfaceId: string,
  target: HTMLDivElement,
) => void;

type DetailVideoProps = {
  imageId: number;
  previewSrc?: string;
  previewKind?: 'image' | 'video';
  finalSrc: string;
  alt: string;
  style: CSSProperties;
  heroActive: boolean;
  preloadFinal?: boolean;
  surfaceId?: string;
  onTargetChange?: DetailMediaTargetCallback;
  onPreviewReady?: DetailMediaReadyCallback;
  onFinalReady?: DetailMediaReadyCallback;
};

type VideoFrameElement = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

type VideoFrameLease = {
  video: HTMLVideoElement;
  cancel: () => void;
};

function afterVideoFrame(video: HTMLVideoElement, callback: () => void) {
  const frameVideo = video as VideoFrameElement;
  let settled = false;
  let videoFrame: number | null = null;
  let firstFrame: number | null = null;
  let secondFrame: number | null = null;

  const cancelScheduled = () => {
    if (videoFrame !== null) {
      frameVideo.cancelVideoFrameCallback?.(videoFrame);
      videoFrame = null;
    }
    if (firstFrame !== null) {
      cancelAnimationFrame(firstFrame);
      firstFrame = null;
    }
    if (secondFrame !== null) {
      cancelAnimationFrame(secondFrame);
      secondFrame = null;
    }
  };
  const finish = () => {
    if (settled) return;
    settled = true;
    cancelScheduled();
    callback();
  };

  if (frameVideo.requestVideoFrameCallback) {
    videoFrame = frameVideo.requestVideoFrameCallback(finish);
  }
  firstFrame = requestAnimationFrame(() => {
    firstFrame = null;
    secondFrame = requestAnimationFrame(finish);
  });

  return () => {
    if (settled) return;
    settled = true;
    cancelScheduled();
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
  preloadFinal = false,
  surfaceId,
  onTargetChange,
  onPreviewReady,
  onFinalReady,
}: DetailVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef({ previewSrc, finalSrc });
  const surfaceIdRef = useRef(surfaceId);
  const onPreviewReadyRef = useRef(onPreviewReady);
  const onFinalReadyRef = useRef(onFinalReady);
  const previewReadyRef = useRef(false);
  const finalReadyRef = useRef(false);
  const publishedPreviewSurfaceRef = useRef<string | null>(null);
  const publishedFinalSurfaceRef = useRef<string | null>(null);
  const finalFrameLeaseRef = useRef<VideoFrameLease | null>(null);
  const previewFrameLeaseRef = useRef<VideoFrameLease | null>(null);
  const hasPreview = Boolean(previewSrc);
  // Mirror DetailImage: while the hero flyer owns the screen, do not mount the
  // final video. Preview alone drives handoff readiness.
  const mountFinal = !heroActive || !hasPreview || preloadFinal;

  const cancelFinalReady = useCallback((owner?: HTMLVideoElement) => {
    const lease = finalFrameLeaseRef.current;
    if (!lease || (owner && lease.video !== owner)) return;
    finalFrameLeaseRef.current = null;
    lease.cancel();
  }, []);

  const cancelPreviewReady = useCallback((owner?: HTMLVideoElement) => {
    const lease = previewFrameLeaseRef.current;
    if (!lease || (owner && lease.video !== owner)) return;
    previewFrameLeaseRef.current = null;
    lease.cancel();
  }, []);

  const setFinalVideoRef = useCallback((video: HTMLVideoElement | null) => {
    const previous = videoRef.current;
    if (previous && previous !== video) {
      cancelFinalReady(previous);
      previous.pause();
    }
    videoRef.current = video;
    if (!video) {
      finalReadyRef.current = false;
      publishedFinalSurfaceRef.current = null;
      targetRef.current?.removeAttribute('data-image-detail-final-ready');
    }
  }, [cancelFinalReady]);

  const setPreviewVideoRef = useCallback((video: HTMLVideoElement | null) => {
    const previous = previewVideoRef.current;
    if (previous && previous !== video) {
      cancelPreviewReady(previous);
      previous.pause();
    }
    previewVideoRef.current = video;
  }, [cancelPreviewReady]);

  const publishPreviewReady = useCallback(() => {
    const readySurfaceId = surfaceIdRef.current;
    const target = targetRef.current;
    const callback = onPreviewReadyRef.current;
    if (!readySurfaceId || !target || !callback ||
        publishedPreviewSurfaceRef.current === readySurfaceId) {
      return;
    }
    publishedPreviewSurfaceRef.current = readySurfaceId;
    callback(readySurfaceId, target);
  }, []);

  const publishFinalReady = useCallback(() => {
    const readySurfaceId = surfaceIdRef.current;
    const target = targetRef.current;
    const callback = onFinalReadyRef.current;
    if (!readySurfaceId || !target || !callback ||
        publishedFinalSurfaceRef.current === readySurfaceId) {
      return;
    }
    publishedFinalSurfaceRef.current = readySurfaceId;
    callback(readySurfaceId, target);
  }, []);

  const markPreviewReady = useCallback(() => {
    previewReadyRef.current = true;
    publishPreviewReady();
  }, [publishPreviewReady]);

  const markFinalPaintable = useCallback(() => {
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
      cancelPreviewReady();
      previewReadyRef.current = false;
      publishedPreviewSurfaceRef.current = null;
    }
    if (previous.finalSrc !== finalSrc) {
      cancelFinalReady();
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
  }, [cancelFinalReady, cancelPreviewReady, finalSrc, previewSrc]);

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

  const markFinalReady = useCallback((video: HTMLVideoElement) => {
    if (sourceRef.current.finalSrc !== finalSrc || videoRef.current !== video) return;
    if (finalReadyRef.current) {
      publishFinalReady();
      return;
    }
    cancelFinalReady();
    const loadedSrc = video.currentSrc;
    let cancel = () => {};
    cancel = afterVideoFrame(video, () => {
      if (finalFrameLeaseRef.current?.cancel === cancel) finalFrameLeaseRef.current = null;
      if (sourceRef.current.finalSrc !== finalSrc || videoRef.current !== video ||
          !video.isConnected || video.currentSrc !== loadedSrc ||
          video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        return;
      }
      markFinalPaintable();
    });
    finalFrameLeaseRef.current = { video, cancel };
  }, [cancelFinalReady, finalSrc, markFinalPaintable, publishFinalReady]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !mountFinal) return;
    if (heroActive) {
      video.pause();
    } else {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) markFinalReady(video);
      void video.play().catch(() => undefined);
    }
    return () => {
      cancelFinalReady(video);
      video.pause();
    };
  }, [cancelFinalReady, finalSrc, heroActive, markFinalReady, mountFinal]);

  useEffect(() => {
    const previewVideo = previewVideoRef.current;
    if (!previewVideo) return;
    if (!heroActive) previewVideo.pause();
    return () => {
      cancelPreviewReady(previewVideo);
      previewVideo.pause();
    };
  }, [cancelPreviewReady, heroActive, previewKind, previewSrc]);

  const handleFinalLoaded = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    markFinalReady(event.currentTarget);
  }, [markFinalReady]);

  const handlePreviewVideoLoaded = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    if (sourceRef.current.previewSrc !== previewSrc || previewVideoRef.current !== video) return;
    const loadedSrc = video.currentSrc;
    cancelPreviewReady();
    let cancel = () => {};
    cancel = afterVideoFrame(video, () => {
      if (previewFrameLeaseRef.current?.cancel === cancel) previewFrameLeaseRef.current = null;
      if (sourceRef.current.previewSrc !== previewSrc || previewVideoRef.current !== video ||
          !video.isConnected || video.currentSrc !== loadedSrc ||
          video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        return;
      }
      markPreviewReady();
    });
    previewFrameLeaseRef.current = { video, cancel };
  }, [cancelPreviewReady, markPreviewReady, previewSrc]);

  const handlePreviewImageLoaded = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    const loadedSrc = image.currentSrc;
    void image.decode().catch(() => undefined).then(() => {
      requestAnimationFrame(() => {
        if (sourceRef.current.previewSrc === previewSrc &&
            image.isConnected && image.currentSrc === loadedSrc && image.naturalWidth > 0) {
          markPreviewReady();
        }
      });
    });
  }, [markPreviewReady, previewSrc]);

  return (
    <div
      ref={targetRef}
      data-image-hero-role="detail"
      data-image-hero-id={imageId}
      data-image-detail-hero-active={heroActive ? 'true' : 'false'}
      className="group relative flex-none cursor-default overflow-hidden rounded-lg bg-slate-50 dark:bg-slate-900"
      style={style}
    >
      {finalSrc && mountFinal && (
        <video
          ref={setFinalVideoRef}
          src={finalSrc}
          aria-label={heroActive ? undefined : alt}
          aria-hidden={heroActive ? 'true' : undefined}
          controls={!heroActive}
          autoPlay={!heroActive}
          loop
          muted={heroActive}
          playsInline
          preload={heroActive && hasPreview && !preloadFinal ? 'metadata' : 'auto'}
          onLoadedData={handleFinalLoaded}
          data-image-detail-layer="final"
          className="image-detail-final absolute inset-0 z-0 block h-full w-full object-contain"
        />
      )}
      {previewSrc && (previewKind === 'video' ? (
        <video
          ref={setPreviewVideoRef}
          src={previewSrc}
          aria-hidden="true"
          muted
          playsInline
          preload="auto"
          onLoadedData={handlePreviewVideoLoaded}
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
