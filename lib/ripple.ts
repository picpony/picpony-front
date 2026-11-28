'use client';

import { motionTier, scaledMs } from '@/lib/appearance';

/**
 * The press wave, on the Web Animations API — here rather than in the GSAP-backed motion module
 * so the root layout's chunk does not pull the animation engine onto every route.
 *
 * **An explicit exception to the spring roles**, synthesizing Google Material 3 (`md-ripple`),
 * AOSP `RippleForeground` and Vuetify `v-ripple` on the app's own colour and opacity tokens:
 *
 *   - **soft-feathered radial wave**: `.ripple` paints a `radial-gradient` whose uniform inner
 *     core reaches the full bounding half-diagonal (`+ 2px`, covering M3E press-morphed corners
 *     on `IconButton` and `Button` while held) plus a proportional `12–56px` feathered rim
 *     (`--ripple-core`) that glides smoothly during expansion without a hard geometric edge;
 *   - **proportional starting droplet**: `0.18` on compact square/circular controls (≤ 64dp) and
 *     `0.10–0.24` (capped by the shorter side) on wider pills, rows and cards, so even a 264dp
 *     sidebar row launches a crisp droplet right under the contact point;
 *   - **instant contact & fast-launch deceleration**: a 75ms linear fade-in (AOSP / Compose)
 *     pairs with `cubic-bezier(0.2, 0.8, 0.4, 1)` on the unified `translate + scale` transform
 *     (280–420ms by cover radius), launching immediately on frame 1 while staying locked to the
 *     pointer;
 *   - **held press & smooth dissolve**: holds at `--md-sys-ripple-opacity` while pressed, then
 *     hands out of the spread tail (80% of spread) into a 280ms standard-eased fade-out (140ms
 *     on scroll cancel) instead of snapping out. The reduced tier keeps the same bounded wave
 *     (composited transform and opacity, zero overshoot); under `off`, no wave is spawned and the
 *     pressed state layer takes over.
 */
