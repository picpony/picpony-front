'use client';

import { useEffect } from 'react';
import { runWhenIdle } from '@/lib/utils';

/**
 * Registers `public/sw.js`. Renders nothing.
 *
 * Three details, each of which is the difference between this working and quietly not:
 *
 * - **`?v=<buildId>`.** A file in `public/` cannot see a build-time variable, so the worker reads
 *   its own version out of its registration URL. A changing URL is also the thing that makes the
 *   browser byte-compare and notice a new worker at all.
 * - **`updateViaCache: 'none'`.** Without it the browser may satisfy its own check for a new
 *   `sw.js` from the HTTP cache and never see one. `next.config.ts` also sends
 *   `Cache-Control: no-cache, no-store, must-revalidate` for that path — belt and braces, since
 *   the two failures look identical from outside.
 * - **`runWhenIdle`.** Registration competes with hydration for the main thread and buys nothing
 *   on this load — the worker does not control the page that registers it. It is for the *next*
 *   visit.
 *
 * Skipped under automation: `npm run net:audit` counts requests, and a worker that serves one
 * from a cache makes the count a function of run order rather than of the code.
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
          /* An unsupported browser, a private window, a blocked origin. Everything the worker does
             is an optimisation, so there is nothing to report and nothing to retry. */
        });
    });
  }, [version]);

  return null;
}
