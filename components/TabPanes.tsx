'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useTabPanes } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * The shared-axis tab surface, as a primitive.
 *
 * Five screens have tab bars. Before this, they had three different behaviours:
 *
 *   /               shared-axis plane — 500ms `emphasized`, the leaning wave
 *   /user/[id]      shared-axis plane
 *   /messages       `key={activeTab}` remount + `animate-page-transition`
 *   /favorites      nothing. The pane is swapped by a ternary.
 *   /policy         nothing.
 *
 * Same control, three answers. Worse, the two that had motion got it by writing
 * the wiring out longhand — `useTabPanes`, a `data-tab-panel` div, and a
 * `data-tab-pane` / `data-tab-pane-active` pair per pane — which is precisely the
 * sort of four-line incantation that does not get copied to the third screen.
 * So it is a component now, and a screen with tabs cannot accidentally not have
 * the motion.
 *
 * The `/messages` version was also actively wrong rather than merely absent.
 * `key={activeTab}` on the panel unmounts the outgoing pane in the same commit
 * that mounts the incoming one, so there is nothing left to animate *out* — which
 * is the failure `AGENTS.md` calls out by name ("Never put a `key` on
 * `[data-tab-panel]`; that deletes the animation's own targets in the commit that
 * starts it"). It also threw away every pane's scroll position, fetched page and
 * form state on each switch.
 *
 * **Direction comes from DOM order.** `useTabPanes` compares the index of the
 * outgoing and incoming panes among their siblings, so the panes must be written
 * in the same order as the tabs in the bar above them. They almost always are,
 * because both come from the same array — but a conditionally-mounted pane must
 * still hold its place in the sequence, not be appended at the end.
 *
 * **Panes are marked, never unmounted.** A pane that has ever been shown keeps
 * its subtree, so switching away and back does not refetch. Callers that want to
 * defer the *first* mount of an expensive pane can still gate it — see the
 * gallery/forum pair on the home page, which mounts the forum on the first idle
 * callback — but must not gate it on `active`.
 */
const ActiveTabContext = createContext<string | null>(null);

/**
 * The `id` pair that ties a tab to its panel.
 *
 * Derived from the tab's own value rather than passed in, because a prop that has
 * to be remembered at nine call sites is a prop that gets forgotten — and this
 * one was: `Tabs` shipped `aria-controls={panelId?.(value)}` and not one caller
 * supplied `panelId`, so every tablist in the app declared `role="tab"` and named
 * no panel, while `role="tabpanel"` appeared nowhere at all. A screen reader was
 * told "tab, 1 of 4, selected" and then found nothing the tab controlled.
 *
 * Values are unique across the app's tab groups, so one namespace is enough; if
 * two groups ever share one, pass `Tabs`' `panelId` explicitly at the inner one.
 */
export function tabPanelId(value: string) {
  return `tabpanel-${value}`;
}

export function tabId(value: string) {
  return `tab-${value}`;
}

export function TabPanes<T extends string = string>({
  value,
  children,
  className = '',
  lean = false,
}: {
  value: T;
  children: ReactNode;
  className?: string;
  /**
   * Sample the wave over each pane's own blocks, so the seam between the two
   * pages leans over as it sweeps across (see `playSharedAxis`).
   *
   * **Default off, and that is the safe default rather than the pretty one.** The
   * lean holds GSAP references to the blocks *inside* a pane, which requires them
   * to survive the run — and a pane that fetches when its tab is selected
   * replaces its whole subtree within a few frames of the switch starting. When
   * that happens GSAP animates detached nodes and the visible new ones sit
   * perfectly still: measured on the messages tabs as pane height collapsing from
   * 1887px to a 288px skeleton inside 70ms, with zero transformed descendants for
   * the entire 500ms run — a switch with no animation at all, which is worse than
   * the fade it replaced.
   *
   * Turn it on only for panes whose content is static once mounted. /policy
   * qualifies: four blocks of prose that never refetch.
   */
  lean?: boolean;
}) {
  /* Owns the motion flags' lifetime and plays the slide. It covers every route
     into a tab — a tap, the back button, a sidebar link, a deep link — because
     it reacts to the committed value rather than to the event that caused it.
     Screens whose tabs live in local state need nothing else: the state update
     and this layout effect are in the same commit, so there is no URL to wait
     for and no optimistic `startTabTransition` to coalesce behind. */
  const panelRef = useTabPanes<HTMLDivElement>(value, { lean });

  return (
    /* No `key` on this element, ever — see the note above. */
    <div ref={panelRef} data-tab-panel className={cn(className)}>
      <ActiveTabContext.Provider value={value}>{children}</ActiveTabContext.Provider>
    </div>
  );
}

/**
 * One pane. Renders a box whenever it is active *or* while the motion layer is
 * holding it on screen — the `display: none` rule in globals.css keys on all
 * three flags, which is what lets both panes coexist for the length of a switch.
 *
 * Never wrap this in a conditional on the active tab. `{active === 'x' && ...}`
 * is the same bug as a `key`: the outgoing pane has to survive the commit or
 * there is nothing to slide out.
 */
export function TabPane({
  value,
  children,
  className = '',
}: {
  value: string;
  children: ReactNode;
  className?: string;
}) {
  const active = useContext(ActiveTabContext);
  const isActive = active === value;
  return (
    <div
      data-tab-pane={value}
      data-tab-pane-active={isActive ? '' : undefined}
      /* The other half of `role="tab"`'s promise. `aria-labelledby` points back at
         the tab, so the panel announces itself by the tab's own label rather than
         needing a second copy of it. `tabIndex` only while active: a panel that is
         `display: none` must not be a tab stop, and giving every pane one would put
         four dead stops in the order. */
      id={tabPanelId(value)}
      role="tabpanel"
      aria-labelledby={tabId(value)}
      tabIndex={isActive ? 0 : undefined}
      className={cn(className)}
    >
      {children}
    </div>
  );
}

export default TabPanes;
