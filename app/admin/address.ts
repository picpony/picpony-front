import { isHistoryLayerState } from '@/lib/historyLayers';
import { hasModalLayer, subscribeScreenQuiet } from '@/lib/overlay';
import { DEFAULT_ADMIN_TAB, type AdminTabId } from '@/components/admin/registry';

/*
 * The console names its section in the address **in place** — never a new entry (decision 18:
 * an in-page tab switch writes no history, so Back leaves the console), and a reload or a shared
 * link opens the same section. The overview is the bare `/admin`.
 *
 * Under a modal layer the write waits rather than being dropped: while a dialog owns the current
 * entry, a write that changed the address would supersede it (`lib/historyLayers.ts`), so it lands
 * once the screen is quiet — the same arrangement as /settings' `replaceSettingsAddress`.
 */

let queued: AdminTabId | null = null;
let stopWaiting: (() => void) | null = null;

export function replaceAdminAddress(tab: AdminTabId) {
  if (typeof window === 'undefined') return;
  queued = tab;
  writeQueued();
}

function writeQueued() {
  const here = window.location.pathname === '/admin';
  if (here && queued && isHistoryLayerState(window.history.state) && hasModalLayer()) {
    stopWaiting ??= subscribeScreenQuiet(writeQueued);
    return;
  }
  stopWaiting?.();
  stopWaiting = null;
  const tab = queued;
  queued = null;
  if (!here || !tab) return;
  const params = new URLSearchParams(window.location.search);
  if (tab === DEFAULT_ADMIN_TAB) params.delete('tab');
  else params.set('tab', tab);
  const query = params.toString();
  const href = query ? `/admin?${query}` : '/admin';
  if (href !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, '', href);
}

/** The console's waiting write goes with it. */
export function dropQueuedAdminAddress() {
  queued = null;
  stopWaiting?.();
  stopWaiting = null;
}
