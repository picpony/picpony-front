'use client';

import { getAppScroller } from '@/lib/appScroller';

/**
 * The per-tab scroll memory, and the one rule that decides whether a tab switch may move the
 * scroller at all. This animates nothing; both readers need it — the animated path in
 * `lib/motion.ts` and the instant path that `lib/motionLazy.ts` falls back to. Keeping the
 * memory here guarantees the two writers share one map: a tab's remembered offset must not be
 * lost the moment the lazy chunk lands.
 */

/**
 * Per-tab scroll offset, so switching back lands where you left that tab. Keyed by **the
 * page and the tab group's position on it**, then by tab name.
 *
 * - Not one flat `Map<tabName, offset>`: that collides between *instances of one screen*
 *   (`posts`/`uploads`/… across profiles, `picpony`/`derpibooru` across two `/favorites`
 *   visits). The pathname carries the profile's id, so two profiles are two keys.
 * - Not the panel element either, which it was: page content is keyed on the pathname, so
 *   the panel — and its memory — went with every navigation. The forum is a tab on `/`, so
 *   reading a thread and coming back threw the gallery's place away (900 → 0).
 * - The group's ordinal among the page's tab panels separates nested groups (the admin
 *   console has one inside one of its own panes).
 *
 * The lifetime mirrors the route memory's own rule (`lib/scrollMemory.ts`): a page reached by
 * **traversal** keeps its tabs' offsets, a page reached by a **push** starts afresh —
 * `clearTabScroll` is called for the pathname a push lands on. A session change drops all of
 * it, since the pages it described re-render for a different account.
 */
const tabScrollMemory = new Map<string, Map<string, number>>();

function groupKey(panel: HTMLElement): string {
  const pathname = typeof window === 'undefined' ? '' : window.location.pathname;
  const panels = [...document.querySelectorAll<HTMLElement>('[data-page-content] [data-tab-panel]')];
  const ordinal = Math.max(0, panels.indexOf(panel));
  return `${pathname}#${ordinal}`;
}

export function rememberTabScroll(panel: HTMLElement, tab: string, offset: number) {
  const key = groupKey(panel);
  let group = tabScrollMemory.get(key);
  if (!group) {
    group = new Map();
    tabScrollMemory.set(key, group);
  }
  group.set(tab, offset);
}

export function recallTabScroll(panel: HTMLElement, tab: string) {
  return tabScrollMemory.get(groupKey(panel))?.get(tab);
}

/** Forget every tab group on `pathname` — a push arrived there. */
export function clearTabScroll(pathname: string) {
  const prefix = `${pathname}#`;
  for (const key of [...tabScrollMemory.keys()]) {
    if (key.startsWith(prefix)) tabScrollMemory.delete(key);
  }
}

/** Forget everything — the session changed. */
export function clearAllTabScroll() {
  tabScrollMemory.clear();
}

/**
 * Shared chrome above the panel, past which a tab switch stops *restoring* an offset. The app
 * bar's own 64dp — the smallest thing this design system calls a region. Below it the panel is
 * effectively the page (home gutter 24, /policy 209, a profile 697); above it the two tabs
 * share a header, and moving it reads as a jump. "Stops restoring", not "never moves": the
 * clamp still applies on every screen, because a pane shorter than the current offset leaves
 * the browser no choice.
 */
export const TAB_SHARED_CHROME_PX = 64;

/**
 * How much shared chrome sits above the panel: the distance from the top of the scroller's
 * *content* to the panel's own top edge, so it is invariant to where the user has scrolled.
 * Both writers consult it — it is the one rule deciding whether a tab switch may move the
 * scroller, and the animated path applying it while the reduced-motion path did not is how a
 * profile could still jump under the preference.
 */
export function tabPanelTop(panel: HTMLElement, scroller: HTMLElement) {
  return (
    scroller.scrollTop + panel.getBoundingClientRect().top - scroller.getBoundingClientRect().top
  );
}

export function applyInstantTabScroll(panel: HTMLElement, to: string) {
  const scroller = getAppScroller();
  if (!scroller) return;
  if (tabPanelTop(panel, scroller) > TAB_SHARED_CHROME_PX) return;
  /* `?? 0`, matching the animated switch's fallback (`runTabTransition`, lib/motion.ts): on a
     panel that is the page, a tab with no
     remembered offset opens at its own top. Returning early instead left the outgoing tab's
     offset, which the browser then clamped to the shorter pane's maximum — landing on the
     destination's *last* row. The preference asks for less movement, not the wrong position. */
  const remembered = recallTabScroll(panel, to) ?? 0;
  const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  /* No `overflowAnchor` guard, deliberately, and not an omission of the animated switch's: that
     one suspends anchoring because it writes then slides with both panes in layout underneath;
     this write is synchronous with nothing laying out after it in the same task, so there is
     nothing to "correct" — and leaving it on absorbs a late shrink above the viewport, the job
     the animated path hands back to it at settle. */
  scroller.scrollTop = Math.min(remembered, max);
}
