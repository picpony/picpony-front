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
import { HERO_PREVIEW_FALLBACK_MS } from '@/lib/hero/constants';

const HERO_MEDIA_PREVIEW_SIZES = getHeroMediaPreviewSizes();

type DetailMediaTargetCallback = (surfaceId: string, target: HTMLDivElement | null) => void;

type DetailMediaReadyCallback = (surfaceId: string, target: HTMLDivElement) => void;

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
  /** The preview will never paint. Lets the route drop `heroActive` and show the final. */
  onPreviewFailed?: (surfaceId: string) => void;
  /** Neither layer will ever paint. The terminal answer the handoff waits for. */
  onMediaUnavailable?: (surfaceId: string) => void;
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
  onPreviewFailed,
  onMediaUnavailable,
}: DetailVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);
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

  const setFinalVideoRef = useCallback(
    (video: HTMLVideoElement | null) => {
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
    },
    [cancelFinalReady],
  );

  const setPreviewVideoRef = useCallback(
    (video: HTMLVideoElement | null) => {
      const previous = previewVideoRef.current;
      if (previous && previous !== video) {
        cancelPreviewReady(previous);
        previous.pause();
      }
      previewVideoRef.current = video;
    },
    [cancelPreviewReady],
  );

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

  /** Same contract as `DetailImage`'s — see the docstring there. */
  const markPreviewFailed = useCallback(() => {
    clearPreviewFallback();
    if (previewFailedRef.current) return;
    previewFailedRef.current = true;
    cancelPreviewReady();
    const failedSurfaceId = surfaceIdRef.current;
    if (failedSurfaceId) onPreviewFailedRef.current?.(failedSurfaceId);
    if (finalReadyRef.current) markPreviewReady();
    else if (finalFailedRef.current && failedSurfaceId) {
      onMediaUnavailableRef.current?.(failedSurfaceId);
    }
  }, [cancelPreviewReady, clearPreviewFallback, markPreviewReady]);

  const markFinalFailed = useCallback(() => {
    finalFailedRef.current = true;
    cancelFinalReady();
    const failedSurfaceId = surfaceIdRef.current;
    if (!failedSurfaceId || previewReadyRef.current) return;
    onMediaUnavailableRef.current?.(failedSurfaceId);
  }, [cancelFinalReady]);

  const markFinalPaintable = useCallback(() => {
    const target = targetRef.current;
    if (!target) return;
    finalReadyRef.current = true;
    target.setAttribute('data-image-detail-final-ready', 'true');
    publishFinalReady();
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
      cancelPreviewReady();
      previewReadyRef.current = false;
      previewFailedRef.current = false;
      clearPreviewFallback();
      publishedPreviewSurfaceRef.current = null;
    }
    if (previous.finalSrc !== finalSrc) {
      cancelFinalReady();
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
  }, [cancelFinalReady, cancelPreviewReady, clearPreviewFallback, finalSrc, previewSrc]);

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

  const markFinalReady = useCallback(
    (video: HTMLVideoElement) => {
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
        if (
          sourceRef.current.finalSrc !== finalSrc ||
          videoRef.current !== video ||
          !video.isConnected ||
          video.currentSrc !== loadedSrc ||
          video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
        ) {
          return;
        }
        markFinalPaintable();
      });
      finalFrameLeaseRef.current = { video, cancel };
    },
    [cancelFinalReady, finalSrc, markFinalPaintable, publishFinalReady],
  );

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

  const handleFinalLoaded = useCallback(
    (event: SyntheticEvent<HTMLVideoElement>) => {
      markFinalReady(event.currentTarget);
    },
    [markFinalReady],
  );

  const handlePreviewVideoLoaded = useCallback(
    (event: SyntheticEvent<HTMLVideoElement>) => {
      const video = event.currentTarget;
      if (sourceRef.current.previewSrc !== previewSrc || previewVideoRef.current !== video) return;
      const loadedSrc = video.currentSrc;
      cancelPreviewReady();
      let cancel = () => {};
      cancel = afterVideoFrame(video, () => {
        if (previewFrameLeaseRef.current?.cancel === cancel) previewFrameLeaseRef.current = null;
        if (
          sourceRef.current.previewSrc !== previewSrc ||
          previewVideoRef.current !== video ||
          !video.isConnected ||
          video.currentSrc !== loadedSrc ||
          video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
        ) {
          return;
        }
        markPreviewReady();
      });
      previewFrameLeaseRef.current = { video, cancel };
    },
    [cancelPreviewReady, markPreviewReady, previewSrc],
  );

  const handlePreviewImageLoaded = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      const image = event.currentTarget;
      const loadedSrc = image.currentSrc;
      void image
        .decode()
        .catch(() => undefined)
        .then(() => {
          requestAnimationFrame(() => {
            if (
              sourceRef.current.previewSrc === previewSrc &&
              image.isConnected &&
              image.currentSrc === loadedSrc &&
              image.naturalWidth > 0
            ) {
              markPreviewReady();
            }
          });
        });
    },
    [markPreviewReady, previewSrc],
  );

  return (
    <div
      ref={targetRef}
      data-image-hero-role="detail"
      data-image-hero-id={imageId}
      data-image-detail-hero-active={heroActive ? 'true' : 'false'}
      className="group relative flex-none cursor-default overflow-hidden rounded-lg bg-surface-container-low"
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
          onError={markFinalFailed}
          data-image-detail-layer="final"
          className="image-detail-final absolute inset-0 z-0 block h-full w-full object-contain"
        />
      )}
      {previewSrc &&
        (previewKind === 'video' ? (
          <video
            ref={setPreviewVideoRef}
            src={previewSrc}
            aria-hidden="true"
            muted
            playsInline
            preload="auto"
            onLoadedData={handlePreviewVideoLoaded}
            onError={markPreviewFailed}
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
            onError={markPreviewFailed}
            data-image-detail-layer="preview"
            className="image-detail-preview-native pointer-events-none absolute inset-0 z-10 block h-full w-full object-contain"
          />
        ))}
    </div>
  );
}
