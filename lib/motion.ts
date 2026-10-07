'use client';
/* `'use no memo'` while `reactCompiler` is on: `useGSAP`'s `dependencies` array is a
 * runtime argument the compiler does not model; identity churn there is how
 * `@gsap/react` disposes its context — the "a second Observer accumulates" bug (see
 * `useDrawerSwipe`). Two call sites omit `revertOnUpdate` on purpose. Lift one file
 * at a time; a compiler bailout is information, not noise. */
'use no memo';

import { Component, useLayoutEffect, useRef, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { CustomEase } from 'gsap/CustomEase';
import { Flip } from 'gsap/Flip';
import { Observer } from 'gsap/Observer';
import {
  commitCustomPalette,
  commitPalette,
  commitPaletteHues,
  commitScheme,
  currentCustomAccent,
  currentCustomSeed,
  currentPalette,
  currentPaletteHues,
  currentScheme,
  motionScale,
  motionTier,
  resolveScheme,
  setMotionScaleListener,
  useEntranceMotion,
  useMotionTier,
  CUSTOM_PALETTE,
  type CustomPaletteInstall,
  type PaletteHues,
  type PaletteId,
  type SchemeSetting,
} from '@/lib/appearance';
import { getAppScroller, heroOwnsScreen, setHeroBusyCheck } from '@/lib/appScroller';
import { DURATION, EASE } from '@/lib/motionTokens';
import { SPRINGS, SPRING_DURATION, springEase, type SpringName } from '@/lib/spring';
import { SPRING_EFFECTS_FOR } from '@/lib/springTiming';
import { beginPageTransit, notifyThemeWipeStart, routeTransitActive, setThemeWipeGuard } from '@/lib/pageTransit';
import { setTabIntent, tabIntent } from '@/lib/tabIntent';
import { replacedSkeleton } from '@/lib/masonry';
import { runWhenIdle } from '@/lib/utils';
import { recallTabScroll, rememberTabScroll, tabPanelTop, TAB_SHARED_CHROME_PX } from '@/lib/tabScroll';
import {
  freshStripLeg,
  lagSamples,
  leanDelay,
  stripProgress,
  turnStrip,
  LEAN_BAND_PX,
  STRIP_DURATION_MS,
  type StripLeg,
  type StripSegment,
} from '@/lib/tabStrip';

gsap.registerPlugin(useGSAP, CustomEase, Flip, Observer);

/* One line reaches every GSAP tween in the app. `off` is *not* a scale of 0 —
 * `timeScale(0)` freezes every tween at its first frame, where `off` means the tween
 * should be over — so the scale is clamped here and the JS branches skip outright.
 * Registering also applies it once, so a cold load does not start at 1x. */
setMotionScaleListener((scale) => {
  gsap.globalTimeline.timeScale(scale > 0 ? 1 / scale : 1);
});


/**
 * Motion tokens for GSAP-driven animation; the same curves live in globals.css
 * (`--ease-*`), keep the two in sync. These are M3's **transition** curves; component
 * motion is spring physics below. The short `decelerate` / `accelerate` names are
 * the *emphasized* pair, not standard.
 */
export const eases = {
  standard: CustomEase.create('standard', '0.2, 0, 0, 1'),
  standardDecelerate: CustomEase.create('standard-decelerate', '0, 0, 0, 1'),
  standardAccelerate: CustomEase.create('standard-accelerate', '0.3, 0, 1, 1'),
  decelerate: CustomEase.create('decelerate', '0.05, 0.7, 0.1, 1'),
  accelerate: CustomEase.create('accelerate', '0.3, 0, 0.8, 0.15'),
  /**
   * M3's emphasized curve — two cubic segments, no cubic-bezier form exists;
   * CustomEase takes the spec path as-is.
   */
  emphasized: CustomEase.create(
    'emphasized',
    'M0,0 C0.05,0 0.133333,0.06 0.166666,0.4 C0.208333,0.82 0.25,1 1,1',
  ),
  /**
   * Symmetric — eases in as well as out. Every curve above is one-sided, leaving
   * two motions with no token: a repeating one (velocity discontinuous per cycle)
   * and a panel travelling in place. The CSS twin is `--ease-symmetric`.
   */
  symmetric: CustomEase.create('symmetric', '0.4, 0, 0.6, 1'),
  /** Alias of `symmetric`, kept because "loop" is the role at its call sites. */
  loop: CustomEase.create('loop', '0.4, 0, 0.6, 1'),
} as const;

/**
 * The nine M3 Expressive component springs, registered as GSAP eases named
 * `spring-<name>`, as closed-form functions (no interpolation error). Always pair
 * with `SPRING.<name>`: shape and settle time are one spring — splitting them at a
 * call site puts the curve on the wrong clock.
 */
for (const [name, spec] of Object.entries(SPRINGS)) {
  gsap.registerEase(`spring-${name}`, springEase(spec));
}

/** Settle times in seconds, keyed the same way. */
export const SPRING = SPRING_DURATION;

/**
 * A spring as a ready-made `{ duration, ease }` pair, so the two cannot drift apart.
 * Under the reduced tier it substitutes shapes (`SPRING_EFFECTS_FOR`: under-damped →
 * critically damped, mirroring the CSS rule); the table lives in `lib/springTiming.ts`
 * so both renderers share it.
 */
export function spring(name: SpringName): { duration: number; ease: string } {
  const shape = motionTier() === 'reduced' ? (SPRING_EFFECTS_FOR[name] ?? name) : name;
  return { duration: SPRING_DURATION[name], ease: `spring-${shape}` };
}


/* Never let a stalled frame be charged to an animation: GSAP advances tweens by
 * real elapsed time, so blocking work is paid out of the animation. `lagSmoothing`
 * pretends the frame took the adjusted lag; 100ms is above a dropped frame and
 * below this app's stalls. */
gsap.ticker.lagSmoothing(100, 33);

/**
 * Re-export so GSAP call sites keep one import. Deliberately NOT consolidated here:
 * this module registers GSAP at module scope, so a token-only import through it
 * would pull the whole engine into any importer's chunk (root layout included).
 */
export { DURATION, EASE };

/* Matches the CSS safety net. No `motionScale()` here: `gsap.globalTimeline.timeScale`
   above already scales every tween; scaling the default as well would apply it twice. */
gsap.defaults({ ease: eases.standard, duration: DURATION.short, overwrite: 'auto' });

/* Tier semantics — the rule every branch below is written against:
 *
 *   reduced — **basic** motion, not absent motion. Keep fades, short travels, state
 *             layers, ripple, indicator slide. Drop the performance: container-transform
 *             flight, full-window slide, stagger, overshoot, decorative loops, Lottie.
 *             The clock is the speed axis's, same as `standard` — form, not length.
 *   off     — drop opacity and colour too; keep only what carries information:
 *             indeterminate progress, a determinate meter's value, a position the
 *             finger is holding, a scroll offset. Those four are in AGENTS.md.
 */

/* Re-exported so `components/ToggleSwitch.tsx`, which calls it directly for the one
   case event delegation cannot reach, keeps a single import path. */
export { spawnRipple } from '@/lib/ripple';



/* `scrollAppToTop` / `scrollAppToElement` live in `lib/scrollTo.ts` (rAF-driven;
   `scrollTop` is not a CSS property, so it is a per-frame write either way).
   Re-exported so a call site that legitimately wants GSAP keeps one import. */
export { scrollAppToTop, scrollAppToElement } from '@/lib/scrollTo';

/* `beginPageTransit`, the theme-wipe guard and `setTabIntent` live in `lib/pageTransit.ts`
   and `lib/tabIntent.ts`; none touches an animation engine. Re-exported so call sites
   that also want GSAP keep one import. */
export { beginPageTransit, setThemeWipeGuard, setTabIntent };


/* `useSlidingIndicator` lives in `lib/slidingIndicator.ts`, on Web Animations. */


type ViewTransitionDocument = Document & {
  startViewTransition: (update: () => void | Promise<void>) => {
    ready: Promise<void>;
    updateCallbackDone: Promise<void>;
    finished: Promise<void>;
    skipTransition: () => void;
  };
};

type ThemeViewTransition = ReturnType<ViewTransitionDocument['startViewTransition']>;

interface ActiveThemeTransition {
  id: string;
  style: HTMLStyleElement;
  transition: ThemeViewTransition;
}

let activeThemeTransition: ActiveThemeTransition | null = null;
let themeTransitionId = 0;

/**
 * Geometry of the box the `::view-transition` pseudo-elements paint into — the
 * *snapshot containing block*. Two properties bite on phones: its units are not
 * reliably CSS pixels, so geometry below is a *fraction* of the box emitted as
 * percentages (correct under any uniform scale); and it spans the **large** viewport,
 * so where the layout viewport is shorter that band sits above client coordinates —
 * hence `topInset`. The `v*` pair is the fallback for engines that discard `lv*`.
 */
function measureSnapshotBox() {
  const root = document.documentElement;
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;top:0;left:0;margin:0;padding:0;border:0;' +
    'visibility:hidden;pointer-events:none;' +
    'width:100vw;height:100vh;width:100lvw;height:100lvh;';
  root.appendChild(probe);
  const probed = probe.getBoundingClientRect();
  probe.remove();

  const layoutWidth = root.clientWidth || window.innerWidth || probed.width;
  const layoutHeight = root.clientHeight || window.innerHeight || probed.height;
  const width = Math.max(probed.width, layoutWidth, window.innerWidth || 0);
  const height = Math.max(probed.height, layoutHeight, window.innerHeight || 0);
  // Compared against the layout viewport specifically, not the visual one: Chrome
  // and Safari keep the ICB at the large size, so for them this stays 0. It fires
  // only where the layout viewport really is the short one — where the snapshot
  // cannot line up with client coordinates.
  const topInset = Math.max(0, probed.height - layoutHeight);

  return { width, height, topInset };
}

/* ---------------------------------------------------------------------------
 * Where the wipe starts
 *
 * A theme change grows out of the control that caused it, but `Select`'s `onChange`
 * reports a value and no point. The fallback chain: the given origin, then the last
 * pointer-down (captured passively at the window), then the focused element's box,
 * then the viewport's centre. The listener is armed at import — the press causing the
 * first theme change has already happened by the time anything here is called, so an
 * on-demand listener would be one gesture late. The window guard covers the
 * server-side pass over a client module.
 * ------------------------------------------------------------------------ */

type RevealPoint = { x: number; y: number };

let lastPointerPoint: RevealPoint | null = null;

if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    (event) => {
      /* A keyboard-driven activation reports 0/0 — a corner, not a press — so that
       * path wants the focused element instead. `pointerdown` rather than `click`: a
       * press on a menu row inside a popover that closes itself may never produce a
       * `click` at all. */
      if (event.clientX === 0 && event.clientY === 0) return;
      lastPointerPoint = { x: event.clientX, y: event.clientY };
    },
    { capture: true, passive: true },
  );
}

