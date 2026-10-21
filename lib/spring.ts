/**
 * The motion system: Material 3 Expressive, as Compose ships it.
 *
 * **There is one way to move anything in this app, and it is a spring.** M3 Expressive (May 2025)
 * retired easing-plus-duration for everything except indeterminate loops: a motion is a damping
 * ratio and a stiffness, the duration is whatever the physics takes to arrive. This module is the
 * single source of truth for both renderers — CSS gets sampled `linear()` tables generated from it
 * (`npm run motion:write`, checked by `npm run motion`), WAAPI gets the same strings through
 * `springTiming`, GSAP gets the closed form registered as an ease.
 *
 * ## The springs
 *
 * Six **roles** from `MotionScheme` — what Compose's own components ask for — plus a **layout**
 * spring and three named **component springs** (`COMPONENT_SPRINGS`):
 *
 *                       damping  stiffness   settle   use (the Compose component that asks for it)
 *   fastSpatial            0.6       800     ~350ms   a small component moving: switch handle, radio
 *                                                     dot, an icon turning, a menu / tooltip / toast
 *                                                     scaling in *and out* (`DropdownMenu`,
 *                                                     `Tooltip`, `SnackbarHost`)
 *   defaultSpatial         0.8       380     ~410ms   a surface moving: tab indicator, a checkbox's
 *                                                     mark drawing, a sheet / side sheet / modal
 *                                                     drawer arriving and settling after a drag
 *                                                     (`BottomSheet`, `ModalNavigationDrawer`), the
 *                                                     search view collapsing
 *   slowSpatial            0.8       200     ~570ms   a large move: the search view expanding
 *                                                     (`rememberSearchBarState`)
 *   fastEffects            1.0      3800     ~140ms   a small colour/opacity change: hover, focus, a
 *                                                     state layer, a colour going *out* (tab, checkbox
 *                                                     box), a sheet or drawer leaving (`hideMotion`,
 *                                                     `closeMotion`)
 *   defaultEffects         1.0      1600     ~210ms   a colour coming *in* (tab, radio, checkbox box),
 *                                                     a scrim, a dialog fading, **a shape morph**
 *                                                     (button / icon button pressed shape — Compose
 *                                                     uses it "to prevent any bounce")
 *   slowEffects            1.0       800     ~300ms   a full-screen fade: a page arriving
 *   layout                 1.0       700     ~320ms   bounds following a layout change: list items
 *                                                     re-placing, a box following its content's size,
 *                                                     a collapsible, the docked drawer's width, a
 *                                                     lightbox zoom step
 *
 *   FLIGHT_SPRING          1.0      1000     ~268ms   the image hero and the forum / folder
 *                                                     container transform
 *   PAGER_SPRING           1.0       400     ~424ms   a pager turning: the tab strip, the lightbox
 *   PROGRESS_SPRING        1.0        50    ~1200ms   a determinate meter's value
 *
 * The six roles are the **expressive** scheme — `MaterialExpressiveTheme`'s default motion scheme —
 * verbatim. `layout` is Compose's `DampingRatioNoBouncy` docking spring at k700 rather than its
 * k400, and `FLIGHT_SPRING` stiffer again: owner-tuned, because Compose's k400 tail read as slow on
 * a full-screen move (see each constant). Both schemes are kept in `MOTION_SCHEMES` for reference;
 * `ACTIVE_SCHEME` picks.
 *
 * ## How to choose
 *
 * **First, if Compose has the component, take the role its source passes** (`MotionSchemeKeyTokens`
 * in `androidx.compose.material3`) — per property and per direction, as it does. Otherwise:
 *
 * 1. Does it move or change size? **spatial**. Only fade or recolour? **effects** — an overshooting
 *    colour is a flash, an overshooting opacity is clipped at 1. A *shape* morph (a corner radius)
 *    is effects too: Compose keeps bounce out of shapes.
 * 2. Are its bounds following a layout change — a slot, its content's height, a shared element's
 *    other bounds? **layout** (or the flight spring), never a spatial role: an overshoot there
 *    crosses a neighbour. A surface docked to a *screen edge* is not this: it takes its spatial
 *    role, and its overshoot lands on an edge skirt (`edge-skirt-*` in globals.css).
 * 3. Otherwise by size: a control → fast, a partial-screen surface → default, the whole screen →
 *    slow.
 * 4. Leaving: an **opacity** always leaves on an effects spring. A **transform** keeps the spatial
 *    spring it arrived on when the component scales back into its anchor (menu, tooltip, toast —
 *    the fade ends it long before the scale's tail); a large surface that *leaves the screen*
 *    (sheet, side sheet, modal drawer) leaves on `fastEffects`, as `hideMotion` / `closeMotion`.
 *    A colour usually fades in on `defaultEffects` and out on `fastEffects`.
 * 5. Arriving, a surface's transform takes its spatial role and its opacity the effects spring of
 *    the same size (`surfaceArrival`), so the fade is done well before the crest of the travel.
 *
 * There is no other knob. A duration or a curve chosen at a call site is a bug.
 *
 * ## Settling
 *
 * A spring never arrives; it is *considered* arrived inside a threshold. This app uses **one
 * threshold for every spring: 1/512 of the travel** — half an 8-bit colour or alpha step, and half
 * a pixel over 256px of travel, which is Compose's own `visibilityThreshold` for an offset (0.5px)
 * on a typical move. The old 1% cut the last, softest part of every spring off and renormalised the
 * rest, so everything stopped *abruptly* ~40% early — the other half of "too rushed, no texture".
 *
 * Every spring here is one of **three shapes**, by damping alone: normalise the timeline by the
 * settle time and the curve depends only on ζ (stiffness decides the duration). `effects` (ζ1:
 * the three effects roles, layout and the component springs), `spatial` (ζ0.8: default and slow
 * spatial, the theme wipe) and `spatialFast` (ζ0.6).
 *
 * `lib/hero/spring.ts` is the same physics solved for a launch velocity (interruptible, gesture-
 * driven legs). It takes its parameters from here (`springRate`).
 */

