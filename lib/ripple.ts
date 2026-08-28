'use client';

import { motionTier, scaledMs } from '@/lib/appearance';

/**
 * The Material press wave, on the Web Animations API.
 *
 * It was a GSAP timeline, and moving it is not a style preference — it is the single edge
 * that put GSAP in the root layout's chunk. `<RippleLayer />` is mounted by `app/layout.tsx`
 * on every route, it imported `spawnRipple`, `spawnRipple` lived in `lib/motion.ts`, and that
 * module registers GSAP and its plugins at module scope. So the app's most trivial animation
 * dragged ~180KB of animation engine onto `/policy`.
 *
 * Nothing about the motion changes. The two eases it used are exactly reproducible:
 * `'standard'` is `CustomEase.create('standard', '0.2, 0, 0, 1')`, a plain cubic Bézier, so
 * `cubic-bezier(0.2, 0, 0, 1)` is the same curve; and the fade used `'none'`, i.e. linear.
 * The two curves that could *not* have survived this move are `emphasized` (two cubic
 * segments, no single-bezier form) and the nine springs — and the ripple uses neither.
 *
 * The literal curve rather than `var(--ease-standard)` is deliberate and has a precedent in
 * this repo: a WAAPI `easing:` string is not a CSS property declaration, so a `var()` in it
 * does not resolve — it silently falls back to `ease`. `app/layout.tsx` spells out the top
 * loader's curve for the same reason, and `lib/hero/` spells out its own. **The value is the
 * token's; keep them in step.**
 */

/** `cubic-bezier(0.2, 0, 0, 1)` — the `standard` token, spelled out. See above. */
const STANDARD = 'cubic-bezier(0.2, 0, 0, 1)';

/**
 * How long the wave takes to cover its host, ms.
 *
 * 450, carried over verbatim from `RIPPLE_GROW` in `lib/motion.ts`. Worth noting that it is
 * *not* a step on the app’s duration scale and never was: the nearest are `long` (400) and
 * `emphasized` (500). A press wave is not entering or leaving the screen, so neither row of
 * that table describes it, and 450 is what the gesture was tuned to.
 */
const GROW_MS = 450;

/** The trailing fade, ms. `DURATION.state` — the state-layer step. */
const FADE_MS = 150;

/**
 * The wave opens at a fifth of its final size rather than at zero.
 *
 * Starting nearer zero reads as a dot appearing and then expanding; starting here reads as
 * contact already having been made.
 */
const START_SCALE = 0.2;

/**
 * Motion speed.
 *
 * On the GSAP path this came for free: `lib/motion.ts` pipes the speed preference into
 * `gsap.globalTimeline.timeScale`, which reaches every tween in the app at once. WAAPI has no
 * such global, so a ripple that left GSAP would have been the one animation in the app that
 * ignored 快速 / 缓慢. `scaledMs` (lib/appearance.ts) is the shared answer —
 * `components/Popover.tsx` reaches for the same one.
 */

/**
 * Paints one Material press wave inside `host`, centred on (`x`, `y`) given in the host's own
 * coordinates. The span cleans itself up.
 *
 * Normally you never call this — `<RippleLayer />` delegates it to anything carrying
 * `data-ripple`. It is exported for the one case delegation cannot reach: a control whose
 * ripple target is not an ancestor of what the pointer actually hits, such as the switch,
 * where the press lands on a full-size input overlay but the wave belongs to the 40dp circle
 * around the handle.
 *
 * The wave holds **one** opacity for its whole life and then fades, which is how M3 draws it:
 * the ripple *is* the pressed state layer, spreading. It used to open at 0.18 and settle to
 * 0.12 — two values, neither of them a token, the first of them half again the spec's — so
 * the press read as a flash followed by a wash rather than as one gesture.
 *
 * **The reduced tier gets the same wave.** It briefly did not — it appeared at full size and
 * faded — and there was nothing to justify that: a wave growing from the point of contact is
 * already the plainest possible press cue, it is one composited `scale` on a span that removes
 * itself, and standing it down left the tier's most-repeated interaction with no feedback but
 * a colour. Under **off** there is no wave at all (`.ripple` is `display: none`) and
 * `state-layer`'s `:active` tint is the whole of the press.
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

  /* Only the scale is animated. The wave's opacity is the pressed state-layer token, set on
     `.ripple` in globals.css, so the value has one owner rather than being restated here. */
  ripple.animate(
    [{ transform: `scale(${START_SCALE})` }, { transform: 'scale(1)' }],
    { duration: grow, easing: STANDARD, fill: 'forwards' },
  );

  /* The fade ends *with* the grow rather than after it, so the wave is still spreading as it
     goes — a fade that waits for the spread to finish leaves a static disc sitting on the
     control for its whole duration. On the GSAP timeline this was a `-=DURATION.state`
     position offset; here it is the equivalent start delay. */
  /* **One keyframe, not two, and this is the trap that moving off GSAP set.** `gsap.to(el,
     { opacity: 0 })` reads the element's *current* value as the start; a WAAPI keyframe list is
     absolute, so `[{ opacity: 1 }, { opacity: 0 }]` does not mean "fade out from wherever you
     are" — it means "be fully opaque, then fade". `.ripple`'s CSS opacity is the pressed state
     token (0.10), and this animation has a 300ms delay with no `backwards` fill, so at the moment
     it became in-effect the wave jumped 0.10 → 1 and then fell: a full-strength `currentColor`
     flash at the end of every press, black on a text button and white on a filled one. Measured
     per frame, the opacity read 0.100 for 291ms and then 1.000.

     A single keyframe at offset 1 gives an **implicit start from the underlying value**, which is
     the token — so the wave fades from exactly what it was painting, and the opacity still has one
     owner in globals.css rather than being restated here. */
  const out = ripple.animate([{ opacity: 0 }], {
    duration: fade,
    delay: Math.max(0, grow - fade),
    easing: 'linear',
    fill: 'forwards',
  });

  /* `finished` rejects if the animation is cancelled — which happens when the node is removed
     from the document while it runs, e.g. the control unmounts under the pointer. Removing an
     already-removed span is harmless, so both paths do the same thing. */
  const done = () => ripple.remove();
  out.finished.then(done, done);
}
