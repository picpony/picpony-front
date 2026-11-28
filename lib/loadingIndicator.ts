/**
 * Material 3 Expressive loading indicator geometry and shared clock.
 *
 * Implements the seven-shape morph sequence from Compose's
 * `LoadingIndicatorDefaults.IndeterminateIndicatorPolygons`:
 *   SoftBurst → Cookie9Sided → Pentagon → Pill → Sunny → Cookie4Sided → Oval
 *
 * All seven contours are constructed analytically (circular corner fillets for polygons and
 * stars, exact stadium for Pill, exact ellipse for Oval), aligned at θ = 0 with consistent
 * winding, and resampled at uniform arc-length intervals into 36 cubic Bézier segments so
 * linear interpolation between consecutive shapes stays smooth and twist-free even through
 * spring overshoot.
 *
 * Motion follows Compose's `LoadingIndicator.kt` / `LoadingIndicatorAnimatorDelegate`:
 *   - 650 ms per morph step (`MORPH_INTERVAL_MS`)
 *   - standard tier: underdamped spring (ζ = 0.6, k = 200, ~9.5% lively overshoot, ~99.6% settled at 650 ms)
 *   - reduced tier: critically damped spring (ζ = 1.0, k = 200, zero bounce, ~99.9% settled at 650 ms)
 *   - off tier: rAF loop stands down and CSS rotates the static `SoftBurst` shape gently
 *   - dual rotation per step: 50° continuous linear + 90° spring impulse (140°/step)
 *
 * One shared `requestAnimationFrame` clock drives every active indicator on screen, computing
 * the SVG path and rotation once per frame so a page of loading gallery cards stays light.
 */

import { motionTier, type MotionTier } from '@/lib/appearance';
import { insideConcealedPane } from '@/lib/tabPaneVisibility';

export const LOADING_SHAPE_COUNT = 7;
export const MORPH_INTERVAL_MS = 650;
const SEGMENTS = 36;
const VIEWBOX_CENTER = 50;
/** Fitted radius inside the 0..100 viewBox; leaves headroom for ~9.5% spring overshoot without clipping. */
const FIT_RADIUS = 45.2;

interface Point {
  x: number;
  y: number;
}

/** Packed cubic segments: `SEGMENTS * 6` floats (`cp1x, cp1y, cp2x, cp2y, x, y` per segment). */
type CubicRing = Float32Array;

function clampUnit(value: number): number {
  return value < -1 ? -1 : value > 1 ? 1 : value;
}

function normalize(x: number, y: number): Point {
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

/** Shortest signed angular delta in (-π, π]. */
function shortAngleDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta <= -Math.PI) delta += Math.PI * 2;
  while (delta > Math.PI) delta -= Math.PI * 2;
  return delta;
}

