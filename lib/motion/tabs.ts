'use client';

import { Component, type RefObject } from 'react';
import { motionTier } from '@/lib/appearance';
import { getAppScroller, heroOwnsScreen } from '@/lib/appScroller';
import { beginPageTransit } from '@/lib/pageTransit';
import { tabIntent } from '@/lib/tabIntent';
import { recallTabScroll, rememberTabScroll, tabPanelTop, TAB_SHARED_CHROME_PX } from '@/lib/tabScroll';
import { columnWindow } from '@/lib/tabStrip';
import { runWhenIdle } from '@/lib/utils';
import { AXIS_GAP, playSharedAxis, supportsEdgeMask } from './sharedAxis';
import { isConcealedPane, leanPlan, loadingInView, paneClip, type LeanPlan, type PaneClip } from './tabGeometry';

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
  /* At the very top there is no offset to keep reachable: every height reaches 0. Measured here
     anyway, a page shorter than its window read `scrollHeight` as the window's height, so the
     floor came out as the panel's whole run height (both panes) — and, carried into the next
     switch's read, it only ever grew: a short /admin section stood at the tallest one visited,
     then dropped by hundreds of pixels on the first scroll. */
  if (offset <= 0) {
    panel.style.minHeight = '';
    return;
  }
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
 * A switch the press on a tab has set up (`primeTabTransition`), which the finger's lift or the
 * mouse's click starts (`playPrimedTabTransition`, from `Tabs`). It is not a live run: nothing has
 * moved and React has not been told, so the driver never adopts it as one. `runTabTransition`
 * plays it when the switch it was primed for arrives by another path, and lets it go when any
 * other switch does.
 */
type PrimedRun = {
  panel: HTMLElement;
  from: string;
  to: string;
  /** Start it, from the offset the switch read before React's commit (when it did). False when
   *  the page moved under the press: it has then been let go, flags kept, for a fresh run. */
  play(before?: number): boolean;
  /** Undo it. `keepFlags` when a switch on the same panel is about to write its own. */
  release(keepFlags?: boolean): void;
};
let primedRun: PrimedRun | null = null;
/** The press a primed run is waiting on: its listeners and timers, removed with the run. */
let primeWatch: (() => void) | null = null;

function releasePrimedRun(keepFlags = false) {
  const primed = primedRun;
  primedRun = null;
  primeWatch?.();
  primed?.release(keepFlags);
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
 *
 * **A switch the press primed has done all of that already** (`primeTabTransition`): it is
 * started here, and the click pays for the scroll write and the clock.
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
  const primed = primedRun;
  if (!leaving || !entering || leaving === entering) {
    if (primed) releasePrimedRun();
    return false;
  }

  /* A flight is mid-air: the axis run would set `data-axis-running` on the gallery
   * scroller, which globals.css turns into a horizontal clip — a clip context for
   * the absolutely-positioned flight layer inside it, cutting the flyer off for the
   * whole run. Reachable from a history restore or a deep link committing during a
   * slide; the tab pill's `inert` only covers the tap path. */
  if (heroOwnsScreen()) {
    if (primed) releasePrimedRun();
    return false;
  }

  /* The reader tapped the tab this run is leaving: turn it around from where it is. */
  const live = activeTabRun;
  if (live && live.panel === panel && live.to === from && live.from === to && live.reverse()) {
    lastTabTarget.set(panel, to);
    return true;
  }
  /* A finger's lift already started this very switch (`playPrimedTabTransition`); the click that
     follows asks for it again. */
  if (live && live.panel === panel && live.from === from && live.to === to) {
    if (primed) releasePrimedRun();
    lastTabTarget.set(panel, to);
    return true;
  }
  /* The press that led here primed this very switch. */
  if (primed) {
    if (primed.panel === panel && primed.from === from && primed.to === to && primed.play(before)) return true;
    releasePrimedRun(primed.panel === panel);
  }
  live?.finish();
  suspendFloor(panel);
  prepareTabRun(panel, leaving, entering, from, to, direction, before, false);
  return true;
}

/**
 * The body of a switch. `held`: set it up at its first pose and wait (`primeTabTransition`) —
 * everything but the writes that move the page, which a press may yet take back: the scroll
 * restore, the outgoing pane's compensation for it, the per-tab memory, the record of where the
 * panes are. Returns the primed run when held.
 */
