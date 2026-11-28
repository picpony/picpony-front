/**
 * /policy's four tabs and the address that names one — /settings' pattern (`app/settings/tabs.ts`):
 * the tab is in the address, written in place and never as a new entry (decision 18: Back leaves
 * the screen), so a reload restores it and a link — a sign-up dialog's 服务协议, a footer's 隐私政策 —
 * opens it (R7-038). Cookie 政策 is the bare address.
 */
import { isHistoryLayerState } from '@/lib/historyLayers';
import { hasModalLayer, subscribeScreenQuiet } from '@/lib/overlay';

export type PolicyTab = 'cookie' | 'agreement' | 'privacy' | 'faq';

const TABS: readonly PolicyTab[] = ['cookie', 'agreement', 'privacy', 'faq'];

export function isPolicyTab(value: unknown): value is PolicyTab {
  return typeof value === 'string' && (TABS as readonly string[]).includes(value);
}

/** The address of a tab: `policyHref('agreement')` for a link to 服务协议. */
export function policyHref(tab?: PolicyTab): string {
  return tab && tab !== 'cookie' ? `/policy?tab=${tab}` : '/policy';
}

let queued: PolicyTab | null = null;
let stopWaiting: (() => void) | null = null;

/**
 * Name the tab on screen in the address, in place. Under a modal layer the write waits, rather
 * than superseding the dialog's entry (`lib/historyLayers.ts`).
 */
export function replacePolicyAddress(tab: PolicyTab) {
  if (typeof window === 'undefined') return;
  queued = tab;
  writeQueued();
}

function writeQueued() {
  const here = window.location.pathname === '/policy';
  if (here && queued && isHistoryLayerState(window.history.state) && hasModalLayer()) {
    stopWaiting ??= subscribeScreenQuiet(writeQueued);
    return;
  }
  stopWaiting?.();
  stopWaiting = null;
  const tab = queued;
  queued = null;
  if (!here || !tab) return;
  const href = policyHref(tab);
  if (href !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, '', href);
}

/** A screen's waiting write goes with it. */
export function dropQueuedPolicyAddress() {
  queued = null;
  stopWaiting?.();
  stopWaiting = null;
}
