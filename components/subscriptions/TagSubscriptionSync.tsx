'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { showToast } from '@/components/Toast';
import { useSession } from '@/lib/hooks';
import { runWhenIdle } from '@/lib/utils';
import { attemptSync, loadSyncDue, periodicSyncDue, SYNC_PERIOD_MS, type SyncResult } from './sync';

/** The original front end waited a second after `load` before its first run. */
const LOAD_DELAY_MS = 1000;

function announce(result: SyncResult, open: () => void) {
  if (!result.ok || result.updatedTags <= 0) return;
  /* The original's sentence: the notifications are what the sync just produced. */
  showToast(`有 ${result.updatedTags} 个订阅标签出现了新图片，已生成系统通知`, 'success', {
    action: { label: '查看', onClick: open },
  });
}

/**
 * Renders nothing: it keeps the tag-subscription sync on its schedule (`./sync.ts`) for the
 * signed-in account — once per tab session at load and right after a sign-in, then every ten
 * minutes while the tab is in view and on returning to it. Mounted once in the root layout,
 * outside maintenance (it writes to the account), like `SettingsSync`.
 */
export default function TagSubscriptionSync() {
  const { token, ready } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!ready || !token) return;
    let cancelIdle: (() => void) | null = null;
    let disposed = false;
    const attempt = () => {
      if (disposed || document.visibilityState === 'hidden') return;
      void attemptSync(token, (result) => {
        if (!disposed) announce(result, () => router.push('/subscriptions', { scroll: false }));
      });
    };
    const schedule = () => {
      cancelIdle?.();
      cancelIdle = runWhenIdle(attempt, 4000);
    };

    /* The first run of the session waits for the page to settle, then for an idle moment. */
    const first = loadSyncDue(token) ? window.setTimeout(schedule, LOAD_DELAY_MS) : 0;
    const periodic = () => {
      if (document.visibilityState === 'hidden' || !periodicSyncDue(token)) return;
      schedule();
    };
    const interval = window.setInterval(periodic, SYNC_PERIOD_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') periodic();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      window.clearTimeout(first);
      window.clearInterval(interval);
      cancelIdle?.();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ready, token, router]);

  return null;
}