/** The centre of `el`'s box, or null if it has none (unmounted, or `display: none`). */
function centreOf(el: Element | null | undefined): RevealPoint | null {
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

const usablePoint = (point: RevealPoint | null): RevealPoint | null =>
  point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;

function resolveRevealOrigin(
  origin: RevealPoint | undefined,
  box: { width: number; height: number },
): RevealPoint {
  /* Not defensive dressing: a caller measuring an already-unmounted control hands
   * over a rect of zeros, and a `NaN` reaching the emitted `clip-path` as `at NaN%`
   * invalidates the whole declaration — the keyframes carry no clip and the wipe
   * silently becomes a cut. */
  return (
    usablePoint(origin ?? null) ??
    usablePoint(lastPointerPoint) ??
    centreOf(typeof document === 'undefined' ? null : document.activeElement) ?? {
      x: box.width / 2,
      y: box.height / 2,
    }
  );
}

/**
 * Circular reveal for theme changes, growing from `origin` (viewport coordinates —
 * pass the pressed control's centre) out to the farthest corner; `origin` is optional
 * and resolved by the fallback chain above. **reduced** cross-fades the two schemes in
 * place — a real wipe, not an absent one; **off** applies the change with no transition.
 *
 * **View Transitions are feature-detected, not assumed.** Firefox ESR, Safari 17 and older
 * WebViews have no `startViewTransition`; calling it threw *after* the freeze attribute
 * had gone onto `<html>`, so the theme never changed and every transition in the app stayed
 * frozen until a reload. Without the API — or if the engine throws — the change is applied
 * as a cut, which is what the off tier does anyway.
 */
export function circularReveal(applyChange: () => void, origin?: { x: number; y: number }) {
  /* A flight owns these pixels; the wipe would snapshot the flyer mid-air and then
   * let it teleport. Apply the theme with no animation and stand down. */
  if (heroOwnsScreen()) {
    applyChange();
    return;
  }

  /* Settle other motion before the snapshot: `startViewTransition` freezes CSS
   * *transitions* (see globals.css) but not GSAP tweens or CSS animations, so a
   * tween caught mid-flight would be baked into the outgoing frame. */
  finishTabTransition();
  notifyThemeWipeStart();

  const doc = document as Partial<ViewTransitionDocument>;
  const root = document.documentElement;
  const tier = motionTier();

  if (tier === 'off' || typeof doc.startViewTransition !== 'function') {
    applyChange();
    return;
  }

  const box = measureSnapshotBox();
  const seed = resolveRevealOrigin(origin, box);
  const x = seed.x;
  const y = seed.y + box.topInset;
  // Position as a fraction of the snapshot box, so the wipe starts on the icon
  // whatever units that box is measured in.
  const fx = box.width > 0 ? x / box.width : 0.5;
  const fy = box.height > 0 ? y / box.height : 0.5;
  // Reach of the farthest corner, not the full viewport diagonal: the diagonal
  // overshoots for any off-centre origin, so the sweep would finish before the
  // animation did.
  const reachX = Math.max(fx, 1 - fx) * box.width;
  // Slack for the vertical correction above: if this engine turns out to anchor
  // the snapshot elsewhere, the circle still covers the corner it can't see.
  const reachY = Math.max(fy, 1 - fy) * box.height + box.topInset;
  // A percentage radius resolves against sqrt((w² + h²) / 2), so scale by √2
  // over the diagonal to turn a length back into that percentage.
  const radiusPercent =
    (Math.hypot(reachX, reachY) / Math.hypot(box.width, box.height)) * Math.SQRT2 * 100 + 1;
  const at = `at ${(fx * 100).toFixed(3)}% ${(fy * 100).toFixed(3)}%`;
  const id = String(++themeTransitionId);
  const animationName = `theme-circular-reveal-${id}`;
  const style = document.createElement('style');
  style.dataset.themeTransitionStyle = id;
  // `html:root[…]` outweighs the `html[data-theme-vt]` base rule in globals.css
  // regardless of stylesheet order — matching on specificity alone left this one
  // stylesheet re-injection away from losing to `animation: none`.
  /* The one curve deliberately not an M3 token: M3 easings are one-sided, but the
   * animated *radius* sweeps area growing as its square — squaring the front-loading
   * (at 150ms of 550: this curve 3% flipped, `emphasized` 65%, `decelerate` 87%).
   * The radius wants a curve slow at BOTH ends: `--ease-loop`'s value, spelled out
   * through EASE because the rule lands in the view-transition pseudo tree, where an
   * unresolved `var()` would silently fall back to `ease`. 550ms goes through
   * `motionScale()`; the reduced tier cross-fades
   * instead and never uses this curve — no radius, so one-sided decelerate fits. */
  const wipeMs = Math.round(550 * motionScale());
  style.textContent =
    tier === 'reduced'
      ? `
    @keyframes ${animationName} {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    html:root[data-theme-vt="${id}"]::view-transition-new(root) {
      animation: ${animationName} ${Math.round(DURATION.long * 1000 * motionScale())}ms ${EASE.decelerate} both;
    }
  `
      : `
    @keyframes ${animationName} {
      from { clip-path: circle(0% ${at}); }
      to { clip-path: circle(${radiusPercent.toFixed(3)}% ${at}); }
    }
    html:root[data-theme-vt="${id}"]::view-transition-new(root) {
      animation: ${animationName} ${wipeMs}ms ${EASE.loop} both;
    }
  `;

  activeThemeTransition?.transition.skipTransition();
  activeThemeTransition?.style.remove();
  document.head.append(style);

  /* The freeze attribute goes on **inside** the update callback, beside the change itself.
     It keys a rule that reaches every element (`html[data-theme-vt] *`), and Blink
     invalidates such a rule by the attribute's *name* — so set out here it cost a
     whole-document style pass for the old-state capture, which needs no freeze (the old
     state is static), and then a second one for the change. In here both land in the one
     recalculation the scheme change pays anyway. The animation rule keyed on the same
     attribute is only read once the pseudo-elements exist, after this callback. */
  let transition: ThemeViewTransition;
  try {
    transition = doc.startViewTransition!(() => {
      root.dataset.themeVt = id;
      applyChange();
    });
  } catch {
    style.remove();
    applyChange();
    return;
  }
  const active = { id, style, transition };
  activeThemeTransition = active;

  const cleanup = () => {
    if (activeThemeTransition !== active) return;
    activeThemeTransition = null;
    style.remove();
    if (root.dataset.themeVt === id) delete root.dataset.themeVt;
  };
  void transition.finished.then(cleanup, cleanup);
  /* A wipe the next one supersedes before its animation starts — arrowing through the palette
     tiles, two presses in a frame — is skipped above, and a skipped transition rejects `ready`.
     That is the intended outcome; unhandled, it reached the console as a page error. */
  transition.ready.catch(() => {});
}

/* ---------------------------------------------------------------------------
 * The two changes that ride the wipe
 *
 * These live here rather than in `lib/appearance` because what they are is a *wipe* —
 * the preference write is one line of it — and the reverse arrangement would make
 * `lib/appearance` import GSAP. Both are no-ops when nothing visible changes (so call
 * sites need no "is it already this?" guard) and both take the origin from the
 * control that was pressed.
 * ------------------------------------------------------------------------ */

export function changeScheme(setting: SchemeSetting, origin?: { x: number; y: number }) {
  const next = resolveScheme(setting);
  if (next === currentScheme()) {
    commitScheme(setting);
    return;
  }
  circularReveal(() => commitScheme(setting), origin);
}

/**
 * The palette a wipe is on its way to. A wipe commits inside its View Transition's update
 * callback, a frame after it is asked for, so until then `<html>` still names the palette it is
 * leaving — and the no-op guard below, reading that, swallowed a change made in the meantime:
 * arrowing through the palette tiles faster than a frame moved focus back to the tile in force
 * and left the selection on the one the first wipe was heading to. The guard reads the target.
 */
let pendingPalette: PaletteId | null = null;

export function changePalette(id: PaletteId, origin?: { x: number; y: number }) {
  if (id === (pendingPalette ?? currentPalette())) return;
  pendingPalette = id;
  circularReveal(() => {
    /* A superseded wipe still runs its callback (skipping never drops the change), so only the
       wipe that is still the target lets go of it. */
    if (pendingPalette === id) pendingPalette = null;
    commitPalette(id);
  }, origin);
}

/**
 * The eleventh palette, as a wipe. Its own entry point rather than a branch in
 * `changePalette`: that guard is on the id, and for the custom palette the id is
 * constant while the *colour* is what moves — so the guard here is the spec, the
 * seed and its 副色相. The derivation is the caller's (`resolveCustomPalette`
 * awaits a chunk); nothing may await inside the wipe's capture callback.
 */
export function changeCustomPalette(
  install: CustomPaletteInstall,
  origin?: { x: number; y: number },
) {
  if (
    currentPalette() === CUSTOM_PALETTE &&
    currentCustomSeed() === install.seed &&
    currentCustomAccent() === install.accent
  ) {
    return;
  }
  circularReveal(() => commitCustomPalette(install), origin);
}

/** 配色方案, as a wipe: every selection container and accent moment changes at once. */
export function changePaletteHues(hues: PaletteHues, origin?: { x: number; y: number }) {
  if (hues === currentPaletteHues()) return;
  circularReveal(() => commitPaletteHues(hues), origin);
}

/**
 * The hero gate and the app scroller live in `lib/appScroller.ts` so this module's
 * module-scope GSAP registration does not drag the engine into their importers.
 *
 * AGENTS.md: "The hero owns the same pixels. Every other transition stands down while
 * a flight is in progress." Two things here could otherwise start on top of one: the
 * theme wipe (its snapshot would freeze a flyer mid-move) and the tab shared axis
 * (it sets clip on the very scroller hosting the flight layer).
 */
export { getAppScroller, heroOwnsScreen, setHeroBusyCheck };

export interface DrawerSwipeOptions {
  /** The sliding panel. Assumed to sit at `translateX(-width)` when closed. */
  drawerRef: RefObject<HTMLElement | null>;
  /** The dimming layer behind it; its opacity tracks the drag. */
  scrimRef: RefObject<HTMLElement | null>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Turn the whole gesture off — e.g. on desktop, where the drawer is docked. */
  enabled?: boolean;
}

/** Fraction of the drawer's width you must cross for a slow drag to commit. */
const DRAWER_COMMIT_RATIO = 0.4;
/** px/s past which a flick commits regardless of how far it travelled. */
const DRAWER_FLICK_VELOCITY = 450;

/**
 * Swipe an open navigation drawer closed. (Opening by edge-swipe does not exist: a
 * left-edge gesture is claimed by the browser's back navigation on iOS and Android,
 * so the menu button is the way in and this is only the way out.)
 *
 * The drawer tracks the finger for the whole gesture rather than waiting for a flick
 * to complete — a drawer that only responds on release gives no way to change your
 * mind halfway. On release it commits past 40% of its width, or on a fast flick.
 * During a drag the panel and scrim are driven inline with their CSS transitions
 * suppressed — the shell styles them with an all-properties transition and a
 * full-width negative translate, which would put lag between the finger and the
 * panel — both handed back to CSS once the settle tween lands, when the inline and
 * class positions agree.
 *
 * **Every way a gesture ends hands both back**, not only a release: a close from
 * elsewhere while a finger or a release owns the panel (Back — on a phone the edge
 * Back gesture is itself a touch on the open drawer, delivered before the system takes
 * it — Esc, a drawer row, a route change), `enabled` flipping (a picture's route, the
 * docked breakpoint) and unmount. Before, a Back during the drag was undone by the
 * drag's own release, which reopened the drawer and pushed its history entry again; a
 * finger that never ended left the scrim at its inline opacity over a closed drawer;
 * and a revert left GSAP's resting transform (`translate3d(0,0,0)` with `translate:
 * none`) inline, so a closed drawer stood on screen, inert, until a reload.
 */
export function useDrawerSwipe({
  drawerRef,
  scrimRef,
  open,
  onOpenChange,
  enabled = true,
}: DrawerSwipeOptions) {
  /* `open` and `onOpenChange` are read through refs rather than declared as
   * dependencies: `useGSAP` only tears its context down on unmount unless
   * `revertOnUpdate` is set, so a dependency flipping on every drawer toggle added a
   * *second* Observer holding a captured `open === true` forever — survivors read
   * `pending` as true for drags starting within a drawer's width of the left edge
   * and dragged the *closed* drawer into view. With refs the dependency list is just
   * `enabled`: one Observer at a time, disposed by `revertOnUpdate`.
   *
   * Written in a layout effect, in the commit that changes them, so no touch handled
   * after a close can read the drawer as still open; and a change made elsewhere is
   * handed to the gesture there (`interrupt`), before the frame that shows it. */
  const openRef = useRef(open);
  const onOpenChangeRef = useRef(onOpenChange);
  const interrupt = useRef<((openNow: boolean) => void) | null>(null);
  useLayoutEffect(() => {
    const changed = openRef.current !== open;
    openRef.current = open;
    onOpenChangeRef.current = onOpenChange;
    if (changed) interrupt.current?.(open);
  });

  useGSAP(
    (_context, contextSafe) => {
      if (!enabled) return;

      // `width` is read per gesture: the panel is 288dp, capped at the viewport less
      // 56dp on a narrow phone, so a rotation or a resize can change it between drags.
      let width = 0;
      let startOffset = 0;
      let active = false;
      // Set at press when the start point qualifies, cleared once the axis is
      // known: `onDragStart` fires before `lockAxis` has decided, so a vertical
      // scroll that happens to begin at the screen edge must be able to back out.
      let pending = false;
      /** Where a release's spring is taking the drawer while it owns the panel, else null. */
      let settling: boolean | null = null;

      const drawer = () => drawerRef.current;
      const scrim = () => scrimRef.current;

      /* The panel and the scrim back to their classes: every inline property the gesture
         wrote comes off — `clearProps: 'transform'` takes GSAP's individual `translate`,
         `rotate` and `scale` with it — and a forced style read commits that with the
         transitions still off, so nothing animates the hand-back; only then are the
         transitions given back. */
      const handBack = () => {
        const d = drawer();
        const s = scrim();
        if (d) gsap.set(d, { clearProps: 'transform' });
        if (s) gsap.set(s, { clearProps: 'opacity' });
        if (d) void getComputedStyle(d).translate;
        if (s) void getComputedStyle(s).opacity;
        if (d) d.style.transition = '';
        if (s) {
          s.style.transition = '';
          s.style.pointerEvents = '';
        }
      };

      /** Places the panel at `x` ∈ [-width, 0] and fades the scrim to match.
       *  `contextSafe` throughout: these writes happen from Observer callbacks,
       *  after useGSAP's own callback returned — without it the inline transforms
       *  are invisible to `revert()` and an interrupted drag strands the panel. */
      const place = contextSafe!((x: number) => {
        const d = drawer();
        if (d) gsap.set(d, { x, xPercent: 0 });
        const s = scrim();
        if (s) gsap.set(s, { opacity: width > 0 ? (x + width) / width : 0 });
      });

      const begin = () => {
        const d = drawer();
        if (!d) return false;
        width = d.offsetWidth;
        if (width <= 0) return false;

        /* Take the pose that is actually on screen, including Tailwind's
         * individual translate during a tap-driven transition. A new drag can
         * catch either that transition or a previous GSAP release; using the
         * boolean endpoint snapped both of them home under the finger. */
        const pose = getComputedStyle(d);
        const translate = pose.translate.split(' ')[0];
        const independentX = (parseFloat(translate) || 0) * (translate.endsWith('%') ? width / 100 : 1);
        const transformX = pose.transform === 'none' ? 0 : new DOMMatrixReadOnly(pose.transform).m41;
        startOffset = gsap.utils.clamp(-width, 0, independentX + transformX);
        gsap.killTweensOf(d);
        const s = scrim();
        if (s) gsap.killTweensOf(s);
        // A release caught by this finger is over: its spring will not finish.
        settling = null;
        active = true;
        // Suppress the class-level transitions for the duration of the drag.
        d.style.transition = 'none';
        if (s) {
          s.style.transition = 'none';
          // The scrim is `pointer-events-none` while closed; it must not start
          // swallowing taps just because it became visible mid-drag.
          s.style.pointerEvents = 'none';
        }
        place(startOffset);
        return true;
      };

      const settle = contextSafe!((toOpen: boolean) => {
        active = false;
        pending = false;
        const d = drawer();
        const s = scrim();

        /* The hand-back from the inline pose to the class pose, and **all of it in one
           synchronous block with transitions still off**. The state change used to be a
           scheduled React update while the inline transform was cleared at once: for a frame
           the panel stood at its *old* class pose (open), and when the class caught up the
           restored transition ran it shut a second time — a committed swipe that bounced back
           open for a frame. `flushSync` puts the new class on first; the inline transform then
           comes off onto a class pose that already agrees with it (`handBack`). */
        const release = () => {
          settling = null;
          flushSync(() => onOpenChangeRef.current(toOpen));
          handBack();
        };

        /* The drag itself is never gated — direct manipulation is not an animation —
         * so a tier affects only the *release*. Off snaps to the committed end;
         * reduced and standard both spring: the finger has already put the panel
         * most of the way there, and cutting the last few pixels reads as the
         * gesture being dropped, not as less motion. */
        if (!d || motionTier() === 'off') {
          release();
          return;
        }

        const target = toOpen ? 0 : -width;
        /* The panel's own springs, the same ones the tap-driven transition uses:
         * `DefaultSpatial` open, `FastEffects` shut, as `NavigationDrawer.kt`
         * assigns them — a gesture and a tap must not land differently. No velocity
         * scaling: a duration scaled by distance double-counts; a spring already
         * covers a shorter remaining distance in less time. */
        const spec = toOpen ? spring('defaultSpatial') : spring('fastEffects');

        settling = toOpen;
        if (s)
          gsap.to(s, {
            opacity: toOpen ? 1 : 0,
            ...spec,
            overwrite: true,
          });
        gsap.to(d, {
          x: target,
          ...spec,
          overwrite: true,
          onComplete: release,
        });
      });

      /* **Opened or closed from elsewhere while the gesture owns the panel** — Back (on a
         phone the edge Back gesture arrives as this very drag before the system takes it),
         Esc, a row, a route change; or the menu button during a release. React's state
         stands: the panel goes from where it is to that state on the drawer's own spring for
         the direction, and the drag's release, when the finger lifts, finds nothing to do. A
         release already springing the other way is turned round. React already has the state,
         so nothing is told; the class takes over at the end. A release's own state change
         never lands here: it clears `settling` before it tells React. */
      interrupt.current = contextSafe!((openNow: boolean) => {
        pending = false;
        if (!active && settling === null) return;
        if (!active && settling === openNow) return;
        active = false;
        const d = drawer();
        const s = scrim();
        if (!d || width <= 0 || motionTier() === 'off') {
          settling = null;
          if (d) gsap.killTweensOf(d);
          if (s) gsap.killTweensOf(s);
          handBack();
          return;
        }
        settling = openNow;
        const spec = openNow ? spring('defaultSpatial') : spring('fastEffects');
        if (s) gsap.to(s, { opacity: openNow ? 1 : 0, ...spec, overwrite: true });
        gsap.to(d, {
          x: openNow ? 0 : -width,
          ...spec,
          overwrite: true,
          onComplete: () => {
            settling = null;
            handBack();
          },
        });
      });

      const observer = Observer.create({
        target: document.body,
        // Touch only. Hijacking a left-drag from a desktop pointer would break
        // text selection near the window edge, and those users have the header
        // button anyway.
        type: 'touch',
        dragMinimum: 8,
        lockAxis: true,
        tolerance: 4,
        ignore: '[data-no-drawer-swipe]',
        onDragStart: (self) => {
          const startX = self.startX ?? 0;
          // Opening is anchored to the screen edge; closing can start anywhere on
          // the panel, which is the only thing under the finger while it is open.
          // Only a drag that starts on the open panel counts.
          pending = openRef.current && startX <= (drawer()?.offsetWidth ?? 0);
        },
        onDrag: (self) => {
          if (pending) {
            if (self.axis === 'y') {
              pending = false;
              return;
            }
            if (self.axis !== 'x' || !begin()) return;
            pending = false;
          }
          if (!active) return;
          place(gsap.utils.clamp(-width, 0, startOffset + (self.x ?? 0) - (self.startX ?? 0)));
        },
        onDragEnd: (self) => {
          pending = false;
          if (!active) return;
          const d = drawer();
          const x = d ? (gsap.getProperty(d, 'x') as number) : startOffset;
          const flick = Math.abs(self.velocityX) > DRAWER_FLICK_VELOCITY;
          /* `(x + width) / width` is the fraction still *visible*, so the drawer stays open
             only while more than 1 − ratio of it is on screen: a slow drag commits once it
             has travelled the ratio. (Compared against the ratio itself, a half-way drag —
             which closes every native drawer — sprang back open.) */
          settle(
            flick ? self.velocityX > 0 : (x + width) / width > 1 - DRAWER_COMMIT_RATIO,
          );
        },
      });

      /* `enabled` flipping (a picture's route, the docked breakpoint) or unmount, mid-gesture
       * or not. `context.revert()` has already run the gesture's tweens back by the time this
       * is called — and for a transform that leaves GSAP's own resting pose inline
       * (`translate3d(0,0,0)` with `translate: none`), which outranks the class: a closed
       * drawer stood on screen, inert, until a reload. So everything comes off here, the raw
       * writes `begin()` makes included (`element.style`, which no revert sees). A gesture cut
       * short is not finished by a spring that will never run: a release that was taking the
       * drawer shut still shuts it, and a finger's drag ends with the drawer as React has it. */
      return () => {
        observer.kill();
        interrupt.current = null;
        const closing = settling === false;
        active = false;
        pending = false;
        settling = null;
        handBack();
        if (closing && openRef.current) onOpenChangeRef.current(false);
      };
    },
    { dependencies: [enabled], revertOnUpdate: true },
  );
}

/**
 * `useDrawerSwipe` as a component that renders nothing — what `lib/motionLazy.tsx` mounts once
 * the engine is resident. The hook is called here, by name; handed across the import boundary as
 * a value, it made the React Compiler skip the component calling it.
 */
export function DrawerSwipeHost(options: DrawerSwipeOptions) {
  useDrawerSwipe(options);
  return null;
}

/* ---------------------------------------------------------------------------
 * Entrance / list motion
 *
 * `useStaggerGrid` here and `<Reveal>` (components/Reveal.tsx) are the two, both
 * playing on mount; there is no scroll-driven reveal. If one is ever wanted, an
 * `IntersectionObserver` with the app scroller as `root` suffices (see
 * `components/PicDetail.tsx`) under two constraints: never wrap a gallery card
 * (it parks targets at a `y` offset, and the hero flight reads
 * `getBoundingClientRect` on press) and never sit inside a tab pane whose content
 * swaps (the pane transition already animates the same nodes' `autoAlpha` and `y`).
 * ------------------------------------------------------------------------ */

/** Distance an entering element travels, px, on the 4dp grid. Small on purpose: a long
 *  throw reads as decoration, a short one reads as the content settling. */
const REVEAL_SHIFT = 16;

/**
 * Cascade for grid/masonry children, played on mount rather than on scroll — a
 * stagger reads as the grid filling in instead of one rectangle arriving. Order is
 * by *visual* position, not DOM order: the masonry's DOM is feed order and a card's
 * slot is shortest-column-first, so two neighbours in the list can sit a whole card
 * apart vertically. Sorting by row band then by x makes cards arrive left to right,
 * top to bottom.
 */
/** Rows are banded before sorting: masonry cards on the same visual row rarely
 *  share an exact `top`, and comparing raw values would zig-zag between them. */
const ROW_BAND_PX = 48;
/** Cards this far below the viewport still cascade: the next row, about to scroll in. */
const STAGGER_NEAR_MARGIN = 240;

/**
 * The ref is a **parameter**, not something this creates. **Whatever renders this must
 * be a *sibling after* the ref'd element, never a child of it**: React attaches a
 * parent's ref only after its children's layout effects have run, so a component
 * rendered *inside* the grid reads `ref.current === null` on the mounting commit —
 * and once `warmMotion()` has made the engine resident before first paint, nothing
 * re-runs the mount pass, so the gallery silently gets no entrance on load. The
 * caller owns the `useRef`; this owns the animation (`lib/motionLazy.tsx` mounts it
 * from a child that only exists once GSAP has arrived).
 */
export function useStaggerGridOn<T extends HTMLElement = HTMLElement>(
  ref: RefObject<T | null>,
  selector: string,
  deps: unknown[] = [],
): void {
  // Reactive: this re-runs on every page of results, so a preference changed
  // mid-session still has work to skip.
  const tier = useMotionTier();
  const entrances = useEntranceMotion();
  /**
   * Once per mounted grid, not once per page of results. The cascade parks every
   * card at `autoAlpha: 0` and reveals them over up to 0.9s of stagger — right for a
   * grid *arriving*, wrong for a page turn, twice over: `Pagination` glides the
   * scroller to the top, so the viewport starts at the **bottom** of the grid where
   * cards are *last* in cascade order (looked-at content held invisible for the full
   * stagger); and a page turn is a content *replacement* inside a grid that never
   * left — the glide carries it, and a second entrance on top is the "动画重叠"
   * failure this file names elsewhere. A breakpoint reflow does not replay it
   * either — a resize is not an arrival. `deps` stays the full list because the
   * *early return* must re-evaluate: a grid that mounted empty has to cascade when
   * rows land, so the latch is set after the `items.length` check.
   */
  const played = useRef(false);

  useGSAP(
    () => {
      const root = ref.current;
      if (!root || !entrances || tier === 'off') return;
      const items = gsap.utils.toArray<HTMLElement>(root.querySelectorAll(selector));
      if (items.length === 0) return;
      if (played.current) return;
      played.current = true;
      /* The route's pre-commit marker is already present when this grid mounts.
         Its page is entering as one surface; a child cascade here adds a second
         clock and a transform per card during the most expensive first paint.
         Latch the skipped entrance too, so a later update cannot replay it. */
      if (routeTransitActive(root)) return;
      /* The grid took over from its own skeleton in this commit: the placeholder has been
         saying "arriving" for as long as it was up, and a cascade on top of it is the same
         news twice (the judgement a page turn gets). This is also every unseeded cold load
         of `/`, where the cascade used to park fifty cards and spend a second and a half of
         a slow phone's main thread revealing them. */
      if (replacedSkeleton()) return;

      /* Only what can be seen, plus the next row. Cards below the fold are revealed long
         before anyone scrolls to them, so tweening them was pure cost — 45 of 50 on a phone
         — and it held them at zero opacity for up to 0.9s of stagger for nothing. The rest
         are left exactly as they are, which is visible. */
      const scroller = getAppScroller();
      const view = scroller?.getBoundingClientRect();
      const viewTop = view?.top ?? 0;
      const viewBottom = view?.bottom ?? window.innerHeight;
      const rootTop = root.getBoundingClientRect().top;
      const ordered = items
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { el, r, band: Math.round((r.top - rootTop) / ROW_BAND_PX), x: r.left };
        })
        .filter(({ r }) => r.bottom > viewTop && r.top < viewBottom + STAGGER_NEAR_MARGIN)
        .sort((a, b) => a.band - b.band || a.x - b.x)
        .map((m) => m.el);
      if (ordered.length === 0) return;

      /* Reduced halves the rise and drops the cascade and the scale: the cascade is
       * a tween per card on a device that cannot afford 100 of them, the scale is
       * the flourish, the rise says "arriving". `scale` must be absent from *both*
       * ends rather than 1 at both — a card mid-tween would otherwise carry an
       * identity transform, exactly what the hero flight measures on press. */
      const reduced = tier === 'reduced';
      const tween = gsap.fromTo(
        ordered,
        reduced
          ? { autoAlpha: 0, y: REVEAL_SHIFT / 2 }
          : { autoAlpha: 0, y: REVEAL_SHIFT, scale: 0.985 },
        {
          autoAlpha: 1,
          y: 0,
          ...(reduced ? {} : { scale: 1 }),
          duration: DURATION.long,
          ease: 'decelerate',
          // Capped: with 100 cards a linear stagger would still be arriving
          // several seconds after the images finished decoding.
          stagger: reduced
            ? 0
            : { each: 0.035, from: 'start', amount: Math.min(ordered.length * 0.035, 0.9) },
          clearProps: 'opacity,visibility,transform',
        },
      );

      // A transform on an ancestor shifts `getBoundingClientRect` for everything
      // under it, and the hero flight reads exactly that off a card the moment you
      // press it. Snapping to the end state on pointerdown means a card can never
      // be measured mid-cascade — a press during the cascade feels answered.
      const settle = () => tween.progress(1);
      root.addEventListener('pointerdown', settle, { capture: true });
      return () => root.removeEventListener('pointerdown', settle, { capture: true });
    },
    // `revertOnUpdate`: the `pointerdown` listener is removed by the returned
    // cleanup, which useGSAP otherwise defers to unmount — every page turn was
    // leaving another capture-phase listener calling `progress(1)` on a dead tween.
    { scope: ref, dependencies: [selector, tier, entrances, ...deps], revertOnUpdate: true },
  );
}