/**
 * Where every spring is considered arrived: within 1/512 of its target. See "Settling" above.
 */
export const SETTLE_THRESHOLD = 1 / 512;

export interface SpringSpec {
  /** Damping ratio ζ. Below 1 overshoots; exactly 1 is critically damped. */
  damping: number;
  /** Stiffness k. M3 assumes unit mass, so the natural frequency is √k. */
  stiffness: number;
}

type SchemeRole =
  | 'fastSpatial'
  | 'defaultSpatial'
  | 'slowSpatial'
  | 'fastEffects'
  | 'defaultEffects'
  | 'slowEffects';

/**
 * Compose's two motion schemes, verbatim (`androidx.compose.material3.MotionScheme`). The effects
 * springs are identical in both: the argument for a flourish applies to movement, not to a fade.
 */
export const MOTION_SCHEMES = {
  standard: {
    fastSpatial: { damping: 0.9, stiffness: 1400 },
    defaultSpatial: { damping: 0.9, stiffness: 700 },
    slowSpatial: { damping: 0.9, stiffness: 300 },
    fastEffects: { damping: 1, stiffness: 3800 },
    defaultEffects: { damping: 1, stiffness: 1600 },
    slowEffects: { damping: 1, stiffness: 800 },
  },
  expressive: {
    fastSpatial: { damping: 0.6, stiffness: 800 },
    defaultSpatial: { damping: 0.8, stiffness: 380 },
    slowSpatial: { damping: 0.8, stiffness: 200 },
    fastEffects: { damping: 1, stiffness: 3800 },
    defaultEffects: { damping: 1, stiffness: 1600 },
    slowEffects: { damping: 1, stiffness: 800 },
  },
} as const satisfies Record<string, Record<SchemeRole, SpringSpec>>;

/** `MaterialExpressiveTheme`'s default. */
export const ACTIVE_SCHEME = 'expressive' as const satisfies keyof typeof MOTION_SCHEMES;

/**
 * Compose's layout spring, `DampingRatioNoBouncy`, at k700 rather than Compose's own
 * `StiffnessMediumLow` (k400). On a full-screen flight k400 is 90% of the way by ~195ms and then
 * crawls the last few dozen pixels for another ~230ms, which read as slow. k700 is the standard
 * scheme's `defaultSpatial` stiffness: halfway ~64ms, 90% ~147ms, settled ~321ms. Still critically
 * damped, so nothing that docks overshoots.
 */
export const LAYOUT_SPRING = { damping: 1, stiffness: 700 } as const satisfies SpringSpec;

/**
 * Compose's pager snap, `PagerDefaults.snapAnimationSpec`: `spring(StiffnessMediumLow)`, ζ1 k400.
 * Only the tab strip uses it, because the strip is *launched* (at half its rate, `lib/tabStrip.ts`)
 * and a launched spring's first frame scales with its stiffness: launched on `layout`'s k700 it
 * moved 21.5% of the window in its first frame — the lunge the strip was tuned away from.
 */
export const PAGER_SPRING = { damping: 1, stiffness: 400 } as const satisfies SpringSpec;

