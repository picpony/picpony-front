'use client';

import { Component, type RefObject } from 'react';
import { motionTier } from '@/lib/appearance';
import { getAppScroller, heroOwnsScreen } from '@/lib/appScroller';
import { beginPageTransit } from '@/lib/pageTransit';
import { tabIntent } from '@/lib/tabIntent';
import { recallTabScroll, rememberTabScroll, tabPanelTop, TAB_SHARED_CHROME_PX } from '@/lib/tabScroll';
import { runWhenIdle } from '@/lib/utils';
import { AXIS_GAP, playSharedAxis } from './sharedAxis';
import { isConcealedPane, leanPlan, loadingInView, type LeanPlan } from './tabGeometry';

/* --- the height a switch leaves ------------------------------------------- */

/**
 * **A tab switch never moves the reader.** On a screen whose panel sits under shared chrome
 * (the 全部 / 本站讨论 row under the banner) the offset stays exactly where it was: the header
 * does not move, and the arriving pane starts at its own top. What can still move the page is
 * the *height*: when the arriving pane is shorter, taking the leaving one out of layout would
 * leave the offset past the new end, and the browser would clamp it — the header thrown down
 * the screen in one frame. So at settle the panel keeps a floor, a `min-height` of exactly the
 * height that keeps the current offset reachable: the page then ends at the bottom of the
 * viewport, blank below a short pane, which is what a native tab page shows under a collapsed
 * header.
 *
 * The floor is written whenever the viewport reaches the panel at all — also when the arriving
 * pane is tall enough today — so a pane whose content lands shorter after the switch (a
 * skeleton giving way to an empty list) cannot pull the page up under the reader either. It is
 * let go on the first scroll that no longer needs it: once the page without it would still
 * reach the bottom of the viewport, taking it away changes nothing on screen.
 */
const panelFloors = new WeakMap<HTMLElement, () => void>();

/** Stop watching the floor without dropping it — a run is starting and will re-measure it. */
function suspendFloor(panel: HTMLElement) {
  panelFloors.get(panel)?.();
  panelFloors.delete(panel);
}

/** The pane on screen once a switch has settled — the one child the stylesheet shows. */
function shownPane(panel: HTMLElement): HTMLElement | null {
  for (const child of panel.children) {
    if (child instanceof HTMLElement && child.hasAttribute('data-tab-pane') && !isConcealedPane(child)) {
      return child;
    }
  }
  return null;
}

/**
 * Written at settle while the leaving pane still has its box, so the one layout read here
 * sees the page as it was on screen. `staying` is the pane that remains.
 */
function holdFloor(panel: HTMLElement, scroller: HTMLElement, staying: HTMLElement) {
  suspendFloor(panel);
  const offset = scroller.scrollTop;
  const view = scroller.clientHeight;
  /* Everything in the page but the panel. The panel's own height includes any floor it
     already carries, so this is floor-independent. */
  const outside = scroller.scrollHeight - panel.offsetHeight;
  const need = offset + view - outside;
  /* The viewport ends above the panel: no height of the panel's can move the reader. */
  if (need <= 0 || !staying.isConnected) {
    panel.style.minHeight = '';
    return;
  }
  panel.style.minHeight = `${Math.ceil(need)}px`;
  let frame = 0;
  const check = () => {
    frame = 0;
    if (!panel.isConnected || !panel.style.minHeight) return stop();
    const rest = scroller.scrollHeight - panel.offsetHeight;
    const content = shownPane(panel)?.offsetHeight ?? 0;
    if (scroller.scrollTop + scroller.clientHeight <= rest + content + 1) {
      panel.style.minHeight = '';
      stop();
    }
  };
  const onScroll = () => {
    if (!frame) frame = requestAnimationFrame(check);
  };
  const stop = () => {
    scroller.removeEventListener('scroll', onScroll);
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (panelFloors.get(panel) === stop) panelFloors.delete(panel);
  };
  scroller.addEventListener('scroll', onScroll, { passive: true });
  panelFloors.set(panel, stop);
}

/* --- tab wiring ---------------------------------------------------------- */