const FADE_IN_MS = 75;
const SPREAD_MIN_MS = 240;
const SPREAD_MAX_MS = 380;
const FADE_OUT_MS = 220;
const FADE_CANCEL_MS = 140;
/** Fast-launch, soft-decelerate spread curve (AOSP LogDecelerate / Vuetify launch with M3 tail). */
const RIPPLE_SPREAD_EASE = 'cubic-bezier(0.2, 0.8, 0.4, 1)';
/** Standard M3 / Vuetify dissolve curve so the fade-out melts smoothly without an abrupt drop. */
const RIPPLE_FADE_OUT_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';
/** Continuous starting scale bounds across compact buttons, pills, rows and cards (no 48/52px cliff). */
const MIN_START_SCALE = 0.12;
const MAX_START_SCALE = 0.2;
/** Cap initial droplet radius relative to the shorter side so wide rows still radiate crisply. */
const RECT_SHORT_SIDE_SHARE = 0.34;
/** Small anti-aliasing margin so the uniform core clears all four pressed corners cleanly. */
const END_RADIUS_PAD_PX = 2;
/** Proportional soft-feathered rim width (Google `md-ripple` style), clamped across control sizes. */
const SOFT_EDGE_MIN_PX = 12;
const SOFT_EDGE_MAX_PX = 56;
const SOFT_EDGE_SHARE = 0.3;
/** At 62% of `RIPPLE_SPREAD_EASE`, scale is already >94% complete — quick taps stay crisp. */
const RELEASE_HOLD_SHARE = 0.62;

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

  /* Full half-diagonal plus a 2px margin for the uniform core, extended by a proportional soft
     rim so the wave feathers while expanding yet covers all four press-morphed corners evenly
     while held (`IconButton` 50% → 8dp, `Button` pill → 12dp). */
  const cover = Math.hypot(width, height) / 2 + END_RADIUS_PAD_PX;
  const feather = Math.min(SOFT_EDGE_MAX_PX, Math.max(SOFT_EDGE_MIN_PX, cover * SOFT_EDGE_SHARE));
  const end = cover + feather;
  const startScale = Math.max(
    MIN_START_SCALE,
    Math.min(MAX_START_SCALE, (Math.min(width, height) * RECT_SHORT_SIDE_SHARE) / cover),
  );
  /* Clamp taps landing in an expanded `touch-target` overhang to the painted edge. */
  const cx = Math.min(width, Math.max(0, x));
  const cy = Math.min(height, Math.max(0, y));

  /* Read and freeze the wave's ink from the already-styled host *before* mutating the DOM so
     pointerdown never forces a synchronous write-then-read style recalculation on the new span. */
  const hostStyle = window.getComputedStyle(host);
  const resolvedColor = hostStyle.getPropertyValue('--ripple-color').trim() || hostStyle.color;

  /* Centred on the host from the start; a single unified `transform` translates from the contact
     point while scaling up on the same easing curve, so the wave never slips off the pointer. */
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  ripple.style.width = `${end * 2}px`;
  ripple.style.height = `${end * 2}px`;
  ripple.style.left = `${width / 2 - end}px`;
  ripple.style.top = `${height / 2 - end}px`;
  ripple.style.setProperty('--ripple-core', `${((cover / end) * 100).toFixed(2)}%`);
  if (resolvedColor) ripple.style.color = resolvedColor;
  host.appendChild(ripple);

  const fadeIn = scaledMs(FADE_IN_MS);
  const spread = scaledMs(
    Math.round(Math.min(SPREAD_MAX_MS, Math.max(SPREAD_MIN_MS, 220 + Math.sqrt(cover) * 10))),
  );
  const fadeOut = scaledMs(FADE_OUT_MS);
  const fadeCancel = scaledMs(FADE_CANCEL_MS);
  const animations: Animation[] = [
    /* One keyframe at offset 0: the end value is the underlying one — the token — so the opacity
       keeps its single owner in globals.css. */
    ripple.animate([{ opacity: 0, offset: 0 }], { duration: fadeIn, easing: 'linear' }),
    ripple.animate(
      [
        { transform: `translate(${cx - width / 2}px, ${cy - height / 2}px) scale(${startScale})` },
        { transform: 'translate(0px, 0px) scale(1)' },
      ],
      { duration: spread, easing: RIPPLE_SPREAD_EASE, fill: 'forwards' },
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
    out = ripple.animate([{ opacity: 0 }], {
      duration,
      delay,
      easing: RIPPLE_FADE_OUT_EASE,
      fill: 'forwards',
    });
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
 * anywhere on its label (`Checkbox`, `Radio`, `ToggleSwitch`). Holds while the pointer is down,
 * waits for the touch tap timeout, cancels if the touch turns into a scroll, and optionally
 * mirrors held press state via `onPressChange` (for `ToggleSwitch`'s pressed handle swell).
 */
export function startCenteredRipple(
  event: Pick<PointerEvent, 'button' | 'pointerType' | 'pointerId' | 'clientX' | 'clientY'>,
  host: HTMLElement | null,
  isDisabled?: () => boolean,
  onPressChange?: (pressed: boolean) => void,
): void {
  if (event.button !== 0 || !host || isDisabled?.()) return;
  let wave: RippleHandle | null = null;
  let released = false;
  let active = false;
  const pulse = () => {
    if (!host.isConnected || isDisabled?.()) return null;
    const rect = host.getBoundingClientRect();
    return spawnRipple(host, rect.width / 2, rect.height / 2);
  };
  const clearPress = () => {
    if (!active) return;
    active = false;
    onPressChange?.(false);
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
    clearPress();
    if (e.type === 'pointercancel') wave?.cancel();
    else wave?.release();
  };
  const onBlur = () => {
    cleanup();
    released = true;
    clearPress();
    wave?.cancel();
  };
  window.addEventListener('pointerup', end, { capture: true, passive: true });
  window.addEventListener('pointercancel', end, { capture: true, passive: true });
  window.addEventListener('blur', onBlur, { passive: true });
  trackPress(event, {
    press: () => {
      if (released || !host.isConnected || isDisabled?.()) return;
      active = true;
      onPressChange?.(true);
      wave = pulse();
    },
    tap: () => {
      wave = pulse();
      wave?.release();
    },
    cancel: () => {
      cleanup();
      released = true;
      clearPress();
      wave?.cancel();
    },
  });
}
