'use client';
/* `'use no memo'` while `reactCompiler` is on: `useGSAP`'s `dependencies` array is a
 * runtime argument the compiler does not model; identity churn there is how
 * `@gsap/react` disposes its context — the "a second Observer accumulates" bug (see
 * `useDrawerSwipe`). Two call sites omit `revertOnUpdate` on purpose. Lift one file
 * at a time; a compiler bailout is information, not noise. */
'use no memo';

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { CustomEase } from 'gsap/CustomEase';
import { Flip } from 'gsap/Flip';
import { Observer } from 'gsap/Observer';
import { ScrollToPlugin } from 'gsap/ScrollToPlugin';
import {
  commitCustomPalette,
  commitPalette,
  commitScheme,
  currentCustomSeed,
  currentPalette,
  currentScheme,
  motionScale,
  motionTier,
  resolveScheme,
  setMotionScaleListener,
  useEntranceMotion,
  useMotionTier,
  CUSTOM_PALETTE,
  type CustomPaletteInstall,
  type PaletteId,
  type SchemeSetting,
} from '@/lib/appearance';
import { getAppScroller, heroOwnsScreen, setHeroBusyCheck } from '@/lib/appScroller';
import { DURATION, EASE } from '@/lib/motionTokens';
import { SPRINGS, SPRING_DURATION, springEase, type SpringName } from '@/lib/spring';
import { SPRING_EFFECTS_FOR } from '@/lib/springTiming';
import { beginPageTransit, notifyThemeWipeStart, routeTransitActive, setThemeWipeGuard } from '@/lib/pageTransit';
import { setTabIntent, tabIntent } from '@/lib/tabIntent';
import {
  applyInstantTabScroll,
  recallTabScroll,
  rememberTabScroll,
  tabPanelTop,
  TAB_SHARED_CHROME_PX,
} from '@/lib/tabScroll';

gsap.registerPlugin(useGSAP, CustomEase, Flip, Observer, ScrollToPlugin);

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
 * and resolved by the fallback chain above. View Transitions are assumed present.
 * **reduced** cross-fades the two schemes in place — a real wipe, not an absent one;
 * **off** applies the change with no transition.
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

  const doc = document as ViewTransitionDocument;
  const root = document.documentElement;
  const tier = motionTier();

  if (tier === 'off') {
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
  root.dataset.themeVt = id;

  const transition = doc.startViewTransition(applyChange);
  const active = { id, style, transition };
  activeThemeTransition = active;

  const cleanup = () => {
    if (activeThemeTransition !== active) return;
    activeThemeTransition = null;
    style.remove();
    if (root.dataset.themeVt === id) delete root.dataset.themeVt;
  };
  void transition.finished.then(cleanup, cleanup);
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

export function changePalette(id: PaletteId, origin?: { x: number; y: number }) {
  if (id === currentPalette()) return;
  circularReveal(() => commitPalette(id), origin);
}

/**
 * The eleventh palette, as a wipe. Its own entry point rather than a branch in
 * `changePalette`: that guard is on the id, and for the custom palette the id is
 * constant while the *colour* is what moves — so the guard here is the seed. The
 * derivation is the caller's (`resolveCustomPalette` awaits a chunk); nothing may
 * await inside the wipe's capture callback.
 */
export function changeCustomPalette(
  install: CustomPaletteInstall,
  origin?: { x: number; y: number },
) {
  if (currentPalette() === CUSTOM_PALETTE && currentCustomSeed() === install.seed) return;
  circularReveal(() => commitCustomPalette(install), origin);
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
   * `enabled`: one Observer at a time, disposed by `revertOnUpdate`. */
  const openRef = useRef(open);
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    openRef.current = open;
    onOpenChangeRef.current = onOpenChange;
  });

  useGSAP(
    (_context, contextSafe) => {
      if (!enabled) return;

      // `width` is read per gesture: the panel is 360dp open and auto-width
      // closed, and either can change with the viewport.
      let width = 0;
      let startOffset = 0;
      let active = false;
      // Set at press when the start point qualifies, cleared once the axis is
      // known: `onDragStart` fires before `lockAxis` has decided, so a vertical
      // scroll that happens to begin at the screen edge must be able to back out.
      let pending = false;

      const drawer = () => drawerRef.current;
      const scrim = () => scrimRef.current;

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

        const release = () => {
          onOpenChangeRef.current(toOpen);
          if (d) {
            gsap.set(d, { clearProps: 'transform' });
            d.style.transition = '';
          }
          if (s) {
            gsap.set(s, { clearProps: 'opacity' });
            s.style.transition = '';
            s.style.pointerEvents = '';
          }
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
          settle(flick ? self.velocityX > 0 : (x + width) / width > DRAWER_COMMIT_RATIO);
        },
      });

      /* Kill the Observer **and** undo the two raw style writes `begin()` makes:
       * `context.revert()` cannot — they are set through `element.style`. Reachable
       * when `enabled` flips at the `md` breakpoint mid-drag: a drawer that snaps
       * and a scrim that no longer catches the closing tap. */
      return () => {
        observer.kill();
        const d = drawer();
        const s = scrim();
        if (d) d.style.transition = '';
        if (s) {
          s.style.transition = '';
          s.style.pointerEvents = '';
        }
      };
    },
    { dependencies: [enabled], revertOnUpdate: true },
  );
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
 * by *visual* position, not DOM order: masonry fills column by column, so DOM order
 * sweeps one column at a time. Sorting by row band then by x makes cards arrive
 * left to right, top to bottom.
 */