type TabRun = {
  panel: HTMLElement;
  /** The pane being left and the one being entered, as the run currently heads. */
  from: string;
  to: string;
  finish(): void;
  /** Finish without measuring anything — the panel is being unmounted. */
  abandon(): void;
  /** Turn the run back towards `from`; false when it cannot, and the caller finishes it. */
  reverse(): boolean;
};
let activeTabRun: TabRun | null = null;

/* The tab a panel has already been animated to. The switch is optimistic: it plays
 * on the tap, before the URL change reaches React — `useSearchParams` follows a history
 * write on the router's own schedule, and the home pill's 论坛 → 图库 is a traversal that
 * lands a task later. If that commit lands *after* the run has settled, when `activeTabRun`
 * is null, without this record the reactive path saw a plain `from -> active` change and
 * replayed the whole transition. */
const lastTabTarget = new WeakMap<HTMLElement, string>();

/** Panes whose style and layout exist: on screen once, or rendered ahead in an idle slice
 *  (see `prerenderPane`). */
const renderedPanes = new WeakSet<HTMLElement>();

const paneOf = (panel: HTMLElement, name: string) =>
  panel.querySelector<HTMLElement>(`:scope > [data-tab-pane="${CSS.escape(name)}"]`);

const MOTION_FLAGS = ['data-tab-pane-leaving', 'data-tab-pane-entering', 'data-tab-pane-done'];

function clearPaneFlags(panel: HTMLElement) {
  setPaneFlags(panel, null, null);
}

/**
 * Exactly `leaving` flagged as leaving and `entering` as entering, every other pane bare —
 * writing only the attributes that differ. The driver flags a switch before React's commit and
 * the run confirms it; a remove-and-re-add of the same attribute would still restyle the pane
 * and force one more style pass inside the tap's own task.
 */
function setPaneFlags(panel: HTMLElement, leaving: HTMLElement | null, entering: HTMLElement | null) {
  for (const pane of panel.querySelectorAll<HTMLElement>(':scope > [data-tab-pane]')) {
    const want = pane === leaving ? 'data-tab-pane-leaving' : pane === entering ? 'data-tab-pane-entering' : null;
    for (const flag of MOTION_FLAGS) {
      if (flag === want) {
        if (!pane.hasAttribute(flag)) pane.setAttribute(flag, '');
      } else if (pane.hasAttribute(flag)) {
        pane.removeAttribute(flag);
      }
    }
  }
}

/**
 * One tab switch: the flags that give both panes a box, the scroll decision, the run, and
 * the settle that hides the pane left behind. Shared by the tap path (`startTabTransition`)
 * and the reactive one (`TabPanesDriver`); the off tier takes the same path with no run.
 *
 * **One forced layout, and it comes first.** The only write before the reads is the pair of
 * flags that gives the arriving pane its box — the one input every read below depends on —
 * and the arriving pane keeps its style and layout while concealed (`content-visibility:
 * hidden`), so that layout lays out the panel and reuses the pane's own. After the reads
 * nothing is read again: the scroll write and the animations cannot force another.
 */