/** `useStaggerGridOn` as a component that renders nothing, for `lib/motionLazy.tsx` — see
 *  `DrawerSwipeHost`. Rendered as a sibling after the grid, which is what the ref needs. */
export function StaggerGridHost({
  gridRef,
  selector,
  deps,
}: {
  gridRef: RefObject<HTMLElement | null>;
  selector: string;
  deps: unknown[];
}) {
  useStaggerGridOn(gridRef, selector, deps);
  return null;
}

/* ---------------------------------------------------------------------------
 * Shared axis — Material 3, one plane rather than two layers, run by the compositor
 *
 * **The two sides are laid end to end and the strip is what moves.** The incoming
 * side starts a whole window-width away — not the spec's 30dp — so at every instant
 * the two are exactly adjacent: outgoing at `-d·p`, incoming at `d·(1-p)`, always `d`
 * apart, the width of the window they slide past. Neither is ever painted over the
 * other; the window clips whatever is outside it.
 *
 * That is why there is no cross-fade: an opacity handoff *is* two layers stacked —
 * for the length of the fade both sides occupy the same pixels, which is precisely
 * what read as "a layer sliding up from the right". A 30dp nudge cannot carry the
 * movement alone, so full travel and no fade go together: a deliberate divergence
 * from the spec's numbers in service of what the spec is describing.
 *
 * **Each side is one element and one Web Animations `transform`**, which the engine hands
 * to the compositor whole: a frame costs the main thread nothing, so the router's commit, a
 * font slice landing or an image decoding during the switch no longer lands on the
 * animation's clock, and a hover hit test finds nothing dirty to lay out. And the pane moves
 * as a unit, so everything inside it moves by construction — a row, a wrapper with no box of
 * its own, an inline error, whatever a later feature adds.
 *
 * **On a leaning panel (`TabPanes lean`) the blocks on screen follow a little late**, top
 * first, so the page leaves on a shear: the layered departure. Each such block is one more Web
 * Animations transform, set up once in the tap — the *difference* between the strip and the
 * strip `delay` ms earlier, `S(t) − S(t − delay)`, on top of the pane's own — so the block
 * lands exactly where the strip was `delay` ago while everything else keeps riding the pane.
 * The blocks come from the structure (`leanPlan`), never from marks, and only those on
 * screen lean. It used to be GSAP writing a transform to every marked block every frame (on
 * the production build one tap on 论坛 spent 25–35 layouts and ~540 forced style and layout
 * passes inside its run); marks it had not been given — the gallery's 全部 / 本站讨论 row, in a
 * wrapper with no box — stood still while their pane slid.
 *
 * Nothing waits for the router: both panes are already mounted, so the transition
 * only needs the *attribute* that gives the incoming one a box — which this owns.
 * The route commit that follows is a visual no-op.
 * ------------------------------------------------------------------------ */

