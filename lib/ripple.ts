'use client';

import { motionTier, scaledMs } from '@/lib/appearance';

/**
 * The press wave, on the Web Animations API — here rather than in the GSAP-backed motion module
 * so the root layout's chunk does not pull the animation engine onto every route.
 *
 * **An explicit exception to the spring roles**, tuned from Vuetify's `v-ripple` feel and unified
 * with Material 3 Expressive's colour roles:
 *
 *   - **bounding-box half-diagonal radius**: `hypot(w, h) / 2 + 2px` so controls that morph
 *     their corners inward while pressed (`IconButton` `50% → rounded-sm`, `Button` pill →
 *     `rounded-md`) always have all four pressed corners filled cleanly with no octagonal gap;
 *   - **proportional starting droplet**: `0.15` on compact square/circular controls (≤ 64dp) and
 *     `0.10–0.24` (capped by the shorter side) on wider pills, rows and cards, so even a 264dp
 *     sidebar row launches a crisp droplet under the pointer rather than a half-width slab;
 *   - **fast-launch deceleration**: `cubic-bezier(0.25, 0.8, 0.5, 1)` drives both the unified
 *     `translate + scale` transform (260–380ms, scaled smoothly by radius) and the 100ms fade-in,
 *     so the wave bursts outward immediately on frame 1 and stays locked over the contact point;
 *   - **held press & silky dissolve**: holds at `--md-sys-ripple-opacity` for as long as the press
 *     lasts, then hands smoothly out of the spread tail (85% of spread) into a 300ms eased
 *     fade-out (150ms when cancelled by a scroll). The reduced tier keeps the same bounded wave
 *     (composited transform and opacity, zero overshoot); under `off`, no wave is spawned and the
 *     pressed state layer takes over.
 */
const FADE_IN_MS = 100;
const SPREAD_MIN_MS = 260;
const SPREAD_MAX_MS = 380;
const FADE_OUT_MS = 300;
const FADE_CANCEL_MS = 150;
/** Vuetify's fast-launch, soft-decelerate ripple curve (spelled out for WAAPI). */
const RIPPLE_EASE = 'cubic-bezier(0.25, 0.8, 0.5, 1)';
/** Starting scale on compact square/circular controls (IconButton, selection circles, FABs). */
const COMPACT_START_SCALE = 0.15;
const COMPACT_MAX_EDGE_PX = 64;
/** Starting scale bounds on wider rectangular / pill / row / card hosts. */
const RECT_MIN_START_SCALE = 0.1;
const RECT_MAX_START_SCALE = 0.24;
/** Cap initial droplet radius relative to the shorter side so wide rows still radiate crisply. */
const RECT_SHORT_SIDE_SHARE = 0.36;
/** Small anti-aliasing margin so the settled disc clears all four corners cleanly. */
const END_RADIUS_PAD_PX = 2;
/** At 85% of `RIPPLE_EASE`, scale is already >98% complete — dissolve blends right out of the tail. */
const RELEASE_HOLD_SHARE = 0.85;

/**
 * How long a finger has to stay put before its touch counts as a press rather than the start of
 * a scroll — Android's `ViewConfiguration.getTapTimeout()`. A native list never flashes a wave
 * under a finger that is about to scroll it; a wave on every `pointerdown` did exactly that.
 */
export const TOUCH_PRESS_DELAY_MS = 100;

/** How far a finger may drift and still be pressing, px — Android's touch slop is 8dp. */
export const TOUCH_SLOP_PX = 10;

/**
 * A spawned wave. `release` lets it go the way a press ends — once its spread is done, it fades
 * out; `cancel` lets it go now (a press that turned into a scroll).
 */
export interface RippleHandle {
  release(): void;
  cancel(): void;
}

/**
 * The element a `[data-ripple]` control paints its wave into. A control that must not clip its
 * own box — one whose hit area extends past what it paints, via `touch-target` — carries an
 * inner `[data-ripple-host]` span and clips the wave there instead.
 */
export function rippleHostOf(control: HTMLElement): HTMLElement {
  return control.querySelector<HTMLElement>(':scope > [data-ripple-host]') ?? control;
}