function runTabTransition(
  panel: HTMLElement,
  from: string,
  to: string,
  direction: 1 | -1,
  /** The scroll offset before this switch, when the caller read it before React's commit. */
  before?: number,
) {
  const leaving = paneOf(panel, from);
  const entering = paneOf(panel, to);
  if (!leaving || !entering || leaving === entering) return false;

  /* A flight is mid-air: the axis run would set `data-axis-running` on the gallery
   * scroller, which globals.css turns into a horizontal clip — a clip context for
   * the absolutely-positioned flight layer inside it, cutting the flyer off for the
   * whole run. Reachable from a history restore or a deep link committing during a
   * slide; the tab pill's `inert` only covers the tap path. */
  if (heroOwnsScreen()) return false;

  /* The reader tapped the tab this run is leaving: turn it around from where it is. */
  const live = activeTabRun;
  if (live && live.panel === panel && live.to === from && live.from === to && live.reverse()) {
    lastTabTarget.set(panel, to);
    return true;
  }
  live?.finish();
  suspendFloor(panel);

  const instant = motionTier('tabs') === 'off';
  const scroller = getAppScroller();

  /* The one write before the reads: both panes get a box. They share one grid cell, so
   * the panel is as tall as the taller of the two for the run. `-entering` survives until
   * the route commit lands. */
  setPaneFlags(panel, leaving, entering);
  renderedPanes.add(entering);

  /* Reads — the forced layout is the first of these. */
  const origin = before ?? scroller?.scrollTop ?? 0;
  /* Whether this screen may restore at all — a property of the *screen*, not the
   * scroll position, which is what makes it predictable. `panelTop` is how much
   * shared chrome sits above the panel: on the home route just the gutter (the tab
   * pill is fixed chrome outside the scroller), so the panel effectively *is* the
   * page and a restored offset lands on the row you left; on a profile, or the
   * gallery's 全部 / 本站讨论 row under the banner, content a restored offset would drag
   * along. There the offset is not touched at all (see `holdFloor`). The threshold is
   * the app bar's 64dp, the smallest chrome this design system treats as a region. */
  const mayRestore = scroller ? tabPanelTop(panel, scroller) <= TAB_SHARED_CHROME_PX : false;
  /* The window the strip slides past: the scroller — or, for panes that live in a bounded region
   * of the page (the admin console's panel, beside its rail inside one card), that region
   * (`data-tab-window`). Sliding a scroller's width there swept the outgoing pane across the rail
   * and out past the card, and brought the incoming one in over the page outside it; one region's
   * width, clipped to the region, keeps both panes inside the box they belong to. */
  const stripWindow = panel.closest<HTMLElement>('[data-tab-window]') ?? scroller;
  const distance = (stripWindow?.clientWidth || panel.getBoundingClientRect().width) + AXIS_GAP;
  let next = origin;
  if (scroller && mayRestore) {
    /* No memory for the destination: on a screen whose panel *is* the page, the
     * carried-over offset clamps to exactly the bottom, so the destination would open on
     * its last row — a tab never opened starts at its own beginning. And the target is
     * clamped against the height the page *ends* at: the page is `max(H_out, H_in)` tall
     * now, and `H_in` once the leaving pane is hidden, so `max(0, H_out − H_in)` less —
     * exact, not a bound, and only clamping when the destination is the shorter one. */
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const finalMax = Math.max(0, max - Math.max(0, leaving.offsetHeight - entering.offsetHeight));
    next = Math.min(recallTabScroll(panel, to) ?? 0, finalMax);
  }
  /* The lean is the panel's own statement (`TabPanes lean`), so the tap and the reactive path
     cannot disagree about it. Planned here, among the reads, where the panes are already laid
     out; the arriving pane will sit `next − origin` higher once the offset is written. */
  let lean: LeanPlan | undefined;
  if (scroller && !instant && panel.hasAttribute('data-tab-lean') && motionTier('tabs') === 'standard') {
    const view = scroller.getBoundingClientRect();
    if (
      !loadingInView(leaving, view.top, view.bottom, 0) &&
      !loadingInView(entering, view.top, view.bottom, origin - next)
    ) {
      /* The panel's top on screen now, and once the arriving pane's offset is written. */
      const panelTop = view.top + tabPanelTop(panel, scroller);
      const out = leanPlan(leaving, view.top, view.bottom, 0, Math.max(view.top, panelTop - origin));
      const into = leanPlan(entering, view.top, view.bottom, origin - next, Math.max(view.top, panelTop - next));
      lean = { blocks: [...out.blocks, ...into.blocks], lift: [...out.lift, ...into.lift] };
    }
  }

  /* Writes. Saved here rather than only in `startTabTransition`, so the memory is kept by
   * *every* way of changing tab: sidebar links, the back button and the `/forum` redirect
   * arrive through the reactive path and never record the tab they are leaving. */
  rememberTabScroll(panel, from, origin);
  const offsetY = next - origin;
  if (scroller && offsetY !== 0) {
    // Scroll anchoring would "correct" a deliberate jump; same guard as runScroll.
    scroller.style.overflowAnchor = 'none';
    scroller.scrollTop = next;
  }
  lastTabTarget.set(panel, to);

  /* The settle, for both ends a run can reach. `reversed` means it was played back and
   * `leaving` is the pane that stays. */
  let released = false;
  let abandoned = false;
  const endTransit = instant ? () => {} : beginPageTransit();
  const onPress = () => activeTabRun?.panel === panel && activeTabRun.finish();
  const release = () => {
    if (released) return;
    released = true;
    /* The clip exists for `offsetY` alone: the outgoing pane is translated by the
     * difference between the tabs' remembered offsets — most of a screen — and would
     * paint over the footer without it. */
    panel.style.overflowY = '';
    if (scroller) scroller.style.overflowAnchor = '';
    endTransit();
    panel.removeEventListener('pointerdown', onPress, { capture: true });
  };
  const land = (reversed: boolean) => {
    const staying = reversed ? leaving : entering;
    const going = reversed ? entering : leaving;
    /* Played back to the start: the offset goes back to where the reader left it, in the
       same task as the outgoing pane's compensating offset comes off — one pose, two ways
       of writing it. */
    if (reversed && scroller && offsetY !== 0) scroller.scrollTop = origin;
    if (scroller && !abandoned) holdFloor(panel, scroller, staying);
    if (staying.hasAttribute('data-tab-pane-active') && !going.hasAttribute('data-tab-pane-active')) {
      /* React already agrees — the commit landed during the run, or the tab was local state
         all along — so the flags have nothing left to hold, and nothing else would clear them:
         the driver clears on a commit, and that commit has been. */
      clearPaneFlags(panel);
    } else {
      /* The route has not committed yet, so React is *also* still marking the outgoing pane
       * active. `-done` holds it out until the commit lands and the driver clears every
       * flag; without it the old page would reappear on top. */
      going.setAttribute('data-tab-pane-done', '');
      going.removeAttribute('data-tab-pane-leaving');
      going.removeAttribute('data-tab-pane-entering');
      staying.removeAttribute('data-tab-pane-leaving');
      staying.setAttribute('data-tab-pane-entering', '');
    }
    release();
    if (activeTabRun?.panel === panel) activeTabRun = null;
  };

  if (instant) {
    land(false);
    return true;
  }

  if (offsetY !== 0) panel.style.overflowY = 'clip';
  /* The footer rides inside `[data-page-content]` and travels with every route
   * change on its own; a tab switch is the exception — the sliding panes are
   * *inside* the page — so this is the one caller that asks it to step aside. */

  const handle = playSharedAxis({
    leaving,
    entering,
    direction,
    distance,
    view: stripWindow,
    leavingOffsetY: offsetY,
    lean,
    onSettle: land,
  });

  /* Same reason as the masonry cascade: these panes are ancestors of every gallery
   * card, and `useHeroLink` measures a card during the click that follows this
   * press. Snap to rest rather than be measured mid-slide. */
  panel.addEventListener('pointerdown', onPress, { capture: true });
  const record: TabRun = {
    panel,
    from,
    to,
    finish: () => {
      handle.finish();
      release();
    },
    abandon: () => {
      abandoned = true;
      record.finish();
    },
    reverse: () => {
      if (!handle.reverse()) return false;
      [record.from, record.to] = [record.to, record.from];
      const ahead = record.to === to ? entering : leaving;
      const behind = ahead === entering ? leaving : entering;
      behind.removeAttribute('data-tab-pane-entering');
      behind.setAttribute('data-tab-pane-leaving', '');
      ahead.removeAttribute('data-tab-pane-leaving');
      ahead.setAttribute('data-tab-pane-entering', '');
      return true;
    },
  };
  activeTabRun = record;
  return true;
}

