'use client';
/* `'use no memo'`, for the first release with `reactCompiler` on.

   This file hands `useGSAP` hand-tuned `dependencies` arrays, and that array is a *runtime*
   argument the compiler does not model — while it does memoise the values that go into it. How
   often those identities change is how often `@gsap/react` disposes its context, and getting that
   wrong is the "a second Observer accumulates holding a stale closure" bug this repo has already
   shipped once (see `useDrawerSwipe`). Two of the call sites here also omit `revertOnUpdate` on
   purpose, so the deferred-cleanup path is exactly the one in question.

   Lift it one file at a time, with `npm run net:tabs` and `npm run hero:path` as the guardrails.
   A compiler bailout is information, not noise: it says this file was not optimised. */
'use no memo';

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { CustomEase } from 'gsap/CustomEase';
import { Flip } from 'gsap/Flip';
import { Observer } from 'gsap/Observer';
import { ScrollToPlugin } from 'gsap/ScrollToPlugin';
import {
  commitPalette,
  commitScheme,
  currentPalette,
  currentScheme,
  motionScale,
  motionTier,
  resolveScheme,
  setMotionScaleListener,
  useEntranceMotion,
  useMotionTier,
  type PaletteId,
  type SchemeSetting,
} from '@/lib/appearance';
import { getAppScroller, heroOwnsScreen, setHeroBusyCheck } from '@/lib/appScroller';
import { DURATION, EASE } from '@/lib/motionTokens';
import { SPRINGS, SPRING_DURATION, springEase, type SpringName } from '@/lib/spring';
import { SPRING_EFFECTS_FOR } from '@/lib/springTiming';
import { beginPageTransit, notifyThemeWipeStart, setThemeWipeGuard } from '@/lib/pageTransit';
import { setTabIntent, tabIntent } from '@/lib/tabIntent';
import {
  applyInstantTabScroll,
  recallTabScroll,
  rememberTabScroll,
  tabPanelTop,
  TAB_SHARED_CHROME_PX,
} from '@/lib/tabScroll';

gsap.registerPlugin(useGSAP, CustomEase, Flip, Observer, ScrollToPlugin);

/* One line reaches every GSAP tween and delay in the app.
 *
 * `timeScale` on the global timeline is the idiomatic lever and the only one that covers
 * animations built by forty call sites without touching any of them. The `off` tier is
 * *not* expressed as a scale of 0: `timeScale(0)` stops the clock — every tween would
 * hang at its first frame forever — where what `off` means is that the tween should be
 * over. So the tier is clamped here and the JS branches skip outright, which is what they
 * already did under the old preference.
 *
 * Registering the listener also applies it once, so a cold load with a stored speed does
 * not run its first transition at 1x. */
setMotionScaleListener((scale) => {
  gsap.globalTimeline.timeScale(scale > 0 ? 1 / scale : 1);
});


/**
 * Motion tokens for GSAP-driven animation. The same curves live in
 * globals.css (`--ease-*` in @theme) for CSS transitions/keyframes — keep the
 * two in sync so scripted and declarative motion feel identical.
 * CustomEase registers by name, so `ease: 'decelerate'` works in any tween.
 *
 * These are M3's **transition** curves: for something entering, leaving or
 * crossing the screen. Component motion — a handle travelling, a menu growing,
 * a mark landing — is spring physics in M3 Expressive and lives below, in
 * `springs`. Reaching for `decelerate` on a switch handle is the mistake this
 * split exists to prevent.
 *
 * `standard` and `emphasized` are two different sets and not interchangeable;
 * the short `decelerate` / `accelerate` names are the *emphasized* pair, which
 * is what every existing call site means by them. The standard pair is spelled
 * out in full for the same reason globals.css does it.
 */
export const eases = {
  standard: CustomEase.create('standard', '0.2, 0, 0, 1'),
  standardDecelerate: CustomEase.create('standard-decelerate', '0, 0, 0, 1'),
  standardAccelerate: CustomEase.create('standard-accelerate', '0.3, 0, 1, 1'),
  decelerate: CustomEase.create('decelerate', '0.05, 0.7, 0.1, 1'),
  accelerate: CustomEase.create('accelerate', '0.3, 0, 0.8, 0.15'),
  /**
   * M3's emphasized curve — two cubic segments, so unlike the three above it
   * cannot be written as four numbers. CustomEase takes the spec path as-is.
   *
   * It hangs back for the first sixth, snaps through at 2.5x `standard`'s peak
   * speed, then takes a long tail into rest. That is what the spec reserves for
   * a large container transform, and what stops a full-window slide reading as
   * a rigid plate being pushed across at a constant clip.
   */
  emphasized: CustomEase.create(
    'emphasized',
    'M0,0 C0.05,0 0.133333,0.06 0.166666,0.4 C0.208333,0.82 0.25,1 1,1',
  ),
  /**
   * Symmetric — eases in as well as out. Every curve above is one-sided by
   * construction, which leaves two motions with no token: a repeating one, whose
   * velocity would be discontinuous once per cycle, and a panel travelling in
   * place with both ends of its journey on screen, which starts and stops at rest
   * and reads as a jump-then-stall on a one-sided curve. The CSS twin is
   * `--ease-symmetric`.
   */
  symmetric: CustomEase.create('symmetric', '0.4, 0, 0.6, 1'),
  /** Alias of `symmetric`, kept because "loop" is the role at its call sites. */
  loop: CustomEase.create('loop', '0.4, 0, 0.6, 1'),
  /* The long-distance *scroll* curve was here and moved to `lib/scrollTo.ts` with the two
     functions that used it. It is a plain cubic (`0.33, 0, 0, 1`) evaluated in JS there,
     because `scrollTop` is not a CSS property and the tween has to be per-frame either way.
     Keep the two literals in step if either moves. */
} as const;

/**
 * The nine M3 Expressive component springs, registered as GSAP eases under the
 * names `spring-fastSpatial`, `spring-defaultSpatial`, … See `lib/spring.ts` for
 * the physics and for why spatial may overshoot while effects never can.
 *
 * Registered as **closed-form functions** rather than sampled tables, which is
 * the one advantage the scripted side has over CSS here: no interpolation error
 * at all. Pair each with `SPRING.<name>` for its settle time — the two together
 * are the spring, and using one without the other gives a curve on the wrong
 * clock.
 *
 *     gsap.to(el, { x: 0, ...spring('fastSpatial') })
 */
for (const [name, spec] of Object.entries(SPRINGS)) {
  gsap.registerEase(`spring-${name}`, springEase(spec));
}

/** Settle times in seconds, keyed the same way. */
export const SPRING = SPRING_DURATION;

/**
 * A spring as a ready-made `{ duration, ease }` pair, so the two cannot drift
 * apart at a call site.
 *
 * `SPRING_EFFECTS_FOR` — the reduced tier's shape substitution — lives in
 * `lib/springTiming.ts`, next to the WAAPI twin of this function, because both renderers need
 * one table and that module is the one of the two that does not drag GSAP in.
 */
export function spring(name: SpringName): { duration: number; ease: string } {
  const shape = motionTier() === 'reduced' ? (SPRING_EFFECTS_FOR[name] ?? name) : name;
  return { duration: SPRING_DURATION[name], ease: `spring-${shape}` };
}


/* Never let a stalled frame be charged to an animation.
 *
 * GSAP advances tweens by real elapsed time, so work that blocks the main
 * thread is paid for out of the animation rather than delaying it. Measured on
 * the home tab switch: the route push and React commit stall painting for
 * ~84ms, and the first frame the user actually sees is already 25% into the
 * tween with the panes two thirds of the way across. It reads as a snap
 * followed by a crawl — not as a slow animation, which is why it was hard to
 * place by eye.
 *
 * `lagSmoothing` is GSAP's own answer: past the threshold, pretend the frame
 * took `adjustedLag` instead. The default 500ms is far above anything a React
 * commit costs, so it never engaged. 100ms is above a normal dropped frame and
 * below the stalls this app actually produces. */
gsap.ticker.lagSmoothing(100, 33);

/**
 * `DURATION` now lives in `lib/motionTokens.ts`, with the curve literals, and is re-exported
 * here so GSAP call sites keep one import.
 *
 * It is a plain object of numbers and never needed this module — but this module registers
 * GSAP and five plugins at module scope, so importing it to ask “how long is a state layer”
 * pulled the whole engine into the asker’s chunk. `Toast` and `Reveal` are both mounted from
 * the root layout and both did exactly that.
 */
export { DURATION, EASE };

/* Matches the CSS safety net (`--default-transition-duration` +
   `--ease-standard`). It read 0.4s, which pairs `standard` with a duration from
   another row of the table, so the two renderers' fallbacks disagreed. It then read a
   bare `0.2` with a comment explaining that `DURATION.short` was out of reach at module
   load — which was true only because this call sat above the declaration. It does not
   any more.

   No `motionScale()` here: `gsap.globalTimeline.timeScale` above already scales every
   tween, and scaling the default as well would apply it twice. */
