'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Skeleton from '@/components/Skeleton';

type ImageCardVideoProps = {
  src: string;
};

export default function ImageCardVideo({ src }: ImageCardVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameReadyRef = useRef(false);
  const [preload, setPreload] = useState<'metadata' | 'auto'>('metadata');
  /* Video thumbs used to pop in with no transition at all, next to image thumbs
     that faded — two different arrivals in the same grid. Same shimmer, same
     fade, same curve as `FadeInImage`. */
  const [posterReady, setPosterReady] = useState(false);

  useLayoutEffect(() => {
    // HAVE_CURRENT_DATA: the poster frame is already decoded (cached video on a
    // return visit), so there is nothing to reveal.
    if ((videoRef.current?.readyState ?? 0) >= 2) setPosterReady(true);
  }, [src]);

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
    setPosterReady(true);
    setPreload('metadata');
  };

  return (
    <>
      {!posterReady && (
        /* `Skeleton`, not a hand-built `.skeleton` span: same tone and sweep,
           but one owner for the app's loading language. `rounded-none` because
           the media container already clips this to its own corner. */
        <Skeleton className="absolute inset-0 block rounded-none" />
      )}
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
        className={`absolute left-0 top-0 h-full w-full object-cover transition-opacity duration-200 ease-[var(--ease-standard)] motion-reduce:transition-none ${
          posterReady ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </>
  );
}
