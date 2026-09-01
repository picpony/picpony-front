'use client';

import { useOffline } from 'next/offline';
import { MdWifiOff } from 'react-icons/md';
import { ICON } from '@/lib/icons';

/**
 * Says so when the network is down — the user-facing half of `useOffline`,
 * which keeps interrupted navigations pending and retrying. Without this banner
 * "pending" and "broken" look the same. Complements the service worker, which
 * covers the one case no retry reaches (a hard refresh with no network).
 *
 * `warning-fill`/`on-warning-fill` rather than an error tone, and the
 * scheme-independent `*-fill` pair, for the reason the snackbar section gives:
 * a severity must not arrive as one shade in light and another in dark.
 * `role="status"`, not `alert` — it is a state, not an interruption.
 */
export default function OfflineBanner() {
  const isOffline = useOffline();
  if (!isOffline) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-toast flex items-center justify-center gap-2 bg-warning-fill px-4 py-2 text-on-fill text-label-l"
    >
      <MdWifiOff size={ICON.dense} aria-hidden="true" />
      当前网络不可用，恢复后会自动重试
    </div>
  );
}