gsap.defaults({ ease: eases.standard, duration: DURATION.short, overwrite: 'auto' });

/* `prefersReducedMotion()` and `useReducedMotion()` used to live here, and both are gone
 * rather than renamed. What replaced them is `motionTier()` / `useMotionTier()` in
 * `lib/appearance`, which answer three-way instead of yes/no.
 *
 * Deleting the names rather than aliasing them was the point. The old boolean had ~30
 * call sites and at more than twenty of them the "reduced" branch was a bare `return` —
 * not a degraded animation, an absent one. A compatibility alias would have left every
 * one of those quietly meaning "off" for a user who asked for *less*, which is the one
 * outcome this change exists to fix. Making the compiler name all thirty was the only
 * way to be sure each was actually looked at.
 *
 * The rule those thirty were rewritten against, so a new one does not have to be
 * guessed at:
 *
 *   reduced — **basic** motion, not absent motion. Keep the fades, the short travels, the
 *             state layers, the ripple, the indicator that slides. Drop the performance:
 *             the container-transform flight, a slide across the whole window, stagger,
 *             overshoot, decorative loops, Lottie playback. The clock is the speed axis's,
 *             the same as `standard` — this tier changes the form, not the length.
 *   off     — drop opacity and colour too, and keep only what carries information:
 *             indeterminate progress, a determinate meter's value, a position the finger
 *             is holding, and a scroll offset. Those four are listed in AGENTS.md.
 *
 * The first version of this rule said "keep opacity and colour, drop travel, scale,
 * rotation and stagger; one short step" — which is a fair description of *off* and left
 * `reduced` with nothing moving anywhere in the app. That is the defect this wording
 * replaces, and it is why so many of the branches below now do something rather than
 * nothing.
 */

/**
 * The press wave now lives in `lib/ripple.ts`, on WAAPI rather than a GSAP timeline.
 *
 * That was the single edge putting GSAP in the root layout’s chunk: `<RippleLayer />` is
 * mounted by `app/layout.tsx` on every route and imported `spawnRipple` from here, and this
 * module registers GSAP and five plugins at module scope. The app’s most trivial animation
 * was dragging the whole engine onto `/policy`.
 *
 * Re-exported so `components/ToggleSwitch.tsx` — which calls it directly, for the one case
 * event delegation cannot reach — keeps a single import path.
 */
export { spawnRipple } from '@/lib/ripple';



/* `scrollAppToTop`, `scrollAppToElement` and their tween moved to `lib/scrollTo.ts`, off
   ScrollToPlugin and onto rAF. `scrollTop` is not a CSS property, so this is the one piece of
   motion in the app that WAAPI cannot express and it has to be a per-frame write either way —
   which is what the plugin was doing. What the plugin cost was its host: `components/Pagination.tsx`
   is on ten screens and imported this module for those two functions alone.

   Re-exported below, so a call site that legitimately wants GSAP as well keeps one import. */
export { scrollAppToTop, scrollAppToElement } from '@/lib/scrollTo';

/* `beginPageTransit`, the theme-wipe guard and `setTabIntent` moved to `lib/pageTransit.ts`
   and `lib/tabIntent.ts`. None of the three touches an animation engine, and between them
   they were one of the two reasons GSAP was in the root shell of every route: the first two
   are what `lib/routeCrossFade.ts` needed from here, and the third is written by `AppLayout`
   for one screen's tab bar. Re-exported so nothing that legitimately wants GSAP too has to
   change its import. */
export { beginPageTransit, setThemeWipeGuard, setTabIntent };


/* `useSlidingIndicator` moved to `lib/slidingIndicator.ts` and onto Web Animations. It was this
   module's only reason to be imported by `components/Tabs.tsx`, which `AppLayout` mounts — so
   four lines of GSAP were putting the engine and its five plugins into the root shell of every
   route. Nothing here is left that a tab row needs. */


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
 * Geometry of the box the `::view-transition` pseudo-elements are painted into.
 *
 * That box is the *snapshot containing block*, and two things about it bite on
 * phones:
 *
 * - Its units are not reliably CSS pixels. Some mobile engines size it at
 *   device resolution, so a circle written in `px` lands compressed towards the
 *   top-left by roughly the device pixel ratio. Everything below is therefore
 *   expressed as a *fraction* of this box and emitted as percentages, which the
 *   engine resolves against the box itself — correct under any uniform scale.
 * - It spans the **large** viewport (browser UI retracted). Where the layout
 *   viewport is genuinely shorter, that extra band sits above the origin of
 *   client coordinates, and everything placed by `getBoundingClientRect()`
 *   renders that much too high.
 *
 * `lv*` units measure the box; the `v*` pair in front of them is the fallback
 * for engines that discard the large-viewport units as invalid.
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
  // Compared against the layout viewport specifically, not the visual one:
  // Chrome and Safari keep the ICB at the large size and only shrink the visual
  // viewport, so for them this stays 0 and no correction is applied. It fires
  // only where the layout viewport really is the short one — the case where the
  // snapshot cannot line up with client coordinates.
  const topInset = Math.max(0, probed.height - layoutHeight);

  return { width, height, topInset };
}

/* ---------------------------------------------------------------------------
 * Where the wipe starts
 *
 * A theme change grows out of the control that caused it, which means every caller has to
 * hand over a point — and one of them cannot. `Select`'s `onChange` reports a value and
 * nothing else, so /settings' 主题模式 row had no rect to pass and the wipe fell back to the
 * centre of the screen: the same gesture behaved one way from the app bar and another way
 * from the settings page, for no reason the user can see.
 *
 * So the fallback is the last place the pointer went down, captured passively at the window,
 * and after that the focused element's box — which is the keyboard's answer to the same
 * question. The viewport's centre stays as the last resort, for a change nothing visible
 * triggered.
 *
 * Armed at import, which is what makes it useful: the press that *causes* the first theme
 * change has already happened by the time anything in here is called, so a listener attached
 * on demand would always be one gesture late. This module is `'use client'` and already runs
 * `gsap.registerPlugin` and `gsap.ticker.lagSmoothing` at import; the window guard is for the
 * server-side pass over a client module, not for a real environment without a DOM.
 * ------------------------------------------------------------------------ */

type RevealPoint = { x: number; y: number };

let lastPointerPoint: RevealPoint | null = null;

