'use client';

import Image, { ImageProps } from 'next/image';
import { useState, useEffect, useRef } from 'react';

interface FadeInImageProps extends ImageProps {
  fallbackSrc?: string;
  eager?: boolean;
}

/**
 * Lightweight fade-in. Avoids per-image rAF + long CSS transitions that thrash
 * the gallery scroll frame on low-end devices when many thumbs decode at once.
 */
export default function FadeInImage({ className, onLoad, eager = false, ...props }: FadeInImageProps) {
  const [isLoaded, setIsLoaded] = useState(eager);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    // Synchronous complete check — no rAF (rAF during fling = jank).
    if (imgRef.current?.complete) {
      setIsLoaded(true);
    }
  }, [props.src]);

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden contain-paint">
      <Image
        {...props}
        alt={props.alt || ''}
        ref={imgRef}
        className={`${className || ''} ${isLoaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-150 ease-out`}
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