function prepareTabRun(
  panel: HTMLElement,
  leaving: HTMLElement,
  entering: HTMLElement,
  from: string,
  to: string,
  direction: 1 | -1,
  before: number | undefined,
  held: boolean,
): PrimedRun | null {
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
  const view = scroller && !instant ? scroller.getBoundingClientRect() : null;
  const column = panel.getBoundingClientRect();
  /* On a wide screen, the column and a faded margin rather than the whole scroller
     (`columnWindow`) — where the scroller is the window and the strip slides (the reduced tier's
     short shift stays inside the column), and where the engine can mask the edges. */
  const edge =
    view && scroller && stripWindow === scroller && motionTier('tabs') === 'standard' && supportsEdgeMask()
      ? columnWindow(column, {
          left: view.left + scroller.clientLeft,
          right: view.left + scroller.clientLeft + scroller.clientWidth,
        })
      : null;
  const distance = edge?.width ?? (stripWindow?.clientWidth || column.width) + AXIS_GAP;
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
  /* What the window can show of each pane for the run (`paneClip`), and the lean — both planned
     here, among the reads, where the panes are already laid out. The arriving pane will sit
     `next − origin` higher once the offset is written; the leaving one is held where it is. */
  let clip: { leaving: PaneClip | null; entering: PaneClip | null; offset: number } | undefined;
  if (view) {
    /* Half a window either side: a page scrolled during the run widens the clip a frame later. */
    const margin = Math.max(200, view.height / 2);
    clip = {
      leaving: paneClip(leaving, view.top, view.bottom, 0, margin),
      entering: paneClip(entering, view.top, view.bottom, origin - next, margin),
      offset: next,
    };
  }
  /* The lean is the panel's own statement (`TabPanes lean`), so the tap and the reactive path
     cannot disagree about it. */
  let lean: LeanPlan | undefined;
  if (view && scroller && panel.hasAttribute('data-tab-lean') && motionTier('tabs') === 'standard') {
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
  const offsetY = next - origin;

  /* The settle, for both ends a run can reach. `reversed` means it was played back and
   * `leaving` is the pane that stays. */
  let released = false;
  let abandoned = false;
  /* The footer rides inside `[data-page-content]` and travels with every route
   * change on its own; a tab switch is the exception — the sliding panes are
   * *inside* the page — so this is the one caller that asks it to step aside. Held from the
   * press, when the arriving pane first takes its place beside the leaving one. */
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

  /* Writes. Saved here rather than only in `startTabTransition`, so the memory is kept by
   * *every* way of changing tab: sidebar links, the back button and the `/forum` redirect
   * arrive through the reactive path and never record the tab they are leaving. */
  const commit = () => {
    rememberTabScroll(panel, from, origin);
    if (scroller && offsetY !== 0) {
      // Scroll anchoring would "correct" a deliberate jump; same guard as runScroll.
      scroller.style.overflowAnchor = 'none';
      scroller.scrollTop = next;
    }
    lastTabTarget.set(panel, to);
  };

  if (instant) {
    commit();
    land(false);
    return null;
  }
  /* Before the animations, as the reads' last consumer: a scroll write lays out what is dirty,
     and after the animations that would be a second forced pass. */
  if (!held) commit();

  const handle = playSharedAxis({
    leaving,
    entering,
    direction,
    distance,
    view: stripWindow,
    /* A primed run holds the outgoing pane where it is; the compensation comes with the scroll
       write, at `play`. */
    leavingOffsetY: held ? 0 : offsetY,
    lean,
    clip,
    edge: edge ? { panel, reach: edge.reach, fade: edge.fade } : undefined,
    onSettle: land,
    held,
  });

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
  const go = () => {
    if (offsetY !== 0) panel.style.overflowY = 'clip';
    /* Same reason as the masonry cascade: these panes are ancestors of every gallery
     * card, and `useHeroLink` measures a card during the click that follows this
     * press. Snap to rest rather than be measured mid-slide. */
    panel.addEventListener('pointerdown', onPress, { capture: true });
    activeTabRun = record;
  };

  if (!held) {
    go();
    return null;
  }
  const primed: PrimedRun = {
    panel,
    from,
    to,
    play: (after) => {
      if (primedRun !== primed) return false;
      const now = after ?? scroller?.scrollTop ?? 0;
      /* The page moved under the press (a fling still settling, a wheel): the reads are stale. */
      if (Math.abs(now - origin) > 1 || heroOwnsScreen()) {
        releasePrimedRun(true);
        return false;
      }
      primedRun = null;
      primeWatch?.();
      suspendFloor(panel);
      commit();
      go();
      handle.play(offsetY);
      return true;
    },
    release: (keepFlags = false) => {
      handle.cancel();
      released = true;
      endTransit();
      if (!keepFlags) clearPaneFlags(panel);
    },
  };
  return primed;
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
  /* The finger's lift already started this switch: the offset was recorded then, and the
     scroller holds the arriving tab's now. */
  if (activeTabRun?.panel === panel && activeTabRun.from === from && activeTabRun.to === to) {
    lastTabTarget.set(panel, to);
    return;
  }
  /* Recorded before the tier check, and keyed on the panel, so the two writers agree. */
  const scroller = getAppScroller();
  if (scroller) rememberTabScroll(panel, from, scroller.scrollTop);
  /* Only `off` returns here: the switch then happens when the URL commits, through the
   * driver, with no run. `reduced` runs the transition, which cross-fades the panes
   * instead of sliding them — that branch is inside `playSharedAxis`. */
  if (motionTier('tabs') === 'off') return;
  runTabTransition(panel, from, to, direction);
}

/* --- the press primes the switch --------------------------------------------------------- */

/** After the pointer comes up, how long a primed switch waits for a click to play it — a mouse's,
 *  or a finger's held too long to start on the lift. A finger's click arrives a task or two after
 *  it lifts, later on a main thread that is busy. */
const PRIME_CLICK_GRACE_MS = 1000;
/** A primed switch nobody plays is let go after this long, whatever the pointer is doing. */
const PRIME_MAX_MS = 10_000;

/**
 * **A press on a tab primes its switch; its release starts it.** Everything a switch costs before
 * its first frame — the arriving pane's restyle, layout and first paint (the rows the window can
 * show, `paneClip`), its compositor layers, the lean's plan and its blocks' layers — used to be
 * paid after the finger lifted: the click's task and the frame after it, 75–240ms on a
 * phone-class CPU (4× slower than a desktop, measured) before anything moved. A finger is down for
 * 60–120ms before it lifts, and that work does not depend on the lift: so it is done here, behind
 * the press, with the run set up at its first pose and held there (`playSharedAxis`'s `held`). The
 * finger's lift, or a mouse's click, finds it ready and only starts the clock
 * (`playPrimedTabTransition`).
 *
 * Nothing the press does is visible: the arriving pane waits a window to the side, clipped, and
 * the outgoing one does not move. The writes that would be — the scroll restore and the
 * outgoing pane's compensation for it — wait for the start. A press that is not a tap (a scroll,
 * a drag off the tab, a pointer that comes up elsewhere) lets the run go and the panes are as
 * they were; a switch to any other tab, by any path, lets it go first.
 *
 * A finger primes at once: its press feedback waits for the tap timeout anyway
 * (`trackPress`). A mouse primes after the frame that paints its ripple (`deferred`), which is
 * still most of a click's length before the click. Where the prime outlasts the press — the home
 * pill's two large panes on a slow phone — the release waits for it, and the switch starts on the
 * frame after; nothing is lost but the head start.
 */
export function primeTabTransition(
  panel: HTMLElement,
  from: string,
  to: string,
  direction: 1 | -1,
  press: { pointerId: number; deferred: boolean },
): void {
  releasePrimedRun();
  if (from === to || activeTabRun || motionTier('tabs') === 'off' || heroOwnsScreen()) return;
  let frame = 0;
  let timer = 0;
  let waiting = true;
  const stop = () => {
    waiting = false;
    window.cancelAnimationFrame(frame);
    window.clearTimeout(timer);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
    if (primeWatch === stop) primeWatch = null;
  };
  /* The run is the watcher's from here: the release takes the watcher down with it. */
  const letGo = () => {
    if (primeWatch === stop && primedRun) releasePrimedRun();
    else stop();
  };
  function onUp(event: PointerEvent) {
    if (event.pointerId !== press.pointerId) return;
    /* A click this quick comes before a deferred prime could help. */
    if (waiting) return stop();
    window.removeEventListener('pointerup', onUp, true);
    window.clearTimeout(timer);
    timer = window.setTimeout(letGo, PRIME_CLICK_GRACE_MS);
  }
  function onCancel(event: PointerEvent) {
    if (event.pointerId === press.pointerId) letGo();
  }
  const prime = () => {
    if (!waiting) return;
    waiting = false;
    if (!primeNow(panel, from, to, direction)) return stop();
    timer = window.setTimeout(letGo, PRIME_MAX_MS);
  };
  primeWatch = stop;
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onCancel, true);
  if (press.deferred) {
    frame = window.requestAnimationFrame(() => {
      timer = window.setTimeout(prime, 0);
    });
  } else {
    prime();
  }
}

