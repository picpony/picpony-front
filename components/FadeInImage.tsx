'use client';

import Image, { ImageProps } from 'next/image';
import { useState, useEffect, useRef } from 'react';

interface FadeInImageProps extends ImageProps {
  fallbackSrc?: string;
  eager?: boolean;
}

export default function FadeInImage({ className, onLoad, eager = false, ...props }: FadeInImageProps) {
  const [isLoaded, setIsLoaded] = useState(eager);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (imgRef.current?.complete) {
      requestAnimationFrame(() => {
        setIsLoaded(true);
      });
    }
  }, [props.src]);

  return (
    <div 
      className="relative w-full h-full flex items-center justify-center overflow-hidden"
    >
      <Image
        {...props}
        alt={props.alt || ""}
        ref={imgRef}
        className={`
          ${className || ''}
          transition-opacity duration-500 ease-in-out
          ${isLoaded ? 'opacity-100' : 'opacity-0'}
        `}
        onLoad={(e) => {
          setIsLoaded(true);
          if (onLoad) {
            onLoad(e);
          }
        }}
        // Keep the explicit `eager` escape hatch, but let the browser schedule
        // all ordinary thumbnails natively instead of mounting them during a
        // scroll when a per-image IntersectionObserver fires.
        loading={props.loading ?? (eager ? 'eager' : 'lazy')}
        decoding={props.decoding ?? 'async'}
      />
    </div>
  );
}