/**
 * The shared-element flight: the image hero and the forum / folder container transform.
 * Critically damped like every docking spring — the container's mask must never cross its
 * rectangle — but stiffer than `layout`: at k400 and k700 the critically damped tail of a
 * full-screen flight read as slow. k1000 arrives on the clock of the standard scheme's
 * `defaultSpatial` (ζ0.9 k700, `MaterialTheme`'s surface spring — 90% by ~128ms), which could not
 * be used verbatim because its 0.15% overshoot crosses the rectangle: halfway ~53ms, 90% ~123ms,
 * settled ~268ms.
 */
export const FLIGHT_SPRING = { damping: 1, stiffness: 1000 } as const satisfies SpringSpec;

/**
 * A determinate meter's value: Compose's `ProgressIndicatorDefaults.ProgressAnimationSpec`,
 * `spring(DampingRatioNoBouncy, StiffnessVeryLow, visibilityThreshold = 1 / 1000)` — ζ1 k50,
 * verbatim. `ProgressBar` and the vote ratio.
 */
export const PROGRESS_SPRING = { damping: 1, stiffness: 50 } as const satisfies SpringSpec;

/** The named component springs, each a Compose constant or an owner-tuned docking spring. CSS
 * tokens `--motion-base-spring-<name>` are generated from these (`scripts/motionTokens.mjs`). */
export const COMPONENT_SPRINGS = {
  flight: FLIGHT_SPRING,
  pager: PAGER_SPRING,
  progress: PROGRESS_SPRING,
} as const satisfies Record<string, SpringSpec>;

/** The six scheme roles and the layout spring, by name. The component springs are `COMPONENT_SPRINGS`. */
export const SPRINGS = {
  ...MOTION_SCHEMES[ACTIVE_SCHEME],
  layout: LAYOUT_SPRING,
} as const satisfies Record<string, SpringSpec>;

export type SpringName = keyof typeof SPRINGS;

/** The three shapes, by damping ratio. */
export type SpringShape = 'effects' | 'spatial' | 'spatialFast';

export function shapeOf(name: SpringName): SpringShape {
  const { damping } = SPRINGS[name];
  if (damping >= 1) return 'effects';
  return damping < 0.7 ? 'spatialFast' : 'spatial';
}

/** A representative spec per shape, for sampling (the shape depends on ζ alone). */
export const SHAPE_SPEC: Record<SpringShape, SpringSpec> = {
  effects: SPRINGS.defaultEffects,
  spatial: SPRINGS.defaultSpatial,
  spatialFast: SPRINGS.fastSpatial,
};

/**
 * Unnormalised displacement of a unit-mass spring released from rest at 0 and
 * pulled to 1, at time `t` **in seconds**.
 *
 *   ζ < 1   p(t) = 1 − e^(−ζωt)·[cos(ω_d t) + (ζω/ω_d)·sin(ω_d t)]
 *   ζ = 1   p(t) = 1 − e^(−ωt)·(1 + ωt)
 *
 * with ω = √k and ω_d = ω√(1−ζ²).
 */
function displacement({ damping, stiffness }: SpringSpec): (seconds: number) => number {
  const omega = Math.sqrt(stiffness);
  if (Math.abs(damping - 1) < 1e-9) {
    return (t) => 1 - Math.exp(-omega * t) * (1 + omega * t);
  }
  const damped = omega * Math.sqrt(1 - damping * damping);
  return (t) =>
    1 -
    Math.exp(-damping * omega * t) *
      (Math.cos(damped * t) + ((damping * omega) / damped) * Math.sin(damped * t));
}

/**
 * An upper bound on the settle time, from the analytic envelope — used only to bound the sweep
 * below. For ζ < 1 the oscillation is contained by `e^(−ζωt) / √(1 − ζ²)`; for ζ = 1 the fixed
 * point of `x = ln((1 + x) / threshold)` is iterated. The 1.25 margin keeps a rounding difference
 * from truncating a real crossing.
 */
function settleBoundSeconds({ damping, stiffness }: SpringSpec): number {
  const omega = Math.sqrt(stiffness);
  if (Math.abs(damping - 1) < 1e-9) {
    let x = Math.log(1 / SETTLE_THRESHOLD);
    for (let i = 0; i < 8; i += 1) x = Math.log((1 + x) / SETTLE_THRESHOLD);
    return Math.min(4, (1.25 * x) / omega);
  }
  const amplitude = 1 / Math.sqrt(1 - damping * damping);
  return Math.min(4, (1.25 * Math.log(amplitude / SETTLE_THRESHOLD)) / (damping * omega));
}

/**
 * Settle time in seconds: the last moment the spring is still further than `SETTLE_THRESHOLD`
 * from its target. Swept rather than solved because an under-damped spring crosses the threshold
 * several times on the way in. Memoised per spec.
 */