/** Dense polyline for a closed polygon with circular fillets at each vertex. */
function buildRoundedPolygon(vertices: readonly Point[], roundings: readonly number[]): Point[] {
  const count = vertices.length;
  const arcs: { start: Point; end: Point; center: Point; radius: number; a0: number; delta: number }[] = [];

  for (let i = 0; i < count; i += 1) {
    const prev = vertices[(i - 1 + count) % count]!;
    const curr = vertices[i]!;
    const next = vertices[(i + 1) % count]!;
    const inDx = prev.x - curr.x;
    const inDy = prev.y - curr.y;
    const outDx = next.x - curr.x;
    const outDy = next.y - curr.y;
    const lenIn = Math.hypot(inDx, inDy);
    const lenOut = Math.hypot(outDx, outDy);
    const uIn = { x: inDx / (lenIn || 1), y: inDy / (lenIn || 1) };
    const uOut = { x: outDx / (lenOut || 1), y: outDy / (lenOut || 1) };
    const dot = clampUnit(uIn.x * uOut.x + uIn.y * uOut.y);
    const halfAngle = Math.acos(dot) / 2;
    const sinHalf = Math.sin(halfAngle);
    const tanHalf = Math.tan(halfAngle);
    const requested = roundings[i] ?? 0;

    if (requested <= 1e-4 || sinHalf < 1e-4 || tanHalf < 1e-4) {
      arcs.push({ start: curr, end: curr, center: curr, radius: 0, a0: 0, delta: 0 });
      continue;
    }

    const maxCut = 0.49 * Math.min(lenIn, lenOut);
    const cut = Math.min(requested / tanHalf, maxCut);
    const radius = cut * tanHalf;
    const start = { x: curr.x + uIn.x * cut, y: curr.y + uIn.y * cut };
    const end = { x: curr.x + uOut.x * cut, y: curr.y + uOut.y * cut };
    const bisector = normalize(uIn.x + uOut.x, uIn.y + uOut.y);
    const centerDist = radius / sinHalf;
    const center = { x: curr.x + bisector.x * centerDist, y: curr.y + bisector.y * centerDist };
    const a0 = Math.atan2(start.y - center.y, start.x - center.x);
    const a1 = Math.atan2(end.y - center.y, end.x - center.x);
    arcs.push({ start, end, center, radius, a0, delta: shortAngleDelta(a0, a1) });
  }

  const samples: Point[] = [];
  const lineSteps = 10;
  const arcSteps = 20;
  for (let i = 0; i < count; i += 1) {
    const prevArc = arcs[(i - 1 + count) % count]!;
    const arc = arcs[i]!;
    for (let s = 0; s < lineSteps; s += 1) {
      const t = s / lineSteps;
      samples.push({
        x: prevArc.end.x + (arc.start.x - prevArc.end.x) * t,
        y: prevArc.end.y + (arc.start.y - prevArc.end.y) * t,
      });
    }
    if (arc.radius > 1e-4) {
      for (let s = 0; s < arcSteps; s += 1) {
        const angle = arc.a0 + (arc.delta * s) / arcSteps;
        samples.push({
          x: arc.center.x + Math.cos(angle) * arc.radius,
          y: arc.center.y + Math.sin(angle) * arc.radius,
        });
      }
    }
  }
  return samples;
}

/** Alternating outer/inner star vertices in CCW order. */
function buildStar(
  points: number,
  innerRadius: number,
  outerRounding: number,
  innerRounding: number,
  rotation = 0,
): Point[] {
  const vertices: Point[] = [];
  const roundings: number[] = [];
  const total = points * 2;
  for (let i = 0; i < total; i += 1) {
    const angle = rotation + (i * Math.PI * 2) / total;
    const outer = i % 2 === 0;
    const r = outer ? 1 : innerRadius;
    vertices.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
    roundings.push(outer ? outerRounding : innerRounding);
  }
  return buildRoundedPolygon(vertices, roundings);
}

/** Regular n-gon in CCW order. */
function buildRegularPolygon(sides: number, rounding: number, rotation = 0): Point[] {
  const vertices: Point[] = [];
  const roundings: number[] = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = rotation + (i * Math.PI * 2) / sides;
    vertices.push({ x: Math.cos(angle), y: Math.sin(angle) });
    roundings.push(rounding);
  }
  return buildRoundedPolygon(vertices, roundings);
}

/** Stadium / capsule rotated by `rotation`. */
function buildPill(rx: number, ry: number, rotation: number): Point[] {
  const halfStraight = Math.max(0, rx - ry);
  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);
  const rot = (x: number, y: number): Point => ({ x: x * cosR - y * sinR, y: x * sinR + y * cosR });
  const samples: Point[] = [];
  const arcSteps = 48;
  const lineSteps = 16;

  for (let i = 0; i < arcSteps; i += 1) {
    const a = -Math.PI / 2 + (Math.PI * i) / arcSteps;
    samples.push(rot(halfStraight + Math.cos(a) * ry, Math.sin(a) * ry));
  }
  for (let i = 0; i < lineSteps; i += 1) {
    const t = i / lineSteps;
    samples.push(rot(halfStraight - 2 * halfStraight * t, ry));
  }
  for (let i = 0; i < arcSteps; i += 1) {
    const a = Math.PI / 2 + (Math.PI * i) / arcSteps;
    samples.push(rot(-halfStraight + Math.cos(a) * ry, Math.sin(a) * ry));
  }
  for (let i = 0; i < lineSteps; i += 1) {
    const t = i / lineSteps;
    samples.push(rot(-halfStraight + 2 * halfStraight * t, -ry));
  }
  return samples;
}

