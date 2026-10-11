'use client';

import {
  commitCustomPalette, commitPalette, commitPaletteHues, commitScheme,
  currentCustomAccent, currentCustomSeed, currentPalette, currentPaletteHues,
  currentScheme, motionScale, motionTier, resolveScheme, CUSTOM_PALETTE,
  type CustomPaletteInstall, type PaletteHues, type PaletteId, type SchemeSetting,
} from '@/lib/appearance';
import { heroOwnsScreen } from '@/lib/appScroller';
import { DURATION, EASE } from '@/lib/motionTokens';
import { notifyThemeWipeStart } from '@/lib/pageTransit';
import { finishTabTransition } from './tabs';

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
  const tier = motionTier('theme');

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
  const wipeMs = Math.round(550 * motionScale('theme'));
  style.textContent =
    tier === 'reduced'
      ? `
    @keyframes ${animationName} {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    html:root[data-theme-vt="${id}"]::view-transition-new(root) {
      animation: ${animationName} ${Math.round(DURATION.long * 1000 * motionScale('theme'))}ms ${EASE.decelerate} both;
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
