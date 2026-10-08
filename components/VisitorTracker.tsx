'use client';

import { useEffect } from 'react';
import { trackVisitor } from '@/lib/api/tracking';
import { LS_KEYS } from '@/lib/constants';
import { readToken } from '@/lib/hooks';
import { runWhenIdle } from '@/lib/utils';
import { createVisitorTracker, trackingAllowed, VISIT_INTERVAL_MS } from '@/lib/visitor';

/**
 * Renders nothing: it counts visits for the site's statistics (`track_visitor`, decision 15)
 * — at load, every ten minutes while the tab is in view, and on returning to it — by the rules in
 * `lib/visitor.ts`: production builds only, never under automation or headless, never a
 * signed-in visitor, the pathname alone. Never on the critical path: the first count waits for an idle moment, and
 * nothing waits on any of them.
 */
export default function VisitorTracker() {
  useEffect(() => {
    if (!trackingAllowed(process.env.NODE_ENV, typeof navigator === 'undefined' ? undefined : navigator)) return;
    const tracker = createVisitorTracker({
      now: Date.now,
      isHidden: () => document.visibilityState === 'hidden',
      isSignedIn: () => readToken() !== null,
      readId: () => {
        try {
          return localStorage.getItem(LS_KEYS.visitorId);
        } catch {
          return null;
        }
      },
      storeId: (id) => {
        try {
          localStorage.setItem(LS_KEYS.visitorId, id);
        } catch {
          /* Refused storage: this load is counted under an id the next load will not know. */
        }
      },
      pathname: () => window.location.pathname,
      send: trackVisitor,
    });
    const count = () => void tracker.visit();
    const cancelFirst = runWhenIdle(count, 4000);
    const interval = window.setInterval(count, VISIT_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') count();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelFirst();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return null;
}