/**
 * Starts the switch on the tap, before the URL moves. Both panes are mounted, so this
 * hands the incoming one a box directly and the commit only has to agree with what is
 * already on screen. The caller writes the URL in the same task, with a native history
 * write rather than a navigation (`lib/homeTabs.ts`): nothing is fetched and nothing can
 * race, and the optimistic tab (`setTabIntent`) covers the commits until the URL catches up.
 */
export function startTabTransition(from: string, to: string, direction: 1 | -1): void {
  if (from === to) return;
  const panel = document.querySelector<HTMLElement>('[data-tab-panel]');
  if (!panel) return;
  /* Recorded before the tier check, and keyed on the panel, so the two writers agree. */
  const scroller = getAppScroller();
  if (scroller) rememberTabScroll(panel, from, scroller.scrollTop);
  /* Only `off` returns here: the switch then happens when the URL commits, through the
   * driver, with no run. `reduced` runs the transition, which cross-fades the panes
   * instead of sliding them — that branch is inside `playSharedAxis`. */
  if (motionTier('tabs') === 'off') return;
  runTabTransition(panel, from, to, direction);
}

/* --- a pane never shown is rendered ahead, once ----------------------------------------- */

/**
 * A concealed pane keeps the style and layout it had when it was last shown — but a pane that
 * has never been shown has none, so its *first* switch still restyled and laid out its whole
 * subtree inside the tap (the forum, mounted hidden on an idle callback: ~100ms of a slow
 * phone's main thread before the first frame, plus the web-font slices its text needs landing
 * during the slide). So each such pane is rendered once in an idle slice: un-concealed in place
 * (`data-tab-pane-prerender`), laid out, and concealed again in the same task. No frame is drawn
 * inside a task, so nothing reaches the screen; the page only ever grows in that moment (the
 * cell takes the taller pane), so no offset is clamped; and the first switch finds a pane the
 * engine already knows. A size containment or a clip instead of the real placement measured no
 * better than nothing: the first show could not reuse a layout made under other constraints.
 */