/**
 * Paints one Material press wave inside `host`, from (`x`, `y`) in host coordinates; the span
 * cleans itself up once released and faded. Exported for the one case `<RippleLayer />`
 * delegation cannot reach: a control whose ripple target is not an ancestor of what the pointer
 * hits.
 *
 * The wave's opacity is `--md-sys-ripple-opacity`, set on `.ripple` in globals.css — it has one
 * owner; this only fades towards and away from it. The reduced tier gets the same bounded wave
 * (composited transform and opacity on a self-removing span); under `off` there is no wave at all
 * and the active-state tint is the whole of the press.
 */
export function spawnRipple(host: HTMLElement, x: number, y: number): RippleHandle | null {
  if (motionTier() === 'off') return null;
  const { width, height } = host.getBoundingClientRect();
  if (width <= 0 || height <= 0) return null;

  /* Full half-diagonal plus a 2px margin: controls with M3E press-morph (`IconButton` 50% → 8dp,
     `Button` pill → 12dp) expand their visible corners while held, so sizing to the resting
     border-radius left unfilled corner gaps on long press. */
  const end = Math.hypot(width, height) / 2 + END_RADIUS_PAD_PX;
  const isCompactSquare = Math.max(width, height) <= COMPACT_MAX_EDGE_PX && Math.abs(width - height) <= 2;
  const startScale = isCompactSquare
    ? COMPACT_START_SCALE
    : Math.max(
        RECT_MIN_START_SCALE,
        Math.min(RECT_MAX_START_SCALE, (Math.min(width, height) * RECT_SHORT_SIDE_SHARE) / end),
      );
  /* Clamp taps landing in an expanded `touch-target` overhang to the painted edge. */
  const cx = Math.min(width, Math.max(0, x));
  const cy = Math.min(height, Math.max(0, y));

  /* Centred on the host from the start; a single unified `transform` translates from the contact
     point while scaling up on the same easing curve, so the wave never slips off the pointer. */
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  ripple.style.width = `${end * 2}px`;
  ripple.style.height = `${end * 2}px`;
  ripple.style.left = `${width / 2 - end}px`;
  ripple.style.top = `${height / 2 - end}px`;
  host.appendChild(ripple);
  /* Freeze the wave's resolved ink at contact time so a quick click that immediately flips the
     control into a selected container (e.g. a pill/rail tab, sidebar nav row or toggle) keeps
     the colour it launched with instead of snapping mid-spread. */
  const resolvedColor = window.getComputedStyle(ripple).backgroundColor;
  if (resolvedColor) ripple.style.backgroundColor = resolvedColor;

  const fadeIn = scaledMs(FADE_IN_MS);
  const spread = scaledMs(Math.round(Math.min(SPREAD_MAX_MS, Math.max(SPREAD_MIN_MS, 210 + Math.sqrt(end) * 10))));
  const fadeOut = scaledMs(FADE_OUT_MS);
  const fadeCancel = scaledMs(FADE_CANCEL_MS);
  const animations: Animation[] = [
    /* One keyframe at offset 0: the end value is the underlying one — the token — so the opacity
       keeps its single owner in globals.css. */
    ripple.animate([{ opacity: 0, offset: 0 }], { duration: fadeIn, easing: RIPPLE_EASE }),
    ripple.animate(
      [
        { transform: `translate(${cx - width / 2}px, ${cy - height / 2}px) scale(${startScale})` },
        { transform: 'translate(0px, 0px) scale(1)' },
      ],
      { duration: spread, easing: RIPPLE_EASE, fill: 'forwards' },
    ),
  ];
  const spawnedAt = performance.now();

  let gone = false;
  const remove = () => {
    if (gone) return;
    gone = true;
    for (const animation of animations) animation.cancel();
    ripple.remove();
  };
  /* Fades out after `delay` and removes the span. ONE keyframe, at offset 1: its start is the
     underlying value — the token, or wherever a fade-in still running has it — so nothing flashes
     and the opacity keeps its owner. A cancelled fade (the control unmounting under the pointer)
     removes the span too. */
  let out: Animation | null = null;
  const leave = (delay: number, duration: number) => {
    if (out || gone) return;
    out = ripple.animate([{ opacity: 0 }], { duration, delay, easing: RIPPLE_EASE, fill: 'forwards' });
    out.finished.then(remove, remove);
  };

  return {
    /* Let a quick tap complete the visible sweep before dissolving smoothly into the surface. */
    release() {
      const minHold = Math.round(spread * RELEASE_HOLD_SHARE);
      leave(Math.max(0, minHold - (performance.now() - spawnedAt)), fadeOut);
    },
    cancel() {
      leave(0, fadeCancel);
    },
  };
}