/** Analytic ellipse rotated by `rotation`. */
function buildOval(rx: number, ry: number, rotation: number): Point[] {
  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);
  const steps = 160;
  const samples: Point[] = [];
  for (let i = 0; i < steps; i += 1) {
    const a = (i * Math.PI * 2) / steps;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    samples.push({ x: x * cosR - y * sinR, y: x * sinR + y * cosR });
  }
  return samples;
}

/**
 * Center, normalize scale, enforce CCW winding, align start to θ = 0, and fit
 * `SEGMENTS` smooth uniform arc-length cubic Bézier curves inside 0..100 viewBox.
 */
function toCubicRing(raw: readonly Point[]): CubicRing {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of raw) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  let maxR = 0;
  const centered = raw.map((p) => {
    const x = p.x - cx;
    const y = p.y - cy;
    const r = Math.hypot(x, y);
    if (r > maxR) maxR = r;
    return { x, y };
  });

  // Deduplicate adjacent coincident samples so tangents never divide by zero.
  const pts: Point[] = [];
  for (const p of centered) {
    const prev = pts[pts.length - 1];
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > 1e-5) pts.push(p);
  }
  if (pts.length > 2 && Math.hypot(pts[0]!.x - pts[pts.length - 1]!.x, pts[0]!.y - pts[pts.length - 1]!.y) <= 1e-5) {
    pts.pop();
  }

  // Enforce consistent positive signed area (CCW in math coordinates / CW on screen).
  let area2 = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    area2 += a.x * b.y - b.x * a.y;
  }
  if (area2 < 0) pts.reverse();

  // Rotate starting index to the point closest to ray θ = 0 (+x axis).
  let bestIdx = 0;
  let bestAngle = Infinity;
  for (let i = 0; i < pts.length; i += 1) {
    const angle = Math.abs(Math.atan2(pts[i]!.y, pts[i]!.x));
    if (angle < bestAngle) {
      bestAngle = angle;
      bestIdx = i;
    }
  }
  const ordered = pts.slice(bestIdx).concat(pts.slice(0, bestIdx));
  const scale = FIT_RADIUS / (maxR || 1);
  const scaled = ordered.map((p) => ({
    x: VIEWBOX_CENTER + p.x * scale,
    y: VIEWBOX_CENTER + p.y * scale,
  }));

  // Cumulative arc length table around the closed loop.
  const count = scaled.length;
  const cum = new Float64Array(count + 1);
  for (let i = 0; i < count; i += 1) {
    const a = scaled[i]!;
    const b = scaled[(i + 1) % count]!;
    cum[i + 1] = cum[i]! + Math.hypot(b.x - a.x, b.y - a.y);
  }
  const total = cum[count]!;

  const sampleAt = (dist: number): Point => {
    const wrapped = ((dist % total) + total) % total;
    let lo = 0;
    let hi = count;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid]! <= wrapped) lo = mid;
      else hi = mid;
    }
    const segLen = cum[lo + 1]! - cum[lo]! || 1;
    const t = (wrapped - cum[lo]!) / segLen;
    const a = scaled[lo]!;
    const b = scaled[(lo + 1) % count]!;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };

  const step = total / SEGMENTS;
  const tangentEps = step * 0.08;
  const knots: Point[] = [];
  const tangents: Point[] = [];
  for (let i = 0; i < SEGMENTS; i += 1) {
    const d = i * step;
    knots.push(sampleAt(d));
    const before = sampleAt(d - tangentEps);
    const after = sampleAt(d + tangentEps);
    tangents.push(normalize(after.x - before.x, after.y - before.y));
  }

  // Hermite-to-cubic conversion: handle length = arc step / 3 matches circular arcs to < 0.04%.
  const handle = step / 3;
  const ring = new Float32Array(SEGMENTS * 6);
  for (let i = 0; i < SEGMENTS; i += 1) {
    const p0 = knots[i]!;
    const t0 = tangents[i]!;
    const p1 = knots[(i + 1) % SEGMENTS]!;
    const t1 = tangents[(i + 1) % SEGMENTS]!;
    const offset = i * 6;
    ring[offset] = p0.x + t0.x * handle;
    ring[offset + 1] = p0.y + t0.y * handle;
    ring[offset + 2] = p1.x - t1.x * handle;
    ring[offset + 3] = p1.y - t1.y * handle;
    ring[offset + 4] = p1.x;
    ring[offset + 5] = p1.y;
  }
  return ring;
}