/** Rows are banded before sorting: masonry cards on the same visual row rarely
 *  share an exact `top`, and comparing raw values would zig-zag between them. */
const ROW_BAND_PX = 48;

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

      const rootTop = root.getBoundingClientRect().top;
      const ordered = items
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { el, band: Math.round((r.top - rootTop) / ROW_BAND_PX), x: r.left };
        })
        .sort((a, b) => a.band - b.band || a.x - b.x)
        .map((m) => m.el);

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
            : { each: 0.035, from: 'start', amount: Math.min(items.length * 0.035, 0.9) },
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

/* ---------------------------------------------------------------------------
 * Shared axis — Material 3, and one plane rather than two layers
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
 * **The cascade is a lean, not a queue.** A block's delay is a continuous function
 * of its height on screen, identical on both sides, so at any height the leaving and
 * arriving blocks are on the same beat, exactly one window apart — the seam between
 * the pages leans over, top leading, and sweeps across. The delay must be small (at
 * a full window of travel, ten milliseconds of lag is a hundred pixels of shear) and
 * continuous (a stepped delay puts two close cards a whole step out of phase, a
 * visible rip through content that belongs together).
 *
 * The stagger axis must stay *perpendicular* to the motion axis: sideways blocks may
 * be delayed by height (a horizontal band is rigid); vertically translating blocks
 * may not (that stretches the column instead of shearing it) — `axis: 'y'` moves as
 * one block.
 *
 * Nothing waits for the router: both panes are already mounted, so the transition
 * only needs the *attribute* that gives the incoming one a box — which this owns.
 * The route commit that follows is a visual no-op.
 * ------------------------------------------------------------------------ */

/**
 * How far the bottom of the window lags the top, as a fraction of the span.
 *
 * Read it as a shear, not a wait: the lean the eye sees is the lag times the
 * curve's peak slope, so the number only means something paired with a curve.
 * `emphasized` peaks at 10.06 against `standard`'s 4.05 — 2.49x — so it is re-tuned
 * per curve, landing the peak lean at about 0.32 of a window. That is the whole
 * budget: past it the top finishes before the bottom starts — a shredded page.
 */
const AXIS_LAG = 0.032;
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
/** Heights within this of each other share a beat. See `planWave`. */
const AXIS_ROW_BAND = 64;
/** How far outside the viewport still counts as worth a compositor layer. */
const AXIS_NEAR_MARGIN = 240;
/** Runaway guard on the descent; nothing legitimate nests a row this deep. */
const PANE_DESCEND_LIMIT = 6;
/**
 * How far the reduced tier shifts each side, instead of a whole window's width.
 * Enough to carry the *direction* of the move, short enough not to read as a slide
 * — the 24dp M3's own shared axis uses for its small-container form, the same order
 * as the 8px an entrance travels here. A cross-fade cannot say which way you went,
 * and on a tab bar that is half the information.
 */
const REDUCED_AXIS_SHIFT_PX = 24;

export interface SharedAxisHandle {
  /** Jump to the end state and run the settle callback. Idempotent. */
  finish(): void;
}

/**
 * A complete partition of the pane into blocks that will be moved.
 *
 * "Complete" is the load-bearing word. Marking only the tagged rows leaves everything
 * else — masonry container, pagination anchor, loading skeletons, error block —
 * sitting at rest for the whole slide, only to be hidden when the pane is finally
 * taken out of layout: the sliver of the old page visible after a switch. Under a
 * small nudge an unmoved element is indistinguishable from a moved one; under a
 * window-width slide it is the only thing still on screen.
 *
 * So: descend only through elements that *contain* a marked row, and take everything
 * else whole. Every element then ends up inside exactly one block, marked or not,
 * and the markers only decide how finely the wave is sampled — never whether
 * something moves at all.
 */
