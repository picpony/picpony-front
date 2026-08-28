'use client';

import { useOffline } from 'next/offline';
import { MdWifiOff } from 'react-icons/md';
import { ICON } from '@/lib/icons';

/**
 * Says so when the network is down.
 *
 * `useOffline` is `experimental.useOffline`'s hook and returns `false` unless that flag is on, so
 * this is inert without it. What the flag itself does is the larger half: a navigation, a
 * prefetch, an RSC fetch or a Server Action interrupted by a drop stays **pending and retries**
 * instead of throwing. This banner is the part that tells the user why something is taking a
 * while — without it, "pending" and "broken" look the same.
 *
 * It complements the service worker rather than overlapping it: `useOffline` covers soft
 * navigations inside a live document, and `public/sw.js` covers the one case no retry can reach,
 * a hard refresh with no network.
 *
 * `warning-fill`/`on-warning-fill` rather than `error`: being offline is a condition to work
 * around, not a failure. And the scheme-independent `*-fill` pair with `on-fill` over it — the pairing `Toast` uses — for the reason the snackbar
 * section gives — a severity must not arrive as one shade in light and another in dark.
 *
 * `role="status"`, not `alert`: it is a state, and an assertive interruption for something the
 * user can see in their own status bar is noise.
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
