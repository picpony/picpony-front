'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (container: string | HTMLElement, options: TurnstileRenderOptions) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
    onTurnstileLoad?: () => void;
  }
}

interface TurnstileRenderOptions {
  sitekey: string;
  callback?: (token: string) => void;
  'error-callback'?: (error: string) => void;
  'expired-callback'?: () => void;
  theme?: 'light' | 'dark' | 'auto';
  size?: 'normal' | 'compact';
  appearance?: 'always' | 'execute' | 'interaction-only';
  language?: string;
  retry?: 'auto' | 'never';
  'retry-interval'?: number;
  'response-field'?: boolean;
}

interface TurnstileProps {
  onVerify: (token: string) => void;
  onError?: (error: string) => void;
  onExpire?: () => void;
  theme?: 'light' | 'dark' | 'auto';
  size?: 'normal' | 'compact';
  language?: string;
  className?: string;
}

const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

let scriptLoaded = false;
let scriptLoading = false;
const pendingCallbacks: (() => void)[] = [];

function loadTurnstileScript() {
  if (scriptLoaded) return Promise.resolve();
  if (scriptLoading) {
    return new Promise<void>((resolve) => {
      pendingCallbacks.push(resolve);
    });
  }

  scriptLoading = true;
  return new Promise<void>((resolve) => {
    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;

    const onLoad = () => {
      scriptLoaded = true;
      scriptLoading = false;
      pendingCallbacks.forEach((cb) => cb());
      pendingCallbacks.length = 0;
      resolve();
    };

    script.onload = onLoad;
    script.onerror = () => {
      scriptLoading = false;
      resolve();
    };

    document.head.appendChild(script);
  });
}

export default function Turnstile({
  onVerify,
  onError,
  onExpire,
  theme = 'auto',
  size = 'normal',
  language = 'zh-CN',
  className = '',
}: TurnstileProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [mounted, setMounted] = useState(false);

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '1x00000000000000000000AA';

  const renderWidget = useCallback(() => {
    if (!containerRef.current || !window.turnstile) return;

    // 清除旧的 widget
    if (widgetIdRef.current) {
      try {
        window.turnstile.remove(widgetIdRef.current);
      } catch {}
      widgetIdRef.current = null;
    }

    // 清空容器
    containerRef.current.innerHTML = '';

    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      callback: onVerify,
      'error-callback': onError || (() => {}),
      'expired-callback': onExpire || (() => {}),
      theme,
      size,
      language,
      retry: 'auto',
      'retry-interval': 2000,
    });
  }, [siteKey, onVerify, onError, onExpire, theme, size, language]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    loadTurnstileScript().then(() => {
      // 等待 turnstile API 就绪
      const tryRender = () => {
        if (window.turnstile) {
          renderWidget();
        } else {
          setTimeout(tryRender, 100);
        }
      };
      tryRender();
    });

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {}
        widgetIdRef.current = null;
      }
    };
  }, [mounted, renderWidget]);

  if (!mounted) return null;

  return (
    <div className={`flex justify-center ${className}`}>
      <div ref={containerRef} />
    </div>
  );
}
