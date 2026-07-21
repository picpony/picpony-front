'use client';

import { useEffect, useRef, useState } from 'react';

type ImageCardVideoProps = {
  src: string;
  onLoadedData?: () => void;
};

export default function ImageCardVideo({ src, onLoadedData }: ImageCardVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameReadyRef = useRef(false);
  const [preload, setPreload] = useState<'metadata' | 'auto'>('metadata');

  useEffect(() => {
    const video = videoRef.current;
    if (!video || frameReadyRef.current || preload === 'auto') return;
    const root = video.closest<HTMLElement>('[data-image-detail-background]');

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setPreload('auto');
        observer.disconnect();
      },
      { root, rootMargin: '500px' },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [preload]);

  const warmVideo = () => setPreload('auto');
  const coolVideo = () => setPreload('metadata');
  const handleLoadedData = () => {
    frameReadyRef.current = true;
    setPreload('metadata');
    onLoadedData?.();
  };

  return (
    <video
      ref={videoRef}
      src={`${src}#t=0.1`}
      preload={preload}
      muted
      playsInline
      onLoadedData={handleLoadedData}
      onPointerEnter={warmVideo}
      onPointerDown={warmVideo}
      onPointerLeave={coolVideo}
      onFocus={warmVideo}
      onBlur={coolVideo}
      className="absolute left-0 top-0 h-full w-full object-cover transition-all duration-500"
    />
  );
}
