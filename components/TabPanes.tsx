'use client';

import { createContext, useContext, useRef, type ReactNode } from 'react';
import { TabPanesMotion } from '@/lib/motionLazy';
import { cn } from '@/lib/utils';

/**
 * The shared-axis tab surface, as a primitive.
 *
 * Every screen with tabs gets the same motion by construction, rather than by
 * copying a four-line incantation per screen. The panes must be written in the
 * same order as the tabs in the bar above them — **direction comes from DOM
 * order** — and a conditionally-mounted pane must still hold its place in the
 * sequence, not be appended at the end.
 *
 * **Panes are marked, never unmounted.** A pane that has ever been shown keeps
 * its subtree, so switching away and back does not refetch. Callers that want to
 * defer the *first* mount of an expensive pane can still gate it (see the
 * gallery/forum pair on the home page) — but must not gate it on `active`, and
 * must never put a `key` on the panel: the outgoing pane has to survive the
 * commit or there is nothing to slide out, and a remount throws away every
 * pane's scroll and form state.
 */
const ActiveTabContext = createContext<string | null>(null);

/**
 * The `id` pair that ties a tab to its panel. Derived from the tab's own value
 * rather than passed in, because a prop that has to be remembered at nine call
 * sites is a prop that gets forgotten. Values are unique across the app's tab
 * groups; if two ever share one, pass `Tabs`' `panelId` explicitly at the inner.
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
   * **Default off, and that is the safe default rather than the pretty one.**
   * The lean holds GSAP references to the blocks *inside* a pane, which requires
   * them to survive the run — and a pane that fetches when its tab is selected
   * replaces its whole subtree within a few frames, so GSAP animates detached
   * nodes while the visible ones sit perfectly still: a switch with no
   * animation at all, which is worse than the fade it replaces. Turn it on only
   * for panes whose content is static once mounted.
   */
  lean?: boolean;
}) {
  /* Owns the motion flags' lifetime and plays the slide. It covers every route
     into a tab — a tap, the back button, a sidebar link, a deep link — because
     it reacts to the committed value rather than to the event that caused it.
     Screens whose tabs live in local state need nothing else. */
  /* The ref is owned here and the motion is mounted beside it. `TabPanesMotion`
     renders nothing; it exists so the hook that drives the slide can live
     behind a dynamic import — a static import of `lib/motion.ts` is what
     decides whether the engine is in the chunk every route loads. Until it
     arrives the panes still swap, which is the 关闭 tier's own path. */
  const panelRef = useRef<HTMLDivElement>(null);

  return (
    <>
      {/* No `key` on this element, ever — see the note above. */}
      <div ref={panelRef} data-tab-panel className={cn(className)}>
        <ActiveTabContext.Provider value={value}>{children}</ActiveTabContext.Provider>
      </div>
      {/* A **sibling after** the panel, not a child of it. React attaches a
          parent's ref only after its children's layout effects have run, so
          mounted inside the div this read a null panel on every commit that
          mounted the two together — and silently skipped `clearPaneFlags` and
          the `off`-tier instant scroll. Correct by construction now. */}
      <TabPanesMotion panelRef={panelRef} active={value} lean={lean} />
    </>
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
