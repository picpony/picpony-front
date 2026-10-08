/**
 * /settings' three tabs (decision 23) and the address that names one.
 *
 * **偏好** is how the app browses — content, display, lines, notifications and the defaults later
 * features add. **账户** is the account itself — its public page, sign-in security, the
 * Derpibooru binding and its privacy. **个性化** is how it looks and feels — the theme and its
 * colours, mode and motion, the mascot and the desktop ponies.
 *
 * **Signed out, 账户 is not offered** (the owner's call, the /messages pattern of decision 22): the
 * row is 偏好 and 个性化, both device-local until signing in. A link into 账户 lands on 偏好, the
 * address is corrected in place, and the request is kept — signing in on the spot reveals the tab
 * and opens it once the sign-in dialog has gone. To offer 账户 with a sign-in prompt instead, set
 * `ACCOUNT_TAB_SIGNED_OUT` to `'prompt'`; the pane already renders `SignInRequired` when asked to.
 */
import { isHistoryLayerState } from '@/lib/historyLayers';
import { hasModalLayer, subscribeScreenQuiet } from '@/lib/overlay';

export type SettingsTab = 'preferences' | 'account' | 'personalise';

export const ACCOUNT_TAB_SIGNED_OUT: 'hidden' | 'prompt' = 'hidden';

const LABELS: Record<SettingsTab, string> = { preferences: '偏好', account: '账户', personalise: '个性化' };

export function isSettingsTab(value: unknown): value is SettingsTab {
  return value === 'preferences' || value === 'account' || value === 'personalise';
}

/** The row, in the owner's order. */
export function settingsTabs(signedIn: boolean): { value: SettingsTab; label: string }[] {
  const offered: SettingsTab[] =
    signedIn || ACCOUNT_TAB_SIGNED_OUT === 'prompt' ? ['preferences', 'account', 'personalise'] : ['preferences', 'personalise'];
  return offered.map((value) => ({ value, label: LABELS[value] }));
}

/** Where a request for `tab` lands: itself when offered, else 偏好. */
export function landingTab(tab: SettingsTab, signedIn: boolean): SettingsTab {
  return settingsTabs(signedIn).some((item) => item.value === tab) ? tab : 'preferences';
}

/**
 * The address of a tab: `settingsHref('account')` for a prompt that sends somebody to bind an API
 * key or verify an address; `settingsHref()` — the bare address — for content settings (偏好 is
 * the default tab).
 */
export function settingsHref(tab?: SettingsTab): string {
  return tab && tab !== 'preferences' ? `/settings?tab=${tab}` : '/settings';
}

/* An address write waiting for a modal surface (the sign-in dialog) to close. */
let queued: SettingsTab | null = null;
let stopWaiting: (() => void) | null = null;

/**
 * Name the tab on screen in the address, in place — never a new entry (decision 18: Back leaves
 * the screen), so a reload restores the tab and a shared link opens it. **Under a modal layer
 * the write waits** rather than being dropped: while a dialog owns the current entry a write that
 * changes the address would supersede it (`lib/historyLayers.ts`), so it lands once the screen is
 * quiet. (The /messages screen's writer, for one parameter.)
 */
export function replaceSettingsAddress(tab: SettingsTab) {
  if (typeof window === 'undefined') return;
  queued = tab;
  writeQueued();
}

function writeQueued() {
  const here = window.location.pathname === '/settings';
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
  if (tab === 'preferences') params.delete('tab');
  else params.set('tab', tab);
  const query = params.toString();
  const href = query ? `/settings?${query}` : '/settings';
  if (href !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, '', href);
}

/** A screen's waiting write goes with it. */
export function dropQueuedSettingsAddress() {
  queued = null;
  stopWaiting?.();
  stopWaiting = null;
}
