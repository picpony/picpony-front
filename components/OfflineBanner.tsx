'use client';

import { useOffline } from 'next/offline';
import { MdWifiOff } from 'react-icons/md';
import { ICON } from '@/lib/icons';
import { cn } from '@/lib/utils';

const MESSAGE = '当前网络不可用，恢复后会自动重试';

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
 *
 * It opens and closes by its row's height on DefaultEffects, never over its own content.
 * The strip itself is presentation; the announcement is a separate, always-mounted status
 * region whose text changes, which is what makes a screen reader say it.
 *
 * `warning-fill`/`on-fill`, the scheme-independent severity pair, for the reason the snackbar
 * section gives: a severity must not arrive as one shade in light and another in dark.
 */
export default function OfflineBanner({ inert }: { inert?: boolean }) {
  const isOffline = useOffline();

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
