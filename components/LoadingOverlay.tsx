'use client';

import { useEffect, useState } from 'react';

export default function LoadingOverlay() {
  const [isVisible, setIsVisible] = useState(true);
  const [isMounted, setIsMounted] = useState(true);

  useEffect(() => {
    const fadeOutTimer = setTimeout(() => {
      setIsVisible(false);
    }, 500);

    const unmountTimer = setTimeout(() => {
      setIsMounted(false);
    }, 1000);

    return () => {
      clearTimeout(fadeOutTimer);
      clearTimeout(unmountTimer);
    };
  }, []);

  if (!isMounted) return null;

  return (
    <div 
      className={`fixed inset-0 z-[9999] bg-white flex items-center justify-center transition-opacity duration-500 ease-in-out ${
        isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      <img 
        src="/img/picpony.svg"
        className="w-32 h-auto opacity-10" 
      />
    </div>
  );
}
