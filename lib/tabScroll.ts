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
 * Per-tab scroll offset, so switching back lands where you left that tab. Keyed by the
 * **panel element**, then by tab name — one flat `Map<tabName, offset>` collides between
 * *instances of one screen* (`posts`/`uploads`/… across profiles, `picpony`/`derpibooru`
 * across two `/favorites` visits); tab values are unique app-wide, which is exactly why the
 * flat map looked safe. The panel is the tab group's identity, so nested groups work and the
 * lifetime is free: page content is keyed on the pathname, so `/user/1` → `/user/2` unmounts
 * the panel and the entry goes with it (leaving home and returning drops per-tab offsets;
 * `lib/scrollMemory.ts` restores the scroller itself).
 */
const tabScrollMemory = new WeakMap<HTMLElement, Map<string, number>>();

export function rememberTabScroll(panel: HTMLElement, tab: string, offset: number) {
  let group = tabScrollMemory.get(panel);
  if (!group) {
    group = new Map();
    tabScrollMemory.set(panel, group);
  }
  group.set(tab, offset);
}

export function recallTabScroll(panel: HTMLElement, tab: string) {
  return tabScrollMemory.get(panel)?.get(tab);
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
  /* `?? 0`, matching `applyTabScroll`'s fallback: on a panel that is the page, a tab with no
     remembered offset opens at its own top. Returning early instead left the outgoing tab's
     offset, which the browser then clamped to the shorter pane's maximum — landing on the
     destination's *last* row. The preference asks for less movement, not the wrong position. */
  const remembered = recallTabScroll(panel, to) ?? 0;
  const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  /* No `overflowAnchor` guard, deliberately, and not an omission of `applyTabScroll`'s: that
     one suspends anchoring because it writes then animates for 500ms with panes re-laying-out
     underneath; this write is synchronous with nothing laying out after it in the same task,
     so there is nothing to "correct" — and leaving it on absorbs a late shrink above the
     viewport, the job `restoreAnchor` hands back to it on the animated path. */
  scroller.scrollTop = Math.min(remembered, max);
}