function paneBlocks(pane: HTMLElement): HTMLElement[] {
  const blocks: HTMLElement[] = [];
  const walk = (node: Element, depth: number) => {
    for (const child of node.children) {
      if (!(child instanceof HTMLElement)) continue;
      if (!child.hasAttribute('data-tab-row') && depth < PANE_DESCEND_LIMIT) {
        if (child.querySelector('[data-tab-row]')) {
          walk(child, depth + 1);
          continue;
        }
      }
      blocks.push(child);
    }
  };
  walk(pane, 0);
  return blocks.length > 0 ? blocks : [pane];
}

/**
 * Delay per block, as a continuous function of its height on screen.
 *
 * One map for both panes — that is the whole mechanism. Because the delay depends
 * only on `top`, a block leaving at y=400 and a block arriving at y=400 are on the
 * same beat; any other input decouples them and the switch stops being one surface
 * (ranking bands per pane tears apart same-height blocks; banding tears apart
 * neighbours across a boundary — height, continuously, has neither failure).
 *
 * Measured against the viewport, not the pane, so a mid-scroll pane does not have
 * every visible block already capped, flattening the wave when there is most to
 * show; capped at one viewport, since below the fold the lag is invisible and would
 * only stretch the timeline. Measured once, up front, so every tween agrees.
 *
 * Height is quantised to `AXIS_ROW_BAND` first — not a return to banding: the
 * quantum is on the *input* and it is small. Masonry cards that read as one row have
 * tops tens of pixels apart and would set off at visibly different moments under a
 * purely continuous delay.
 *
 * Returns the near-viewport subset alongside — the only place worth spending a
 * compositor layer.
 */
function planWave(
  /** One entry per pane. `shiftY` is where that pane is about to be moved to
   *  vertically, applied arithmetically so nothing has to be written to the DOM
   *  before these reads — see the note at the call site. */
  groups: { blocks: HTMLElement[]; shiftY: number }[],
  span: number,
  lean: boolean,
) {
  const scroller = getAppScroller();
  const view = scroller?.getBoundingClientRect();
  const origin = view?.top ?? 0;
  const height = view?.height || window.innerHeight || 1;
  const delayOf = new Map<Element, number>();
  const near: HTMLElement[] = [];
  for (const { blocks, shiftY } of groups) {
    for (const block of blocks) {
      const rect = block.getBoundingClientRect();
      const top = rect.top + shiftY;
      const offset = top - origin;
      const row = Math.round(offset / AXIS_ROW_BAND) * AXIS_ROW_BAND;
      delayOf.set(block, lean ? gsap.utils.clamp(0, 1, row / height) * span * AXIS_LAG : 0);
      if (
        rect.bottom + shiftY > origin - AXIS_NEAR_MARGIN &&
        top < origin + height + AXIS_NEAR_MARGIN
      ) {
        near.push(block);
      }
    }
  }
  const delay: (index: number, target: Element) => number = (_index, target) =>
    delayOf.get(target) ?? 0;
  return { delay, near };
}

/**
 * Slides `leaving` out and `entering` in along one axis as a single plane, band by
 * band. Both elements must already have a box — see the grid rules for
 * `[data-tab-panel]` in globals.css, which stack the panes in one cell so the row
 * height is `max(outgoing, incoming)` and the scroller's height can only grow while
 * the transition runs.
 */
