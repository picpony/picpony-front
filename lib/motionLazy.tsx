'use client';

import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import {
  commitCustomPalette,
  commitPalette,
  commitScheme,
  type CustomPaletteInstall,
  type PaletteId,
  type SchemeSetting,
} from '@/lib/appearance';
import { getAppScroller } from '@/lib/appScroller';
import { applyInstantTabScroll, rememberTabScroll } from '@/lib/tabScroll';
import type { DrawerSwipeOptions } from '@/lib/motion';

/**
 * The four things the app shell asks of `lib/motion`, behind a dynamic import — `lib/motion.ts`
 * registers GSAP and five plugins at module scope and none of the four can run before the user
 * has done something, yet together they pulled the engine into the first document.
 *
 * **GSAP boundary:** the sanctioned lazy entry to the engine; nothing here may be statically
 * imported by a route — zero routes reach `lib/motion` in a first document.
 *
 * **Nothing here awaits inside an event handler** — the rule this file exists to keep. An `await`
 * before `preventDefault()` loses the gesture; an `await` before a state write puts a frame of
 * nothing on screen. Every entry point instead does what the **关闭 tier** already does and
 * starts the load in the background: a user who beats the chunk loses one interaction's
 * animation, never the interaction. `warmMotion()` is called from the shell in runWhenIdle.
 */

type Motion = typeof import('@/lib/motion');

let motion: Motion | null = null;
let loading: Promise<Motion> | null = null;

function load(): Promise<Motion> {
  if (loading) return loading;
  loading = import('@/lib/motion').then((module) => {
    motion = module;
    return module;
  });
  return loading;
}

/** Pull the engine in after first paint. Idempotent. */
export function warmMotion(): void {
  void load();
}

/** A colour-scheme change as a circular wipe; without the engine the preference is still
 *  written and the scheme flips — it arrives as a cut, what the 关闭 tier does today. */
export function changeScheme(setting: SchemeSetting, origin?: { x: number; y: number }): void {
  if (motion) {
    motion.changeScheme(setting, origin);
    return;
  }
  commitScheme(setting);
  void load();
}

/** A palette change as a circular wipe, same shape as `changeScheme`: without the engine the
 *  palette still changes, it just does not wipe. On `/settings` — the only screen with this
 *  control — a first click before the chunk is exactly where a cut is acceptable. */
export function changePalette(id: PaletteId, origin?: { x: number; y: number }): void {
  if (motion) {
    motion.changePalette(id, origin);
    return;
  }
  commitPalette(id);
  void load();
}

/** The eleventh palette, as a wipe — same contract as `changePalette`. The install is resolved
 *  by the caller through `lib/paletteLazy.ts`, so this stays synchronous and the two chunks stay
 *  independent. */
export function changeCustomPalette(
  install: CustomPaletteInstall,
  origin?: { x: number; y: number },
): void {
  if (motion) {
    motion.changeCustomPalette(install, origin);
    return;
  }
  commitCustomPalette(install);
  void load();
}

/** The optimistic tab, while the URL catches up. No engine involved — it lives in
 *  `lib/tabIntent.ts`; re-exported so the shell's motion imports stay one import. */
export { setTabIntent } from '@/lib/tabIntent';

/** Starts a tab switch on the tap, ahead of the route push. Without the engine the fallback is
 *  the 关闭 branch, line for line: record the outgoing offset against the panel and return; the
 *  switch then happens in `useTabPanes`'s layout effect when the URL commits, without animating. */
export function startTabTransition(
  from: string,
  to: string,
  direction: 1 | -1,
  lean = false,
): void {
  if (motion) {
    motion.startTabTransition(from, to, direction, lean);
    return;
  }
  void load();
  if (from === to) return;
  const panel = document.querySelector<HTMLElement>('[data-tab-panel]');
  if (!panel) return;
  const scroller = getAppScroller();
  if (scroller) rememberTabScroll(panel, from, scroller.scrollTop);
}

