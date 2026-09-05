'use client';

import { motionTier, scaledMs } from '@/lib/appearance';

/**
 * The Material press wave, on the Web Animations API — here rather than in the GSAP-backed
 * motion module so the root layout's chunk does not pull the animation engine onto every
 * route for the app's most trivial effect.
 *
 * The literal curve rather than a CSS variable is deliberate: a WAAPI easing string is not a
 * CSS declaration, so a var() in it does not resolve and silently falls back to ease.
 * The value is the token's; keep them in step.
 */

/** cubic-bezier(0.2, 0, 0, 1) — the standard token, spelled out. See above. */
const STANDARD = 'cubic-bezier(0.2, 0, 0, 1)';

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
 * Paints one Material press wave inside `host`, centred on (`x`, `y`) in host coordinates; the
 * span cleans itself up. Exported for the one case `<RippleLayer />` delegation cannot reach: a
 * control whose ripple target is not an ancestor of what the pointer hits.
 *
 * The ripple is the state layer spreading from the point of contact: it holds ONE opacity for its
 * whole life — the pressed token from CSS — and spawnRipple drives only scale and fade-out. The
 * reduced tier gets the same wave (one composited scale on a self-removing span); under off there
 * is no wave at all and the active-state tint is the whole of the press.
 */
export function spawnRipple(host: HTMLElement, x: number, y: number) {
  if (motionTier() === 'off') return;
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
    { duration: grow, easing: STANDARD, fill: 'forwards' },
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
}