export function playSharedAxis(opts: {
  leaving: HTMLElement;
  entering: HTMLElement;
  /** Which way the strip travels. `y` moves as one block; see the note above. */
  axis?: 'x' | 'y';
  /** +1 = moving forward; the outgoing side exits towards the negative end. */
  direction: 1 | -1;
  /** Width (or height) of the window the strip slides past. Defaults to the
   *  incoming side's own box, which is what the tab panes want. */
  distance?: number;
  /** Vertical compensation for a scroll restore, applied to the whole pane. */
  leavingOffsetY?: number;
  /**
   * Sample the wave over the pane's own blocks. Requires that those blocks survive
   * the run — true of the tab panes (mounted once, only marked), false of a route
   * change, where React replaces the whole subtree behind us.
   *
   * **Off by default** — one option, one default; a screen that wants it says so at
   * *both* of its call sites. Two screens opt in: `/policy`, whose four prose panes
   * are static once mounted, and the home page's gallery↔forum switch (reactive and
   * tap paths), safe because the forum pane is mounted ahead of the tap on an idle
   * callback. `/messages` is the counter-example: its panes fetch on arrival, so the
   * subtrees are swapped for skeletons ~70ms in and GSAP animates detached nodes.
   *
   * The frame-rate cost is real and paid where it belongs — sixteen to forty inline
   * transforms and promoted layers per frame on a 50-card gallery, against two.
   */
  lean?: boolean;
  onSettle?: () => void;
}): SharedAxisHandle {
  const { leaving, entering, axis = 'x', direction, leavingOffsetY = 0, onSettle } = opts;

  /* No lean on the vertical axis (it would stretch the column, not shear it), and
   * none where the blocks are not stable — a route's incoming page re-renders as
   * soon as its data lands, detaching every block GSAP holds. Without a lean the
   * whole side moves as one element, the only node a re-render never replaces. */
  const lean = (opts.lean ?? false) && axis === 'x';
  const outAll = lean ? paneBlocks(leaving) : [leaving];
  const inAll = lean ? paneBlocks(entering) : [entering];
  /** The travel, as a vars object on whichever axis this run is using. */
  const travel = (value: number) => (axis === 'x' ? { x: value } : { y: value });

  /* The window the strip slides past is the *scroller*, not the pane: the pane is
   * the centred content column, the scroller runs sidebar edge to screen edge. One
   * column of travel made the incoming page appear mid-page with the two pages edge
   * to edge and no plate; one *window* of travel fixes both — pages enter and leave
   * at the content-area edges, and each being centred in its own window, the side
   * margins become the gap. */
  const view = getAppScroller();
  const box = entering.getBoundingClientRect();
  const window_ = axis === 'x' ? view?.clientWidth || box.width : view?.clientHeight || box.height;
  const distance = opts.distance ?? window_ + AXIS_GAP;

  /* Only what can be seen actually moves. Most of a gallery pane's partition blocks
   * are below the fold for the whole run; animating them cost seventy compositor
   * layers and seventy inline transforms rewritten every frame — a long task before
   * the first frame could paint. Leaving them at rest is not a residue (a residue is
   * something *visible* that fails to move; below the viewport a block ends where it
   * began, exactly where the settle would have put it). The margin covers a scroll
   * landing slightly off from the measurement. The partition stays complete: `near`
   * is filtered out of it, so anything on screen is in it by construction. */
  /* `emphasized` wants room for its tail — it spends the last two thirds of the
   * clock covering the last few per cent of the distance; squeezed into 400ms that
   * read as an abrupt stop rather than a settle. 500ms is also what the spec gives
   * a large container transform. */
  const span = DURATION.emphasized;

  let settled = false;
  /* Declared before `finish` closes over it: the reduced-motion path returns
   * before a timeline is ever built, so a `const` declared afterwards would be
   * in the temporal dead zone when the queued microtask fired. */
  let timeline: gsap.core.Timeline | null = null;

  const finish = () => {
    if (settled) return;
    settled = true;
    timeline?.kill();
    view?.removeAttribute('data-axis-running');
    /* Nothing may keep a transform. `lib/hero/dom.ts` only compensates for a
     * transform on `[data-image-detail-background-visual]`, so a residual one on a
     * row — an ancestor of every gallery card — would silently corrupt the rect the
     * hero flight reads on press. `clearProps`, never a zero translate: the latter
     * still leaves `transform !== 'none'`. Over every block, not just the animated
     * ones — an interrupted run may have left an offset on a block this run skips. */
    gsap.set([leaving, entering, ...outAll, ...inAll], {
      clearProps: 'transform,opacity,visibility,willChange',
    });
    onSettle?.();
  };

  const tier = motionTier();
  if (tier === 'off' || distance <= 0) {
    queueMicrotask(finish);
    return { finish };
  }

  /* Reduced: the panes cross-fade with a short shift instead of sliding a window's
   * width. Dropped: the *distance* and the wave (a full-window slide is the
   * performance; the wave is a transform per block per frame). Survives: direction —
   * 24px reads "the next one came from the right", which a bare cross-fade cannot
   * say. `leavingOffsetY` still applies, as a `set` not a tween: not travel, but
   * holding the outgoing pane over the pixels the eye was on after the scroller
   * moved to the destination's remembered offset. */
  if (tier === 'reduced') {
    view?.setAttribute('data-axis-running', axis);
    if (leavingOffsetY) gsap.set(leaving, { y: leavingOffsetY });
    const shift = REDUCED_AXIS_SHIFT_PX * direction;
    const prop = axis === 'x' ? 'x' : 'y';
    timeline = gsap.timeline({ onComplete: finish });
    timeline
      .set([leaving, entering], { willChange: 'opacity, transform' }, 0)
      .to(
        leaving,
        { [prop]: -shift, autoAlpha: 0, duration: DURATION.press, ease: 'accelerate' },
        0,
      )
      .fromTo(
        entering,
        { [prop]: shift, autoAlpha: 0 },
        {
          [prop]: 0,
          autoAlpha: 1,
          duration: DURATION.short,
          ease: 'decelerate',
          clearProps: 'transform',
        },
        0,
      );
    return { finish };
  }

  /* Turn the scroller into that window for the length of the run. Set before
   * anything is offset, so no frame paints a page hanging outside it or hands the
   * scroller something to scroll sideways. Callers always settle the previous run
   * first, so the attribute cannot be cleared from under a live one. */
  view?.setAttribute('data-axis-running', axis);

  /* The outgoing pane's compensating offset is accounted for BEFORE anything is
   * measured — arithmetically, not by writing it first. `runTabTransition` restores
   * the destination tab's scroll position while both panes are still in place, then
   * hands us `leavingOffsetY` to hold the outgoing pane over the pixels the user was
   * looking at. Measure without it and every rect on that side is wrong by the whole
   * jump: the cards under the user's eyes read as below the fold — outside `near`,
   * left at rest for the entire slide. Passing the shift to `planWave` instead of
   * writing and re-reading keeps this to a single forced layout. */
  const { delay, near } = planWave(
    [
      { blocks: outAll, shiftY: leavingOffsetY },
      { blocks: inAll, shiftY: 0 },
    ],
    span,
    lean,
  );
  const onScreen = new Set(near);
  const pick = (all: HTMLElement[], pane: HTMLElement) => {
    if (!lean) return all;
    const visible = all.filter((block) => onScreen.has(block));
    return visible.length > 0 ? visible : [pane];
  };
  const outRows = pick(outAll, leaving);
  const inRows = pick(inAll, entering);

  /* The start state is written SYNCHRONOUSLY, before the timeline exists. A `.set()`
   * inside a timeline is rendered on GSAP's next rAF tick, but the caller has just
   * flipped `data-tab-pane-entering`, which gives the incoming pane a box immediately
   * — so there was a window of one frame in which it painted on top of the outgoing
   * one. That is the flash. Nothing needs an opacity guard: at `direction * distance`
   * the incoming rows are a whole window away and the clip has already hidden them. */
  gsap.set(leaving, { y: leavingOffsetY });
  gsap.set([...outRows, ...inRows], { willChange: 'transform' });
  gsap.set(inRows, { ...travel(direction * distance), force3D: true });

  /* `overwrite: false` — the default `'auto'` makes tweens sharing a target and
   * property kill each other; every tween below is deliberate and non-conflicting
   * (an earlier `fromTo` start offset was silently killed by the `to` beside it).
   * `paused` — see the `play()` below. */
  timeline = gsap.timeline({ paused: true, defaults: { overwrite: false, force3D: true } });

  /* One clock, one curve, one delay function, two tweens. `delay` is measured
   * across BOTH sides' blocks at once, so leaving and arriving blocks at the same
   * height are on the same beat; everything else is already symmetric (same
   * duration, curve, equal and opposite offsets), so at every height the pair stays
   * exactly one window apart. Separate delay functions degenerate into a layer on a
   * layer. `emphasized`, not `spring`: overshoot would carry the incoming side past
   * its resting place — and the two being adjacent, "past" is a strip of bare panel
   * at the trailing edge. Overshoot is only free when something else is underneath;
   * `emphasized` gets thrown weight from its front loading instead. */
  timeline
    .to(
      outRows,
      { ...travel(-direction * distance), duration: span, ease: 'emphasized', stagger: delay },
      0,
    )
    .to(inRows, { ...travel(0), duration: span, ease: 'emphasized', stagger: delay }, 0);

  timeline.eventCallback('onComplete', finish);

  /* Started here, in the tap handler, not on the next animation frame. A rAF
   * deferral costs a whole frame every time: GSAP's own ticker rAF is registered
   * long before ours, so `play()` lands after the tick for the current frame.
   * Playing synchronously dates the timeline from the previous tick instead, so the
   * very next frame already carries a few percent of the travel. `lagSmoothing`
   * above covers any stall the play might otherwise be charged for. */
  if (!settled) timeline.play();

  return { finish };
}