/**
 * Extra plate between the two pages, px, on top of whatever the layout gives.
 *
 * The window the pages slide past is the scroller — sidebar edge to screen edge —
 * and the content column is centred inside it, so the two side margins are already
 * empty space between the pages: they sit one window apart on the strip, content
 * centred in its own window, exactly as a paged carousel does it. This is the floor
 * under that, for the phone layout where the column fills the window. Without a
 * plate, edge-to-edge pages read as one page shoving the other.
 *
 * A delay on the incoming side would also open a gap, and is the wrong mechanism:
 * the plate would stretch and close over the run, so the strip reads as elastic
 * instead of rigid. A carousel's pages are a fixed distance apart — that fixity is
 * what sells them as one surface.
 */
const AXIS_GAP = 96;
/**
 * How far the reduced tier shifts each side, instead of a whole window's width.
 * Enough to carry the *direction* of the move, short enough not to read as a slide
 * — the 24dp M3's own shared axis uses for its small-container form, the same order
 * as the 8px an entrance travels here. A cross-fade cannot say which way you went,
 * and on a tab bar that is half the information.
 */
const REDUCED_AXIS_SHIFT_PX = 24;

/* The strip's motion — a critically damped spring the tap launches, and the leg a second tap
 * turns it onto — is `lib/tabStrip.ts`, where its numbers are argued and tested. */

