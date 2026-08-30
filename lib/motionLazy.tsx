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
 * The four things the app shell asks of `lib/motion`, behind a dynamic import.
 *
 * `components/AppLayout.tsx` wraps every route, and `lib/motion.ts` registers GSAP and five
 * plugins at module scope — so a theme toggle, a tab tap, a one-line setter and a phone-only swipe
 * gesture were, between them, putting 43 KB (brotli) of animation engine into the first document
 * of a page of text. None of the four can run before the user has done something.
 *
 * **Nothing here awaits inside an event handler**, which is the rule this file exists to keep. An
 * `await` before `preventDefault()` loses the gesture, and an `await` before a state write puts a
 * frame of nothing on screen. Every entry point instead does the thing the **关闭 tier** already
 * does — a real, shipped, documented code path — and starts the load in the background. So a user
 * who beats the chunk gets one interaction without its animation, not a dropped one.
 *
 * `warmMotion()` is called from the shell on an idle callback after first paint, so in practice
 * the chunk is resident long before any of this is reached.
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

/**
 * A colour-scheme change, as a circular wipe.
 *
 * Without the engine the preference is still written and the scheme still flips — `commitScheme`
 * is `lib/appearance`'s and needs nothing — it simply arrives as a cut. That is what the 关闭 tier
 * does with this control today.
 */
export function changeScheme(setting: SchemeSetting, origin?: { x: number; y: number }): void {
  if (motion) {
    motion.changeScheme(setting, origin);
    return;
  }
  commitScheme(setting);
  void load();
}

/**
 * A palette change, as a circular wipe.
 *
 * Same shape as `changeScheme`: without the engine the palette still changes, it just does not
 * wipe. `/settings` is the only screen with this control, and it is also one of the two places the
 * app's own preference for less motion can be turned on — so a first click that lands before the
 * chunk is precisely the case where a cut is the acceptable answer.
 */
export function changePalette(id: PaletteId, origin?: { x: number; y: number }): void {
  if (motion) {
    motion.changePalette(id, origin);
    return;
  }
  commitPalette(id);
  void load();
}

/**
 * The eleventh palette, as a wipe. Same contract as `changePalette` above: without the
 * engine the colour still changes, it just arrives as a cut.
 *
 * The install is resolved by the caller through `lib/paletteLazy.ts`, so this function
 * stays synchronous and the two chunks stay independent — a user who has the palette
 * recipe but not GSAP gets their colour without a wipe, which is the right way round.
 */
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

/**
 * The optimistic tab, while the URL catches up.
 *
 * No fallback needed and no engine involved: this moved to `lib/tabIntent.ts`. Re-exported here
 * so the shell's motion imports stay one import.
 */
export { setTabIntent } from '@/lib/tabIntent';

/**
 * Starts a tab switch on the tap, ahead of the route push.
 *
 * The fallback is `startTabTransition`'s own 关闭 branch, line for line: record the outgoing
 * offset against the panel and return. The switch then happens in `useTabPanes`'s layout effect
 * when the URL commits, which positions the scroller and swaps the panes without animating —
 * exactly what a user who has asked for no motion gets.
 */
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
 * A hook cannot live behind an `import()`, so this is a **component**: it renders nothing, and it
 * is only rendered once the engine has arrived. That is what keeps the hook call unconditional —
 * React's rule is about call order within one component's renders, and `<DrawerSwipeImpl>` calls
 * `useDrawerSwipe` on every render it ever has.
 *
 * The load is gated on `enabled`, which is `!useMediaQuery(MEDIA.md)` at the call site: above
 * 768px the drawer is docked and this gesture does not exist, so a desktop session never fetches
 * the chunk for it. What is lost while it arrives is one swipe; the drawer's button, its scrim and
 * its Escape key are untouched, because none of them is this hook's.
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
 * `useTabPanes` and `useStaggerGrid` both return a **ref**, which is why neither can simply be
 * wrapped: the ref has to exist in the first render, and the engine does not. So the caller keeps
 * the `useRef` and hands it down, and the hook runs inside a child that is only mounted once the
 * module has arrived — the same arrangement as `DrawerSwipe`, and the only one that keeps the
 * hook's own call order unconditional.
 *
 * `TabPanes` alone is on seven routes and `MasonryGrid` on two more, so between them they are what
 * decides whether GSAP is in the shared chunk every route loads or in one nothing loads until it
 * moves. That is the whole reason both are here rather than left as direct imports.
 * ------------------------------------------------------------------------ */

/**
 * The shared-axis tab switch, once the engine is resident.
 *
 * Until then `TabPanesFallback` does what the **关闭 tier** does: `data-tab-pane-active` moves in
 * React's own commit, globals.css swaps the panes on it, and the scroller lands on the
 * destination's remembered offset. No pane is left mid-flight, because nothing was flying.
 */
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

/**
 * The gallery's entrance cascade, once the engine is resident.
 *
 * There is no fallback and there should not be: this is an *entrance*, so its absent form is the
 * cards simply being there — which is exactly what 入场动画 off already gives, and what a grid
 * re-rendered on a page turn gives today. Nothing is left half-animated.
 */
export function StaggerGrid({
  gridRef,
  selector,
  deps,
}: {
  gridRef: RefObject<HTMLElement | null>;
  selector: string;
  deps: unknown[];
}) {
  /* **Decided once, at mount, and never subscribed to the load.**

     This used to wait for the chunk and then mount the hook, which is wrong for an *entrance*
     in one specific and very visible way: `/` renders its first feed page on the server, so on
     a cold load the cards are in the HTML and painted before the engine arrives. The hook then
     ran `fromTo(..., { autoAlpha: 0, y: 16, scale: 0.985 })` over content the user was already
     looking at — fifty cards blinked out a few hundred milliseconds after paint and cascaded
     back in over ~1.3s. An entrance that begins after the content has arrived is worse than no
     entrance, which is what the paragraph above means by "its absent form is the cards simply
     being there".

     So: engine resident at mount (a client navigation, a warm second visit) and the cascade
     plays before the first paint of those cards, which is what it is for. Engine absent and
     this grid instance never cascades. Nothing else changes — `warmMotion()` still loads the
     engine on an idle callback for every other consumer. */
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
