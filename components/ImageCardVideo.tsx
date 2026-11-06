'use client';

import { startTransition, useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type SyntheticEvent } from 'react';
import Skeleton from '@/components/Skeleton';
import { useSsrImageLine } from '@/components/ImageLineProvider';
import { MOTION_SPEED_SCALE } from '@/lib/appearance';
import { SPRING_MS } from '@/lib/spring';
import {
  createInitialAttempt,
  getRawImageUrl,
  isResilientImageUrl,
  LOAD_TIMEOUT_MS,
  resolveNextAttempt,
  type LoadAttempt,
} from '@/lib/imageLoader';
import { startCardVideoPreview } from '@/lib/cardVideoPreview';

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
 * Loading and recovery follow docs/scrolling.md#video-cards. Only an exhausted retry ladder
 * reports failure to the card; a transient media error keeps the shimmer while recovering.
 */
export default function ImageCardVideo(props: ImageCardVideoProps) {
  return <ImageCardVideoInner key={props.src} {...props} />;
}

function ImageCardVideoInner({ src, onGiveUp }: ImageCardVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [near, setNear] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const [placeholderGone, setPlaceholderGone] = useState(false);
  const preview = useRef<(() => void) | null>(null);
  const ssrLine = useSsrImageLine();
  const rawUrl = getRawImageUrl(src).split('#')[0];
  const resilient = isResilientImageUrl(src);
  const [load, setLoad] = useState(() => {
    const attempt: LoadAttempt = resilient
      ? createInitialAttempt(rawUrl, { line: ssrLine, optimize: false })
      : { url: src, optimized: false, tier: 2, retries: 0, giveUp: false, delayMs: 0 };
    return { attempt, shown: attempt, generation: 0 };
  });
  const { attempt, shown, generation } = load;
  const displayKey = `${generation}:${shown.tier}:${shown.retries}:${shown.url}`;
  const [heldOffline, setHeldOffline] = useState(false);
  const timerRef = useRef(0);
  const reportedRef = useRef(false);

  const fail = () => {
    if (attempt !== shown || attempt.giveUp || heldOffline) return;
    window.clearTimeout(timerRef.current);
    setFrameReady(false);
    setPlaceholderGone(false);
    if (navigator.onLine === false) {
      setHeldOffline(true);
      return;
    }
    setLoad((state) => {
      if (state.shown !== shown || state.attempt !== state.shown || state.attempt.giveUp) return state;
      const next = resilient
        ? resolveNextAttempt(rawUrl, state.attempt)
        : { ...state.attempt, giveUp: true };
      return { ...state, attempt: next, shown: next.delayMs > 0 && !next.giveUp ? state.shown : next };
    });
  };

  const markFrameReady = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    if (video !== videoRef.current || attempt !== shown || attempt.giveUp || heldOffline) return;
    if (video.readyState < 2 || video.error) return;
    window.clearTimeout(timerRef.current);
    startTransition(() => setFrameReady(true));
  };

  /* A changed source or an unmounted card ends both playing and still-pending previews. */
  useEffect(() => () => {
    preview.current?.();
    preview.current = null;
  }, [displayKey, near]);

  /* Attach the source once the card is within a screen of the viewport — the app scroller,
     or the overlay's own scroller when the grid sits behind an open picture. */
  useEffect(() => {
    const video = videoRef.current;
    if (!video || near) return;
    if (typeof IntersectionObserver === 'undefined') {
      queueMicrotask(() => setNear(true));
      return;
    }
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
    /* Cached frames may precede the listener; a new attempt must clear the old frame's latch. */
    const video = videoRef.current;
    const ready = Boolean(near && video && video.readyState >= 2 && !video.error);
    setFrameReady(ready);
    if (!ready) setPlaceholderGone(false);
  }, [near, displayKey]);

  const onLoadTimeout = useEffectEvent(() => {
    /* `loadeddata` can be missed or suppressed. A decoded frame is success either way. */
    const video = videoRef.current;
    if (video && video.readyState >= 2 && !video.error) {
      startTransition(() => setFrameReady(true));
    } else {
      fail();
    }
  });
  useEffect(() => {
    if (!near || frameReady || attempt !== shown || attempt.giveUp || heldOffline) return;
    timerRef.current = window.setTimeout(() => onLoadTimeout(), LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timerRef.current);
  }, [near, frameReady, attempt, shown, generation, heldOffline]);

  useEffect(() => {
    if (attempt === shown || attempt.giveUp) return;
    const timer = window.setTimeout(() => {
      setLoad((state) => state.attempt === attempt ? { ...state, shown: attempt } : state);
    }, attempt.delayMs);
    return () => window.clearTimeout(timer);
  }, [attempt, shown]);

  useEffect(() => {
    if (!heldOffline) return;
    let waiting = true;
    const onOnline = () => {
      if (!waiting || navigator.onLine === false) return;
      waiting = false;
      setHeldOffline(false);
      setLoad((state) => ({ ...state, generation: state.generation + 1 }));
    };
    window.addEventListener('online', onOnline);
    /* The network may have recovered between the error and this effect installing its listener. */
    if (navigator.onLine !== false) queueMicrotask(onOnline);
    return () => {
      waiting = false;
      window.removeEventListener('online', onOnline);
    };
  }, [heldOffline]);

  useEffect(() => {
    if (!attempt.giveUp || reportedRef.current) return;
    reportedRef.current = true;
    onGiveUp();
  }, [attempt.giveUp, onGiveUp]);

  useEffect(() => {
    if (!frameReady) return;
    /* The wall-clock rule: the slow tier's scale, so the placeholder outlives its own fade. */
    const timer = window.setTimeout(
      () => startTransition(() => setPlaceholderGone(true)),
      SPRING_MS.defaultEffects * MOTION_SPEED_SCALE.slow,
    );
    return () => window.clearTimeout(timer);
  }, [frameReady]);

  const startPreview = (event: React.PointerEvent<HTMLVideoElement>) => {
    if (event.pointerType === 'touch') return;
    const video = videoRef.current;
    if (!video || !near || !frameReady) return;
    preview.current?.();
    preview.current = startCardVideoPreview(video);
  };

  const stopPreview = () => {
    preview.current?.();
    preview.current = null;
  };

  return (
    <>
      {!placeholderGone && (
        /* `Skeleton`, not a hand-built shimmer span: one owner for the app's loading
           language. Square-cornered — the media container already clips this to its own
           corner. Cross-fades with the frame rather than unmounting on it, so the first
           frames of an arriving still are never a blank card. */
        <Skeleton
          className={`absolute inset-0 block rounded-none transition-opacity spring-default-effects ${
            frameReady ? 'opacity-0 after:animate-none' : near ? 'opacity-100' : 'opacity-100 after:[animation-play-state:paused]'
          }`}
        />
      )}
      <video
        /* A fresh element clears the browser's sticky media error, including an offline retry. */
        key={displayKey}
        ref={videoRef}
        src={near ? `${shown.url.split('#')[0]}#t=0.1` : undefined}
        preload={near ? 'metadata' : 'none'}
        muted
        playsInline
        disablePictureInPicture
        aria-hidden="true"
        tabIndex={-1}
        /* A transition, like `FadeInImage`'s load: cosmetic, and it must not interrupt a page
           still mounting its cards. */
        onLoadedData={markFrameReady}
        onCanPlay={markFrameReady}
        onSeeked={markFrameReady}
        onError={(event) => { if (event.currentTarget === videoRef.current) fail(); }}
        onPointerEnter={startPreview}
        onPointerLeave={stopPreview}
        className={`absolute left-0 top-0 h-full w-full object-cover transition-opacity spring-default-effects ${
          frameReady ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </>
  );
}
