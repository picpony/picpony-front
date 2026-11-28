'use client';

import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import {
  commitCustomPalette,
  commitPalette,
  commitPaletteHues,
  commitScheme,
  commitSkyPhase,
  type CustomPaletteInstall,
  type PaletteHues,
  type PaletteId,
  type SchemeSetting,
  type SkyPhaseId,
} from '@/lib/appearance';
import { getAppScroller } from '@/lib/appScroller';
import { applyInstantTabScroll, rememberTabScroll } from '@/lib/tabScroll';
import type { DrawerSwipeOptions } from '@/lib/motion/drawer';

/**
 * The shell's motion operations behind independent dynamic imports:
 *
 * - `lib/motion/tabs.ts` (WAAPI shared-axis tabs), `lib/motion/theme.ts` (View Transition
 *   theme wipes) and `lib/motion/grid.ts` (WAAPI grid stagger) carry **zero GSAP dependency** and
 *   warm on idle via `warmMotion()`.
 * - `lib/motion/drawer.ts` (phone-only swipe-to-close) isolates GSAP + Observer behind its own
 *   on-open boundary so desktop homepage hydration, idle warmup, tab switching, theme wipes and
 *   grid cascades download zero GSAP bytes.
 *
 * **GSAP boundary:** routes may import this facade; their static graphs must never reach
 * `lib/motion.ts` or its implementation modules.
 *
 * **Nothing here awaits inside an event handler** — the rule this file exists to keep. An `await`
 * before `preventDefault()` loses the gesture; an `await` before a state write puts a frame of
 * nothing on screen. Every entry point instead does what the **关闭 tier** already does and
 * starts the load in the background: a user who beats the chunk loses one interaction's
 * animation, never the interaction. `warmMotion()` is called from the shell in runWhenIdle.
 */

type TabsModule = typeof import('@/lib/motion/tabs');
type ThemeModule = typeof import('@/lib/motion/theme');
type DrawerModule = typeof import('@/lib/motion/drawer');
type GridModule = typeof import('@/lib/motion/grid');

let tabsModule: TabsModule | null = null;
let tabsLoading: Promise<TabsModule | null> | null = null;

function loadTabs(): Promise<TabsModule | null> {
  if (tabsLoading) return tabsLoading;
  tabsLoading = import('@/lib/motion/tabs')
    .then((module) => {
      tabsModule = module;
      return module;
    })
    .catch(() => {
      tabsLoading = null;
      return null;
    });
  return tabsLoading;
}

let themeModule: ThemeModule | null = null;
let themeLoading: Promise<ThemeModule | null> | null = null;

function loadTheme(): Promise<ThemeModule | null> {
  if (themeLoading) return themeLoading;
  themeLoading = import('@/lib/motion/theme')
    .then((module) => {
      themeModule = module;
      return module;
    })
    .catch(() => {
      themeLoading = null;
      return null;
    });
  return themeLoading;
}

let drawerModule: DrawerModule | null = null;
let drawerLoading: Promise<DrawerModule | null> | null = null;

function loadDrawer(): Promise<DrawerModule | null> {
  if (drawerLoading) return drawerLoading;
  drawerLoading = import('@/lib/motion/drawer')
    .then((module) => {
      drawerModule = module;
      return module;
    })
    .catch(() => {
      drawerLoading = null;
      return null;
    });
  return drawerLoading;
}

let gridModule: GridModule | null = null;
let gridLoading: Promise<GridModule | null> | null = null;

function loadGrid(): Promise<GridModule | null> {
  if (gridLoading) return gridLoading;
  gridLoading = import('@/lib/motion/grid')
    .then((module) => {
      gridModule = module;
      return module;
    })
    .catch(() => {
      gridLoading = null;
      return null;
    });
  return gridLoading;
}

/** Pull the GSAP-free tab, theme and grid modules in after first paint. Idempotent. */
export function warmMotion(): void {
  void loadTabs();
  void loadTheme();
  void loadGrid();
}