/* --- tab wiring ---------------------------------------------------------- */

type TabRun = { panel: HTMLElement; to: string; finish(): void };
let activeTabRun: TabRun | null = null;


/**
 * Records the tab being left and lands on the one being entered — the whole of the
 * scroll behaviour of a tab switch, shared by the animated and reduced paths (the
 * reduced one applies it and stops). A scroll position is state, not decoration: the
 * preference asks for less movement, not less positioning, and letting the browser
 * clamp `scrollTop` after a `display: none` swap is a nondeterministic jump on every
 * switch. Returns the scroller and how far it moved, which the animated path needs
 * to hold the outgoing pane over the pixels the user was looking at.
 */

function applyTabScroll(
  panel: HTMLElement,
  from: string,
  to: string,
  leaving: HTMLElement,
  entering: HTMLElement,
): { scroller: HTMLElement | null; offsetY: number } {
  const scroller = getAppScroller();
  if (!scroller) return { scroller: null, offsetY: 0 };
  const before = scroller.scrollTop;
  /* Saved here rather than only in `startTabTransition`, so the memory is kept by
   * *every* way of changing tab: sidebar links, the back button and the `/forum`
   * redirect arrive through `useTabPanes` and never record the tab they are leaving
   * — otherwise the tab bar came back to where you were, the sidebar to the top. */
  rememberTabScroll(panel, from, before);
  // Reading scrollHeight here forces the reflow the pane flags need.
  const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  /* …but `max` is the height with BOTH panes mounted, the row being a grid cell as
   * tall as the taller. At settle the leaving pane leaves layout, the page shrinks
   * to the entering pane's height, and the browser clamps `scrollTop` in one frame
   * at the end of the switch — a tall gallery left for a still-loading forum visibly
   * snapped backwards as the slide finished. So the target is clamped against the
   * height the page *ends* at: `max` was read at `max(H_out, H_in)`, minus `H_in` =
   * `max(0, H_out − H_in)` — exact, not a bound, and only clamping when the
   * destination pane is the shorter one. */
  const finalMax = Math.max(0, max - Math.max(0, leaving.offsetHeight - entering.offsetHeight));
  /* Whether this screen may restore at all — a property of the *screen*, not the
   * scroll position, which is what makes it predictable. `panelTop` is how much
   * shared chrome sits above the panel: on the home route just the gutter (the tab
   * pill is fixed chrome outside the scroller), so the panel effectively *is* the
   * page and a restored offset lands on the row you left; on a profile the banner,
   * name, level bar and tab row — content a restored offset drags along, snapping
   * the page. So a screen with real shared chrome above its panel is left where it
   * is (only `finalMax`'s clamp can move it). The threshold is the app bar's 64dp,
   * the smallest chrome this design system treats as a region. */
  const mayRestore = tabPanelTop(panel, scroller) <= TAB_SHARED_CHROME_PX;
  /* No memory for the destination; same test as `mayRestore`. "Stay where you are"
   * is right on a screen with shared chrome (the header does not move); on a screen
   * whose panel *is* the page, the carried-over offset clamps to exactly the bottom,
   * so the destination opens on its last row. A tab never opened starts at its own
   * beginning. */
  const remembered = mayRestore ? recallTabScroll(panel, to) : undefined;
  const fallback = mayRestore ? 0 : before;
  const next = Math.min(remembered ?? fallback, finalMax);
  // Scroll anchoring would "correct" a deliberate jump; same guard as runScroll.
  scroller.style.overflowAnchor = 'none';
  scroller.scrollTop = next;
  return { scroller, offsetY: next - before };
}