/** Exact Material 3 Expressive 7-shape indeterminate sequence. */
function buildIndicatorShapes(): readonly CubicRing[] {
  return [
    // 0: SoftBurst — 10-pointed soft rounded burst
    toCubicRing(buildStar(10, 0.68, 0.16, 0.16, 0)),
    // 1: Cookie9Sided — 9-lobed puffy scalloped cookie
    toCubicRing(buildStar(9, 0.85, 0.42, 0.05, -Math.PI / 2)),
    // 2: Pentagon — plump rounded 5-sided polygon
    toCubicRing(buildRegularPolygon(5, 0.44, -Math.PI / 2)),
    // 3: Pill — tilted capsule
    toCubicRing(buildPill(1.0, 0.66, -Math.PI / 4)),
    // 4: Sunny — 8-pointed sunny burst with bold petals
    toCubicRing(buildStar(8, 0.72, 0.24, 0.08, 0)),
    // 5: Cookie4Sided — 4-lobed clover cushion
    toCubicRing(buildStar(4, 0.56, 0.46, 0.14, Math.PI / 4)),
    // 6: Oval — tilted smooth oval
    toCubicRing(buildOval(1.0, 0.68, -Math.PI / 4)),
  ];
}

let cachedShapes: readonly CubicRing[] | null = null;
function shapes(): readonly CubicRing[] {
  return (cachedShapes ??= buildIndicatorShapes());
}