/** A colour-scheme change as a circular wipe; without the module the preference is still
 *  written and the scheme flips — it arrives as a cut, what the 关闭 tier does today. */
export function changeScheme(setting: SchemeSetting, origin?: { x: number; y: number }): void {
  if (themeModule) {
    themeModule.changeScheme(setting, origin);
    return;
  }
  commitScheme(setting);
  void loadTheme();
}

/** A palette change as a circular wipe, same shape as `changeScheme`: without the module the
 *  palette still changes, it just does not wipe. On `/settings` — the only screen with this
 *  control — a first click before the chunk is exactly where a cut is acceptable. */
export function changePalette(id: PaletteId, origin?: { x: number; y: number }): void {
  if (themeModule) {
    themeModule.changePalette(id, origin);
    return;
  }
  commitPalette(id);
  void loadTheme();
}

/** The eleventh palette, as a wipe — same contract as `changePalette`. The install is resolved
 *  by the caller through `lib/paletteLazy.ts`, so this stays synchronous and the two chunks stay
 *  independent. */
export function changeCustomPalette(install: CustomPaletteInstall, origin?: { x: number; y: number }): void {
  if (themeModule) {
    themeModule.changeCustomPalette(install, origin);
    return;
  }
  commitCustomPalette(install);
  void loadTheme();
}

/** 配色方案, as a wipe — same contract as `changePalette`. */
export function changePaletteHues(hues: PaletteHues, origin?: { x: number; y: number }): void {
  if (themeModule) {
    themeModule.changePaletteHues(hues, origin);
    return;
  }
  commitPaletteHues(hues);
  void loadTheme();
}

/** Dynamic 天空 time-of-day transition as a wipe; falls back to an instant commit until loaded. */
export function changeSkyPhase(phaseId: SkyPhaseId, origin?: { x: number; y: number }): void {
  if (themeModule) {
    themeModule.changeSkyPhase(phaseId, origin);
    return;
  }
  commitSkyPhase(phaseId);
  void loadTheme();
}

/** The optimistic tab, while the URL catches up. No engine involved — it lives in
 *  `lib/tabIntent.ts`; re-exported so the shell's motion imports stay one import. */
export { setTabIntent } from '@/lib/tabIntent';

/** Starts a tab switch on the tap, ahead of the route push. Without the tab module the fallback is
 *  the 关闭 branch, line for line: record the outgoing offset against the panel and return; the
 *  switch then happens when the URL commits, without animating. */
export function startTabTransition(from: string, to: string, direction: 1 | -1): void {
  if (tabsModule) {
    tabsModule.startTabTransition(from, to, direction);
    return;
  }
  void loadTabs();
  if (from === to) return;
  const panel = document.querySelector<HTMLElement>('[data-tab-panel]');
  if (!panel) return;
  const scroller = getAppScroller();
  if (scroller) rememberTabScroll(panel, from, scroller.scrollTop);
}

/** The press on a tab primes its switch, for its release to start (`primeTabTransition` in
 *  `lib/motion/tabs.ts`). Without the tab module there is no run to prime: the click takes the
 *  fallback above. */
export function primeTabTransition(
  panel: HTMLElement,
  from: string,
  to: string,
  direction: 1 | -1,
  press: { pointerId: number; deferred: boolean },
): void {
  if (tabsModule) {
    tabsModule.primeTabTransition(panel, from, to, direction, press);
    return;
  }
  void loadTabs();
}

/** A finger's lift starts the switch its press primed (`playPrimedTabTransition`). False without
 *  the tab module: nothing was primed, and the click does the switch. */
export function playPrimedTabTransition(panel: HTMLElement, to: string): boolean {
  return tabsModule ? tabsModule.playPrimedTabTransition(panel, to) : false;
}

