/**
 * /favorites' tabs and the address that names one — /settings' pattern (`app/settings/tabs.ts`):
 * the tab is in the address, written in place and never as a new entry (decision 18: Back leaves
 * the screen), so a reload restores it and a link opens it.
 *
 * **隐私空间 is offered only while 显示隐私空间 (`showPrivacyFaves`) is on** — the original front end
 * showed its privacy page under the same switch. A link naming it lands on 收藏夹 otherwise, the
 * address corrected in place.
 */
import { isHistoryLayerState } from '@/lib/historyLayers';
import { hasModalLayer, subscribeScreenQuiet } from '@/lib/overlay';
import { favoritesHref, type FavoritesTab } from '@/lib/favorites';

const LABELS: Record<FavoritesTab, string> = { folders: '收藏夹', derpibooru: 'Derpibooru', privacy: '隐私空间' };

/** The row, in its order. */
export function favoritesTabs(showPrivacy: boolean): { value: FavoritesTab; label: string }[] {
  const offered: FavoritesTab[] = showPrivacy ? ['folders', 'derpibooru', 'privacy'] : ['folders', 'derpibooru'];
  return offered.map((value) => ({ value, label: LABELS[value] }));
}

/** Where a request for `tab` lands: itself when offered, else 收藏夹. */
export function landingTab(tab: FavoritesTab, showPrivacy: boolean): FavoritesTab {
  return favoritesTabs(showPrivacy).some((item) => item.value === tab) ? tab : 'folders';
}

let queued: FavoritesTab | null = null;
let stopWaiting: (() => void) | null = null;

/**
 * Name the tab on screen in the address, in place. Under a modal layer the write waits, rather
 * than superseding the dialog's entry (`lib/historyLayers.ts`).
 */
export function replaceFavoritesAddress(tab: FavoritesTab) {
  if (typeof window === 'undefined') return;
  queued = tab;
  writeQueued();
}

function writeQueued() {
  const here = window.location.pathname === '/favorites';
  if (here && queued && isHistoryLayerState(window.history.state) && hasModalLayer()) {
    stopWaiting ??= subscribeScreenQuiet(writeQueued);
    return;
  }
  stopWaiting?.();
  stopWaiting = null;
  const tab = queued;
  queued = null;
  if (!here || !tab) return;
  const href = favoritesHref(tab);
  if (href !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, '', href);
}

/** A screen's waiting write goes with it. */
export function dropQueuedFavoritesAddress() {
  queued = null;
  stopWaiting?.();
  stopWaiting = null;
}
