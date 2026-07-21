'use client';

import { useEffect, useRef, useState, type CSSProperties, type SyntheticEvent } from 'react';
import HeroFrame from '@/components/HeroFrame';

type DetailVideoProps = {
  imageId: number;
  previewFrame?: HTMLCanvasElement | null;
  previewSrc?: string;
  finalSrc: string;
  alt: string;
  style: CSSProperties;
  heroActive: boolean;
  onOpen: () => void;
};

export default function DetailVideo({
  imageId,
  previewFrame,
  previewSrc,
  finalSrc,
  alt,
  style,
  heroActive,
  onOpen,
}: DetailVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [frameReady, setFrameReady] = useState(false);
  const [decodedVideoSrc, setDecodedVideoSrc] = useState<string | null>(null);
  const previewReady = previewFrame ? frameReady : false;
  const videoReady = decodedVideoSrc === finalSrc;
  const showFinal = videoReady && !heroActive;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (heroActive) {
      video.pause();
      return;
    }
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      setDecodedVideoSrc(finalSrc);
    }
    void video.play().catch(() => undefined);
  }, [finalSrc, heroActive]);

  const markVideoReady = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      setDecodedVideoSrc(finalSrc);
    }
  };

  return (
    <div
      data-image-hero-role="detail"
      data-image-hero-id={imageId}
      data-image-hero-ready={previewReady || (!heroActive && videoReady) ? 'true' : undefined}
      className="group relative flex-none cursor-zoom-in overflow-hidden rounded-lg bg-slate-50 dark:bg-slate-900"
      style={style}
      onClick={onOpen}
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
          preload={heroActive ? 'metadata' : 'auto'}
          onLoadedData={markVideoReady}
          data-image-detail-layer="final"
          className={`absolute inset-0 z-0 block h-full w-full object-contain ${showFinal ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        />
      )}
      {!showFinal && (previewFrame ? (
        <HeroFrame
          frame={previewFrame}
          onDrawn={() => setFrameReady(true)}
          data-image-detail-layer="preview"
          aria-hidden="true"
          className={`absolute inset-0 z-10 block h-full w-full object-contain ${showFinal ? 'opacity-0' : 'opacity-100'}`}
        />
      ) : previewSrc ? (
        <video
          src={previewSrc}
          aria-hidden="true"
          muted
          playsInline
          preload="auto"
          data-image-detail-layer="preview"
          className={`absolute inset-0 z-10 block h-full w-full object-contain ${showFinal ? 'opacity-0' : 'opacity-100'}`}
        />
      ) : null)}
    </div>
  );
}
