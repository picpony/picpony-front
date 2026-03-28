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
  }, [props.src]);

  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-8 h-8 border-[4px] border-transparent border-t-primary rounded-full animate-[spin_0.5s_linear_infinite]"></div>
        </div>
      )}
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
    </div>
  );
}
