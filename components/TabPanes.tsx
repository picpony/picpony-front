'use client';

import { createContext, useContext, useLayoutEffect, useRef, type ReactNode } from 'react';
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
 * **Each pane moves as one piece** (`playSharedAxis`): whatever a pane holds — a row, a
 * wrapper with no box of its own, a banner — travels with it by construction, and a pane
 * that replaces its content on arrival still slides. `lean` adds the layered departure on
 * top, block by block, without taking anything off the pane.
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
 * True inside a `TabPane`. A block with an entrance of its own (`StatusView`'s
 * `Reveal`) stands down there — the pane transition already moves those nodes — and a
 * context answers that in the first render, where probing the DOM for the pane marker
 * could only answer after mounting (and then tearing down) the entrance it meant to skip.
 */
const InTabPaneContext = createContext(false);

export function useInTabPane() {
  return useContext(InTabPaneContext);
}

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
   * The layered departure: the blocks on screen follow the strip a little late, top first,
   * so the page leaves on a shear (`playSharedAxis`). Written on the panel as an attribute, so
   * the tap path (`startTabTransition`) and the reactive one read the same statement. On the
   * home route and /policy; it adds a compositor layer per block on screen for the run, and a
   * pane that replaces its content on arrival loses its lean (the new nodes ride the pane).
   */
  lean?: boolean;
}) {
  /* Owns the motion flags' lifetime and plays the slide. It covers every route
     into a tab — a tap, the back button, a sidebar link, a deep link — because
     it reacts to the committed value rather than to the event that caused it
     (and flags the outgoing pane before React's commit can conceal it).
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
      <div ref={panelRef} data-tab-panel data-tab-lean={lean ? '' : undefined} className={cn(className)}>
        <ActiveTabContext.Provider value={value}>{children}</ActiveTabContext.Provider>
      </div>
      {/* A **sibling after** the panel, not a child of it. React attaches a
          parent's ref only after its children's layout effects have run, so
          mounted inside the div this read a null panel on every commit that
          mounted the two together — and silently skipped `clearPaneFlags` and
          the `off`-tier instant scroll. Correct by construction now. */}
      <TabPanesMotion panelRef={panelRef} active={value} />
    </>
  );
}

/** What can take the keyboard's focus inside a pane. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/**
 * One pane. Shown whenever it is active *or* while the motion layer is holding it
 * on screen — the concealment rule in globals.css keys on all three flags, which is
 * what lets both panes coexist for the length of a switch. Concealed, it keeps its
 * style and layout (`content-visibility: hidden`), so showing it again is cheap.
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
  const pane = useRef<HTMLDivElement>(null);
  /* A tab stop only while active **and** only when nothing inside can take focus (APG): every
     tabbed screen here but /policy's prose starts with a control, a row or a card, and a focusable
     panel in front of it was a dead stop between the tab row and the content (G0-007). Content
     arrives after the pane does, so the answer is kept current while the pane is shown. Written
     to the DOM: it is a fact about the content, not something to render. */
  useLayoutEffect(() => {
    const el = pane.current;
    if (!el) return;
    if (!isActive) {
      el.removeAttribute('tabindex');
      return;
    }
    const update = () => {
      if (el.querySelector(FOCUSABLE)) el.removeAttribute('tabindex');
      else el.tabIndex = 0;
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(el, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [isActive]);
  return (
    <div
      data-tab-pane={value}
      data-tab-pane-active={isActive ? '' : undefined}
      ref={pane}
      /* The other half of `role="tab"`'s promise. `aria-labelledby` points back at
         the tab, so the panel announces itself by the tab's own label rather than
         needing a second copy of it. Its tab stop is decided above. */
      id={tabPanelId(value)}
      role="tabpanel"
      aria-labelledby={tabId(value)}
      /* A tab stop needs the app's one focus ring, or Tab from the tab row drew the
         engine's black outline round the whole section. The section step's corner,
         since this is the box the ring follows. */
      className={cn('rounded-md focus-visible:outline-hidden focus-visible:ring-2 focus-ring', className)}
    >
      <InTabPaneContext.Provider value>{children}</InTabPaneContext.Provider>
    </div>
  );
}

export default TabPanes;
