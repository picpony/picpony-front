'use client';

import Image, { ImageProps } from 'next/image';
import { useState, useEffect, useRef } from 'react';

interface FadeInImageProps extends ImageProps {
  fallbackSrc?: string;
  eager?: boolean;
}

export default function FadeInImage({ className, onLoad, eager = false, ...props }: FadeInImageProps) {
  const [isLoaded, setIsLoaded] = useState(eager);
  const [isInView, setIsInView] = useState(eager);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (eager) return;
    const container = containerRef.current;
    if (!container) return;
    const root = container.closest<HTMLElement>('[data-image-detail-background]');

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      {
        root,
        rootMargin: '300px',
      }
    );

    observer.observe(container);

    return () => observer.disconnect();
  }, [eager]);

  useEffect(() => {
    if (imgRef.current?.complete) {
      requestAnimationFrame(() => {
        setIsLoaded(true);
      });
    }
  }, [props.src]);

  return (
    <div 
      ref={containerRef}
      className="relative w-full h-full flex items-center justify-center overflow-hidden"
    >
      {isInView && (
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
          loading={props.loading ?? 'eager'}
        />
      )}
    </div>
  );
}
