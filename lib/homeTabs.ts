'use client';

/**
 * The home route's 图库 / 论坛 pill as Android bottom navigation — the history half.
 *
 * **Tabs do not make history, with one deliberate exception.** Every other tab row in the app
 * is local state and Back leaves the screen. The home pill is navigation between the app's
 * two top-level destinations, and follows the platform's bottom-navigation model: the start
 * destination (图库) is always at the bottom of the stack, the other one (论坛) sits at most one
 * entry above it, and switching back and forth never accumulates entries. So from 论坛, Back
 * returns to 图库 exactly once, and from 图库 it leaves.
 *
 * - 图库 → 论坛 **pushes** one entry.
 * - 论坛 → 图库 **goes back** to the entry below when that entry is this route's gallery —
 *   the common case, and it keeps the stack at one entry; when it is not (论坛 was reached
 *   through a link from another screen), it **replaces** instead, so Back still leaves.
 * - A cold entry at `/?tab=forum` (a shared link, a new tab, the thread's "up" on a cold
 *   entry) has nothing below it, so the gallery entry is put there: the current entry
 *   becomes `/` and `/?tab=forum` is pushed over it — the synthetic back stack a platform
 *   builds for a deep link into a non-start destination.
 *
 * The writes are native `history.pushState` / `replaceState` / `back`, which Next's router
 * integrates: `useSearchParams` follows, nothing is fetched, and nothing races another
 * navigation (see AGENTS.md on why a tab switch is not `router.push`). A traversal lands a task
 * later, so a switch requested while one of ours is still in flight is held until it lands.
 *
 * **The write waits for the tap's first frame.** Next applies a history write through React,
 * and React gives an update made inside a tap's event the event's priority: written in the tap's
 * own task, the whole route re-rendered synchronously there (router, shell, both panes, every
 * card — ~35ms of React on a desktop, several times that on a phone) before the transition's
 * first frame could be drawn. Written after that frame, the same update is an ordinary
 * transition, rendered in slices while the compositor runs the slide. The delay is one frame,
 * and it cannot race: the next `pointerdown` or `keydown` anywhere writes it at once, before
 * that input's own handlers can start a navigation, and a traversal in between (Back) cancels
 * it, since the entry it was meant for is gone.
 */

import { settleHistoryLayers } from '@/lib/historyLayers';

export type HomeTab = 'gallery' | 'forum';

export function homeTabOf(search: URLSearchParams | string): HomeTab {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  return params.get('tab') === 'forum' ? 'forum' : 'gallery';
}

/** The home URL for `tab`, keeping every other parameter the current one carries. */
export function homeTabHref(tab: HomeTab, search: string = window.location.search): string {
  const params = new URLSearchParams(search);
  if (tab === 'gallery') params.delete('tab');
  else params.set('tab', tab);
  const qs = params.toString();
  return qs ? `/?${qs}` : '/';
}

type NavigationEntryLike = { url?: string | null; index?: number };
type NavigationLike = {
  currentEntry?: NavigationEntryLike | null;
  entries?: () => NavigationEntryLike[];
};

const navigationApi = () =>
  (window as unknown as { navigation?: NavigationLike }).navigation ?? null;

/** Whether `url` is this route's gallery tab. */
function isGalleryEntry(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin && parsed.pathname === '/' &&
      homeTabOf(parsed.search) === 'gallery';
  } catch {
    return false;
  }
}

/* The fallback where the Navigation API is missing: the forum entry this module pushed
   directly above a gallery entry, identified by its URL and the history length at the time. A
   traversal away and back does not disturb either, and anything else that moves the stack
   (a push elsewhere) changes the length. */
let pushedForum: { href: string; length: number } | null = null;

/** Whether the entry directly behind the current one is this route's gallery. */
function galleryIsBehind(): boolean {
  const nav = navigationApi();
  if (nav?.currentEntry && typeof nav.currentEntry.index === 'number' && nav.entries) {
    const index = nav.currentEntry.index;
    if (index <= 0) return false;
    return isGalleryEntry(nav.entries()[index - 1]?.url);
  }
  return (
    pushedForum !== null &&
    pushedForum.href === `${window.location.pathname}${window.location.search}` &&
    pushedForum.length === window.history.length
  );
}

/* The tab the latest request asked for, and whether a write is waiting for history to be
   ours to write — an overlay's entry to be unwound, or our own traversal to land. The latest
   request wins; a burst of taps settles on the last one. */