/** A turn's first frame later than this after the tap (1.5 frames at 60 Hz) restarts the new
 *  leg from that frame — see `turn` in `playSharedAxis`. */
const STRIP_LATE_FRAME_MS = 25;

/** Whether the engine takes a `linear()` easing — the strip's shape, and the lean's. */
function supportsLinearEasing(): boolean {
  return typeof CSS !== 'undefined' && !!CSS.supports?.('transition-timing-function', 'linear(0, 1)');
}

/**
 * A response as a Web Animations easing, sampled where it bends until straight segments stay
 * within 0.15% of it. An engine without `linear()` gets the emphasized decelerate — the one
 * cubic that also leaves at speed.
 */
function linearEasingOf(ease: (t: number) => number, tolerance = 0.0015): string {
  if (!supportsLinearEasing()) return EASE.decelerate;
  const stops: string[] = [`${+ease(0).toFixed(4)} 0%`];
  const split = (t0: number, v0: number, t1: number, v1: number, depth: number) => {
    const mid = (t0 + t1) / 2;
    const value = ease(mid);
    if (depth < 4 || (depth < 12 && Math.abs(value - (v0 + v1) / 2) > tolerance)) {
      split(t0, v0, mid, value, depth + 1);
      split(mid, value, t1, v1, depth + 1);
      return;
    }
    stops.push(`${+v1.toFixed(4)} ${+(t1 * 100).toFixed(3)}%`);
  };
  split(0, ease(0), 1, ease(1), 0);
  return `linear(${stops.join(', ')})`;
}