/**
 * The off tier's half of the same behaviour, applied *after* the commit. The panes
 * swap through `display: none` rather than sliding, so at this moment the arriving
 * pane is the only one with a box and the clamp is the browser's real maximum. What
 * it keeps is the *screen* test — restoring on a profile drags the shared banner.
 *
 * **What it can restore is bounded by who records.** The origin's offset is written
 * by `applyTabScroll` (every animated run) and by `startTabTransition` (the tap
 * path, before its reduced-motion bail). Under the preference a screen whose tabs
 * are reached through the tab bar remembers both directions; a tab reached only by
 * a sidebar link or the back button has nothing recorded and this returns at the
 * `undefined` guard. The two limits coincide today; a future screen with a low
 * `panelTop` and no tap path would need a pre-commit hook the reactive path lacks.
 */

/* The tab a panel has already been animated to. The switch is optimistic: it plays
 * on the tap, well before `router.push` resolves. If the destination's data is slow
 * the commit can land *after* the run has settled, when `activeTabRun` is null —
 * without this record the effect below saw a plain `from -> active` change and
 * replayed the whole transition once loading finished. */
const lastTabTarget = new WeakMap<HTMLElement, string>();

/* The tab the tab bar is optimistically showing, for as long as the URL has not
 * caught up with it — see `setTabIntent`. */


const paneOf = (panel: HTMLElement, name: string) =>
  panel.querySelector<HTMLElement>(`[data-tab-pane="${CSS.escape(name)}"]`);

const MOTION_FLAGS = [
  'data-tab-pane-leaving',
  'data-tab-pane-entering',
  'data-tab-pane-done',
  'data-tab-pane-animating',
];

function clearPaneFlags(panel: HTMLElement) {
  panel.querySelectorAll<HTMLElement>('[data-tab-pane]').forEach((pane) => {
    for (const flag of MOTION_FLAGS) pane.removeAttribute(flag);
  });
}