/**
 * The drawer's swipe-to-close, on a phone.
 *
 * A hook cannot live behind an `import()`, so this renders the drawer module's own **component**
 * (`DrawerSwipeHost`, rendering nothing) once loaded — the hook call stays unconditional for its
 * whole life, and it is called by name inside the module rather than handed down as a value, which
 * the React Compiler refuses to compile.
 *
 * The load is gated on `enabled && open`: above 768px the drawer is docked, and even on a phone
 * swipe only closes an already-open drawer (left-edge open is reserved for OS Back). Waiting until
 * the drawer opens keeps GSAP + Observer completely out of mobile cold-load hydration too; once
 * loaded, `DrawerSwipeHost` remains mounted so interruptions and disables clean up identically.
 */
export function DrawerSwipe(options: DrawerSwipeOptions) {
  const [ready, setReady] = useState(drawerModule !== null);
  const enabled = options.enabled ?? true;
  const shouldLoad = enabled && options.open;

  useEffect(() => {
    if (!shouldLoad || ready) return;
    let live = true;
    void loadDrawer().then((mod) => {
      if (live && mod) setReady(true);
    });
    return () => {
      live = false;
    };
  }, [shouldLoad, ready]);

  if (!ready || !drawerModule) return null;
  const Host = drawerModule.DrawerSwipeHost;
  return <Host {...options} />;
}

/* ---------------------------------------------------------------------------
 * The two that gate most of the app's routes
 *
 * The caller keeps the `useRef` and hands it down — the ref must exist in the caller's first
 * render, before the module does — while the motion runs inside a child mounted only once the
 * module has arrived (as in `DrawerSwipe`), the only arrangement that keeps a hook's call order
 * unconditional. The children are the modules' own components, read off the module once resident.
 * The tab switch's is a class (`TabPanesDriver`): it needs the one lifecycle that runs before
 * React's DOM mutations.
 * ------------------------------------------------------------------------ */

/** The shared-axis tab switch, once `lib/motion/tabs.ts` (GSAP-free WAAPI) is resident. Until
 *  then the fallback applies an instant tab scroll — panes swap in React's commit and the scroller
 *  lands on the destination's remembered offset; no pane is left mid-flight, because nothing was
 *  flying. */
export function TabPanesMotion({ panelRef, active }: { panelRef: RefObject<HTMLElement | null>; active: string }) {
  const [ready, setReady] = useState(tabsModule !== null);

  useEffect(() => {
    if (ready) return;
    let live = true;
    void loadTabs().then((mod) => {
      if (live && mod) setReady(true);
    });
    return () => {
      live = false;
    };
  }, [ready]);

  if (!ready || !tabsModule) return <TabPanesFallback panelRef={panelRef} active={active} />;
  const Driver = tabsModule.TabPanesDriver;
  return <Driver panelRef={panelRef} active={active} />;
}

function TabPanesFallback({ panelRef, active }: { panelRef: RefObject<HTMLElement | null>; active: string }) {
  /* Layout effect, so the offset lands in the frame the arriving pane first paints — a passive
     effect would show it at the outgoing tab's scroll position for one frame. */
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (panel) applyInstantTabScroll(panel, active);
  }, [panelRef, active]);
  return null;
}

/** The gallery's entrance cascade, once `lib/motion/grid.ts` is resident. No fallback,
 *  deliberately: an *entrance*'s absent form is the cards simply being there — nothing is left
 *  half-animated, and cold loads never pull GSAP for a cascade that would blink painted cards. */
export function StaggerGrid({
  gridRef,
  selector,
  deps,
}: {
  gridRef: RefObject<HTMLElement | null>;
  selector: string;
  deps: unknown[];
}) {
  /* Decided once, at mount, never subscribed to the load. An entrance that begins after its
     content has arrived is worse than no entrance: `/` server-renders the first feed page, so
     gating the cascade on the chunk made painted cards blink out and cascade back in. */
  const [ready] = useState(gridModule !== null);

  if (!ready || !gridModule) return null;
  const Host = gridModule.StaggerGridHost;
  return <Host gridRef={gridRef} selector={selector} deps={deps} />;
}
