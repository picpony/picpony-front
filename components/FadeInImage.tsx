'use client';

import Image, { type ImageProps } from 'next/image';
import { startTransition, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import { MdBrokenImage } from 'react-icons/md';
import {
  createInitialAttempt,
  getRawImageUrl,
  isResilientImageUrl,
  LOAD_TIMEOUT_MS,
  OPTIMIZER_ACTIVE,
  resolveNextAttempt,
  type LoadAttempt,
} from '@/lib/imageLoader';
import Skeleton from '@/components/Skeleton';
import { DURATION } from '@/lib/motionTokens';
import { MOTION_SPEED_SCALE } from '@/lib/appearance';
import { useSsrImageLine } from '@/components/ImageLineProvider';
import { useMounted } from '@/lib/overlay';
import type { ImageLine } from '@/lib/route';
import { ICON } from '@/lib/icons';
import { cn } from '@/lib/utils';

/**
 * One observer per scroll root for "this picture is within reach of the viewport", shared by
 * every picture under it: a gallery page is fifty pictures, and fifty observers of one target
 * each cost the browser an intersection pass apiece on every frame the page moves (R12-010).
 * A picture is watched until it first comes near, then forgotten.
 */
const nearWatchers = new Map<Element | null, { observer: IntersectionObserver; waiting: Map<Element, () => void> }>();

function whenNear(target: Element, root: Element | null, onNear: () => void): () => void {
  let watcher = nearWatchers.get(root);
  if (!watcher) {
    const waiting = new Map<Element, () => void>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const callback = waiting.get(entry.target);
          waiting.delete(entry.target);
          observer.unobserve(entry.target);
          callback?.();
        }
      },
      { root, rootMargin: '600px 0px' },
    );
    watcher = { observer, waiting };
    nearWatchers.set(root, watcher);
  }
  const current = watcher;
  current.waiting.set(target, onNear);
  current.observer.observe(target);
  return () => {
    if (current.waiting.delete(target)) current.observer.unobserve(target);
    if (current.waiting.size === 0 && nearWatchers.get(root) === current) {
      current.observer.disconnect();
      nearWatchers.delete(root);
    }
  };
}

interface FadeInImageProps extends ImageProps {
  eager?: boolean;
  /**
   * Draw the shimmer underneath while the image decodes. On by default; turn it
   * off where the parent already paints something meaningful behind the image
   * (an avatar ring, a cropper stage).
   *
   * Not named `placeholder` — `next/image` owns that prop name for its own
   * blur/empty modes, and shadowing it makes the interface unassignable.
   */
  shimmer?: boolean;
  /**
   * The layered ladder for a Derpibooru-family URL (derpicdn / trixiebooru, or one already
   * wrapped by the worker or the CDN): the optimizer on the raw URL, then the visitor's image
   * line browser-direct — see `lib/imageLoader.ts`. On by default: a Derpibooru URL handed to
   * the optimizer as it came would be line-wrapped, which is exactly what the optimizer may no
   * longer fetch. Other URLs ignore it.
   */
  resilient?: boolean;
  /** 走 PicPony 加速代理时附带缩略图优化参数（_thumb=1） */
  proxyThumb?: boolean;
  /**
   * Called once when every attempt has failed. When given, the caller draws the failure plate
   * itself (a gallery card puts a 重试 control beside its link, which a plate inside the link
   * could not hold) and this renders only the quiet surface under it.
   */
  onGiveUp?: () => void;
}

/**
 * The one image reveal.
 *
 * The shimmer continues *under* the real card until its own image is ready, so the
 * placeholder never stops mid-sentence. The `complete` check runs in
 * `useLayoutEffect` (before paint), so a cached image is simply there instead of
 * fading in over a frame it already had. The fade is the utility standard, 200ms.
 *
 * The card-level entrance cascade animates the tile, not the picture — the two
 * fading independently would multiply their opacities.
 *
 * **Every image has a way to fail.** A Derpibooru picture walks the ladder in
 * `lib/imageLoader.ts`; any other URL gets the optimizer and then one browser-direct try of the
 * same URL (so an optimizer outage cannot blank avatars and covers either). Each retry waits its
 * backoff, a failure while the device is offline waits for the connection instead of spending
 * the ladder, and when it is spent the plate says 图片加载失败 in the app's own vocabulary —
 * never the alt text, which for a Derpibooru row was the upload's file name. A given-up image
 * tries again from the top when the device comes back online.
 *
 * The outer component keys the inner on the source, so a new picture starts a new ladder.
 */