/**
 * The drawer's edge-swipe, on a phone.
 *
 * A hook cannot live behind an `import()`, so this is a **component** rendering nothing, rendered
 * only once the engine has arrived — the hook call stays unconditional for its whole life. The
 * load is gated on `enabled`: above 768px the drawer is docked, so a desktop never fetches the
 * chunk. What is lost while it arrives is one swipe; the drawer's button, scrim and Escape key
 * are untouched, because none of them is this hook's.
 */
export function DrawerSwipe(options: DrawerSwipeOptions) {
  const [ready, setReady] = useState(motion !== null);
  const enabled = options.enabled ?? true;

  useEffect(() => {
    if (!enabled || ready) return;
    let live = true;
    void load().then(() => {
      if (live) setReady(true);
    });
    return () => {
      live = false;
    };
  }, [enabled, ready]);

  if (!ready || !motion) return null;
  return <DrawerSwipeImpl impl={motion.useDrawerSwipe} options={options} />;
}

function DrawerSwipeImpl({
  impl,
  options,
}: {
  impl: Motion['useDrawerSwipe'];
  options: DrawerSwipeOptions;
}) {
  impl(options);
  return null;
}

/* ---------------------------------------------------------------------------
 * The two hooks that gate most of the app's routes
 *
 * `useTabPanes`/`useStaggerGrid` return a **ref**, so the caller keeps the `useRef` and hands it
 * down — the ref must exist in the caller's first render, before the engine does — while the
 * hook runs inside a child mounted only once the module has arrived (as in `DrawerSwipe`), the
 * only arrangement that keeps the hook call order unconditional.
 * ------------------------------------------------------------------------ */

/** The shared-axis tab switch, once the engine is resident. Until then the fallback applies an
 *  instant tab scroll — panes swap in React's commit and the scroller lands on the destination's
 *  remembered offset; no pane is left mid-flight, because nothing was flying. */
export function TabPanesMotion({
  panelRef,
  active,
  lean,
}: {
  panelRef: RefObject<HTMLElement | null>;
  active: string;
  lean: boolean;
}) {
  const [ready, setReady] = useState(motion !== null);

  useEffect(() => {
    if (ready) return;
    let live = true;
    void load().then(() => {
      if (live) setReady(true);
    });
    return () => {
      live = false;
    };
  }, [ready]);

  if (!ready || !motion) return <TabPanesFallback panelRef={panelRef} active={active} />;
  return <TabPanesImpl impl={motion.useTabPanesOn} panelRef={panelRef} active={active} lean={lean} />;
}

function TabPanesImpl({
  impl,
  panelRef,
  active,
  lean,
}: {
  impl: Motion['useTabPanesOn'];
  panelRef: RefObject<HTMLElement | null>;
  active: string;
  lean: boolean;
}) {
  impl(panelRef, active, { lean });
  return null;
}

function TabPanesFallback({
  panelRef,
  active,
}: {
  panelRef: RefObject<HTMLElement | null>;
  active: string;
}) {
  /* Layout effect, so the offset lands in the frame the arriving pane first paints — a passive
     effect would show it at the outgoing tab's scroll position for one frame. */
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (panel) applyInstantTabScroll(panel, active);
  }, [panelRef, active]);
  return null;
}

/** The gallery's entrance cascade, once the engine is resident. No fallback, deliberately: an
 *  *entrance*'s absent form is the cards simply being there — nothing is left half-animated. */
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
     gating the cascade on the chunk made painted cards blink out and cascade back in. Engine
     resident at mount → cascade before those cards' first paint; absent → this grid instance
     never cascades. `warmMotion()` still loads the engine for every other consumer. */
  const [ready] = useState(motion !== null);

  if (!ready || !motion) return null;
  return <StaggerGridImpl impl={motion.useStaggerGridOn} gridRef={gridRef} selector={selector} deps={deps} />;
}

function StaggerGridImpl({
  impl,
  gridRef,
  selector,
  deps,
}: {
  impl: Motion['useStaggerGridOn'];
  gridRef: RefObject<HTMLElement | null>;
  selector: string;
  deps: unknown[];
}) {
  impl(gridRef, selector, deps);
  return null;
}