function prerenderPane(pane: HTMLElement) {
  if (renderedPanes.has(pane) || !pane.isConnected || !isConcealedPane(pane)) return;
  /* Where concealment is display none, nothing rendered now would survive it. */
  if (!CSS.supports?.('content-visibility', 'hidden')) return;
  renderedPanes.add(pane);
  pane.setAttribute('data-tab-pane-prerender', '');
  void pane.getBoundingClientRect();
  pane.removeAttribute('data-tab-pane-prerender');
}

type DriverProps = { panelRef: RefObject<HTMLElement | null>; active: string };

/**
 * The reactive half, and the owner of the motion flags' lifetime. Covers every way of
 * reaching a tab that does not go through the tab bar — back/forward, a sidebar link, the
 * `/forum` redirect, a deep link, and every tab row whose value is local state (the gallery's
 * 全部 / 本站讨论, a profile's tabs). If the tap already started this exact transition it
 * adopts it rather than restarting.
 *
 * **A class, for the one lifecycle a hook does not have.** React flips `data-tab-pane-active`
 * in its mutation phase, and from that moment the outgoing pane is concealed — any layout read
 * before a layout effect could flag it back (another component's layout effect measuring a tab
 * indicator is enough) sees the page without it, and the browser clamps the scroll offset
 * there: the header thrown down the screen with no animation to hide it. `getSnapshotBeforeUpdate`
 * runs before any DOM mutation of the commit, so the outgoing pane is flagged first and the
 * commit never conceals it; `componentDidUpdate` then runs the switch at layout-effect time.
 *
 * Render it as a *sibling after* the element carrying `data-tab-panel` (see `TabPanes`).
 */
export class TabPanesDriver extends Component<DriverProps> {
  /** The value the last commit carried — the fallback `from` for a panel never animated. */
  private previous: string;

  /** Cancels the idle slice waiting to render a never-shown pane. */
  private cancelPrerender: (() => void) | null = null;

  constructor(props: DriverProps) {
    super(props);
    this.previous = props.active;
  }

  /** Watches the panel's own children: a pane can mount on any render of the caller (the forum
   *  pane on an idle callback) without this component re-rendering. */
  private panesObserver: MutationObserver | null = null;