const settleCache = new Map<string, number>();

function settleSeconds(spec: SpringSpec): number {
  const key = `${spec.damping}/${spec.stiffness}`;
  const cached = settleCache.get(key);
  if (cached !== undefined) return cached;
  const p = displacement(spec);
  const step = 0.00005;
  const bound = settleBoundSeconds(spec);
  let last = 0;
  for (let t = 0; t <= bound; t += step) {
    if (Math.abs(1 - p(t)) > SETTLE_THRESHOLD) last = t;
  }
  const settled = last + step;
  settleCache.set(key, settled);
  return settled;
}

/**
 * The spring as an easing function on `t ∈ [0, 1]` — progress against its settle time. Normalised
 * by its own value at the settle time so the last frame is exactly 1 (a uniform scale, under
 * 0.2%, so the shape is kept).
 */
export function springEase(spec: SpringSpec): (progress: number) => number {
  const settle = settleSeconds(spec);
  const p = displacement(spec);
  const end = p(settle);
  return (progress) => {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    return p(progress * settle) / end;
  };
}

/** Settle time in **milliseconds**, rounded — the duration to pair with the ease. */
export function springDurationMs(spec: SpringSpec): number {
  return Math.round(settleSeconds(spec) * 1000);
}

/** Settle time in **seconds**, GSAP's unit. */
export function springDuration(spec: SpringSpec): number {
  return settleSeconds(spec);
}

/**
 * ω in *normalised* time — √k × settle — which is what `lib/hero/spring.ts` takes as `rate`, so a
 * velocity-launched leg over the spring's own settle time flies exactly this spring.
 */
export function springRate(spec: SpringSpec): number {
  return Math.sqrt(spec.stiffness) * settleSeconds(spec);
}

/** Milliseconds for each named spring (the `--motion-base-spring-*` tokens are generated from it). */
export const SPRING_MS = Object.fromEntries(
  Object.entries(SPRINGS).map(([name, spec]) => [name, springDurationMs(spec)]),
) as Record<SpringName, number>;

/** Milliseconds for each component spring (`--motion-base-spring-flight` / `-pager` / `-progress`). A
 * wall-clock wait for a meter to fill reads `COMPONENT_SPRING_MS.progress`, never a role's number. */
export const COMPONENT_SPRING_MS = Object.fromEntries(
  Object.entries(COMPONENT_SPRINGS).map(([name, spec]) => [name, springDurationMs(spec)]),
) as Record<keyof typeof COMPONENT_SPRINGS, number>;

/** Seconds for each named spring, for GSAP's `duration`. */
export const SPRING_DURATION = Object.fromEntries(
  Object.entries(SPRINGS).map(([name, spec]) => [name, springDuration(spec)]),
) as Record<SpringName, number>;

/**
 * The spring as a CSS `linear()` string. Sampled adaptively (Ramer–Douglas–Peucker over a dense
 * sweep), not evenly: an under-damped spring's crest and its trough are where an even 32-point
 * table flattened the overshoot, and its long flat tail is where it wasted points. Every stop is
 * kept within `tolerance` of the closed form.
 */
const linearCache = new Map<string, string>();

export function springToLinear(spec: SpringSpec, tolerance = 0.002): string {
  const key = `${spec.damping}/${spec.stiffness}/${tolerance}`;
  const cached = linearCache.get(key);
  if (cached) return cached;
  const ease = springEase(spec);
  const dense = 1200;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= dense; i += 1) {
    const x = i / dense;
    xs.push(x);
    ys.push(i === dense ? 1 : ease(x));
  }
  const keep = new Uint8Array(dense + 1);
  keep[0] = 1;
  keep[dense] = 1;
  const stack: Array<[number, number]> = [[0, dense]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i += 1) {
      const t = (xs[i] - xs[a]) / (xs[b] - xs[a]);
      const err = Math.abs(ys[i] - (ys[a] + (ys[b] - ys[a]) * t));
      if (err > worst) {
        worst = err;
        at = i;
      }
    }
    if (worst > tolerance && at > 0) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  const stops: string[] = [];
  for (let i = 0; i <= dense; i += 1) {
    if (!keep[i]) continue;
    const value = Number(ys[i].toFixed(4));
    stops.push(i === 0 ? '0' : i === dense ? '1' : `${value} ${Number((xs[i] * 100).toFixed(2))}%`);
  }
  const result = `linear(${stops.join(', ')})`;
  linearCache.set(key, result);
  return result;
}

/** The `linear()` string for a named spring's shape. */
export function springLinear(name: SpringName): string {
  return springToLinear(SHAPE_SPEC[shapeOf(name)]);
}
