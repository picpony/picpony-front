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
 * Three things were wrong before:
 *
 * 1. Two loading languages ran back to back. `ImageGridSkeleton` shimmered,
 *    then the real grid swapped in and showed a flat `surface-container-high`
 *    while each thumb decoded, then each thumb faded. The flat grey in the
 *    middle was exactly the "unstyled colour" the shimmer existed to prevent.
 *    The shimmer now continues *under* the real card until its own image is
 *    ready, so the placeholder never stops mid-sentence.
 *
 * 2. Cached images flickered. The `complete` check ran in `useEffect`, which
 *    fires after paint — so returning to the gallery painted at least one frame
 *    at `opacity: 0` and then faded in over 150ms, on an image the browser
 *    already had. `useLayoutEffect` runs before paint, so a warm image is
 *    simply there.
 *
 * 3. The fade used Tailwind's `ease-out` at 150ms, matching nothing else. It is
 *    a utility fade now: `standard`, 200ms.
 *
 * The card-level entrance cascade (`useStaggerGrid`) animates the tile, not the
 * picture — the two used to fade independently and their opacities multiplied.
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
  const imgRef = useRef<HTMLImageElement>(null);
  const src = typeof props.src === 'string' ? props.src : '';
  // 挂载时一次性初始化分层尝试（key 变化会重挂载）
  const [attempt, setAttempt] = useState<LoadAttempt | null>(() =>
    useLayers ? createInitialAttempt(getRawImageUrl(src), proxyThumb) : null,
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

  useLayoutEffect(() => {
    // Synchronous complete check — no rAF (rAF during a fling is jank), and
    // before paint so a decoded image never shows a transparent frame.
    if (imgRef.current?.complete) setIsLoaded(true);
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
      {shimmer && !isLoaded && (
        <span
          aria-hidden="true"
          className="skeleton bg-surface-container-high absolute inset-0 block"
        />
      )}
      <Image
        {...props}
        src={displaySrc}
        alt={props.alt || ''}
        ref={imgRef}
        className={`${className || ''} ${isLoaded ? 'opacity-100' : 'opacity-0'} relative transition-opacity duration-200 ease-[var(--ease-standard)] motion-reduce:transition-none`}
        onLoad={handleLoad}
        onError={handleError}
        loading={props.loading ?? (eager ? 'eager' : 'lazy')}
        decoding={props.decoding ?? 'async'}
      />
    </div>
  );
}