/** What a press does at each stage of its life; see `trackPress`. */
export interface PressHandlers {
  /** The pointer is pressing: at once for a mouse or pen, after the delay for a finger. */
  press(): void;
  /** A finger lifted before the delay — a tap too quick to have pressed yet. */
  tap?(): void;
  /** A finger lifted after it had pressed. */
  release?(): void;
  /** A finger drifted past the slop or the browser took the touch for a scroll. */
  cancel?(): void;
}

/**
 * The press gesture, on one timeline for every control that paints press feedback.
 *
 * A mouse or pen press is a press the moment it lands. A finger is not: the first ~100ms of a
 * touch cannot tell a tap from the start of a scroll, so feedback waits for the tap timeout,
 * starts at once if the finger lifts first (`tap`), and is abandoned if the finger travels past
 * the slop or the browser claims the touch for a scroll (`pointercancel`). That is the whole
 * difference between a list that ripples under every flick and one that behaves like a native one.
 *
 * `delay` is the tap timeout by default; a long press (a tooltip on touch) passes its own.
 * Listens on `window` for this pointer only, and removes its listeners when the press resolves.
 */
export function trackPress(
  event: Pick<PointerEvent, 'pointerType' | 'pointerId' | 'clientX' | 'clientY'>,
  handlers: PressHandlers,
  delay: number = TOUCH_PRESS_DELAY_MS,
): void {
  if (event.pointerType !== 'touch') {
    handlers.press();
    return;
  }
  const { pointerId, clientX: startX, clientY: startY } = event;
  let pressed = false;
  let timer: number | null = window.setTimeout(() => {
    timer = null;
    pressed = true;
    handlers.press();
  }, delay);

  const stop = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
  };
  const abandon = () => {
    stop();
    handlers.cancel?.();
  };
  function onMove(e: PointerEvent) {
    if (e.pointerId !== pointerId) return;
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > TOUCH_SLOP_PX) abandon();
  }
  function onUp(e: PointerEvent) {
    if (e.pointerId !== pointerId) return;
    stop();
    if (pressed) handlers.release?.();
    else handlers.tap?.();
  }
  function onCancel(e: PointerEvent) {
    if (e.pointerId === pointerId) abandon();
  }
  window.addEventListener('pointermove', onMove, { capture: true, passive: true });
  window.addEventListener('pointerup', onUp, { capture: true, passive: true });
  window.addEventListener('pointercancel', onCancel, { capture: true, passive: true });
}

/**
 * Runs one centred Material press wave inside `host` for a selection control whose press lands
 * outside its 40dp state-layer circle (a checkbox or radio label). Holds while the pointer is
 * down, waits for the touch tap timeout, and cancels if the touch turns into a scroll.
 */
export function startCenteredRipple(
  event: Pick<PointerEvent, 'button' | 'pointerType' | 'pointerId' | 'clientX' | 'clientY'>,
  host: HTMLElement | null,
  isDisabled?: () => boolean,
): void {
  if (event.button !== 0 || !host || isDisabled?.()) return;
  let wave: RippleHandle | null = null;
  let released = false;
  const start = () => {
    if (!host.isConnected || isDisabled?.()) return;
    const rect = host.getBoundingClientRect();
    wave = spawnRipple(host, rect.width / 2, rect.height / 2);
    if (released) wave?.release();
  };
  const pointerId = event.pointerId;
  const cleanup = () => {
    window.removeEventListener('pointerup', end, true);
    window.removeEventListener('pointercancel', end, true);
    window.removeEventListener('blur', onBlur);
  };
  const end = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    cleanup();
    released = true;
    if (e.type === 'pointercancel') wave?.cancel();
    else wave?.release();
  };
  const onBlur = () => {
    cleanup();
    released = true;
    wave?.cancel();
  };
  window.addEventListener('pointerup', end, { capture: true, passive: true });
  window.addEventListener('pointercancel', end, { capture: true, passive: true });
  window.addEventListener('blur', onBlur, { passive: true });
  trackPress(event, {
    press: start,
    tap: start,
    cancel: () => {
      cleanup();
      released = true;
      wave?.cancel();
    },
  });
}
