'use client';

import { motionTier, scaledMs } from '@/lib/appearance';

/**
 * The Material press wave, on the Web Animations API — here rather than in the GSAP-backed motion
 * module so the root layout's chunk does not pull the animation engine onto every route.
 *
 * **It is Compose's `RippleAnimation`, verbatim**, and it is the one press feedback that is not on
 * the motion scheme's springs — as in Compose itself, where the ripple keeps its own tweens:
 *
 *   - the wave fades in over 75ms (linear) as it spreads, so contact is answered on the next frame
 *     without a disc stamping onto the control;
 *   - its radius grows from 30% of the control's longer side to the control's half-diagonal plus
 *     10dp over 225ms on `FastOutSlowInEasing`, while its centre drifts from the point of contact
 *     to the control's centre over the same 225ms, linear — the wave *fills* the control rather
 *     than spreading lopsidedly from an edge;
 *   - **it holds for as long as the press does**, at the pressed state-layer opacity, and fades
 *     out over 150ms (linear) only once the press is released *and* the spread has finished.
 *
 * The old wave grew over 450ms from a fifth of its size and faded out on its own clock whether or
 * not the finger was still down, so a long press lost its feedback under the finger and a quick
 * tap's wave lingered after the tap: the two reasons press feedback read as having no texture.
 */
const FADE_IN_MS = 75;
const SPREAD_MS = 225;
const FADE_OUT_MS = 150;
/** Compose's `FastOutSlowInEasing`. A WAAPI string, so spelled out (a `var()` would not resolve). */
const FAST_OUT_SLOW_IN = 'cubic-bezier(0.4, 0, 0.2, 1)';
/** `getRippleStartRadius`: 30% of the longer side. */
const START_RADIUS_SHARE = 0.3;
/** `getRippleEndRadius` for a bounded ripple: the half-diagonal plus 10dp. */
const END_RADIUS_PAD_PX = 10;

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
 * The wave's opacity is the pressed state-layer token, set on `.ripple` in globals.css — it has one
 * owner; this only fades towards and away from it. The reduced tier gets the same wave (composited
 * scale and translate on a self-removing span); under off there is no wave at all and the
 * active-state tint is the whole of the press.
 */
export function spawnRipple(host: HTMLElement, x: number, y: number): RippleHandle | null {
  if (motionTier() === 'off') return null;
  const { width, height } = host.getBoundingClientRect();
  const end = Math.hypot(width, height) / 2 + END_RADIUS_PAD_PX;
  const start = Math.max(width, height) * START_RADIUS_SHARE;

  /* Centred on the host from the start; the drift from the contact point is a `translate`
     animated to nothing, so the centre ends where Compose's does. */
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  ripple.style.width = `${end * 2}px`;
  ripple.style.height = `${end * 2}px`;
  ripple.style.left = `${width / 2 - end}px`;
  ripple.style.top = `${height / 2 - end}px`;
  host.appendChild(ripple);

  const fadeIn = scaledMs(FADE_IN_MS);
  const spread = scaledMs(SPREAD_MS);
  const fadeOut = scaledMs(FADE_OUT_MS);
  const animations: Animation[] = [
    /* One keyframe at offset 0: the end value is the underlying one — the token — so the opacity
       keeps its single owner in globals.css. */
    ripple.animate([{ opacity: 0, offset: 0 }], { duration: fadeIn, easing: 'linear' }),
    ripple.animate([{ scale: `${start / end}` }, { scale: '1' }], { duration: spread, easing: FAST_OUT_SLOW_IN, fill: 'forwards' }),
    ripple.animate([{ translate: `${x - width / 2}px ${y - height / 2}px` }, { translate: '0 0' }], {
      duration: spread,
      easing: 'linear',
      fill: 'forwards',
    }),
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
  const leave = (delay: number) => {
    if (out || gone) return;
    out = ripple.animate([{ opacity: 0 }], { duration: fadeOut, delay, easing: 'linear', fill: 'forwards' });
    out.finished.then(remove, remove);
  };

  return {
    /* Compose fades out only once the spread is complete: a quick tap still shows the whole wave. */
    release() {
      leave(Math.max(0, spread - (performance.now() - spawnedAt)));
    },
    cancel() {
      leave(0);
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
