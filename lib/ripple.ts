'use client';

import { motionTier, scaledMs } from '@/lib/appearance';
import { EASE } from '@/lib/motionTokens';

/**
 * The Material press wave, on the Web Animations API — here rather than in the GSAP-backed
 * motion module so the root layout's chunk does not pull the animation engine onto every
 * route for the app's most trivial effect. The curve is `EASE.standard`, the shared WAAPI
 * copy of the token (a var() in a WAAPI easing string does not resolve).
 */

/**
 * How long the wave takes to cover its host, ms. Deliberately not a step on the duration scale —
 * a press wave is neither entering nor leaving the screen, and 450 is what the gesture was tuned to.
 */
const GROW_MS = 450;

/** The trailing fade, ms — the state-layer duration step. */
const FADE_MS = 150;

/** The wave opens at a fifth of its final size, not zero — contact already made, not a dot appearing. */
const START_SCALE = 0.2;

/**
 * How long a finger has to stay put before its touch counts as a press rather than the start of
 * a scroll — Android's `ViewConfiguration.getTapTimeout()`. A native list never flashes a wave
 * under a finger that is about to scroll it; a wave on every `pointerdown` did exactly that.
 */
export const TOUCH_PRESS_DELAY_MS = 100;

/** How far a finger may drift and still be pressing, px — Android's touch slop is 8dp. */
export const TOUCH_SLOP_PX = 10;

/** A spawned wave. `cancel` lets it go at once (a press that turned into a scroll). */
export interface RippleHandle {
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
 * Paints one Material press wave inside `host`, centred on (`x`, `y`) in host coordinates; the
 * span cleans itself up. Exported for the one case `<RippleLayer />` delegation cannot reach: a
 * control whose ripple target is not an ancestor of what the pointer hits.
 *
 * The ripple is the state layer spreading from the point of contact: it holds ONE opacity for its
 * whole life — the pressed token from CSS — and spawnRipple drives only scale and fade-out. The
 * reduced tier gets the same wave (one composited scale on a self-removing span); under off there
 * is no wave at all and the active-state tint is the whole of the press.
 */
export function spawnRipple(host: HTMLElement, x: number, y: number): RippleHandle | null {
  if (motionTier() === 'off') return null;
  // Radius reaching the farthest corner keeps the wave circular.
  const { width, height } = host.getBoundingClientRect();
  const radius = Math.hypot(Math.max(x, width - x), Math.max(y, height - y));

  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  const size = radius * 2;
  ripple.style.width = `${size}px`;
  ripple.style.height = `${size}px`;
  ripple.style.left = `${x - radius}px`;
  ripple.style.top = `${y - radius}px`;
  host.appendChild(ripple);

  const grow = scaledMs(GROW_MS);
  const fade = scaledMs(FADE_MS);

  /* Only the scale is animated: the wave's opacity is the pressed state-layer token set
     on the .ripple element in globals.css, so the value has one owner rather than being
     restated here. */
  ripple.animate(
    [{ transform: `scale(${START_SCALE})` }, { transform: 'scale(1)' }],
    { duration: grow, easing: EASE.standard, fill: 'forwards' },
  );

  /* The fade ends *with* the grow rather than after it, so the wave is still spreading as it
     goes instead of leaving a static disc sitting on the control. */
  /* The fade is ONE keyframe at offset 1: a WAAPI keyframe list is absolute, so listing opacity
     1 then 0 would flash to full strength when the animation becomes in-effect — the .ripple CSS
     sets a non-default opacity and this fade has a delay with no backwards fill, the only such
     element in the app. One keyframe takes the implicit start from the underlying value (the
     token), so the opacity keeps its single owner in globals.css. */
  const out = ripple.animate([{ opacity: 0 }], {
    duration: fade,
    delay: Math.max(0, grow - fade),
    easing: 'linear',
    fill: 'forwards',
  });

  /* `finished` rejects when the animation is cancelled (e.g. the control unmounts under the
     pointer); removing an already-removed span is harmless, so both paths do the same thing. */
  const done = () => ripple.remove();
  out.finished.then(done, done);

  return {
    /* Let go now: pull the scheduled fade forward to this instant rather than cancelling
       anything. Cancelling would snap the opacity back to the token for a frame; moving the
       delay keeps the one-keyframe fade (and its implicit start from the token) intact, and
       the wave keeps spreading while it goes. A fade already under way is left alone. */
    cancel() {
      const effect = out.effect;
      const now = Number(out.currentTime ?? 0);
      if (!effect || now >= Number(effect.getTiming().delay ?? 0)) return;
      effect.updateTiming({ delay: now });
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