  /** Queue one idle slice for the panes that have never been shown. */
  private schedulePrerender() {
    const panel = this.props.panelRef.current;
    if (!panel || this.cancelPrerender) return;
    const waiting: HTMLElement[] = [];
    for (const pane of panel.querySelectorAll<HTMLElement>(':scope > [data-tab-pane]')) {
      if (!isConcealedPane(pane)) renderedPanes.add(pane);
      else if (!renderedPanes.has(pane)) waiting.push(pane);
    }
    if (waiting.length === 0) return;
    this.cancelPrerender = runWhenIdle(() => {
      this.cancelPrerender = null;
      /* Not while a switch is on screen: it owns this frame's work. The next render asks again. */
      if (activeTabRun?.panel === panel || heroOwnsScreen()) return;
      for (const pane of waiting) prerenderPane(pane);
    });
  }

  componentDidMount() {
    const panel = this.props.panelRef.current;
    if (panel) {
      this.panesObserver = new MutationObserver(() => this.schedulePrerender());
      this.panesObserver.observe(panel, { childList: true });
    }
    this.schedulePrerender();
  }

  /** The tab a switch to `active` would leave, or `null` when this commit starts none. */
  private leavingFor(panel: HTMLElement, active: string): string | null {
    /* The URL is still travelling towards a tab the user has already left — a stale
     * waypoint, not a destination; the superseding write is already queued. */
    const intent = tabIntent();
    if (intent !== null && intent !== active) return null;
    /* Where the panes actually are, which is not necessarily where the URL says.
     * `lastTabTarget` is written by every run, optimistic or reactive, while `previous`
     * has only seen commits — the fallback, for a panel that has not animated yet. */
    const target = lastTabTarget.get(panel);
    const from = target ?? this.previous;
    if (from === active || target === active) return null;
    if (activeTabRun?.panel === panel && activeTabRun.to === active) return null;
    return from;
  }

  getSnapshotBeforeUpdate(prev: DriverProps): number | null {
    const panel = this.props.panelRef.current;
    if (!panel || prev.active === this.props.active) return null;
    const from = this.leavingFor(panel, this.props.active);
    /* Flag the switch now — both panes, so the commit's own forced style pass (another
       component's layout effect, a focused tab's new tabindex) already lays the arriving pane
       out and the run's reads find nothing left to do. A live run's panes are its own; the
       arriving pane does not exist yet when this commit is the one that mounts it. */
    if (from !== null && activeTabRun?.panel !== panel) {
      setPaneFlags(panel, paneOf(panel, from), paneOf(panel, this.props.active));
    }
    return getAppScroller()?.scrollTop ?? null;
  }

  componentDidUpdate(prev: DriverProps, _state: unknown, before: number | null) {
    const panel = this.props.panelRef.current;
    const active = this.props.active;
    if (!panel || prev.active === active) return;
    /* A stale waypoint returns before any flag is touched: React has just moved
     * `data-tab-pane-active` onto the tab the URL passes through, so the motion flags are
     * the only thing holding the right pane on screen. */
    const intent = tabIntent();
    if (intent !== null && intent !== active) return;
    const from = this.leavingFor(panel, active);
    this.previous = active;
    const idle = activeTabRun?.panel !== panel;
    if (from !== null) {
      const order = [...panel.querySelectorAll<HTMLElement>(':scope > [data-tab-pane]')].map(
        (pane) => pane.dataset.tabPane,
      );
      const direction: 1 | -1 = order.indexOf(active) > order.indexOf(from) ? 1 : -1;
      /* The run keeps the flags placed before the commit (it writes only what differs). */
      if (runTabTransition(panel, from, active, direction, before ?? undefined)) return;
    }
    /* No switch: nothing is animating, so React's `data-tab-pane-active` is the only truth and
     * every motion flag is stale — including a hold placed before this commit. */
    if (idle) clearPaneFlags(panel);
  }

  componentWillUnmount() {
    this.panesObserver?.disconnect();
    this.panesObserver = null;
    this.cancelPrerender?.();
    this.cancelPrerender = null;
    const panel = this.props.panelRef.current;
    if (activeTabRun && activeTabRun.panel === panel) activeTabRun.abandon();
    if (panel) suspendFloor(panel);
  }

  render() {
    return null;
  }
}

/** Ends any in-flight tab transition immediately. */
export function finishTabTransition() {
  activeTabRun?.finish();
}
