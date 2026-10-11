'use client';

import { useEffect, useState } from 'react';
import { useOffline } from 'next/offline';
import { MdWifiOff } from 'react-icons/md';
import { ICON } from '@/lib/icons';
import { cn } from '@/lib/utils';

const MESSAGE = '当前网络不可用，恢复后会自动重试';

/**
 * How long Next's offline state has to hold before the banner opens. A failed navigation request
 * flips it on and Next's own connectivity check — a `HEAD` aborted after 200ms, which counts as
 * online when the server is reachable — flips it off a fraction of a second later; while a
 * request keeps failing against a reachable server (a dev server mid-compile, a 5xx proxy) the
 * two alternate several times a second. Followed directly, the banner opened and closed with each
 * flip and moved the page under it by its height each time — 14 opens in 4 seconds, measured.
 * A real outage holds for longer than this.
 */
const OPEN_AFTER_MS = 1000;
/**
 * How long the state has to hold online before an open banner closes, so a check that succeeds
 * between two failures does not take it down and put it back.
 */
const CLOSE_AFTER_MS = 1500;

/**
 * Next's offline state, held to a settled answer: on only once it has held on for
 * `OPEN_AFTER_MS`, off only once it has held off for `CLOSE_AFTER_MS`. Each change restarts the
 * wait, so a state flickering faster than either never reaches the screen.
 */
function useSettledOffline(): boolean {
  const offline = useOffline();
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (offline === settled) return;
    const timer = window.setTimeout(() => setSettled(offline), offline ? OPEN_AFTER_MS : CLOSE_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [offline, settled]);
  return settled;
}

/**
 * Says so when the network is down — the user-facing half of `useOffline`, which keeps
 * interrupted navigations pending and retrying. Without this banner "pending" and "broken"
 * look the same. Complements the service worker, which covers the one case no retry reaches
 * (a hard refresh with no network).
 *
 * **Under the app bar, in the chrome, where M3 puts a banner.** It was a strip fixed to the
 * bottom of the window, and there it covered the home tab pill, the chat composer and the
 * image detail's actions, with no safe-area inset. In the chrome it covers nothing: the
 * content below moves down by one row while it is up, and because it is inside the element
 * `--app-chrome-bottom` measures, toasts hang below it and the navigation progress line —
 * which keeps crawling while a navigation waits for the network — rides its bottom edge.
 * That move is why it follows a settled answer (`useSettledOffline`), not every flip.
 *
 * It opens and closes by its row's height on DefaultEffects, never over its own content.
 * The strip itself is presentation; the announcement is a separate, always-mounted status
 * region whose text changes, which is what makes a screen reader say it.
 *
 * `warning-fill`/`on-fill`, the scheme-independent severity pair, for the reason the snackbar
 * section gives: a severity must not arrive as one shade in light and another in dark.
 */
export default function OfflineBanner({ inert }: { inert?: boolean }) {
  const isOffline = useSettledOffline();

  return (
    <>
      <div role="status" className="sr-only">
        {isOffline ? MESSAGE : ''}
      </div>
      <div
        aria-hidden="true"
        inert={inert || !isOffline || undefined}
        className={cn(
          'grid shrink-0 transition-[grid-template-rows] spring-default-effects',
          isOffline ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="bg-warning-fill text-on-fill text-label-l flex select-none items-center justify-center gap-2 py-2 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
            <MdWifiOff size={ICON.dense} aria-hidden="true" />
            {MESSAGE}
          </div>
        </div>
      </div>
    </>
  );
}
