'use client';

import Image, { ImageProps } from 'next/image';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  createInitialAttempt,
  getRawImageUrl,
  isResilientImageUrl,
  LOAD_TIMEOUT_MS,
  resolveNextAttempt,
  type LoadAttempt,
} from '@/lib/imageLoader';
import Skeleton from '@/components/Skeleton';
import { DURATION } from '@/lib/motionTokens';
import { MOTION_SPEED_SCALE } from '@/lib/appearance';
import { useSsrImageLine } from '@/components/ImageLineProvider';

interface FadeInImageProps extends ImageProps {
  fallbackSrc?: string;
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
   * 启用分层加载：PicPony 加速代理 → CDN → 直连，失败自动降级重试。
   * 仅对 Derpibooru 系图片（derpicdn / trixiebooru / wsrv / 147052 包装）生效。
   */
  resilient?: boolean;
  /** 走 PicPony 加速代理时附带缩略图优化参数（_thumb=1） */
  proxyThumb?: boolean;
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
 * 分层加载（resilient）时，外层用 src 作 key 强制重挂载内层，让内层用
 * lazy initializer 一次性初始化分层状态，避免在 effect 中同步 setState。
 */
export default function FadeInImage({
  resilient = false,
  ...props
}: FadeInImageProps) {
  // 仅字符串 URL 参与分层；静态导入（StaticImport）走普通加载
  const src = typeof props.src === 'string' ? props.src : '';
  const useLayers = resilient && !!src && isResilientImageUrl(src);
  return (
    <FadeInImageInner
      key={useLayers ? src : 'plain'}
      useLayers={useLayers}
      {...props}
    />
  );
}

function FadeInImageInner({
  className,
  onLoad,
  eager = false,
  shimmer = true,
  useLayers,
  proxyThumb = false,
  ...props
}: FadeInImageProps & { useLayers: boolean }) {
  const [isLoaded, setIsLoaded] = useState(eager);
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
  // 挂载时一次性初始化分层尝试（key 变化会重挂载）
   /* The line the *server* used, when there is one. Without it this component resolves
      the line itself on both sides of hydration and every server-rendered `<img>`
      mismatches for anyone who changed the setting — and React leaves a mismatched
      attribute alone, so the preference was ignored for the whole first screen.
      See `components/ImageLineProvider.tsx`. */
  const ssrLine = useSsrImageLine();
  const [attempt, setAttempt] = useState<LoadAttempt | null>(() =>
    useLayers ? createInitialAttempt(getRawImageUrl(src), proxyThumb, ssrLine) : null,
  );
  const rawUrlRef = useRef(getRawImageUrl(src));
  const loadedRef = useRef(false);
  const timerRef = useRef(0);
  const displaySrc = attempt?.url ?? props.src;

  // 单次加载超时保护：超时未 onload 视同失败，走降级链
  useEffect(() => {
    if (!attempt || attempt.giveUp) return;
    loadedRef.current = false;
    timerRef.current = window.setTimeout(() => {
      if (loadedRef.current) return;
      setAttempt((a) =>
        a && !a.giveUp ? resolveNextAttempt(rawUrlRef.current, a, proxyThumb) : a,
      );
    }, LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timerRef.current);
  }, [attempt, proxyThumb]);

  useEffect(() => {
    if (!isLoaded) return;
    const timer = window.setTimeout(
      () => setPlaceholderGone(true),
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

       **And it must reset.** `displaySrc` changes every time the layered loader
       steps down to the next line, and this only ever set `true` — so a card that
       had loaded anything never shimmered again. Assigning the predicate rather
       than only raising it is the whole fix. */
    const img = imgRef.current;
    const loaded = Boolean(img?.complete && img.naturalWidth > 0);
    setIsLoaded(loaded);
    /* The placeholder's own latch resets here rather than in an effect of its own:
       it is the same fact as `isLoaded`. */
    if (!loaded) setPlaceholderGone(false);
  }, [displaySrc]);

  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    loadedRef.current = true;
    window.clearTimeout(timerRef.current);
    setIsLoaded(true);
    onLoad?.(e);
  };

  const handleError = () => {
    // 分层加载失败 → 降级下一层；giveUp 后不再重试（渲染占位）
    if (useLayers) {
      setAttempt((a) =>
        a && !a.giveUp ? resolveNextAttempt(rawUrlRef.current, a, proxyThumb) : a,
      );
    }
  };

  // 所有分层都失败：显示占位而非 broken 图标
  if (useLayers && attempt?.giveUp) {
    return (
      <div className="relative flex h-full w-full items-center justify-center overflow-hidden contain-paint bg-surface-container-high">
        <span className="px-2 text-center text-label-m text-on-surface-variant">
          {props.alt || '图片加载失败'}
        </span>
      </div>
    );
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
          className={`absolute inset-0 block rounded-none transition-opacity duration-standard ease-[var(--ease-standard)] ${
            isLoaded ? 'opacity-0' : 'opacity-100'
          }`}
        />
      )}
      <Image
        {...props}
        src={displaySrc}
        alt={props.alt || ''}
        ref={imgRef}
        className={`${className || ''} ${isLoaded ? 'opacity-100' : 'opacity-0'} relative transition-opacity duration-standard ease-[var(--ease-standard)]`}
        onLoad={handleLoad}
        onError={handleError}
        loading={props.loading ?? (eager ? 'eager' : 'lazy')}
        decoding={props.decoding ?? 'async'}
      />
    </div>
  );
}
