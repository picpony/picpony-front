'use client';

import { useEffect } from 'react';
import { runWhenIdle } from '@/lib/utils';

/**
 * Registers `public/sw.js`. Renders nothing.
 *
 * - `?v=<buildId>`: a file in `public/` cannot see a build-time variable, and a
 *   changing script URL is what makes the browser byte-compare and find a new
 *   worker at all.
 * - `updateViaCache: 'none'`: without it the browser may satisfy its own update
 *   check from the HTTP cache and never see one (the response header on that
 *   path covers the other half of that failure).
 * - `runWhenIdle`: registration competes with hydration for the main thread and
 *   buys nothing on this load — it is for the *next* visit.
 *
 * Skipped under automation, so `npm run net:audit` measures the code rather
 * than a cache.
 */
export default function ServiceWorker({ version }: { version: string }) {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    if (navigator.webdriver) return;
    if (process.env.NODE_ENV !== 'production') return;
    return runWhenIdle(() => {
      void navigator.serviceWorker
        .register(`/sw.js?v=${encodeURIComponent(version)}`, {
          scope: '/',
          updateViaCache: 'none',
        })
        .catch(() => {
          /* Unsupported browser, private window, blocked origin — everything
             the worker does is an optimisation; nothing to report or retry. */
        });
    });
  }, [version]);

  return null;
}