/** Format an interpolated ring as a compact SVG path string (1 decimal precision in 0..100 space). */
function ringToPath(a: CubicRing, b: CubicRing, progress: number): string {
  const last = (SEGMENTS - 1) * 6;
  const sx = a[last + 4]! + (b[last + 4]! - a[last + 4]!) * progress;
  const sy = a[last + 5]! + (b[last + 5]! - a[last + 5]!) * progress;
  let path = `M${sx.toFixed(1)} ${sy.toFixed(1)}`;
  for (let i = 0; i < SEGMENTS; i += 1) {
    const o = i * 6;
    const x1 = a[o]! + (b[o]! - a[o]!) * progress;
    const y1 = a[o + 1]! + (b[o + 1]! - a[o + 1]!) * progress;
    const x2 = a[o + 2]! + (b[o + 2]! - a[o + 2]!) * progress;
    const y2 = a[o + 3]! + (b[o + 3]! - a[o + 3]!) * progress;
    const x = a[o + 4]! + (b[o + 4]! - a[o + 4]!) * progress;
    const y = a[o + 5]! + (b[o + 5]! - a[o + 5]!) * progress;
    path += `C${x1.toFixed(1)} ${y1.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return `${path}Z`;
}

/** Initial static path (`SoftBurst`), used on SSR and under the `off` motion tier. */
export const INITIAL_LOADING_PATH: string = (() => {
  const first = shapes()[0]!;
  return ringToPath(first, first, 0);
})();

/**
 * Closed-form spring progress for a single 650 ms morph step (`stiffness = 200`).
 * Standard tier uses `ζ = 0.6` (AOSP `LoadingIndicatorAnimatorDelegate` overshoot);
 * reduced tier uses `ζ = 1.0` (critically damped, zero bounce).
 */
export function loadingSpringProgress(elapsedMs: number, reduced: boolean): number {
  if (elapsedMs <= 0) return 0;
  const t = Math.min(elapsedMs, MORPH_INTERVAL_MS) / 1000;
  const omega = Math.SQRT2 * 10; // √200
  if (reduced) {
    const wt = omega * t;
    return 1 - Math.exp(-wt) * (1 + wt);
  }
  const zeta = 0.6;
  const damped = omega * 0.8; // √(1 - 0.6²) = 0.8
  return 1 - Math.exp(-zeta * omega * t) * (Math.cos(damped * t) + (zeta / 0.8) * Math.sin(damped * t));
}

export interface LoadingFrame {
  path: string;
  rotationDeg: number;
}

/** Compute the exact morphed SVG path and rotation angle at wall time `elapsedMs`. */
export function sampleLoadingFrame(elapsedMs: number, reduced: boolean): LoadingFrame {
  const list = shapes();
  const safeMs = Math.max(0, elapsedMs);
  const stepIndex = Math.floor(safeMs / MORPH_INTERVAL_MS);
  const stepMs = safeMs - stepIndex * MORPH_INTERVAL_MS;
  const linearFraction = stepMs / MORPH_INTERVAL_MS;
  const springFraction = loadingSpringProgress(stepMs, reduced);

  const from = list[stepIndex % LOADING_SHAPE_COUNT]!;
  const to = list[(stepIndex + 1) % LOADING_SHAPE_COUNT]!;
  // AOSP dual rotation: 50° continuous spin + 90° spring impulse per 650 ms morph.
  const rotationDeg = ((140 * stepIndex + 50 * linearFraction + 90 * springFraction) % 360 + 360) % 360;
  return {
    path: ringToPath(from, to, springFraction),
    rotationDeg,
  };
}

/** Exposes raw packed shapes for deterministic geometry tests. */
export function inspectLoadingShapes(): readonly Float32Array[] {
  return shapes();
}

// ---------------------------------------------------------------------------
// Single shared rAF driver for all visible LoadingIndicator instances
// ---------------------------------------------------------------------------

export interface LoadingSubscriber {
  path: SVGPathElement;
  group: SVGGElement;
  /**
   * Optional host element observed via a pooled per-scroll-root `IntersectionObserver`
   * so off-screen and `@container`-hidden (`display: none`) indicators pause both rAF
   * and CSS rotation (`data-m3e-offscreen`) with zero React re-renders on scroll.
   */
  observe?: Element | null;
}

export interface LoadingIndicatorStats {
  subscribers: number;
  active: number;
  running: boolean;
}

/**
 * Maximum idle gap (ms) before the morph clock resets to shape 0 (`SoftBurst` at 0°).
 * Preserves exact morph phase across same-commit handoffs (e.g. `DetailSkeleton` → `DetailImage`,
 * `FeaturedBannerSkeleton` → `FadeInImage`), while ensuring fresh loads after an idle pause
 * start cleanly from the SSR contour without a frame-1 angle snap.
 */
const CLOCK_RESET_IDLE_MS = 120;

const ANCESTOR_WATCH_ATTRS = [
  'inert',
  'hidden',
  'data-tab-pane-active',
  'data-tab-pane-leaving',
  'data-tab-pane-entering',
  'data-tab-pane-done',
];

const SCROLL_ROOT_SELECTOR =
  '[data-app-scroll-container], .image-detail-overlay-scroll, [data-image-hero-gallery-scroll]';

/** Generous vertical lead-in so even max-height cards start morphing before entering the viewport. */
const VISIBILITY_ROOT_MARGIN = '400px 0px';

interface VisibilityPool {
  observer: IntersectionObserver;
  targets: Map<Element, Set<LoadingSubscriber>>;
}

const subscribers = new Set<LoadingSubscriber>();
const ancestorWatchers = new Map<Element, { observer: MutationObserver; count: number }>();
const subscriberAncestors = new WeakMap<LoadingSubscriber, Element[]>();
const visibilityPools = new Map<Element | null, VisibilityPool>();
const subscriberVisibility = new WeakMap<LoadingSubscriber, { root: Element | null; target: Element; inView: boolean }>();
let rafId = 0;
let originTime = 0;
let lastActiveTime = 0;
let hadActive = false;
let attrObserver: MutationObserver | null = null;
let visibilityBound = false;

function isMotionTierValue(value: string | undefined): value is MotionTier {
  return value === 'standard' || value === 'reduced' || value === 'off';
}

function currentTier(): MotionTier {
  if (typeof document !== 'undefined') {
    const { motion, motionFeedback } = document.documentElement.dataset;
    if (motion === 'custom' && isMotionTierValue(motionFeedback)) {
      return motionFeedback;
    }
  }
  try {
    return motionTier('feedback');
  } catch {
    return 'standard';
  }
}

function isDomElement(node: unknown): node is Element {
  return typeof Element !== 'undefined' && node instanceof Element;
}

/**
 * Whether a subscribed indicator is actually visible and eligible to animate.
 * Skips off-screen / `@container`-hidden targets, disconnected nodes, concealed tab panes,
 * closing `inert` overlays, and `[hidden]` subtrees with zero layout reads.
 */
function isSubscriberActive(sub: LoadingSubscriber): boolean {
  const vis = subscriberVisibility.get(sub);
  if (vis && !vis.inView) return false;
  const el = sub.path;
  if (!isDomElement(el)) return true;
  if (!el.isConnected) return false;
  if (insideConcealedPane(el)) return false;
  if (el.closest('[inert], [hidden]')) return false;
  return true;
}

/**
 * Observe ancestor elements (up to, excluding `<html>`) for `inert`, `hidden`, and tab-pane
 * flag mutations (no `subtree: true`). Shared ancestors like `[data-app-root]`, `<main>`, and
 * `[data-tab-pane]` are ref-counted so 50 gallery cards share one observer per ancestor.
 */
function watchAncestors(sub: LoadingSubscriber) {
  if (typeof MutationObserver === 'undefined' || !isDomElement(sub.path)) return;
  const docRoot = typeof document !== 'undefined' ? document.documentElement : null;
  const ancestors: Element[] = [];
  for (let node: Element | null = sub.path.parentElement; node && node !== docRoot; node = node.parentElement) {
    ancestors.push(node);
  }
  if (ancestors.length === 0) return;
  subscriberAncestors.set(sub, ancestors);
  for (const node of ancestors) {
    const existing = ancestorWatchers.get(node);
    if (existing) {
      existing.count += 1;
    } else {
      const observer = new MutationObserver(syncDriver);
      observer.observe(node, { attributes: true, attributeFilter: ANCESTOR_WATCH_ATTRS });
      ancestorWatchers.set(node, { observer, count: 1 });
    }
  }
}

function unwatchAncestors(sub: LoadingSubscriber) {
  const ancestors = subscriberAncestors.get(sub);
  if (!ancestors) return;
  subscriberAncestors.delete(sub);
  for (const node of ancestors) {
    const entry = ancestorWatchers.get(node);
    if (!entry) continue;
    entry.count -= 1;
    if (entry.count <= 0) {
      entry.observer.disconnect();
      ancestorWatchers.delete(node);
    }
  }
}

/** One shared `IntersectionObserver` per scroll root (R12-010); drives `data-m3e-offscreen` directly. */
function watchVisibility(sub: LoadingSubscriber) {
  const target = sub.observe;
  if (!target || !isDomElement(target) || typeof IntersectionObserver === 'undefined') return;
  const root = target.closest(SCROLL_ROOT_SELECTOR);
  let pool = visibilityPools.get(root);
  if (!pool) {
    const targets = new Map<Element, Set<LoadingSubscriber>>();
    const observer = new IntersectionObserver(
      (entries) => {
        const latest = new Map<Element, boolean>();
        for (const entry of entries) latest.set(entry.target, entry.isIntersecting);
        let changed = false;
        const justEntered: LoadingSubscriber[] = [];
        for (const [el, visible] of latest) {
          if (visible) el.removeAttribute('data-m3e-offscreen');
          else el.setAttribute('data-m3e-offscreen', '');
          const subs = targets.get(el);
          if (!subs) continue;
          for (const s of subs) {
            const state = subscriberVisibility.get(s);
            if (state && state.inView !== visible) {
              state.inView = visible;
              changed = true;
              if (visible && isSubscriberActive(s)) justEntered.push(s);
            }
          }
        }
        if (changed) {
          if (
            rafId !== 0 &&
            justEntered.length > 0 &&
            typeof performance !== 'undefined' &&
            !(typeof document !== 'undefined' && document.hidden)
          ) {
            const tier = currentTier();
            if (tier !== 'off') paintSubscribers(justEntered, performance.now(), tier);
          }
          syncDriver();
        }
      },
      { root, rootMargin: VISIBILITY_ROOT_MARGIN },
    );
    pool = { observer, targets };
    visibilityPools.set(root, pool);
  }
  subscriberVisibility.set(sub, { root, target, inView: false });
  target.setAttribute('data-m3e-offscreen', '');
  let subs = pool.targets.get(target);
  if (!subs) {
    subs = new Set();
    pool.targets.set(target, subs);
    pool.observer.observe(target);
  }
  subs.add(sub);
}

function unwatchVisibility(sub: LoadingSubscriber) {
  const state = subscriberVisibility.get(sub);
  if (!state) return;
  subscriberVisibility.delete(sub);
  const pool = visibilityPools.get(state.root);
  if (!pool) return;
  const subs = pool.targets.get(state.target);
  if (subs) {
    subs.delete(sub);
    if (subs.size === 0) {
      pool.targets.delete(state.target);
      pool.observer.unobserve(state.target);
      state.target.removeAttribute('data-m3e-offscreen');
    }
  }
  if (pool.targets.size === 0 && visibilityPools.get(state.root) === pool) {
    pool.observer.disconnect();
    visibilityPools.delete(state.root);
  }
}

function noteIdle(now: number) {
  if (hadActive) {
    hadActive = false;
    lastActiveTime = now;
  }
}

function ensureOrigin(now: number): number {
  if (!originTime || (!hadActive && lastActiveTime > 0 && now - lastActiveTime > CLOCK_RESET_IDLE_MS)) {
    originTime = now;
  }
  hadActive = true;
  lastActiveTime = 0;
  return originTime;
}

function resetSubscribersToStatic() {
  for (const sub of subscribers) {
    sub.path.setAttribute('d', INITIAL_LOADING_PATH);
    sub.group.removeAttribute('transform');
  }
}

function stopLoop() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

function paintSubscribers(targets: readonly LoadingSubscriber[], now: number, tier: MotionTier) {
  const origin = ensureOrigin(now);
  const frame = sampleLoadingFrame(now - origin, tier === 'reduced');
  const rotate = `rotate(${frame.rotationDeg.toFixed(1)} 50 50)`;
  for (const sub of targets) {
    sub.path.setAttribute('d', frame.path);
    sub.group.setAttribute('transform', rotate);
  }
}

function paintActiveSubscribers(now: number, tier: MotionTier): number {
  const active: LoadingSubscriber[] = [];
  for (const sub of subscribers) {
    if (isSubscriberActive(sub)) active.push(sub);
  }
  if (active.length === 0) {
    noteIdle(now);
    return 0;
  }
  paintSubscribers(active, now, tier);
  return active.length;
}

function tick(now: number) {
  rafId = 0;
  if (subscribers.size === 0 || (typeof document !== 'undefined' && document.hidden)) {
    noteIdle(now);
    return;
  }
  const tier = currentTier();
  if (tier === 'off') {
    noteIdle(now);
    resetSubscribersToStatic();
    return;
  }
  if (paintActiveSubscribers(now, tier) === 0) return;
  rafId = requestAnimationFrame(tick);
}

function syncDriver() {
  if (typeof window === 'undefined' || typeof requestAnimationFrame !== 'function') return;
  const now = typeof performance !== 'undefined' ? performance.now() : 0;
  if (subscribers.size === 0 || (typeof document !== 'undefined' && document.hidden)) {
    stopLoop();
    noteIdle(now);
    return;
  }
  const tier = currentTier();
  if (tier === 'off') {
    stopLoop();
    noteIdle(now);
    resetSubscribersToStatic();
    return;
  }
  const active: LoadingSubscriber[] = [];
  for (const sub of subscribers) {
    if (isSubscriberActive(sub)) active.push(sub);
  }
  if (active.length === 0) {
    stopLoop();
    noteIdle(now);
    return;
  }
  if (!rafId) {
    if (typeof performance !== 'undefined') paintSubscribers(active, now, tier);
    rafId = requestAnimationFrame(tick);
  }
}

function onVisibilityChange() {
  syncDriver();
}

function attachGlobalListeners() {
  if (typeof document === 'undefined') return;
  if (!visibilityBound) {
    visibilityBound = true;
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  if (!attrObserver && typeof MutationObserver !== 'undefined') {
    attrObserver = new MutationObserver(syncDriver);
    attrObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-motion', 'data-motion-effects', 'data-motion-feedback'],
    });
  }
}

function detachGlobalListeners() {
  if (visibilityBound && typeof document !== 'undefined') {
    visibilityBound = false;
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }
  if (attrObserver) {
    attrObserver.disconnect();
    attrObserver = null;
  }
}

/** Read-only snapshot of live subscribers and rAF state for diagnostics and regression tests. */
export function getLoadingIndicatorStats(): LoadingIndicatorStats {
  let active = 0;
  for (const sub of subscribers) {
    if (isSubscriberActive(sub)) active += 1;
  }
  return {
    subscribers: subscribers.size,
    active,
    running: rafId !== 0,
  };
}

/**
 * Subscribe a live indicator SVG to the shared M3E morph clock.
 * Returns an unsubscribe callback; when no visible indicators remain, the clock stops completely.
 */
export function subscribeLoadingIndicator(subscriber: LoadingSubscriber): () => void {
  subscribers.add(subscriber);
  if (subscribers.size === 1) attachGlobalListeners();
  watchAncestors(subscriber);
  watchVisibility(subscriber);
  const tier = currentTier();
  const docHidden = typeof document !== 'undefined' && document.hidden;
  // When the loop is already running, paint this new sibling immediately so it enters in phase.
  // When stopped (`rafId === 0`), `syncDriver()` below performs the single initial paint.
  if (rafId !== 0 && !docHidden && typeof performance !== 'undefined' && tier !== 'off' && isSubscriberActive(subscriber)) {
    paintSubscribers([subscriber], performance.now(), tier);
  }
  syncDriver();
  return () => {
    subscribers.delete(subscriber);
    unwatchAncestors(subscriber);
    unwatchVisibility(subscriber);
    if (subscribers.size === 0) {
      stopLoop();
      detachGlobalListeners();
      noteIdle(typeof performance !== 'undefined' ? performance.now() : 0);
    } else {
      syncDriver();
    }
  };
}