function runTabTransition(
  panel: HTMLElement,
  from: string,
  to: string,
  direction: 1 | -1,
  // `false`, so the tap path and the reactive path agree — see `playSharedAxis`.
  lean = false,
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

  activeTabRun?.finish();
  clearPaneFlags(panel);

  /* 1. Give both panes a box. They share one grid cell, so the row is now as tall
   * as the taller and can only shrink again at settle. `-animating` is separate on
   * purpose: it freezes CSS transitions inside a pane and clears at settle, while
   * `-entering` survives until the route commit lands. Fused into one flag, a slow
   * pane kept the freeze for its whole load — every hover changed colour and
   * elevation with no transition at all. */
  leaving.setAttribute('data-tab-pane-leaving', '');
  entering.setAttribute('data-tab-pane-entering', '');
  leaving.setAttribute('data-tab-pane-animating', '');
  entering.setAttribute('data-tab-pane-animating', '');
  /* Written here, with the flags, not after the measurements below: a style write
   * placed later would split one invalidation in two and force a second layout
   * inside the pointer handler. `clip` creates no scrollbox, so it changes nothing
   * the measurements read. See step 4. */
  panel.style.overflowY = 'clip';

  /* 2. Restore the destination tab's own offset while the incoming pane is still
   * invisible; 3. pin the outgoing pane to the pixels the user was looking at, so
   * step 2 is invisible on that side. */
  const { scroller, offsetY } = applyTabScroll(panel, from, to, leaving, entering);

  const settle = () => activeTabRun?.finish();

  /* 4. Nothing animates the panel's box, and that is the point. The panel is a grid
   * with both panes in one cell, both holding a box for the run (`-leaving` /
   * `-entering`), so its natural height *is* the taller of the two — a `height`
   * tween here would be a layout pass per frame on the ancestor of every gallery
   * card (sixteen to forty promoted layers under `lean`), exactly what the motion
   * section forbids. A late data arrival after settle is an ordinary reflow;
   * `restoreAnchor` puts the anchor back so a shrink above the viewport is absorbed
   * by scroll anchoring — skeletons must still be the right length.
   * What survives is the clip, as two style writes. `overflow-y`, not `overflow`:
   * clipping both axes cropped the shared axis to the centred content column, the
   * incoming pane appearing out of the text's edge. `clip`, not `hidden`: CSS
   * computes a `visible` sibling axis to `auto` beside `hidden`, which would make
   * this a horizontal scroll container mid-slide; `clip` may sit beside `visible`,
   * so `[data-axis-running]` on the scroller keeps owning x. Its purpose is
   * `leavingOffsetY`: the outgoing pane is translated by the difference between the
   * tabs' remembered offsets — most of a screen — and would paint over the footer
   * without it. */

  /* The footer rides inside `[data-page-content]` and travels with every route
   * change on its own; a tab switch is the exception — the sliding panes are
   * *inside* the page — so this is the one caller that asks it to step aside. */
  const endTransit = beginPageTransit();

  /* Belt and braces on the scroll-anchoring guard: `onSettle` restores it, but a
   * run whose panes unmount mid-flight never reaches that, and a lingering disabled
   * anchor silently kills anchoring for the session. The clip goes too: a residual
   * clip on an ancestor of every gallery card would crop anything a pane opens. */
  const restoreAnchor = () => {
    panel.style.overflowY = '';
    if (scroller) scroller.style.overflowAnchor = '';
    endTransit();
  };

  const handle = playSharedAxis({
    leaving,
    entering,
    direction,
    lean,
    leavingOffsetY: offsetY,
    onSettle: () => {
      /* The route may not have committed yet, in which case React is *also* still
       * marking the outgoing pane active — and `clearProps` has just restored it to
       * full opacity. `-done` holds it out of layout until the commit lands and
       * `useTabPanes` clears every flag; without this the old page reappears on top. */
      leaving.setAttribute('data-tab-pane-done', '');
      leaving.removeAttribute('data-tab-pane-leaving');
      /* GSAP is no longer driving either pane, so the transition freeze comes off
       * now — not at the next React commit, which may be a whole data fetch away. */
      leaving.removeAttribute('data-tab-pane-animating');
      entering.removeAttribute('data-tab-pane-animating');
      restoreAnchor();
      panel.removeEventListener('pointerdown', settle, { capture: true });
      if (activeTabRun?.panel === panel) activeTabRun = null;
    },
  });

  /* Same reason as the masonry cascade: these rows are ancestors of every gallery
   * card, and `useHeroLink` measures a card during the click that follows this
   * press. Snap to rest rather than be measured mid-slide. */
  panel.addEventListener('pointerdown', settle, { capture: true });
  lastTabTarget.set(panel, to);
  activeTabRun = {
    panel,
    to,
    finish: () => {
      handle.finish();
      restoreAnchor();
    },
  };
  return true;
}

/**
 * Starts the switch on the tap, before the route. Both panes are mounted, so this
 * hands the incoming one a box directly and the commit only has to agree with what
 * is already on screen.
 *
 * **Hold the `router.push` back past the end of the slide** (`TAB_PUSH_COALESCE_MS`):
 * an RSC navigation lands as a commit, a dropped frame mid-swap; nothing waits for
 * the URL, since the optimistic tab state owns what is on screen. Also swallows a
 * run down the sidebar into one push, not one history entry per tab passed through.
 */
