'use client';

import Image, { ImageProps } from 'next/image';
import { useState, useEffect, useRef } from 'react';

interface FadeInImageProps extends ImageProps {
  fallbackSrc?: string;
}

export default function FadeInImage({ className, onLoad, ...props }: FadeInImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (imgRef.current?.complete) {
      setIsLoaded(true);
    }
  }, []);

  return (
    <Image
      {...props}
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
      loading="lazy"
    />
  );
}
