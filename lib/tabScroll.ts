'use client';

import { getAppScroller } from '@/lib/appScroller';

/**
 * The per-tab scroll memory, and the one rule that decides whether a tab switch may move the
 * scroller at all.
 *
 * None of it animates anything, and both of its readers need it: the animated path in
 * `lib/motion.ts` and the instant path, which `lib/motionLazy.ts` falls back to when the engine
 * has not arrived yet. Keeping the memory here rather than in either of them is what guarantees
 * the two writers share one map — a tab's remembered offset must not be lost at the moment the
 * lazy chunk lands.
 */

/**
 * Per-tab scroll offset, so switching back lands where you left that tab.
 *
 * Keyed by the **panel element**, then by tab name. It was one flat
 * `Map<tabName, offset>` at module scope, and the collision that produced is between
 * *instances of one screen* rather than between screens: `posts`/`uploads`/`faves`/
 * `comments` carried an offset from one profile to the next, and `picpony`/`derpibooru`
 * across two visits to `/favorites`. Tab values happen to be unique app-wide, which is
 * what `TabPanes` relies on for its own reasons, and that is exactly why the flat map
 * looked safe.
 *
 * The panel element *is* the tab group's identity, so this also handles a nested group
 * (`BadgesTab` inside `/admin`) and answers "when is it cleared" for free: the page
 * content is keyed on the pathname, so `/user/1` → `/user/2` unmounts the panel and the
 * entry goes with it. Leaving home and coming back drops the per-tab offsets, and
 * `lib/scrollMemory.ts` restores the scroller itself.
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
 * Shared chrome above the panel, past which a tab switch stops *restoring* an offset.
 *
 * The app bar's own 64dp — the smallest thing this design system calls a region. Below it the
 * panel is effectively the page (the home route's gutter is 24, /policy is 209, a profile is
 * 697); above it there is a header the two tabs share, and moving it is what reads as a jump.
 * "Stops restoring" rather than "never moves": `finalMax`'s clamp still applies on every screen,
 * because a destination pane shorter than the current offset leaves the browser no choice.
 */
export const TAB_SHARED_CHROME_PX = 64;

/**
 * How much shared chrome sits above the panel: the distance from the top of the scroller's
 * *content* to the panel's own top edge, so it is invariant to where the user has scrolled.
 *
 * Both writers consult it, which is the point — it is the one rule that decides whether a tab
 * switch may move the scroller at all, and having the animated path apply it while the
 * reduced-motion path did not is how a profile could still jump under the preference.
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
     remembered offset opens at its own top. Returning early instead left the outgoing tab's offset
     in place, and the browser then clamped it to the shorter pane's maximum — which lands on the
     destination's *last* row. The preference asks for less movement, not for the wrong position. */
  const remembered = recallTabScroll(panel, to) ?? 0;
  const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  /* No `overflowAnchor` guard, deliberately, and it is not an omission of `applyTabScroll`'s:
     that one suspends anchoring because it writes and then animates for 500ms, with the panes
     re-laying-out underneath. This write is synchronous and nothing lays out after it in the
     same task, so there is nothing for anchoring to "correct" — and leaving it on is what
     absorbs a late shrink above the viewport, which is the job `restoreAnchor` hands back to it
     on the animated path. */
  scroller.scrollTop = Math.min(remembered, max);
}