if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    (event) => {
      /* A keyboard-driven activation reports 0/0, which is a corner of the screen rather
         than a place anything was pressed — that path wants the focused element instead.
         `pointerdown` rather than `click`, because a press on a menu row inside a popover
         that closes itself may never produce a `click` at all. */
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
  /* The finiteness check is not defensive dressing. A caller measuring a control that has
     already unmounted hands over a rect of zeros, and a `NaN` from an arithmetic slip reaches
     the emitted `clip-path` as `at NaN%` — which invalidates the whole declaration, so the
     keyframes carry no clip and the wipe silently becomes a cut. */
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
 * Circular reveal for theme changes, growing from `origin` (viewport
 * coordinates — pass the pressed control's centre) out to the farthest corner.
 *
 * `origin` is optional and the fallback chain above resolves it, so a caller that has no rect
 * to offer — `Select`, which reports a value and not an event — still gets a wipe that starts
 * where the user was looking.
 *
 * View Transitions are assumed present — every current engine ships them — so
 * the only branch left is the animation preference, which is a stated preference rather
 * than a capability.
 *
 * Three tiers, and the middle one is a real wipe rather than an absent one: **reduced**
 * cross-fades the two schemes in place. That keeps what the wipe is *for* — the two
 * palettes are visibly the same page rather than two pages — while dropping the only part
 * a motion-sensitive reader could object to, which is a hard edge sweeping the screen.
 * **off** applies the change with no transition at all.
 */
export function circularReveal(applyChange: () => void, origin?: { x: number; y: number }) {
  /* A flight owns these pixels; the wipe would snapshot the flyer mid-air and
     then let it teleport. Apply the theme with no animation and stand down. */
  if (heroOwnsScreen()) {
    applyChange();
    return;
  }

  /* Settle anything else that is moving before the snapshot.
     `startViewTransition` freezes CSS *transitions* for its duration (see
     globals.css) but not GSAP tweens or CSS animations, so a tab cross-fade or
     a route clone caught mid-flight would be baked into the outgoing frame. */
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
  // overshoots for any off-centre origin — a header icon needs about 90% of it —
  // so the sweep used to finish well before the animation did.
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
  // regardless of which stylesheet the browser sees last — matching on
  // specificity alone left this animation one stylesheet re-injection away from
  // losing to `animation: none`.
  /* The one curve in the app that is deliberately not an M3 token, for the same
   * class of reason as `.m3-progress-arc` in globals.css.
   *
   * Every M3 easing is one-sided: they are shaped for a small element travelling
   * a fixed distance, so they spend most of their travel immediately and take a
   * long tail into rest. What is animated here is a *radius*, and what the eye
   * reads is the area it sweeps — which goes as its square. That squares the
   * front-loading. Measured as the fraction of the screen already flipped at
   * 150ms of 550: this curve 3%, `emphasized` 65%, `decelerate` 87%. The M3
   * curves do not read as a fast wipe, they read as no wipe at all.
   *
   * So the radius wants a curve that is slow at BOTH ends. That curve is a
   * token — `--ease-loop`, added for repeating motion, which is symmetric for
   * the same reason — and it is nonetheless spelled out here: the rule lands in
   * the view-transition pseudo tree, where a `var()` that failed to resolve
   * would silently fall back to `ease`. Same documented exception the hero's
   * REVEAL_EASING and the top loader make. The value IS `--ease-loop`'s; keep
   * the two in sync.
   *
   * 550ms goes through `motionScale()` so the three standard speeds reach it; the reduced
   * tier gets its own shorter cross-fade and does not use this curve at all — a
   * cross-fade has no radius, so the argument above does not apply to it and the
   * one-sided decelerate is the right shape for something arriving. */
  const wipeMs = Math.round(550 * motionScale());
  style.textContent =
    tier === 'reduced'
      ? `
    @keyframes ${animationName} {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    html:root[data-theme-vt="${id}"]::view-transition-new(root) {
      animation: ${animationName} ${Math.round(400 * motionScale())}ms cubic-bezier(0.05, 0.7, 0.1, 1) both;
    }
  `
      : `
    @keyframes ${animationName} {
      from { clip-path: circle(0% ${at}); }
      to { clip-path: circle(${radiusPercent.toFixed(3)}% ${at}); }
    }
    html:root[data-theme-vt="${id}"]::view-transition-new(root) {
      animation: ${animationName} ${wipeMs}ms cubic-bezier(0.4, 0, 0.6, 1) both;
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
 * the preference write is one line of it — and the wipe is this module's. The reverse
 * arrangement would make `lib/appearance` import GSAP, and it is reached by anything
 * that reads a preference.
 *
 * Both are no-ops when nothing visible changes, which is what lets the call sites drop
 * their own "is it already this?" guards. Both take the origin from the control that was
 * pressed, so the circle grows out of the thing you touched.
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
 * The hero gate and the app scroller now live in `lib/appScroller.ts`.
 *
 * Neither touches GSAP, and this module registers GSAP and its plugins at module scope — so
 * importing either of them from here pulled the whole engine into the importer’s chunk.
 * `lib/scrollMemory.ts` and `lib/overlay.ts` are both mounted by the root layout, which is
 * how ~180KB of animation engine came to be on `/policy` to answer “which element scrolls”.
 *
 * Re-exported rather than moved-and-forgotten: this module’s own transitions consult
 * `heroOwnsScreen`, and call sites that want both a duration and the scroller keep one import.
 *
 * AGENTS.md: “The hero owns the same pixels. Every other transition stands down while a
 * flight is in progress.” Two things here could otherwise start on top of one: the theme
 * wipe, whose `startViewTransition` freezes rendering to capture a static frame of a flyer
 * that is still moving; and the tab shared axis, which sets `overflow-x: clip` on the very
 * scroller hosting the flight layer.
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
 * Swipe an open navigation drawer closed.
 *
 * Opening by edge-swipe was removed. A left-edge gesture is claimed by the
 * browser's own back-navigation on both iOS and Android, and every screen here
 * that you might swipe on — the image detail, a zoomed photo, a horizontally
 * scrolled chip row — sits under that same edge, so the drawer kept peeking out
 * mid-gesture. The menu button is the way in; this is only the way out.
 *
 * The drawer tracks the finger for the whole gesture rather than waiting for a
 * flick to complete: a drawer that only responds on release gives you no way to
 * change your mind halfway. On release it commits past 40% of its width, or on
 * a fast flick at any distance.
 *
 * During a drag the panel and scrim are driven inline with their CSS
 * transitions suppressed — the shell styles them with an all-properties transition
 * and a
 * `-translate-x-full` class, and leaving that in place would put 300ms of lag
 * between the finger and the panel. Both are handed back to CSS once the settle
 * tween lands, at which point the inline and class positions agree, so the
 * handoff is invisible.
 */
export function useDrawerSwipe({
  drawerRef,
  scrimRef,
  open,
  onOpenChange,
  enabled = true,
}: DrawerSwipeOptions) {
  /* `open` and `onOpenChange` are read through refs rather than declared as
     dependencies.

     `useGSAP` only tears its context down on unmount unless `revertOnUpdate` is
     set (see @gsap/react: `deferCleanup = dependencies.length && !revertOnUpdate`,
     and the effect returns a cleanup only when that is false). So a dependency
     that flips on every drawer toggle added a *second* Observer to
     `document.body` while the first stayed alive — holding a captured
     `open === true` forever. Those survivors then read `pending = open && startX
     <= drawer().offsetWidth` as true for any horizontal drag beginning within
     a drawer's width of the left edge — most of a phone screen — computed
     `startOffset = 0`, and dragged the *closed* drawer into view. That is the
     "sidebar randomly flies out" report; the gesture itself can only close.

     With refs the dependency list is just `enabled`, so exactly one Observer
     exists at a time, and `revertOnUpdate` disposes it when that flips. */
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
       *  `contextSafe` throughout this hook: every one of these writes happens
       *  from an Observer callback, i.e. after useGSAP's own callback returned,
       *  so without it the inline transforms are invisible to `revert()` and a
       *  drag interrupted by an unmount would strand the panel mid-slide. */
      const place = contextSafe!((x: number) => {
        const d = drawer();
        if (d) gsap.set(d, { x });
        const s = scrim();
        if (s) gsap.set(s, { opacity: width > 0 ? (x + width) / width : 0 });
      });

      const begin = () => {
        const d = drawer();
        if (!d) return false;
        width = d.offsetWidth;
        if (width <= 0) return false;
        startOffset = openRef.current ? 0 : -width;
        active = true;
        // Suppress the class-level transitions for the duration of the drag.
        d.style.transition = 'none';
        const s = scrim();
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

        /* The drag itself is never gated — a direct manipulation is not an animation —
           so what a tier can affect is only the *release*. Off snaps to the committed
           end; reduced and standard both spring, because the finger has already put the
           panel most of the way there and cutting the last few pixels reads as the
           gesture being dropped rather than as less motion. */
        if (!d || motionTier() === 'off') {
          release();
          return;
        }

        const target = toOpen ? 0 : -width;
        /* The panel's own springs, the same ones the tap-driven transition uses:
           `DefaultSpatial` on the way open and `FastEffects` on the way shut, which
           is what `NavigationDrawer.kt` assigns to `openMotion` / `closeMotion` —
           and it assigns `DefaultSpatial` to `anchoredDraggableMotion`, the release,
           as well. A gesture and a tap on the same object must not land differently.

           No velocity scaling any more, and dropping it is the fix rather than a
           simplification. It read `clamp(0.16, DURATION.short, remaining / 1200)`,
           which is a *duration* scaled by distance — 160ms is off M3's scale, and
           scaling a duration is what you do when you have no physics: a spring
           already covers a shorter remaining distance in less time, because that is
           what a mass on a spring does. Scaling its clock as well double-counts. */
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

      /* Kill the Observer **and** undo the two raw style writes `begin()` makes.
         `context.revert()` cannot: `transition: none` and `pointer-events: none` are
         set through `element.style` rather than through GSAP, so GSAP does not know
         they exist. The leak was reachable — `enabled` flips at the `md` breakpoint,
         so rotating a tablet mid-drag tore the Observer down and left the drawer
         with `transition: none` and the scrim with `pointer-events: none` for the
         rest of the session: a drawer that snaps instead of sliding, and a scrim
         that has stopped catching the tap that closes it. */
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
 * `useStaggerGrid` here and `<Reveal>` (components/Reveal.tsx) are the two, and
 * both play on mount. There is no scroll-driven reveal: `useScrollReveal` lived
 * here, had zero call sites for its entire existence, and was the only consumer
 * of GSAP's ScrollTrigger — so it and the plugin were removed together rather
 * than kept as a documented no-op that cost every route ~40KB.
 *
 * If a below-the-fold reveal is ever wanted back, it does not need ScrollTrigger:
 * an `IntersectionObserver` with the app scroller as `root` is a dozen lines, and
 * `components/PicDetail.tsx` already has two of them. The constraints worth
 * carrying over are that it must never wrap a gallery card (it parks targets at a
 * `y` offset, and the hero flight reads `getBoundingClientRect` on press) and
 * never sit inside a tab pane whose content swaps (the pane transition already
 * animates the same nodes' `autoAlpha` and `y`).
 * ------------------------------------------------------------------------ */

/** Distance an entering element travels, px. Small on purpose: a long throw
 *  reads as decoration, a short one reads as the content settling. On the 4dp
 *  grid, like every other distance in the app — it was 18, which is not a step
 *  and did not match `useStaggerGrid`'s 14 either, so the app's two entrance
 *  helpers rose by different amounts. */
const REVEAL_SHIFT = 16;

/**
 * Cascade for grid/masonry children, played on mount rather than on scroll.
 *
 * The masonry grid faded in as one block, so 40 cards arrived as a single
 * rectangle. Staggering reads as the grid filling in instead.
 *
 * Order is by *visual* position, not DOM order. A masonry layout is built
 * column by column — each card goes to whichever column is shortest — so the
 * DOM sequence is "all of column 1, then all of column 2". Staggering over that
 * sweeps the grid one column at a time, which is not how anyone reads it.
 * Sorting by row band and then by x makes the cards arrive one after another
 * left to right, top to bottom.
 */
/** Rows are banded before sorting: masonry cards on the same visual row rarely
 *  share an exact `top`, and comparing raw values would zig-zag between them. */
const ROW_BAND_PX = 48;

/**
 * The ref is a **parameter**, not something this creates.
 *
 * **Whatever renders this must be a *sibling after* the ref'd element, never a child of it.**
 * React attaches a parent's ref only after its children's layout effects have run, so a component
 * rendered *inside* the grid reads `ref.current === null` on the commit that mounts them together
 * — which is every commit, once `warmMotion()` has made the engine resident before first paint.
 * `MasonryGrid` did exactly that, and the failure was silent in the worst way: the mount pass
 * returned early, nothing re-ran it (no dependency changes when a ref attaches), and the first
 * pass that ever found a root was a **page turn**. So the gallery had no entrance on load at all,
 * and the cascade the user did see was the one meant for the mount, played with the viewport at
 * the bottom of the grid. Measured: `no-root cards=50` at 543ms, then nothing until the click.
 *
 * `lib/motionLazy.tsx` mounts this from a child component that only exists once GSAP has
 * arrived — and a ref created here would not exist during the renders before that, when the
 * caller already has to attach one to its grid. So the caller owns the `useRef` and this owns
 * the animation. The old `useStaggerGrid(selector, deps)` shape is gone rather than kept as a
 * wrapper: two ways to call one hook is how the `lean` default came to disagree with itself.
 */
export function useStaggerGridOn<T extends HTMLElement = HTMLElement>(
  ref: RefObject<T | null>,
  selector: string,
  deps: unknown[] = [],
): void {
  // Reactive for the same reason as `useScrollReveal`: this re-runs on every
  // page of results, so a preference changed mid-session still has work to skip.
  const tier = useMotionTier();
  const entrances = useEntranceMotion();
  /**
   * Once per mounted grid, not once per page of results.
   *
   * The cascade parks every card at `autoAlpha: 0` and reveals them in visual order, top to
   * bottom, over as much as 0.9s of stagger. That is right for a grid *arriving*. On a page turn
   * it is wrong twice over, and the second one is what made the screen blank:
   *
   *  - `Pagination` glides the scroller to the top of the list, so the viewport starts at the
   *    **bottom** of the grid — where the cards are **last** in the cascade order. Every card the
   *    user is actually looking at was therefore held invisible for the full stagger, and content
   *    appeared only as the glide climbed into the part that had already been revealed. On an
   *    already-cached page the rows are present in the first frame, so the whole delay is spent
   *    hiding content that was ready.
   *  - A page turn is a content *replacement* inside a grid that never left the screen. The
   *    motion carrying it is the glide; a second entrance on top is the "动画重叠" failure this
   *    file names elsewhere, not extra polish.
   *
   * A breakpoint reflow no longer replays it either, and that is the same argument: a resize is
   * not an arrival. `deps` is still the full list because the *early return* has to re-evaluate —
   * a grid that mounted empty and then received rows has to cascade when they land, which is why
   * the latch is set after the `items.length` check rather than before it.
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

      const rootTop = root.getBoundingClientRect().top;
      const ordered = items
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { el, band: Math.round((r.top - rootTop) / ROW_BAND_PX), x: r.left };
        })
        .sort((a, b) => a.band - b.band || a.x - b.x)
        .map((m) => m.el);

      /* Reduced halves the rise and drops the cascade and the scale. The cascade is what
         costs a tween per card on a device that cannot afford 100 of them, and the scale is
         the flourish; the rise is what says "arriving". `scale` has to be absent from
         *both* ends rather than set to 1 at both: a card mid-tween would otherwise carry an
         identity transform, and a transform on a card is exactly what the hero flight
         measures on press. */
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

      // A transform on an ancestor shifts `getBoundingClientRect` for
      // everything under it, and the hero flight reads exactly that off a card
      // the moment you press it. Snapping to the end state on pointerdown means
      // a card can never be measured mid-cascade — and a press during the
      // cascade feels answered rather than ignored.
      const settle = () => tween.progress(1);
      root.addEventListener('pointerdown', settle, { capture: true });
      return () => root.removeEventListener('pointerdown', settle, { capture: true });
    },
    // `revertOnUpdate`: the `pointerdown` listener below is removed by the
    // returned cleanup, which useGSAP otherwise defers to unmount. Every page
    // turn was therefore leaving another capture-phase listener on the grid,
    // each one calling `progress(1)` on a long-dead tween on every card press.
    { scope: ref, dependencies: [selector, tier, entrances, ...deps], revertOnUpdate: true },
  );

}

/* ---------------------------------------------------------------------------
 * Shared axis — Material 3, and one plane rather than two layers
 *
 * The old model was sequential and therefore had a hole in it: the tab bar
 * played a 200ms exit, waited for it, *then* pushed the route, and only once
 * that committed did the incoming panel start its own 500ms enter from
 * `autoAlpha: 0`. Between the two the outgoing panel was already transparent
 * and the incoming one had not begun — at least 200ms of empty page, plus
 * whatever the commit cost. That gap is the "blank flash when switching between
 * the gallery and the forum".
 *
 * **The two sides are laid end to end and the strip is what moves.** The
 * incoming side starts a whole window-width away — not the spec's 30dp — so at
 * every instant the two are exactly adjacent: outgoing at `-d·p`, incoming at
 * `d·(1-p)`, always `d` apart, which is the width of the window they are
 * sliding past. Neither is ever painted over the other, because there is
 * nowhere for them to be painted over each other; the window clips whatever is
 * outside it. When half the outgoing card has left, exactly half the incoming
 * card has arrived.
 *
 * That is why there is no cross-fade here any more. M3's shared axis pairs a
 * 30dp nudge with an opacity handoff, and an opacity handoff *is* two layers
 * stacked — for the length of the fade both sides occupy the same pixels, which
 * is precisely what read as "a layer sliding up from the right". A 30dp nudge
 * cannot carry the movement on its own, so the two go together: full travel,
 * no fade. This is a deliberate divergence from the spec's numbers in service
 * of the thing the spec is describing.
 *
 * **The cascade is a lean, not a queue.** A block's delay is a continuous
 * function of its height on screen, identical on both sides, so at any given
 * height the block leaving and the block arriving are on the same beat and the
 * pair is exactly one window apart there. What the eye reads is the seam
 * between the two pages leaning over, top leading, and sweeping across.
 *
 * The delay has to be small, and it has to be continuous. Small, because at a
 * full window of travel peak velocity is an order of magnitude higher than at
 * the spec's 30dp, so ten milliseconds of lag is already a hundred pixels of
 * shear — the same 50ms-per-band that read as a gentle ripple under a nudge
 * tears the page into strips under a slide. Continuous, because a stepped
 * delay puts two cards two pixels apart vertically a whole step out of phase,
 * which is a visible rip through content that belongs together; with a
 * continuous one, anything close enough to overlap is close enough to be in
 * phase, and anything far enough out of phase is too far apart to overlap.
 *
 * The stagger axis must stay *perpendicular* to the motion axis, though. Blocks
 * translating sideways may be delayed by height, because a horizontal band is
 * rigid whatever its neighbours do. Blocks translating vertically may not: that
 * stretches the column instead of shearing it. `axis: 'y'` therefore moves as
 * one block.
 *
 * And nothing waits for the router: both panes are already mounted, so the
 * transition only needs the *attribute* that gives the incoming one a box —
 * which this owns. The route commit that follows is a visual no-op.
 * ------------------------------------------------------------------------ */

/**
 * How far the bottom of the window lags the top, as a fraction of the span.
 *
 * Read it as a shear, not as a wait: the lean the eye sees is the lag times the
 * curve's peak slope, so this number only means something paired with a curve.
 * `emphasized` peaks at 10.06 against `standard`'s 4.05 — 2.49x — so carrying
 * the old 0.07 across to it would have leaned the seam by 0.7 of a whole window
 * and torn the page in half. 0.032 lands the peak lean at about 0.32 of a
 * window, a touch more than the 0.283 the previous pairing gave: measurably
 * more wave, from a curve that is also faster through the middle.
 *
 * That is the whole budget. Doubling it does not double the sense of a wave; it
 * starts to look like two pages moving independently, and by the time the lean
 * approaches a full window the top of the page has finished before the bottom
 * has started, which is a shredded page rather than a dragged one.
 */
const AXIS_LAG = 0.032;
/**
 * Extra plate between the two pages, px, on top of whatever the layout gives.
 *
 * The window the pages slide past is the scroller — sidebar edge to screen
 * edge — and the content column is centred inside it, so the two side margins
 * are already empty space between the outgoing page and the incoming one. That
 * is most of the answer, and it is the right answer: the pages sit one window
 * apart on the strip and their content is centred in its own window, exactly as
 * a paged carousel does it. This is the floor under it, for the phone layout
 * where the column fills the window and those margins are nearly nothing.
 *
 * Setting it to 0 makes the two pages touch, which is what the first version
 * did by using the *column's* width as the travel. Edge to edge with no plate
 * between them reads as one page shoving the other rather than as two pages on
 * a strip.
 *
 * 24 was the floor and read as crowded: at 1280px the visible plate was 136px,
 * about a tenth of the window, so the two pages still passed each other close
 * enough to feel like one shoving the other. 96 puts it at roughly 208px — a
 * plate you can see rather than a seam — and costs 7% more travel, which is
 * inside the noise of a 400ms move.
 *
 * A delay on the incoming side would also open a gap, and was considered. It is
 * the wrong mechanism: the plate would then stretch and close over the run, so
 * the strip reads as elastic instead of rigid. A paged carousel's pages are a
 * fixed distance apart, and that fixity is what sells them as one surface.
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
 *
 * Enough to carry the *direction* of the move and short enough not to read as a slide —
 * the same 24dp M3's own shared axis uses for its small-container form, and the same order
 * as the 8px an entrance travels here. The point of keeping any distance at all is that a
 * cross-fade cannot say which way you went, and on a tab bar that is half the information.
 */
const REDUCED_AXIS_SHIFT_PX = 24;

export interface SharedAxisHandle {
  /** Jump to the end state and run the settle callback. Idempotent. */
  finish(): void;
}

/**
 * A complete partition of the pane into blocks that will be moved.
 *
 * "Complete" is the load-bearing word. This used to be
 * `querySelectorAll('[data-tab-row]')`, which moves the featured banner, the
 * cards and the forum posts and leaves *everything else* — the masonry
 * container, the pagination anchor, the loading skeletons, an error block, the
 * forum list's "暂无帖子" — sitting at rest for the whole slide, only to be
 * hidden when the pane is finally taken out of layout. That is the sliver of
 * the old page you could see hanging around after a switch. Under a 30dp nudge
 * an unmoved element is indistinguishable from a moved one; under a
 * window-width slide it is the only thing still on screen.
 *
 * So: descend only through elements that *contain* a marked row, and take
 * everything else whole. Every element in the pane then ends up inside exactly
 * one block, marked or not, and the markers only decide how finely the wave is
 * sampled — they can never decide whether something moves at all.
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
 * One map for both panes — that is the whole mechanism. Because the delay
 * depends only on `top`, a block leaving at y=400 and a block arriving at y=400
 * are on the same beat; give them the same curve and the same distance and the
 * pair sits exactly one window apart for the whole run. Any input other than
 * height decouples them and the switch stops being one surface.
 *
 * Two earlier versions got this wrong in opposite directions. The first
 * measured each pane separately and then *ranked* the bands that pane happened
 * to occupy, so a 350px gallery card and a 112px forum row at the same height
 * were ranked 1 and 3 and set off 100ms apart — a layer sliding up from the
 * right, not a plane. The second shared the map but kept the banding, so
 * neighbours either side of a 140px boundary tore apart by a whole step.
 * Height, continuously, is the only input that has neither failure.
 *
 * Measured against the viewport rather than the pane: a pane scrolled to its
 * middle would otherwise have every visible block deep in the count and already
 * capped, flattening the wave to nothing exactly when there is most to show.
 * Capped at one viewport for the same reason in the other direction — below the
 * fold the lag is invisible and would only stretch the timeline. Measured once,
 * up front, so every tween agrees and nothing depends on when GSAP happens to
 * evaluate the stagger.
 *
 * The height is quantised to `AXIS_ROW_BAND` first, which is not a return to
 * banding — the quantum is on the *input* and it is small. A masonry column
 * places each card under the shortest neighbour, so cards that read as one row
 * have tops tens of pixels apart and, under a purely continuous delay, set off
 * at visibly different moments; the row stops looking like a row. Rounding to
 * 64px puts them on one beat, and the worst case at a boundary is 64/viewport
 * of the lag — about 17px of shear where the old 140px steps were worth 50ms.
 *
 * Returns the near-viewport subset alongside, because that is the only place
 * worth spending a compositor layer: promoting all seventy blocks of a gallery
 * cost more in setup than the wave is worth, and the fifty-odd below the fold
 * are never seen moving.
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
 * Slides `leaving` out and `entering` in along one axis as a single plane, band
 * by band.
 *
 * Both elements must already have a box — see the grid rules for
 * `[data-tab-panel]` in globals.css, which stack the panes in one cell so the
 * row height is `max(outgoing, incoming)` and the scroller's height can only
 * grow while the transition runs.
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
   * Sample the wave over the pane's own blocks. Requires that those blocks
   * survive the run — true of the tab panes, which are mounted once and only
   * marked, and false of a route change, where React is replacing the whole
   * subtree behind us.
   *
   * **Off by default, and this is the third default the option has had.** It was
   * `true` here and in `runTabTransition` while `TabPanes` and `useTabPanes` said
   * `false`, so the tab bar's *tap* path — `startTabTransition`, which passes four
   * arguments and therefore takes the parameter default — ran the lean on the home
   * page while the reactive path did not. One option, one default: `false`, and a
   * screen that wants it says so at *both* of its call sites.
   *
   * Two screens opt in: `/policy`, whose four prose panes are static once mounted,
   * and the home page's gallery↔forum switch (`app/page.tsx` for the reactive path,
   * `AppLayout`'s `startTabTransition` argument for the tap path). The home one is safe
   * because the forum pane is mounted ahead of the tap on an idle callback, so by the
   * time you press it holds its rows rather than a skeleton it is about to replace.
   * `/messages` is the counter-example and must stay without it.
   *
   * The frame-rate cost of the lean is real and is paid where it belongs: sixteen to
   * forty inline transforms and promoted layers per frame on a 50-card gallery, against
   * two. What made that unaffordable was not the count but the `height` tween that used
   * to run on `[data-tab-panel]` at the same time — a layout pass per frame on the
   * ancestor of every one of those promoted cards. That is gone (see step 4 of
   * `runTabTransition`), and the lean stays.
   */
  lean?: boolean;
  onSettle?: () => void;
}): SharedAxisHandle {
  const { leaving, entering, axis = 'x', direction, leavingOffsetY = 0, onSettle } = opts;

  /* No lean on the vertical axis (it would stretch the column rather than shear
     it), and no lean where the blocks are not stable — a route's incoming page
     re-renders as soon as its data lands, which detaches every block GSAP is
     holding and leaves the new ones sitting at rest. Measured: the outgoing
     clone slid the whole way while the incoming page simply appeared. Without a
     lean there is nothing to sample, so the whole side moves as one element,
     which is also the only node a re-render is guaranteed not to replace.

     **It was briefly disabled below `md` as a frame-rate measure and that is reverted.** The
     reasoning was sound on paper — the lean gives every near-viewport block its own tween and
     its own transformed layer, against two without it — and it bought nothing measurable on the
     device that was dropping frames, while the shear is the visible thing the lean exists for.
     A cost reduction that does not reduce the cost is just a loss. The blurs were the real item,
     and they are gone from `Badge`'s `media` tone rather than suppressed per transition. */
  const lean = (opts.lean ?? false) && axis === 'x';
  const outAll = lean ? paneBlocks(leaving) : [leaving];
  const inAll = lean ? paneBlocks(entering) : [entering];
  /** The travel, as a vars object on whichever axis this run is using. */
  const travel = (value: number) => (axis === 'x' ? { x: value } : { y: value });

  /* The window the strip slides past is the *scroller*, not the pane.
   *
   * That distinction is the whole of how this reads. The pane is the centred
   * `max-w-7xl` column; the scroller runs from the sidebar's edge to the screen's.
   * Travelling one column width put the incoming page's leading edge at the
   * column's own boundary, so it appeared out of the middle of the page rather
   * than in from the side — and made the travel exactly equal to the column's
   * width, which laid the two pages edge to edge with no plate between them.
   * Travelling one *window* width fixes both at once: the pages enter and leave
   * at the edges of the content area, and because each one is centred in its own
   * window, the side margins become the gap. */
  const view = getAppScroller();
  const box = entering.getBoundingClientRect();
  const window_ = axis === 'x' ? view?.clientWidth || box.width : view?.clientHeight || box.height;
  const distance = opts.distance ?? window_ + AXIS_GAP;

  /* Only what can be seen actually moves.
   *
   * A gallery pane is 3300px of masonry and the window shows 900 of it, so of
   * the seventy blocks a complete partition produces, some fifty-five are below
   * the fold for the whole run. Animating them bought nothing and cost a great
   * deal: seventy compositor layers and seventy inline transforms rewritten
   * every frame, all of it inside the tap handler — measured as a 62ms long
   * task before the first frame could paint.
   *
   * Leaving them at rest is not a residue, which is the trap the other
   * direction of this fell into. A residue is something *visible* that fails to
   * move; a block a thousand pixels below the viewport is neither seen at rest
   * nor seen moving, and it ends where it began, which is exactly where the
   * settle would have put it. The margin covers a scroll landing slightly
   * differently than measured.
   *
   * The partition still has to be complete, though — `near` is filtered out of
   * it rather than gathered independently, so anything on screen is in it by
   * construction rather than by having been marked. */
  /* `emphasized` wants room for its tail — it spends the last two thirds of the
     clock covering the last few per cent of the distance, and squeezed into the
     400ms `long` that read as an abrupt stop rather than a settle. 500ms is
     also what the spec gives a large container transform. */
  const span = DURATION.emphasized;

  let settled = false;
  /* Declared before `finish` closes over it: the reduced-motion path returns
     before a timeline is ever built, so a `const` declared afterwards would be
     in the temporal dead zone when the queued microtask fired. */
  let timeline: gsap.core.Timeline | null = null;

  const finish = () => {
    if (settled) return;
    settled = true;
    timeline?.kill();
    view?.removeAttribute('data-axis-running');
    /* Nothing may keep a transform. `lib/hero/dom.ts` only compensates for a
       transform on `[data-image-detail-background-visual]`, so a residual one
       on a row — an ancestor of every gallery card — would silently corrupt the
       rect the hero flight reads on press. `clearProps`, never
       `translate3d(0,0,0)`: the latter still leaves `transform !== 'none'`.
       Over every block, not just the animated ones: a run interrupted by
       another may have left an offset on a block this run decided to skip. */
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

  /* Reduced: the panes cross-fade with a short shift instead of sliding a window's width.
   *
   * This is the tier's rule applied to the biggest gesture in the app. What gets dropped is
   * the *distance* and the wave: a full-window slide is the performance, and the wave is a
   * transform per block per frame on a device that has told us it cannot afford them. What
   * survives is direction — 24px is enough for the eye to read "the next one came from the
   * right" — so the gesture still says which way you moved, which a bare cross-fade cannot.
   *
   * `leavingOffsetY` is still applied, as a `set` rather than a tween. It is not travel:
   * `runTabTransition` has already moved the scroller to the destination tab's remembered
   * offset, and this holds the outgoing pane over the pixels the eye was on so it fades
   * from where it was rather than from wherever the new offset put it. */
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
     anything is offset, so no frame can paint a page hanging outside it or, on
     the horizontal axis, hand the scroller something to scroll sideways.
     Callers always settle the previous run before starting the next, so the
     attribute cannot be cleared out from under a live one. */
  view?.setAttribute('data-axis-running', axis);

  /* The outgoing pane's compensating offset is accounted for BEFORE anything is
     measured — arithmetically, not by writing it first.
     `runTabTransition` restores the destination tab's own scroll position while
     both panes are still in place, then hands us `leavingOffsetY` to hold the
     outgoing pane over the pixels the user was actually looking at. Measure
     without it and every rect on that side is wrong by the whole jump: leave a
     gallery scrolled to 1200 for a forum remembered at 0 and the scroller is
     already back at the top, so the wave sees the gallery's first screen as the
     visible one and the cards actually under the user's eyes as 1200px below the
     fold — outside `near`, and therefore left at rest for the entire slide. That
     was the "scroll down, switch, and the pictures don't move" report; it did
     not show on the way back because the pane returning to a remembered offset
     is the one being measured correctly.
     Passing the shift to `planWave` rather than writing the transform and
     re-reading keeps this to a single forced layout: every read below happens
     before the first write. */
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

  /* The start state is written SYNCHRONOUSLY, before the timeline exists.
     A `.set()` inside a timeline is rendered on GSAP's next rAF tick, but the
     caller has just flipped `data-tab-pane-entering`, which gives the incoming
     pane a box immediately — so there was a window of one frame in which it
     painted on top of the outgoing one. That is the flash. Nothing needs an
     opacity guard: at `direction * distance` the incoming rows are a whole
     window away and the clip has already hidden them. */
  gsap.set(leaving, { y: leavingOffsetY });
  gsap.set([...outRows, ...inRows], { willChange: 'transform' });
  gsap.set(inRows, { ...travel(direction * distance), force3D: true });

  /* `overwrite: false` — the default is `'auto'`, which makes tweens that share
     a target and a property kill each other. Every tween below is deliberate
     and non-conflicting, and an earlier version of this that relied on a
     `fromTo` for the incoming pane's start offset had that offset silently
     killed by the `to` beside it, so the incoming rows never moved at all.

     `paused` — see the `play()` below. */
  timeline = gsap.timeline({ paused: true, defaults: { overwrite: false, force3D: true } });

  /* One clock, one curve, one delay function, two tweens.
   *
   * `delay` is measured across BOTH sides' blocks at once, so a block leaving
   * and a block arriving at the same height are on the same beat. Everything
   * else is already symmetric — same duration, same curve, equal and opposite
   * offsets — so at every height the pair stays exactly one window apart. Give
   * the two sides separate delay functions and it degenerates into a layer
   * arriving on top of another layer, which is what it used to do.
   *
   * `emphasized`, not `spring`. A back-eased overshoot would carry the incoming
   * side past its resting place, and since the two are adjacent rather than
   * stacked, "past" means a strip of bare panel appearing at the trailing edge.
   * Overshoot is only free when something else is underneath — emphasized gets
   * the same sense of thrown weight from its front loading instead, and never
   * leaves the plate. It replaced `standard`, whose near-constant middle was
   * what made the switch read as a rigid plate being pushed rather than
   * released. */
  timeline
    .to(
      outRows,
      { ...travel(-direction * distance), duration: span, ease: 'emphasized', stagger: delay },
      0,
    )
    .to(inRows, { ...travel(0), duration: span, ease: 'emphasized', stagger: delay }, 0);

  timeline.eventCallback('onComplete', finish);

  /* Started here, in the tap handler, not on the next animation frame.
   *
   * The rAF deferral this replaces was there because `router.push` used to run
   * on the very next line, and its commit blocked the main thread for ~80ms —
   * a timeline already running is charged for that, so the first frame the user
   * saw was a quarter of the way in. The push is now held back past the end of
   * the slide (`TAB_PUSH_COALESCE_MS`), so there is no stall left to defer past,
   * and `lagSmoothing` above still covers anything unexpected.
   *
   * What the deferral cost, meanwhile, was a whole frame every time. GSAP's own
   * ticker rAF is registered long before ours, so it runs first: `play()` landed
   * after the tick for the current frame and the first rendered progress was the
   * frame after that. Playing synchronously dates the timeline from the previous
   * tick instead, so the very next frame already carries a few percent of the
   * travel. Measured tap-to-first-visible-movement over 20 switches: median
   * 40ms before, 28ms after.
   */
  if (!settled) timeline.play();

  return { finish };
}

/* --- tab wiring ---------------------------------------------------------- */

type TabRun = { panel: HTMLElement; to: string; finish(): void };
let activeTabRun: TabRun | null = null;


/**
 * Records the tab being left and lands on the one being entered, and it is the whole of
 * the scroll behaviour of a tab switch.
 *
 * Extracted so the reduced-motion path can reach it. Under that preference
 * `startTabTransition` returned before any of this and `useTabPanes` bailed too, so the
 * panes swapped via `display: none` and the browser clamped `scrollTop` to whatever the
 * arriving pane's height allowed — a nondeterministic jump on every switch, for the users
 * least able to absorb one. A scroll position is state, not decoration; the preference asks
 * for less movement, not for less positioning. So the animated path and the reduced path
 * share this, and the reduced one simply applies it and stops.
 *
 * Returns the scroller and how far it moved, which is what the animated path needs to hold
 * the outgoing pane over the pixels the user was looking at.
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
  /* Saved here rather than only in `startTabTransition`, so that the memory is
     kept by *every* way of changing tab. The tab bar saved it; a sidebar
     `<Link href="/?tab=forum">`, the back button and the `/forum` redirect all
     arrive through `useTabPanes` instead and used to restore the destination's
     offset without ever recording the one they were leaving. Switching with
     the tab bar therefore came back to where you were and switching with the
     sidebar came back to the top — the same control, two behaviours. */
  rememberTabScroll(panel, from, before);
  // Reading scrollHeight here forces the reflow the pane flags need.
  const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  /* …but `max` is the height with BOTH panes mounted, and the row is a grid
     cell as tall as the taller of the two. At settle the leaving pane is
     taken out of layout, the page shrinks to the entering pane's height, and
     the browser clamps `scrollTop` to whatever is left — with no animation,
     in one frame, right at the end of the switch. Leave a tall gallery for a
     forum that is still loading and it clamped 44 to 0: the page visibly
     snapped backwards just as the slide finished. That is the "switching
     between gallery and forum still jumps back".
     So the target is clamped against the height the page *ends* at. `max` was
     read with both panes boxed, i.e. at `max(H_out, H_in)`, and that minus
     `H_in` is `max(0, H_out − H_in)` — so this is exact rather than a bound,
     and it only clamps when the destination pane is the shorter one. It used
     to subtract `|H_out − H_in|`, which also clamped when the destination was
     *taller*: the page ends up taller there, so there was nothing to clamp
     against and a remembered offset was being thrown away for nothing. */
  const finalMax = Math.max(0, max - Math.max(0, leaving.offsetHeight - entering.offsetHeight));
  /* Whether this screen may restore at all, and it is a property of the *screen* rather than
     of the scroll position — which is what makes it predictable.
     `panelTop` is how much shared chrome sits above the panel: the distance from the top of
     the scroller's content to the panel's own top edge. On the home route that is the page
     gutter and nothing else, because the tab pill is fixed chrome outside the scroller, so the
     panel effectively *is* the page and moving the scroller moves only the thing being
     switched. On a profile it is the banner, the name, the level bar and the tab row — some
     660px of content that both tabs share, and restoring the destination's remembered offset
     drags all of it: scroll down through 历史评论, switch back to 上传记录, and the page snapped
     to wherever 上传记录 had been left. That is the reported jump.
     So a screen whose panel carries real shared chrome above it is left where it is — only
     `finalMax`'s clamp can still move it — and a screen whose panel is the page keeps the memory
     that makes leaving the gallery for the forum and coming back land on the same row. The
     threshold is the app bar's own 64dp, which is the smallest piece of chrome this design
     system treats as a region. */
  const mayRestore = tabPanelTop(panel, scroller) <= TAB_SHARED_CHROME_PX;
  /* No memory for the destination, and the answer depends on the same thing `mayRestore` does.
     It used to scroll to put the tab bar at the top of the scrollport, which is fine on the home
     page — the bar is near the top of the document — and wrong on a profile, where it sits below a
     tall header card, so a first visit to a tab jumped *down* to find it. Worse, a short
     destination pane makes `finalMax` small, so that downward target clamped straight to the
     bottom of the page: switching to 上传记录 or 收藏夹 landed at the end of the list.
     "Stay where you are" replaced it, and on a screen with shared chrome that is right — the
     header does not move, so neither should the page. On a screen whose panel *is* the page it is
     the same bug wearing the other face: leave the gallery at 1500, switch to a forum whose whole
     content is 1708, and `finalMax` is 1160 — so the carried-over offset clamps to exactly the
     bottom and the forum opens on its last row. Measured at 1440x900 with the tab bar.
     A tab that has never been opened starts at its own beginning, which is what a list you have
     not seen should do, and there is nothing above the panel to lose by going there. */
  const remembered = mayRestore ? recallTabScroll(panel, to) : undefined;
  const fallback = mayRestore ? 0 : before;
  const next = Math.min(remembered ?? fallback, finalMax);
  // Scroll anchoring would "correct" a deliberate jump; same guard as runScroll.
  scroller.style.overflowAnchor = 'none';
  scroller.scrollTop = next;
  return { scroller, offsetY: next - before };
}

/**
 * The off tier's half of the same behaviour, applied *after* the commit.
 *
 * Under that tier the panes swap through `display: none` rather than sliding, so there is
 * no run to hold an offset across and `applyTabScroll`'s prediction of the settled height is
 * unnecessary: at the moment this runs the arriving pane is the only one with a box, so
 * `scrollHeight` is already final and the clamp is the browser's real maximum. What it does
 * keep is the *screen* test, and that is not arithmetic — a profile has 697px of shared chrome
 * above its panel, so restoring there drags the banner, which is the jump this whole rule
 * exists to stop. Leaving it out would have made that jump reachable by turning the preference
 * on, which is the population least able to absorb one.
 *
 * (It was named `applyReducedTabScroll` and only ever reached from the `off` branch, which is
 * the kind of name that sends the next reader looking for a second caller.)
 *
 * **What it can restore is bounded by who records.** The origin's offset is written by
 * `applyTabScroll` (every animated run, tap or reactive) and by `startTabTransition` (the tap
 * path, before its reduced-motion bail). So under the preference a screen whose tabs are
 * reached through the tab bar remembers both directions — the home route, which is the one
 * screen the test above lets restore anyway — while a tab reached only by a sidebar link or the
 * back button has nothing recorded and this returns at the `undefined` guard, leaving the
 * position exactly where the browser's clamp put it. The two limits coincide today; a future
 * screen with a low `panelTop` and no tap path would need a pre-commit hook the reactive path
 * does not have.
 */

/* The tab a panel has already been animated to.
 *
 * The switch is optimistic: it plays on the tap, well before `router.push`
 * resolves. If the destination's data is slow the commit can land *after* the
 * run has settled, and at that point `activeTabRun` is null — so the effect
 * below saw a plain `from -> active` change and played the whole thing a second
 * time. That is the "it animates again once loading finishes" replay. */
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

  /* A flight is mid-air: the axis run would set `data-axis-running` on the
     gallery scroller, which globals.css turns into `overflow-x: clip` — and a
     clip is a clip context for the absolutely-positioned flight layer inside it,
     so the flyer would be cut off for the whole run. Reachable from a history
     restore or a deep link committing during a slide; the tab pill's `inert` only
     covers the tap path. */
  if (heroOwnsScreen()) return false;

  activeTabRun?.finish();
  clearPaneFlags(panel);

  /* 1. Give both panes a box. They share one grid cell, so the row is now as
        tall as the taller of the two and can only shrink again at settle.
        `-animating` is separate from those two on purpose: it is the flag that
        freezes CSS transitions inside a pane, and it is cleared at settle,
        where `-entering` has to survive until the route commit lands. Fused
        into one flag, an incoming pane whose data was slow kept the freeze for
        as long as it took to load, so every hover inside it changed colour and
        elevation with no transition at all — the "hover effect but no hover
        animation" on a forum list that had not finished loading. */
  leaving.setAttribute('data-tab-pane-leaving', '');
  entering.setAttribute('data-tab-pane-entering', '');
  leaving.setAttribute('data-tab-pane-animating', '');
  entering.setAttribute('data-tab-pane-animating', '');
  /* Written here, with the flags, rather than after the measurements below: it is a
     style write, so putting it later would split what is otherwise one invalidation
     into two and force a second layout inside the pointer handler. `clip` does not
     create a scrollbox, so it changes nothing the measurements read. See step 4. */
  panel.style.overflowY = 'clip';

  /* 2. Restore the destination tab's own offset while the incoming pane is
        still invisible, and 3. pin the outgoing pane to the pixels the user was
        actually looking at, so step 2 is invisible on that side. */
  const { scroller, offsetY } = applyTabScroll(panel, from, to, leaving, entering);

  const settle = () => activeTabRun?.finish();

  /* 4. Nothing animates the panel's box, and that is the point.
     This used to pin `[data-tab-panel]`'s `height` to the leaving pane's and tween it
     to the entering pane's over the same 500ms as the slide, so the page's height
     changed with the motion rather than in one frame at the end of it. Two things
     killed it. The first is that the pin was doing nothing the layout was not already
     doing: the panel is a grid with both panes in one cell, both hold a box for the run
     (`-leaving` / `-entering`), so its natural height *is* the taller of the two — all
     the tween added was a forced shrink to `H_out` at the start, which is also the only
     reason it needed `overflow-y: clip`. The second is the cost: `height` on the
     ancestor of every gallery card is a layout pass per frame, and with `lean` on,
     sixteen to forty of those cards are promoted compositor layers that then re-raster.
     A layout property on this element is exactly what the motion section forbids.
     What it bought is invisible anyway. The only in-flow element below the panel on
     every screen that uses `TabPanes` is the shell footer, and `.page-chrome` is
     `opacity: 0` with `transition: none` for the whole transit — `endTransit()` runs in
     the same `onSettle` as everything else, so the footer's 400ms fade-in starts from
     the settled layout and it is never rendered at a pre-settle position. The content
     *above* the panel does not move, because the clamp against `finalMax` above
     guarantees the offset survives the shrink.
     Gone with it: `watchPaneGrowth`, a `ResizeObserver` that re-tweened the same
     `height` for 2.5s after settle to absorb late-arriving data. A late change is now an
     ordinary reflow, like every other data arrival in the app, and `restoreAnchor` puts
     `overflow-anchor` back at settle so a shrink above the viewport is absorbed by
     scroll anchoring. Skeletons still have to be the right length.

     What does survive is the clip, as two style writes instead of a tween. It is
     `overflow-y`, not `overflow`: this element is the centred `max-w-*` content column,
     so clipping both axes cropped the shared axis to the column and the incoming pane
     appeared out of the text's own edge instead of sliding in from the side of the
     content area. And the value is `clip` rather than `hidden` because CSS computes a
     `visible` sibling axis to `auto` beside `hidden`, which would make this a horizontal
     scroll container mid-slide; `clip` is the one value allowed to sit beside `visible`,
     so `[data-axis-running]` on the scroller keeps owning x. What it is *for* is
     `leavingOffsetY`: the outgoing pane is translated by the difference between the two
     tabs' remembered offsets, which can be most of a screen, and without the clip it
     paints over the footer for the length of the run. It used to be applied only when
     the two panes' heights differed by more than a pixel, since it came in with the
     height pin — so the case it exists for was the one case it could miss. */

  /* The footer rides inside `[data-page-content]` and so travels with every
     route change on its own. A tab switch is the exception — the panes that
     slide are *inside* the page, above it — so this is the one caller that
     still has to ask it to step aside. */
  const endTransit = beginPageTransit();

  /* Belt and braces on the scroll-anchoring guard: `onSettle` restores it, but
     a run whose panes are unmounted mid-flight would never reach that, and
     leaving `overflow-anchor: none` on the app scroller silently disables
     anchoring for the rest of the session. The clip goes with it, and for the same
     reason: a residual `overflow-y: clip` on an ancestor of every gallery card would
     crop anything a pane opens afterwards. */
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
      /* The route may still not have committed, in which case React is *also*
         still marking the outgoing pane active — and `clearProps` has just
         restored it to full opacity. `-done` holds it out of layout until the
         commit lands and `useTabPanes` clears every flag. Without this the old
         page reappears on top of the new one at the end of the transition. */
      leaving.setAttribute('data-tab-pane-done', '');
      leaving.removeAttribute('data-tab-pane-leaving');
      /* GSAP is no longer driving either pane, so the transition freeze comes
         off now — not at the next React commit, which may be a whole data fetch
         away. */
      leaving.removeAttribute('data-tab-pane-animating');
      entering.removeAttribute('data-tab-pane-animating');
      restoreAnchor();
      panel.removeEventListener('pointerdown', settle, { capture: true });
      if (activeTabRun?.panel === panel) activeTabRun = null;
    },
  });

  /* Same reason as the masonry cascade: these rows are ancestors of every
     gallery card, and `useHeroLink` measures a card during the click that
     follows this press. Snap to rest rather than be measured mid-slide. */
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
 * Starts the switch on the tap, before the route.
 *
 * Both panes are mounted, so this hands the incoming one a box directly and the
 * commit that follows only has to agree with what is already on screen.
 *
 * **Hold the `router.push` back past the end of the slide** —
 * `TAB_PUSH_COALESCE_MS`. An RSC navigation lands as a commit, and in the middle of
 * the swap that is a dropped frame; nothing is waiting for the URL, because the
 * optimistic tab state owns what is on screen. It also swallows a run down the
 * sidebar into one push rather than one history entry per tab passed through.
 * This used to say "call it on the very next line — there is nothing to wait for",
 * which was true before the coalescing window existed and is what the note at
 * `playSharedAxis` has said since.
 */
export function startTabTransition(
  from: string,
  to: string,
  direction: 1 | -1,
  /* Passed explicitly rather than left to the parameter default. It defaulting to `true`
     here while `TabPanes` defaulted it to `false` is what made the tap path and the
     reactive path disagree; the tap path now says what it wants and the panes say the
     same thing at their own call site. */
  lean = false,
): void {
  if (from === to) return;
  const panel = document.querySelector<HTMLElement>('[data-tab-panel]');
  if (!panel) return;
  /* Recorded before the tier check, and keyed on the panel, so the two writers
     agree. It used to be `tabScrollMemory.set(from, …)` above the panel lookup, i.e. a
     flat key written before the thing that scopes it was even in hand. */
  const scroller = getAppScroller();
  if (scroller) rememberTabScroll(panel, from, scroller.scrollTop);
  /* Only `off` returns here. `reduced` runs the transition, which cross-fades the panes
     instead of sliding them — that branch is inside `playSharedAxis`, and `lean` is
     ignored there, so passing it through is harmless. */
  if (motionTier() === 'off') return;
  runTabTransition(panel, from, to, direction, lean);
}

/**
 * Reactive fallback, and the owner of the motion flags' lifetime.
 *
 * Covers every way of reaching a tab that does not go through the tab bar:
 * back/forward, a sidebar `<Link href="/?tab=forum">`, the `/forum` redirect, a
 * deep link. If the tap already started this exact transition it adopts it
 * rather than restarting.
 *
 * `lean` samples the wave over the pane's own blocks, and requires that those
 * blocks survive the run — see `playSharedAxis`. It holds for the gallery/forum
 * and profile panes, which are static once mounted, and **fails for any pane
 * whose content is replaced when its tab is selected**: the messages tabs fetch
 * on arrival, so within ~70ms of the switch starting both panes' subtrees had
 * been swapped for loading skeletons and GSAP was animating detached nodes while
 * the new ones sat still. Measured: pane height collapsing 1887 -> 288 inside the
 * first frames, and zero transformed descendants for the whole run.
 *
 * Pass `false` there. Nothing is lost but the shear — the pane element itself is
 * the one node React will not replace, so the whole side moves as one plate,
 * which is exactly what the route cross-fade already does for the same reason.
 *
 * Attach the returned ref to the element carrying `data-tab-panel`.
 */
export function useTabPanesOn<T extends HTMLElement = HTMLElement>(
  /* The ref is a parameter for the reason `useStaggerGridOn` gives: this hook is mounted from a
     child that only exists once GSAP has loaded, and the panel element it drives has to have been
     attached long before that. */
  ref: RefObject<T | null>,
  active: string,
  /* `false`, matching `TabPanes` and matching what AGENTS.md says. It defaulted to
     `true` here and `false` in the component, so a caller that wired this hook by
     hand silently got the lean — and the lean holds GSAP references to the blocks
     *inside* each pane, which a pane that fetches on selection replaces within a few
     frames of the switch starting. Measured on the messages tabs: pane height
     collapsing 1887px to a 288px skeleton inside 70ms, with zero transformed
     descendants for the whole 500ms run, i.e. a switch with no animation at all. Two
     defaults for one option is a bug regardless of which is right. */
  { lean = false }: { lean?: boolean } = {},
): void {
  const previous = useRef(active);
  /* Read through a ref so it never widens the dependency list: this effect must
     run on `active` and nothing else, or a parent re-render that happens to
     change the option would restart a live transition. */
  const leanRef = useRef(lean);
  useEffect(() => {
    leanRef.current = lean;
  });

  useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel) return;

    /* The URL is still travelling towards a tab the user has already left.
       Ignore it — it is not a destination, it is a stale waypoint, and the push
       that supersedes it is already queued.

       This has to return before `clearPaneFlags`: at this commit React has
       moved `data-tab-pane-active` onto the tab the URL is passing through, so
       the motion flags are the only thing still holding the right pane on
       screen. Clearing them here would swap the panes with no animation at all,
       which is the same bounce arriving instantly instead of over 500ms. */
    if (tabIntent() !== null && tabIntent() !== active) return;

    /* Where the panes actually are, which is not necessarily where the URL says.
       `lastTabTarget` is written by every run, optimistic or reactive, whereas
       `previous` has only ever seen commits — so it is the fallback, for a panel
       that has not animated yet and therefore cannot be out of step. */
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
    /* `active` and nothing else, `ref` included. This effect must run on a tab change and on no
       other cause — a parent re-render that happens to change an option would otherwise restart a
       live transition, which is the bounce this hook's own note documents. A ref object is stable
       for the life of the component, so listing it would be noise that can only cause that. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

}

/** Ends any in-flight tab transition immediately. */
export function finishTabTransition() {
  activeTabRun?.finish();
}

/* Re-exported so a component never registers a plugin itself. Registration is a
   global, one-time side effect, and a second `registerPlugin` call from a
   lazily-loaded component is how a plugin ends up half-initialised. `Observer`
   joined this list for `Sheet`'s drag-to-dismiss, which is the same gesture
   mechanism `useDrawerSwipe` above uses. */
export { Flip, gsap, useGSAP, Observer };
