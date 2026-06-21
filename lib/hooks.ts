'use client';

import { useEffect, useState } from 'react';

interface DisplayInfo {
  /** < 640px — 手机 */
  mobile: boolean;
  /** 640px ~ 1023px — 平板/小屏 */
  tablet: boolean;
  /** >= 1024px — 桌面 */
  desktop: boolean;
  /** 当前精确宽度 */
  width: number;
}

export function useDisplay(): DisplayInfo {
  const getDisplay = (): DisplayInfo => {
    if (typeof window === 'undefined') {
      return { mobile: false, tablet: false, desktop: true, width: 1200 };
    }
    const w = window.innerWidth;
    return {
      mobile: w < 640,
      tablet: w >= 640 && w < 1024,
      desktop: w >= 1024,
      width: w,
    };
  };

  const [display, setDisplay] = useState(getDisplay);

  useEffect(() => {
    const update = () => setDisplay(getDisplay());
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return display;
}

export function useMasonryColumns() {
  const getInitialColumns = () => {
    if (typeof window === 'undefined') return 4;
    if (window.innerWidth < 640) return 2;
    if (window.innerWidth < 768) return 2;
    if (window.innerWidth < 1024) return 3;
    return 4;
  };

  const [columns, setColumns] = useState(getInitialColumns);

  useEffect(() => {
    const updateColumns = () => {
      if (window.innerWidth < 640) setColumns(2);
      else if (window.innerWidth < 768) setColumns(2);
      else if (window.innerWidth < 1024) setColumns(3);
      else setColumns(4);
    };

    window.addEventListener('resize', updateColumns);
    return () => window.removeEventListener('resize', updateColumns);
  }, []);

  return columns;
}

export function useAuth() {
  const getUserInfo = (): { token: string; [key: string]: unknown } | null => {
    if (typeof window === 'undefined') return null;
    try {
      const stored = localStorage.getItem('user_info');
      if (!stored) return null;
      return JSON.parse(stored);
    } catch {
      return null;
    }
  };

  const getToken = (): string | null => {
    const user = getUserInfo();
    return user?.token || null;
  };

  return { getUserInfo, getToken };
}

export function useModalAnimation(onClose: () => void) {
  const [isClosing, setIsClosing] = useState(false);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 200);
  };

  return { isClosing, handleClose };
}