export default function FadeInImage({ resilient = true, ...props }: FadeInImageProps) {
  const src = typeof props.src === 'string' ? props.src : '';
  const useLayers = resilient && !!src && isResilientImageUrl(src);
  return <FadeInImageInner key={src || 'static'} useLayers={useLayers} {...props} />;
}

/** What is on screen right now, and what the ladder has decided to try next. */
interface LoadState {
  attempt: LoadAttempt;
  /** The attempt the `<img>` is showing — behind `attempt` only while a backoff runs. */
  shown: LoadAttempt;
  /** Bumped to re-issue the shown attempt (coming back online), which remounts the `<img>`. */
  generation: number;
}

function initialState(
  src: string,
  useLayers: boolean,
  optimize: boolean,
  thumb: boolean,
  line: ImageLine | null,
): LoadState {
  const attempt: LoadAttempt = useLayers
    ? createInitialAttempt(getRawImageUrl(src), { thumb, line, optimize })
    : { url: src, optimized: optimize && OPTIMIZER_ACTIVE, tier: 2, retries: 0, giveUp: false, delayMs: 0 };
  return { attempt, shown: attempt, generation: 0 };
}

function FadeInImageInner({
  className,
  onLoad,
  eager = false,
  shimmer = true,
  useLayers,
  proxyThumb = false,
  onGiveUp,
  unoptimized,
  ...props
}: FadeInImageProps & { useLayers: boolean }) {
  const [isLoaded, setIsLoaded] = useState(eager);
  /* **A picture the server rendered is shown as it decodes, not after hydration.** The fade
     keys on `isLoaded`, which only JS can set, so every server-rendered `<img>` sat at zero
     opacity until the page had hydrated — seconds on a slow phone, with fifty blank cards
     under a first paint that was otherwise complete. Rendered during hydration (`useMounted`
     is false exactly then), the image is opaque from the start and simply paints over its
     shimmer; only an image mounted afterwards (a page turn, a navigation) fades in.
     Only for the source the server rendered, and never after an error: a failed or
     replaced attempt goes back to the ordinary fade, so a broken image is never shown. */
  const mounted = useMounted();
  const [serverFrame, setServerFrame] = useState(!mounted);
  /**
   * Whether the placeholder may leave the tree — one fade after `isLoaded`, not with it.
   *
   * `MOTION_SPEED_SCALE.slow` rather than the live speed, per the wall-clock rule: every CSS
   * duration stretches by up to 1.4, and a timer written against the unscaled figure fires
   * inside the motion it is meant to outlast. Holding an already-invisible node 40% longer
   * costs nothing; releasing it early is the blank frame this exists to remove.
   */
  const [placeholderGone, setPlaceholderGone] = useState(eager);
  const imgRef = useRef<HTMLImageElement>(null);
  const src = typeof props.src === 'string' ? props.src : '';
  const isStatic = typeof props.src !== 'string';
  /* The line the *server* used, when there is one. Without it this component resolves the
     line itself on both sides of hydration and every server-rendered `<img>` mismatches for
     anyone who changed the setting — and React leaves a mismatched attribute alone, so the
     preference was ignored for the whole first screen. See `components/ImageLineProvider.tsx`.
     (Only a browser-direct first attempt depends on it: the optimizer's is line-free.) */
  const ssrLine = useSsrImageLine();
  const [load, setLoad] = useState<LoadState>(() =>
    initialState(src, useLayers, !unoptimized, proxyThumb, ssrLine),
  );
  const rawUrlRef = useRef(getRawImageUrl(src));
  const timerRef = useRef(0);
  const { attempt, shown, generation } = load;
  const displaySrc = isStatic ? props.src : shown.url;
  const displayKey = `${generation}:${shown.optimized ? 'o' : 'd'}:${shown.url}`;
  const [serverKey] = useState(displayKey);
  const paintAsServed = serverFrame && displayKey === serverKey;
  const givenUp = attempt.giveUp;

  /** Decide the next attempt after the shown one failed. */
  const advance = () => {
    setServerFrame(false);
    setLoad((state) => {
      if (state.attempt !== state.shown || state.attempt.giveUp) return state;
      const next: LoadAttempt = isStatic
        ? { ...state.attempt, giveUp: true }
        : useLayers
          ? resolveNextAttempt(rawUrlRef.current, state.attempt, proxyThumb)
          : state.attempt.optimized
            ? { ...state.attempt, optimized: false }
            : { ...state.attempt, giveUp: true };
      return { ...state, attempt: next, shown: next.delayMs > 0 && !next.giveUp ? state.shown : next };
    });
  };

  /* A failure while the device is offline says nothing about the image: hold the attempt and
     re-issue it when the connection returns, instead of walking the ladder into the plate. */
  const [heldOffline, setHeldOffline] = useState(false);
  const fail = () => {
    window.clearTimeout(timerRef.current);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setServerFrame(false);
      setHeldOffline(true);
      return;
    }
    advance();
  };

  /* **The load timeout runs only for a picture the browser is fetching.** A lazy image far below
     the fold is not requested at all, and a timer started at mount used to "time it out" every
     15 seconds and walk it down the ladder while nobody could see it — a gallery left open at
     its top for two minutes came back to give-up plates. So the timer arms once the image is
     within reach of the viewport (well inside any engine's lazy-load distance) and stays armed. */
  const [armed, setArmed] = useState(eager || props.loading === 'eager');
  useEffect(() => {
    if (armed || givenUp) return;
    const img = imgRef.current;
    if (!img || typeof IntersectionObserver === 'undefined') {
      queueMicrotask(() => setArmed(true));
      return;
    }
    const root =
      img.closest<HTMLElement>('[data-app-scroll-container]') ??
      document.querySelector<HTMLElement>('[data-image-hero-gallery-scroll]');
    return whenNear(img, root?.contains(img) ? root : null, () => startTransition(() => setArmed(true)));
  }, [armed, givenUp, displayKey]);

  // 单次加载超时保护：超时未 onload 视同失败，走降级链
  /* What the timeout does when it fires is an effect event: reading the element and walking the
     ladder are not reasons to restart the timer. (It was a suppressed dependency warning, and the
     React Compiler skips any component that carries one — this one rendered unmemoised for every
     picture in the app, R12-010.) */
  const onLoadTimeout = useEffectEvent(() => {
    /* The element, not a flag: a cached picture can fire its load before this effect runs. */
    const img = imgRef.current;
    if (!(img?.complete && img.naturalWidth > 0)) fail();
  });
  useEffect(() => {
    if (isStatic || givenUp || attempt !== shown || heldOffline || !armed) return;
    timerRef.current = window.setTimeout(() => onLoadTimeout(), LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timerRef.current);
  }, [attempt, shown, generation, givenUp, heldOffline, isStatic, armed]);

  /* The backoff: the next attempt is shown once its wait has passed. */
  useEffect(() => {
    if (attempt === shown || attempt.giveUp) return;
    const timer = window.setTimeout(() => {
      setLoad((state) => (state.attempt === attempt ? { ...state, shown: attempt } : state));
    }, attempt.delayMs);
    return () => window.clearTimeout(timer);
  }, [attempt, shown]);

  /* Offline: re-issue the held attempt, or start over after a give-up, when the network returns. */
  useEffect(() => {
    if (!heldOffline && !givenUp) return;
    const onOnline = () => {
      setHeldOffline(false);
      setLoad((state) =>
        state.attempt.giveUp
          ? { ...initialState(src, useLayers, !unoptimized, proxyThumb, null), generation: state.generation + 1 }
          : { ...state, generation: state.generation + 1 },
      );
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [heldOffline, givenUp, src, useLayers, unoptimized, proxyThumb]);

  const reportedRef = useRef(false);
  useEffect(() => {
    if (!givenUp) {
      reportedRef.current = false;
      return;
    }
    if (reportedRef.current) return;
    reportedRef.current = true;
    onGiveUp?.();
  }, [givenUp, onGiveUp]);

  useEffect(() => {
    if (!isLoaded) return;
    const timer = window.setTimeout(
      () => startTransition(() => setPlaceholderGone(true)),
      /* DURATION.short is the 200ms step the duration-standard utility emits. */
      DURATION.short * 1000 * MOTION_SPEED_SCALE.slow,
    );
    return () => window.clearTimeout(timer);
  }, [isLoaded]);

  useLayoutEffect(() => {
    /* Synchronous, before paint, so a decoded image never shows a transparent frame.

       **`complete` alone is not "loaded"** — it is also true for an image that has
       *failed*, which removed the shimmer and left a blank, opaque card.
       `naturalWidth > 0` distinguishes a decoded image from a dead one.

       **And it must reset.** The shown attempt changes every time the ladder steps
       down, and this only ever set `true` — so a card that had loaded anything never
       shimmered again. Assigning the predicate rather than only raising it is the
       whole fix. */
    const img = imgRef.current;
    const loaded = Boolean(img?.complete && img.naturalWidth > 0);
    setIsLoaded(loaded);
    /* The placeholder's own latch resets here rather than in an effect of its own:
       it is the same fact as `isLoaded`. */
    if (!loaded) setPlaceholderGone(false);
  }, [displayKey]);

  /* **The cosmetic updates are transitions** — a picture's fade starting, its placeholder leaving,
     its timeout arming. They arrive from outside any user event (a `load`, a timer, an observer),
     which React renders at a priority that interrupts background work — and fifty pictures
     arriving under a page that is still mounting its next chunk of cards restarted that work
     until its lane expired and it finished synchronously: one 1.3s task at 4× CPU. As
     transitions they batch with the page instead of interrupting it; the fade starts a frame
     or two later, which nobody can see. */
  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    window.clearTimeout(timerRef.current);
    startTransition(() => setIsLoaded(true));
    onLoad?.(e);
  };

  if (givenUp) {
    /* The caller draws its own plate over this quiet surface. */
    if (onGiveUp) return <div aria-hidden="true" className="h-full w-full bg-surface-container-high" />;
    return <FailurePlate label={props.alt} fill={Boolean(props.fill)} />;
  }

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden contain-paint">
      {shimmer && !placeholderGone && (
        /* `Skeleton`, not a hand-built span: one owner for the app's loading
           language. `rounded-none` because the media container already clips
           this to its own corner.

           It **cross-fades with the image rather than unmounting on
           `isLoaded`** — unmounting it in the same commit that flips the image
           to full opacity left the fade starting from 0 with nothing behind it,
           so the first frames of an arriving image were a blank card. */
        <Skeleton
          /* The sweep runs only while it can be seen. Far from the viewport (not yet `armed`)
             the compositor will not take an animation it cannot see, so each one ticked on the
             main thread instead — a style pass per frame for every placeholder of a page still
             loading, forty-odd on a phone (R12-010); and once the picture is in, the sweep
             under it is stopped rather than left running through the fade. */
          className={`absolute inset-0 block rounded-none transition-opacity duration-standard ease-[var(--ease-standard)] ${
            isLoaded ? 'opacity-0 after:animate-none' : armed ? 'opacity-100' : 'opacity-100 after:[animation-play-state:paused]'
          }`}
        />
      )}
      <Image
        {...props}
        key={displayKey}
        src={displaySrc}
        unoptimized={unoptimized || !shown.optimized}
        alt={props.alt || ''}
        ref={imgRef}
        className={`${className || ''} ${isLoaded || paintAsServed ? 'opacity-100' : 'opacity-0'} relative transition-opacity duration-standard ease-[var(--ease-standard)]`}
        onLoad={handleLoad}
        onError={fail}
        loading={props.loading ?? (eager ? 'eager' : 'lazy')}
        decoding={props.decoding ?? 'async'}
      />
    </div>
  );
}

/**
 * The give-up plate, in the enclosure's own size: nothing at an avatar's 32–40px (the avatar's
 * own glyph underneath is the better fallback), the broken-image glyph from 48px, and the
 * sentence once there is room for it. Sized by container query because the same component
 * serves a 32px avatar and a 1280px banner.
 */
function FailurePlate({ label, fill }: { label?: string; fill: boolean }) {
  return (
    <div
      role="img"
      aria-label={label ? `${label}（图片加载失败）` : '图片加载失败'}
      /* The container is transparent; the plate inside it only exists from 48px, so an avatar
         keeps showing its own glyph rather than a grey disc. */
      className={cn('@container relative h-full w-full overflow-hidden', fill && 'absolute inset-0')}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 hidden flex-col items-center justify-center gap-2 bg-surface-container-high px-2 text-center text-on-surface-variant @min-[3rem]:flex"
      >
        <MdBrokenImage size={ICON.standard} className="@min-[10rem]:size-9" />
        <span className="hidden text-label-m @min-[7.5rem]:block">图片加载失败</span>
      </div>
    </div>
  );
}