/**
 * **A finger's switch starts on the lift.** A touch is a click only once the browser has told the
 * lift from the start of a gesture — a task or two after the finger comes up, tens of milliseconds
 * on a busy phone — and the click then renders the screen's new state before the next frame. A
 * native tab row selects on the lift. So the switch the press primed starts here, when the finger
 * comes up on its own tab: the strip is moving on the compositor while the click is still on its
 * way and while React renders it, and the click finds the run under way and adopts it
 * (`runTabTransition`). The caller selects the tab itself if the click never comes. Returns
 * whether it started.
 */
export function playPrimedTabTransition(panel: HTMLElement, to: string): boolean {
  const primed = primedRun;
  if (!primed || primed.panel !== panel || primed.to !== to) return false;
  return primed.play();
}

/** Set the switch up now, if the panel is at rest on `from`. */
function primeNow(panel: HTMLElement, from: string, to: string, direction: 1 | -1): boolean {
  if (!panel.isConnected || activeTabRun || primedRun || motionTier('tabs') === 'off' || heroOwnsScreen()) return false;
  /* Only from rest: a switch still waiting for its commit holds flags of its own. */
  for (const pane of panel.querySelectorAll<HTMLElement>(':scope > [data-tab-pane]')) {
    if (MOTION_FLAGS.some((flag) => pane.hasAttribute(flag))) return false;
  }
  const leaving = paneOf(panel, from);
  const entering = paneOf(panel, to);
  if (!leaving || !entering || leaving === entering) return false;
  if (!leaving.hasAttribute('data-tab-pane-active') || entering.hasAttribute('data-tab-pane-active')) return false;
  primedRun = prepareTabRun(panel, leaving, entering, from, to, direction, undefined, true);
  return primedRun !== null;
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
      /* Not while a switch is on screen or primed: it owns this frame's work. The next render
         asks again. */
      if (activeTabRun?.panel === panel || primedRun?.panel === panel || heroOwnsScreen()) return;
      for (const pane of waiting) prerenderPane(pane);
    });
  }

  /**
   * **A web font landing undoes the rendering ahead.** Its text is shaped again, and a concealed
   * pane lays out only when it is shown — so the first switch to a pane that was concealed when
   * a font slice arrived shaped its text inside the tap (on Windows, where the Han web font
   * leads, /policy's 服务协议 spent 58ms of a 4× slower CPU there). Every concealed pane is
   * rendered ahead again, in an idle slice, once a load is done.
   */
  private onFontsLoaded = () => {
    const panel = this.props.panelRef.current;
    if (!panel) return;
    for (const pane of panel.querySelectorAll<HTMLElement>(':scope > [data-tab-pane]')) {
      if (isConcealedPane(pane)) renderedPanes.delete(pane);
    }
    this.schedulePrerender();
  };

  componentDidMount() {
    const panel = this.props.panelRef.current;
    if (panel) {
      this.panesObserver = new MutationObserver(() => this.schedulePrerender());
      this.panesObserver.observe(panel, { childList: true });
    }
    document.fonts?.addEventListener?.('loadingdone', this.onFontsLoaded);
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
     * every motion flag is stale — including a hold placed before this commit, and a press's. */
    if (idle) {
      if (primedRun?.panel === panel) releasePrimedRun();
      clearPaneFlags(panel);
    }
  }

  componentWillUnmount() {
    this.panesObserver?.disconnect();
    this.panesObserver = null;
    document.fonts?.removeEventListener?.('loadingdone', this.onFontsLoaded);
    this.cancelPrerender?.();
    this.cancelPrerender = null;
    const panel = this.props.panelRef.current;
    if (primedRun && primedRun.panel === panel) releasePrimedRun();
    if (activeTabRun && activeTabRun.panel === panel) activeTabRun.abandon();
    if (panel) suspendFloor(panel);
  }

  render() {
    return null;
  }
}

/** Ends any in-flight tab transition immediately, and lets go of a primed one. */
export function finishTabTransition() {
  releasePrimedRun();
  activeTabRun?.finish();
}