let wanted: HomeTab | null = null;
let waiting = false;
let traversing = false;

function applyWanted(): void {
  waiting = false;
  const to = wanted;
  wanted = null;
  if (!to || window.location.pathname !== '/' || homeTabOf(window.location.search) === to) return;
  if (to === 'forum') {
    const href = homeTabHref('forum');
    window.history.pushState(null, '', href);
    pushedForum = { href, length: window.history.length };
    return;
  }
  if (galleryIsBehind()) {
    traversing = true;
    const landed = () => {
      window.removeEventListener('popstate', landed);
      traversing = false;
      if (wanted) schedule();
    };
    window.addEventListener('popstate', landed);
    window.history.back();
    return;
  }
  window.history.replaceState(null, '', homeTabHref('gallery'));
}

/**
 * Runs `write` once the frame after this task has been drawn — or at once, ahead of the next
 * input that could start a navigation. A traversal first cancels it (see the module note).
 */
function afterFirstFrame(write: () => void): void {
  let frame = 0;
  let timer = 0;
  const stop = () => {
    window.removeEventListener('pointerdown', flush, true);
    window.removeEventListener('keydown', flush, true);
    window.removeEventListener('popstate', cancel, true);
    window.cancelAnimationFrame(frame);
    window.clearTimeout(timer);
  };
  function flush() {
    stop();
    write();
  }
  function cancel() {
    stop();
    waiting = false;
    wanted = null;
  }
  window.addEventListener('pointerdown', flush, true);
  window.addEventListener('keydown', flush, true);
  window.addEventListener('popstate', cancel, true);
  frame = window.requestAnimationFrame(() => {
    timer = window.setTimeout(flush, 0);
  });
}

function schedule(): void {
  if (waiting || traversing) return;
  waiting = true;
  /* An open overlay holds a same-URL entry above the page (`lib/historyLayers.ts`); deciding
     push / back / replace against *that* entry would read the page itself as "the entry
     behind". Settling first unwinds it — a microtask when nothing is open — and the write
     then waits for the tap's first frame. */
  const deferred = () => afterFirstFrame(applyWanted);
  void settleHistoryLayers().then(deferred, deferred);
}

/**
 * Put `to` in the URL, the bottom-navigation way. Call it on the tap, after starting the
 * pane transition (the panes follow the URL; the transition is what the tap shows at once).
 */
export function writeHomeTab(to: HomeTab): void {
  if (typeof window === 'undefined' || window.location.pathname !== '/') return;
  wanted = to;
  schedule();
}

/**
 * The synthetic stack for a cold entry at `/?tab=forum`: with nothing of the app's behind the
 * current entry, it becomes the gallery and the forum is pushed over it. Idempotent; a no-op
 * anywhere but a forum entry that is the first of this app's history. Without the Navigation
 * API, "first" can only be read as "the first entry of the tab", which is the deep-link case.
 */
export function ensureHomeBackStack(): void {
  if (typeof window === 'undefined') return;
  void settleHistoryLayers().then(() => {
    if (window.location.pathname !== '/' || homeTabOf(window.location.search) !== 'forum') return;
    const nav = navigationApi();
    const first =
      nav?.currentEntry && typeof nav.currentEntry.index === 'number'
        ? nav.currentEntry.index === 0
        : window.history.length === 1;
    if (!first) return;
    /* Both writes in one task: Next folds the two router updates into one commit, so the
       forum pane never gives way to the gallery for a frame. */
    const forum = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(null, '', homeTabHref('gallery'));
    window.history.pushState(null, '', forum);
    pushedForum = { href: forum, length: window.history.length };
  });
}

/* The drawer's 主页 / 论坛 rows are the same control as the pill. While the pill is mounted on
   the home route it registers its switch here, and a row on `/` calls it instead of
   navigating — otherwise the drawer pushed entries the pill never would. */
let switcher: ((to: HomeTab) => void) | null = null;

export function setHomeTabSwitcher(fn: ((to: HomeTab) => void) | null): void {
  switcher = fn;
}

/** Switch through the pill if it is live; `false` when the caller must navigate itself. */
export function requestHomeTab(to: HomeTab): boolean {
  if (!switcher || typeof window === 'undefined' || window.location.pathname !== '/') return false;
  switcher(to);
  return true;
}