export interface SharedAxisHandle {
  /** Jump to the end state and run the settle callback. Idempotent. */
  finish(): void;
  /**
   * Send the run back towards its start from wherever it is — a tap on the tab it is leaving
   * turns the strip round at once, rather than snapping to the end and sliding back — and
   * settle there, with `onSettle(true)`. A second call turns it again. False once settled.
   */
  reverse(): boolean;
}

/**
 * Whether the stylesheet conceals this pane — attribute for attribute the rule in globals.css
 * ("React's own active flag decides normally…"). Read from attributes, never from layout:
 * geometry read inside a `content-visibility: hidden` subtree makes the engine lay that
 * subtree out just to answer.
 */
function isConcealedPane(el: Element): boolean {
  if (!el.hasAttribute('data-tab-pane')) return false;
  if (el.hasAttribute('data-tab-pane-done')) return true;
  return (
    !el.hasAttribute('data-tab-pane-active') &&
    !el.hasAttribute('data-tab-pane-leaving') &&
    !el.hasAttribute('data-tab-pane-entering')
  );
}

/* --- the lean: which blocks, and how late -------------------------------------------------- */

/** A block of a leaning pane: its delay (ms at the default speed), and the transform its own
 *  style gives it, which every keyframe carries so the lean adds to it rather than replacing it. */
export type LeanBlock = { el: HTMLElement; delay: number; base: string };

/**
 * What a leaning run animates (`leanPlan`), and the blocks it restacks for the run (`lift`), with
 * whether each needs `relative`.
 *
 * **A leaning block paints last in its stacking context.** An element whose transform is
 * animating may move anywhere, so the engine cannot fold anything painted after it into a layer
 * beneath it — and inside a scroller that holds for the whole scrolled content: with the blocks
 * stacked where they were, every row and card after the first leaning one, off screen too, came
 * out a compositor layer of its own (58 more at 1440 on the gallery, measured). Stacked at 1 for
 * the run, a block paints after the rest of its stacking context, which the lean never lets it
 * overlap, and the extra layers are the blocks themselves. `relative` where the block is static
 * moves nothing: its transform already makes it the containing block of what is positioned inside
 * it. This is why a masonry slot, a positioned stacking context of its own, is the block rather
 * than the card inside it (`leanPlan`): stacked inside the slot, the card would paint last there
 * and nowhere else. A block given a z-index of its own keeps it. Restacking the stacking contexts
 * further up measured worse (the grid's own restack cost three more layers than it saved), so it
 * stops at the block.
 */
export type LeanPlan = { blocks: LeanBlock[]; lift: Array<{ el: HTMLElement; position: boolean }> };

/** Blocks per pane, at most — each is a compositor layer for the length of a run. */
const LEAN_BLOCK_CAP = 32;
/** A wrapper shorter than two bands leans as one piece: its children would share a beat anyway. */
const LEAN_SPLIT_MIN_PX = 2 * LEAN_BAND_PX;
/** Runaway guard on the descent. */
const LEAN_DESCEND_LIMIT = 8;

type BoxChild = { el: HTMLElement; rect: DOMRect; style: CSSStyleDeclaration };

/** An element's children that have a box and reach into the view (`kids`), and how many have a
 *  box at all (`boxes`) — through wrappers without one (`display: contents`), past anything not
 *  rendered, and never into a concealed pane, whose geometry would be laid out just to answer. A
 *  child out of view costs a rect and nothing more: a fifty-card grid reads ten styles, not fifty. */
function boxChildren(node: Element, inView: (rect: DOMRect) => boolean): { kids: BoxChild[]; boxes: number } {
  const kids: BoxChild[] = [];
  let boxes = 0;
  for (const child of node.children) {
    if (!(child instanceof HTMLElement) || isConcealedPane(child)) continue;
    const rect = child.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) {
      boxes += 1;
      if (inView(rect)) kids.push({ el: child, rect, style: getComputedStyle(child) });
    } else if (getComputedStyle(child).display === 'contents') {
      const inner = boxChildren(child, inView);
      kids.push(...inner.kids);
      boxes += inner.boxes;
    }
  }
  return { kids, boxes };
}

/** Whether taking this element apart can tear anything: it paints nothing of its own and clips
 *  and contains nothing, so its children moving apart for a moment shows no seam. */
function isBareWrapper(style: CSSStyleDeclaration): boolean {
  const border =
    parseFloat(style.borderTopWidth) +
    parseFloat(style.borderRightWidth) +
    parseFloat(style.borderBottomWidth) +
    parseFloat(style.borderLeftWidth);
  return (
    (style.backgroundColor === 'transparent' || style.backgroundColor === 'rgba(0, 0, 0, 0)') &&
    style.backgroundImage === 'none' &&
    style.boxShadow === 'none' &&
    !(border > 0) &&
    style.overflowX === 'visible' &&
    style.overflowY === 'visible' &&
    !/paint|strict|content/.test(style.contain)
  );
}

/** Whether any two of these overlap: coincident layers — a picture and the bar over it — must
 *  move as one. Only the pieces on screen are asked: one off screen rides its pane, and where it
 *  meets a leaning one the seam is off screen too. A sweep down the tops. */
function anyOverlap(kids: BoxChild[]): boolean {
  const sorted = [...kids].sort((a, b) => a.rect.top - b.rect.top);
  for (let i = 0; i < sorted.length; i += 1) {
    const a = sorted[i].rect;
    for (let j = i + 1; j < sorted.length && sorted[j].rect.top < a.bottom - 0.5; j += 1) {
      const b = sorted[j].rect;
      if (b.left < a.right - 0.5 && a.left < b.right - 0.5) return true;
    }
  }
  return false;
}

/**
 * **Which blocks lean — decided by the structure, not by marks.** Every child of the pane with a
 * box (through wrappers that have none) is a block; a block that is a bare wrapper (above) taller
 * than two bands, whose own children do not overlap — a grid, a list, a column of sections — is
 * taken apart into those children, and so on down. So a list's rows and a grid's cards lean one
 * by one, a card never comes apart from its caption, a surface never loses its content, and a
 * component added later is a block or inside one without anybody marking it.
 *
 * Only blocks on screen lean (their tops set the delay, `leanDelay`); the rest — below the fold,
 * above it, a block in the top band whose delay rounds to nothing — ride the pane's own transform,
 * so nothing is ever left behind, whatever the page does during the run. Bounded: a wrapper whose
 * pieces would take the pane past `LEAN_BLOCK_CAP` leans whole. Reads only — call it where the
 * switch has already laid the panes out, before anything is written. `shiftY` is where this pane
 * will sit vertically for the run relative to where it is measured (a scroll restore moves the
 * arriving pane).
 *
 * `leadTop` is where the delays count from: the panel's own top on screen, or the view's top once
 * the panel starts above it. So the first row of the panel that is on screen always leads, even
 * under shared chrome — the gallery's 全部 / 本站讨论 under the banner, a profile's tabs under its
 * header. Counted from the view's top instead, a panel starting halfway down the screen set off
 * 12ms late as a whole: a slow start rather than a lean. The slope stays one view height per
 * `LEAN_MAX_MS`, so a panel with less of itself on screen leans less rather than more steeply.
 */
