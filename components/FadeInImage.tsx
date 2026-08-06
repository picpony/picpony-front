'use client';

import Image, { ImageProps } from 'next/image';
import { useState, useLayoutEffect, useRef } from 'react';

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
 */
export default function FadeInImage({
  className,
  onLoad,
  eager = false,
  shimmer = true,
  ...props
}: FadeInImageProps) {
  const [isLoaded, setIsLoaded] = useState(eager);
  const imgRef = useRef<HTMLImageElement>(null);

  useLayoutEffect(() => {
    // Synchronous complete check — no rAF (rAF during a fling is jank), and
    // before paint so a decoded image never shows a transparent frame.
    if (imgRef.current?.complete) setIsLoaded(true);
  }, [props.src]);

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
        alt={props.alt || ''}
        ref={imgRef}
        className={`${className || ''} ${isLoaded ? 'opacity-100' : 'opacity-0'} relative transition-opacity duration-200 ease-[var(--ease-standard)] motion-reduce:transition-none`}
        onLoad={(e) => {
          setIsLoaded(true);
          onLoad?.(e);
        }}
        loading={props.loading ?? (eager ? 'eager' : 'lazy')}
        decoding={props.decoding ?? 'async'}
      />
    </div>
  );
}
