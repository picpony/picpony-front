'use client';

import { startTransition, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Skeleton from '@/components/Skeleton';
import { useMotionTier, MOTION_SPEED_SCALE } from '@/lib/appearance';
import { DURATION } from '@/lib/motionTokens';
import { LOAD_TIMEOUT_MS, saveDataRequested } from '@/lib/imageLoader';

type ImageCardVideoProps = {
  src: string;
  /** Every attempt failed: the card draws its failure plate. */
  onGiveUp: () => void;
};

/**
 * A video card's still frame, and its preview.
 *
 * **The still costs a still.** The frame is the video's own, at `#t=0.1`, loaded with
 * `preload="metadata"` — the header and the first frame, not the file. It used to switch to
 * `preload="auto"` whenever the card came near the viewport, so every WEBM card in view buffered
 * its whole video while staying paused (R4-030). The source itself is attached only near the
 * viewport, since `metadata` is still a request per card.
 *
 * **The preview is a hover.** Under a fine pointer, at the standard motion tier and without Data
 * Saver, resting on the card plays the video muted from the start and leaving stops it back on
 * the still. A touch screen has no hover, and 减弱 / 关闭 drop decorative motion by definition.
 *
 * Same shimmer, same cross-fade as `FadeInImage`; a video that fails (or shows no frame within
 * the load timeout) reports it, and the card draws the failure plate.
 */
export default function ImageCardVideo({ src, onGiveUp }: ImageCardVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [near, setNear] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const [placeholderGone, setPlaceholderGone] = useState(false);
  const tier = useMotionTier();

  /* Attach the source once the card is within a screen of the viewport — the app scroller,
     or the overlay's own scroller when the grid sits behind an open picture. */
  useEffect(() => {
    const video = videoRef.current;
    if (!video || near) return;
    const root = video.closest<HTMLElement>('[data-image-detail-background]');
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        startTransition(() => setNear(true));
        observer.disconnect();
      },
      { root, rootMargin: '500px' },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [near]);

  useLayoutEffect(() => {
    /* A cached frame (a return visit) is already decoded: nothing to fade in. */
    if (near && (videoRef.current?.readyState ?? 0) >= 2) setFrameReady(true);
  }, [near]);

  /* No frame within the load timeout counts as a failure, like an image that never loads. */
  useEffect(() => {
    if (!near || frameReady) return;
    const timer = window.setTimeout(onGiveUp, LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [near, frameReady, onGiveUp]);

  useEffect(() => {
    if (!frameReady) return;
    /* The wall-clock rule: the slow tier's scale, so the placeholder outlives its own fade. */
    const timer = window.setTimeout(
      () => startTransition(() => setPlaceholderGone(true)),
      DURATION.short * 1000 * MOTION_SPEED_SCALE.slow,
    );
    return () => window.clearTimeout(timer);
  }, [frameReady]);

  const previewAllowed = () => tier === 'standard' && !saveDataRequested();

  const startPreview = (event: React.PointerEvent<HTMLVideoElement>) => {
    if (event.pointerType === 'touch' || !previewAllowed()) return;
    const video = videoRef.current;
    if (!video || !frameReady) return;
    video.loop = true;
    void video.play().catch(() => {
      /* A refused play (a policy, a decode hiccup) leaves the still in place. */
    });
  };

  const stopPreview = () => {
    const video = videoRef.current;
    if (!video || video.paused) return;
    video.pause();
    video.currentTime = 0.1;
  };

  return (
    <>
      {!placeholderGone && (
        /* `Skeleton`, not a hand-built shimmer span: one owner for the app's loading
           language. Square-cornered — the media container already clips this to its own
           corner. Cross-fades with the frame rather than unmounting on it, so the first
           frames of an arriving still are never a blank card. */
        <Skeleton
          className={`absolute inset-0 block rounded-none transition-opacity duration-standard ease-[var(--ease-standard)] ${
            frameReady ? 'opacity-0' : 'opacity-100'
          }`}
        />
      )}
      <video
        ref={videoRef}
        src={near ? `${src}#t=0.1` : undefined}
        preload={near ? 'metadata' : 'none'}
        muted
        playsInline
        disablePictureInPicture
        aria-hidden="true"
        tabIndex={-1}
        /* A transition, like `FadeInImage`'s load: cosmetic, and it must not interrupt a page
           still mounting its cards. */
        onLoadedData={() => startTransition(() => setFrameReady(true))}
        onError={onGiveUp}
        onPointerEnter={startPreview}
        onPointerLeave={stopPreview}
        className={`absolute left-0 top-0 h-full w-full object-cover transition-opacity duration-standard ease-[var(--ease-standard)] ${
          frameReady ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </>
  );
}