function leanPlan(pane: HTMLElement, viewTop: number, viewBottom: number, shiftY: number, leadTop: number): LeanPlan {
  const height = viewBottom - viewTop;
  const blocks: LeanBlock[] = [];
  const lift: LeanPlan['lift'] = [];
  const inView = (rect: DOMRect) => rect.bottom + shiftY > viewTop && rect.top + shiftY < viewBottom;
  const visit = (kids: BoxChild[], depth: number) => {
    for (const kid of kids) {
      if (depth < LEAN_DESCEND_LIMIT && kid.rect.height > LEAN_SPLIT_MIN_PX && isBareWrapper(kid.style)) {
        const { kids: inner, boxes } = boxChildren(kid.el, inView);
        /* A wrapper around a single child adds nothing — unless it is a positioned stacking
           context (a masonry slot, which contains its layout): then it is the unit its parent
           stacks, and the one that has to paint last (`LeanPlan`). */
        const single = boxes === 1 && !(kid.style.position !== 'static' && isStackingContext(kid.style));
        if (inner.length > 0 && blocks.length + inner.length <= LEAN_BLOCK_CAP && (single || (boxes > 1 && !anyOverlap(inner)))) {
          visit(inner, depth + 1);
          continue;
        }
      }
      const delay = leanDelay(kid.rect.top + shiftY, leadTop, height);
      if (delay >= 1 && blocks.length < LEAN_BLOCK_CAP) {
        blocks.push({ el: kid.el, delay, base: kid.style.transform });
        if (kid.style.zIndex === 'auto') lift.push({ el: kid.el, position: kid.style.position === 'static' });
      }
    }
  };
  visit(boxChildren(pane, inView).kids, 0);
  return { blocks, lift };
}

/**
 * **A switch whose panes are still loading does not lean.** Checks whether a first-load
 * placeholder is on screen in this pane: a `data-page-loading` root, the mark every first-load
 * skeleton root already carries for the footer hold. Such a placeholder is about to be replaced,
 * and a block React replaces mid-run stops leaning. It would jump by its lag, and at the seam
 * the two panes' lower blocks would overlap by the same amount. So that switch slides as one
 * plane. A pane that reads when its tab is first selected leans from its next visit on, once
 * its rows are cached.
 *
 * A placeholder inside a concealed pane is skipped by its attributes before any geometry is
 * read. Reads only.
 */
function loadingInView(pane: HTMLElement, viewTop: number, viewBottom: number, shiftY: number): boolean {
  for (const el of pane.querySelectorAll('[data-page-loading]')) {
    let concealed = false;
    for (let node: Element | null = el; node && node !== pane; node = node.parentElement) {
      if (isConcealedPane(node)) {
        concealed = true;
        break;
      }
    }
    if (concealed) continue;
    const rect = el.getBoundingClientRect();
    if ((rect.width > 0 || rect.height > 0) && rect.bottom + shiftY > viewTop && rect.top + shiftY < viewBottom) return true;
  }
  return false;
}

/** Whether this computed style makes its element a stacking context (the common ways). */
function isStackingContext(style: CSSStyleDeclaration): boolean {
  return (
    (style.position !== 'static' && style.zIndex !== 'auto') ||
    style.position === 'fixed' ||
    style.position === 'sticky' ||
    style.opacity !== '1' ||
    style.transform !== 'none' ||
    style.filter !== 'none' ||
    style.isolation === 'isolate' ||
    style.mixBlendMode !== 'normal' ||
    /layout|paint|strict|content/.test(style.contain) ||
    (style.containerType !== undefined && style.containerType !== '' && style.containerType !== 'normal')
  );
}

/**
 * Slides `leaving` out and `entering` in along one axis as a single plane. Both elements
 * must already have a box — see the grid rules for `[data-tab-panel]` in globals.css, which
 * stack the panes in one cell so the row height is `max(outgoing, incoming)` for the run.
 *
 * Reads nothing when the caller passes `distance`: the caller has already laid the panes out
 * (the one forced layout of a switch). The animations are created in this task and start
 * together on the next frame the compositor draws.
 */