export function startTabTransition(
  from: string,
  to: string,
  direction: 1 | -1,
  /* Passed explicitly rather than left to the parameter default: one option, one
   * default, and a screen that wants the lean says so at both of its call sites. */
  lean = false,
): void {
  if (from === to) return;
  const panel = document.querySelector<HTMLElement>('[data-tab-panel]');
  if (!panel) return;
  /* Recorded before the tier check, and keyed on the panel, so the two writers agree. */
  const scroller = getAppScroller();
  if (scroller) rememberTabScroll(panel, from, scroller.scrollTop);
  /* Only `off` returns here. `reduced` runs the transition, which cross-fades the
   * panes instead of sliding them — that branch is inside `playSharedAxis`, and
   * `lean` is ignored there, so passing it through is harmless. */
  if (motionTier() === 'off') return;
  runTabTransition(panel, from, to, direction, lean);
}

/**
 * Reactive fallback, and the owner of the motion flags' lifetime. Covers every way
 * of reaching a tab that does not go through the tab bar: back/forward, a sidebar
 * link, the `/forum` redirect, a deep link. If the tap already started this exact
 * transition it adopts it rather than restarting.
 *
 * `lean` samples the wave over the pane's own blocks, which must survive the run —
 * see `playSharedAxis`. Holds for panes static once mounted; **fails for any pane
 * whose content is replaced when its tab is selected** (the messages tabs fetch on
 * arrival: GSAP animates detached nodes while the new ones sit still). Pass `false`
 * there — nothing is lost but the shear, and the pane element is the one node React
 * will not replace.
 *
 * Attach the returned ref to the element carrying `data-tab-panel`.
 */
export function useTabPanesOn<T extends HTMLElement = HTMLElement>(
  /* The ref is a parameter for the reason `useStaggerGridOn` gives: this hook is
   * mounted from a child that only exists once GSAP has loaded, and the panel
   * element it drives has to have been attached long before that. */
  ref: RefObject<T | null>,
  active: string,
  /* `false`, matching `TabPanes`: the lean holds GSAP references to blocks *inside*
   * each pane, which a fetch-on-selection pane replaces within a few frames — a
   * switch with no animation at all. Two defaults for one option is a bug either
   * way. */
  { lean = false }: { lean?: boolean } = {},
): void {
  const previous = useRef(active);
  /* Read through a ref so it never widens the dependency list: this effect must run
   * on `active` and nothing else, or a parent re-render that happens to change the
   * option would restart a live transition. */
  const leanRef = useRef(lean);
  useEffect(() => {
    leanRef.current = lean;
  });

  useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel) return;

    /* The URL is still travelling towards a tab the user has already left — a
     * stale waypoint, not a destination; the superseding push is already queued.
     * Must return before `clearPaneFlags`: React has just moved `data-tab-pane-active`
     * onto the tab the URL passes through, so the motion flags are the only thing
     * holding the right pane on screen — clearing them would swap the panes with no
     * animation at all. */
    if (tabIntent() !== null && tabIntent() !== active) return;

    /* Where the panes actually are, which is not necessarily where the URL says.
     * `lastTabTarget` is written by every run, optimistic or reactive, while
     * `previous` has only seen commits — the fallback, for a panel that has not
     * animated yet and therefore cannot be out of step. */
    const from = lastTabTarget.get(panel) ?? previous.current;
    previous.current = active;

    const live = activeTabRun?.panel === panel;

    // Nothing is animating, so React's `data-tab-pane-active` is the only
    // truth and every motion flag is stale.
    if (!live) clearPaneFlags(panel);

    if (from === active) return;
    if (live && activeTabRun?.to === active) return; // adopted, still in flight
    // Already animated to this tab optimistically; the commit is only catching
    // up. Flags were cleared above, so React's own `-active` now holds it.
    if (lastTabTarget.get(panel) === active) return;
    if (motionTier() === 'off') {
      // Positioning is not motion — see `applyInstantTabScroll`.
      applyInstantTabScroll(panel, active);
      return;
    }

    const order = [...panel.querySelectorAll<HTMLElement>('[data-tab-pane]')].map(
      (pane) => pane.dataset.tabPane,
    );
    const direction: 1 | -1 = order.indexOf(active) > order.indexOf(from) ? 1 : -1;
    runTabTransition(panel, from, active, direction, leanRef.current);
    /* `active` and nothing else (`ref` is stable for the life of the component, so
     * listing it would be noise). This effect must run on a tab change and on no
     * other cause — a parent re-render that happens to change an option would
     * otherwise restart a live transition. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

}

/** Ends any in-flight tab transition immediately. */
export function finishTabTransition() {
  activeTabRun?.finish();
}

/* Re-exported so a component never registers a plugin itself. Registration is a
   global, one-time side effect; a second `registerPlugin` call from a lazily-loaded
   component is how a plugin ends up half-initialised. */
export { Flip, gsap, useGSAP, Observer };