export function playSharedAxis(opts: {
  leaving: HTMLElement;
  entering: HTMLElement;
  /** Which way the strip travels. */
  axis?: 'x' | 'y';
  /** +1 = moving forward; the outgoing side exits towards the negative end. */
  direction: 1 | -1;
  /** Width (or height) of the window the strip slides past, gap included. Defaults to
   *  the scroller's own box plus `AXIS_GAP` — pass it when it was read before a write. */
  distance?: number;
  /** Vertical compensation for a scroll restore, held by the outgoing pane for the run. */
  leavingOffsetY?: number;
  /** The blocks that lean (`leanPlan`, both panes). The standard tier on the x axis only:
   *  减弱 drops the stagger with the rest of the performance, and 关闭 is a cut. */
  lean?: LeanPlan;
  /** `reversed`: the run was sent back to its start (`reverse`), so `leaving` stays. */
  onSettle?: (reversed: boolean) => void;
}): SharedAxisHandle {
  const { leaving, entering, axis = 'x', direction, leavingOffsetY = 0, onSettle } = opts;
  const tier = motionTier();
  const scale = motionScale();

  /* The window the strip slides past is the *scroller*, not the pane: the pane is
   * the centred content column, the scroller runs sidebar edge to screen edge. One
   * column of travel made the incoming page appear mid-page with the two pages edge
   * to edge and no plate; one *window* of travel fixes both — pages enter and leave
   * at the content-area edges, and each being centred in its own window, the side
   * margins become the gap. */
  const view = getAppScroller();
  const distance =
    opts.distance ??
    (axis === 'x'
      ? view?.clientWidth || entering.getBoundingClientRect().width
      : view?.clientHeight || entering.getBoundingClientRect().height) + AXIS_GAP;

  let settled = false;
  let reversed = false;
  const animations: Animation[] = [];
  /** Leaning blocks stacked for the run, with the inline position and z-index to give back. */
  const lifted: Array<[HTMLElement, string, string]> = [];

  /* CSS transitions are frozen on the two moved panes, inline, for the length of the run,
     and handed back after the cancel is committed — otherwise a pane's own transform
     transition would animate the snap from the last frame back to rest. The previous inline
     value is put back, not merely removed. */
  const frozen = new Map<HTMLElement, string>();
  const freeze = (nodes: HTMLElement[]) => {
    for (const node of nodes) {
      if (frozen.has(node)) continue;
      frozen.set(node, node.style.transition);
      node.style.transition = 'none';
    }
  };

  const settle = () => {
    if (settled) return;
    settled = true;
    view?.removeAttribute('data-axis-running');
    /* Nothing may keep a transform. `lib/hero/dom.ts` only compensates for a
     * transform on `[data-image-detail-background-visual]`, so a residual one on a
     * pane — an ancestor of every gallery card — would silently corrupt the rect the
     * hero flight reads on press. Every animation fills both ways, so this cancel is the
     * one place any of them lets go; the caller hides the pane that left in the same task. */
    for (const animation of animations) animation.cancel();
    /* Given back before the read below, so the one layout the settle forces covers it too — a
       block that loses its transform is a containing block no more, and after the read the
       restack cost the settle's height check a second forced layout (measured). */
    for (const [el, position, zIndex] of lifted.splice(0)) {
      el.style.position = position;
      el.style.zIndex = zIndex;
    }
    if (frozen.size > 0) {
      void getComputedStyle(leaving).transform;
      for (const [node, previous] of frozen) node.style.transition = previous;
      frozen.clear();
    }
    onSettle?.(reversed);
  };

  /* The reduced cross-fade plays itself back; the standard strip replaces this with its
     relaunch below. */
  let turn = () => {
    reversed = !reversed;
    for (const animation of animations) animation.reverse();
  };
  const handle: SharedAxisHandle = {
    finish: settle,
    reverse: () => {
      if (settled || animations.length === 0) return false;
      turn();
      return true;
    },
  };

  if (tier === 'off' || distance <= 0 || scale <= 0) {
    queueMicrotask(settle);
    return handle;
  }

  /* Settles once both animations have reached whichever end they are heading for — `finish`
     fires again after a `reverse`, and `playState` says which way it ended. */
  const maybeSettle = () => {
    if (!settled && animations.every((animation) => animation.playState === 'finished')) settle();
  };
  /* Named, so a probe (`npm run net:tabs`) can tell the strip's own animations from anything
     else running inside a pane: `tab-strip` on a pane, `tab-lean` on a block. */
  const adopt = (animation: Animation, id: string) => {
    animation.id = id;
    animation.addEventListener('finish', maybeSettle);
    animations.push(animation);
  };
  const run = (node: HTMLElement, keyframes: Keyframe[], timing: KeyframeAnimationOptions) =>
    adopt(node.animate(keyframes, timing), 'tab-strip');
  const place = (along: number, y = 0) =>
    axis === 'x' ? `translate3d(${along}px, ${y}px, 0)` : `translate3d(0, ${along + y}px, 0)`;

  /* Turn the scroller into that window for the length of the run. Set before
   * anything is offset, so no frame paints a page hanging outside it or hands the
   * scroller something to scroll sideways. Callers always settle the previous run
   * first, so the attribute cannot be cleared from under a live one. */
  view?.setAttribute('data-axis-running', axis);
  freeze([leaving, entering]);

  /* Reduced: the panes cross-fade with a short shift instead of sliding a window's
   * width. Dropped: the *distance* (a full-window slide is the performance). Survives:
   * direction — 24px reads "the next one came from the right", which a bare cross-fade
   * cannot say. `leavingOffsetY` still applies, held rather than travelled: not travel, but
   * holding the outgoing pane over the pixels the eye was on after the scroller moved to the
   * destination's remembered offset. */
  if (tier === 'reduced') {
    const shift = REDUCED_AXIS_SHIFT_PX * direction;
    run(
      leaving,
      [
        { transform: place(0, leavingOffsetY), opacity: 1 },
        { transform: place(-shift, leavingOffsetY), opacity: 0 },
      ],
      { duration: DURATION.press * 1000 * scale, easing: EASE.accelerate, fill: 'both' },
    );
    run(
      entering,
      [
        { transform: place(shift), opacity: 0 },
        { transform: place(0), opacity: 1 },
      ],
      { duration: DURATION.short * 1000 * scale, easing: EASE.decelerate, fill: 'both' },
    );
    return handle;
  }

  /* The strip as one number, `p`: 0 rests on `leaving`, 1 on `entering`. A leg runs `p` from
   * where the strip is to one side; both panes take the same keyframes and timing, so at every
   * instant the pair is exactly one window apart. Filling both ways holds the arriving pane
   * off-screen until the compositor starts the leg, and both at their ends until the settle
   * lets go. */
  const full = STRIP_DURATION_MS * scale;
  let leg = freshStripLeg(full);
  /* Every leg the strip has run, for the blocks: a block `delay` late is where the strip was
     `delay` ago, which after a turn can still be on the leg before it. The times are the
     timeline's, except while the first leg is waiting for the compositor to start it — then they
     are that leg's own, from 0, and the blocks wait with it. */
  let history: StripSegment[] = [];
  let historyPending = false;
  /* The lean's shape is a `linear()` easing (below); an engine without one gets no lean. */
  const leans = axis === 'x' && supportsLinearEasing();
  const blocks = leans ? (opts.lean?.blocks ?? []) : [];
  /* Restacked for the run — see `LeanPlan` — in the frame the run starts rather than in the tap:
     written in the tap, the inline writes made every attribute React sets in that same task
     cost more (setAttribute's own time at 4× CPU, 23ms → 46–53ms, measured). Before that frame's
     style pass, so the first frame that moves is already stacked. */
  const lift = leans ? (opts.lean?.lift ?? []) : [];
  if (lift.length > 0) {
    requestAnimationFrame(() => {
      if (settled) return;
      for (const { el, position } of lift) {
        lifted.push([el, el.style.position, el.style.zIndex]);
        if (position) el.style.position = 'relative';
        el.style.zIndex = '1';
      }
    });
  }
  /* Blocks that share a delay share the lag's shape (one easing), and those that also share their
     own transform share one parsed model (`startLeg`). */
  const byDelay = new Map<number, Map<string, HTMLElement[]>>();
  for (const { el, delay, base } of blocks) {
    const bases = byDelay.get(delay * scale) ?? new Map<string, HTMLElement[]>();
    byDelay.set(delay * scale, bases);
    bases.set(base, [...(bases.get(base) ?? []), el]);
  }
  /* A pixel and a half: invisible in a lag that is a third of a window at its peak, and it keeps
     the lag's easing to 15–25 stops. */
  const tolerance = 1.5 / distance;

  const startLeg = (next: StripLeg, startTime: number | null, prior: readonly StripSegment[]) => {
    for (const animation of animations) animation.cancel();
    animations.length = 0;
    leg = next;
    const at = startTime ?? 0;
    history = [...prior, { leg: next, start: at }];
    historyPending = startTime === null;
    const timing = {
      duration: next.duration,
      easing: linearEasingOf(stripProgress(next.launch)),
      fill: 'both' as const,
    };
    run(
      leaving,
      [
        { transform: place(-direction * distance * next.from, leavingOffsetY) },
        { transform: place(-direction * distance * next.to, leavingOffsetY) },
      ],
      timing,
    );
    run(
      entering,
      [
        { transform: place(direction * distance * (1 - next.from)) },
        { transform: place(direction * distance * (1 - next.to)) },
      ],
      timing,
    );
    /* A block's own transform is its lag behind the pane it sits in, the same on both sides —
       `+d·(S(t) − S(t − delay))` in the direction of travel — sampled once per delay and
       shared by every block of that delay. Linear between samples; the samples are the curve.
       **One keyframe pair, and the lag's shape as the easing**: from the pane's own place to the
       peak lag, with a `linear()` easing that rises to 1 and comes back — `linear()` may leave
       [0, 1] and return, which a lag that swells and settles needs (and a turn, which sends it
       negative). The same curve as a keyframe per sample, at a fraction of the cost: each block's
       effect is a copy of one model per delay (`new KeyframeEffect(model)`), which shares the
       parsed easing, and the engine resolves two values per block instead of twenty. */
    for (const [delay, bases] of byDelay) {
      const samples = lagSamples(history, delay, at, tolerance);
      const span = samples[samples.length - 1][0] - at;
      const peak = samples.reduce((most, [, lag]) => Math.max(most, Math.abs(lag)), 0);
      if (!(span > 0) || !(peak > 0)) continue;
      const easing = `linear(${samples
        .map(([t, lag]) => `${+(lag / peak).toFixed(5)} ${+(((t - at) / span) * 100).toFixed(3)}%`)
        .join(', ')})`;
      for (const [base, els] of bases) {
        const tail = base && base !== 'none' ? ` ${base}` : '';
        const model = new KeyframeEffect(
          null,
          [
            { transform: `translate3d(0px, 0px, 0px)${tail}` },
            { transform: `translate3d(${direction * distance * peak}px, 0px, 0px)${tail}` },
          ],
          { duration: span, easing, fill: 'both' },
        );
        for (const el of els) {
          const effect = new KeyframeEffect(model);
          effect.target = el;
          const animation = new Animation(effect, document.timeline);
          adopt(animation, 'tab-lean');
          animation.play();
        }
      }
    }
    if (startTime !== null) for (const animation of animations) animation.startTime = startTime;
  };

  /* **A tap that turns the strip round sends it the other way at once**, from the pose on screen
   * (`turnStrip`). Played backwards instead (`Animation.reverse`), a leg went on the old way for
   * a frame while the engine resolved the new rate, and a late tap retraced the slow end of the
   * curve — the brake at the start of every quick re-switch. The blocks turn from where each of
   * them is, in the order they left: each is still where the strip was `delay` ago, so it runs
   * on for its own delay and then follows the new leg — top first, the lean reversing as a wave
   * rather than any block starting over.
   *
   * The pose is the old leg's at the moment of the tap, and the new leg starts at that moment,
   * so a frame committed on time carries straight on from it. `performance.now()`, not the
   * timeline's time: with nothing on the main thread animating, the engine may stop producing
   * main frames while the compositor goes on drawing, and the timeline's time is then the last
   * main frame's, however long ago. A commit that comes late — the tap's own work on a slow
   * phone — would open the new leg ahead of the pose the compositor had got to, a jump; so the
   * first frame checks, and past a frame and a half it starts the leg again from that frame. */
  turn = () => {
    const previous = leg;
    const lead = animations[0];
    const began = typeof lead?.startTime === 'number' ? lead.startTime : null;
    /* Nothing has moved while the first leg is still waiting to start. */
    const prior =
      began === null
        ? []
        : historyPending
          ? history.map((segment) => ({ leg: segment.leg, start: segment.start + began }))
          : history;
    const launch = (at: number) => {
      const next = turnStrip(previous, began === null ? 0 : at - began, full);
      reversed = next.to === 0;
      startLeg(next, began === null ? null : at, prior);
      return next;
    };
    const tapped = performance.now();
    const current = launch(tapped);
    if (began === null) return;
    requestAnimationFrame((frame) => {
      if (!settled && leg === current && frame - tapped > STRIP_LATE_FRAME_MS) launch(frame);
    });
  };

  startLeg(leg, null, []);
  return handle;
}

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

  const instant = motionTier() === 'off';
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
  const distance = (scroller?.clientWidth || panel.getBoundingClientRect().width) + AXIS_GAP;
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
  if (scroller && !instant && panel.hasAttribute('data-tab-lean') && motionTier() === 'standard') {
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
  if (motionTier() === 'off') return;
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

/* Re-exported so a component never registers a plugin itself. Registration is a
   global, one-time side effect; a second `registerPlugin` call from a lazily-loaded
   component is how a plugin ends up half-initialised. */
export { Flip, gsap, useGSAP, Observer };
