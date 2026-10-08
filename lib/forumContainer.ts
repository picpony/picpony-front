/**
 * The forum's container transform, the pure half: its clock, its geometry and the shape of the
 * clip that carries it (`lib/forumTransitionPlay.ts` builds the DOM and plays it). A module of its
 * own so the numbers are a test (`scripts/testForum.mjs`) rather than a comment.
 *
 * **What moves.** One rounded container travels from the list row's rectangle to the post card's
 * (and back); the two contents ride inside it, **anchored at its top left and never scaled** —
 * a row's title slides up to where the card's title sits and cross-fades into it, and the card's
 * slides back down into the row. Scaled content is the failure this replaces: the row used to be
 * stretched to the card's size with its words hidden (a blank slab), and its words then faded in
 * while it was still 1.5× tall. The incoming content wears its own surface and fades in on top of
 * the outgoing one, which stays opaque beneath it (`MaterialContainerTransform`'s `FADE_MODE_IN`),
 * so the container is never empty: whichever content is larger fills it.
 *
 * **Its clock is the tab strip's** (`lib/tabStrip.ts`): a critically damped response launched at
 * twice its mean speed, over the route cross-fade's 400ms. It moves on its first frame (9.5% of
 * the way at 60 Hz) and carries no more than 11% in any frame; `emphasized` at 500ms, the pairing
 * M3 gives a container transform, moves 0.8% in its first frame and 24% in its fastest — the
 * slow start the owner has turned down on every surface — and the hero's `fastOutSlowIn` still
 * hangs back for 45ms before it reaches 10%. On the page's own clock the container lands as the
 * incoming page finishes fading in, so the transform, the page and the tab strip are one gesture
 * in one duration, and the handoff to the live element happens at rest.
 *
 * **Its clip is made of translations only.** A rounded rectangle whose size changes cannot be a
 * scaled box (the corners stretch into ellipses and anything inside scales with it), and an
 * animated `clip-path` or size runs on the main thread, which is at its busiest in the frames
 * after a route commits. So the container is a chain of clipping boxes, each larger than any
 * container and each owning one or two of its corners, translated so that their intersection is
 * the container: two levels (the top edge and the bottom edge) when both ends share a column, as
 * the list and the thread do, four (one per corner) otherwise. Every one of those is a
 * compositor transform with a circular radius.
 *
 * **A leg turns from where it is.** When the page a container is flying into goes away mid-leg —
 * Back pressed while a post or a folder is still opening, Forward while it is closing — the
 * container is not dropped and flown again from its far end: it goes back from the pose on
 * screen, on the tab strip's turn (`turnStrip`: at once, at a fresh tap's launch speed or the
 * speed it already had, over `full · clamp(√remaining, 0.6, 1)`), and the content that was coming
 * in goes back out over the same stretch of travel it came in on (`fadeTrack`).
 */
import { STRIP_DURATION_MS, STRIP_LAUNCH, stripLaunchFor, stripProgress, turnStrip, type StripLeg } from '@/lib/tabStrip';

/** A rectangle, in the overlay's coordinates (px). */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Corner radii, clockwise from the top left: top-left, top-right, bottom-right, bottom-left. */
export type Radii = readonly [number, number, number, number];

/** The container transform's duration at the default speed — the route cross-fade's, and the strip's. */
export const FORUM_TRANSFORM_MS = STRIP_DURATION_MS;

/** A fresh leg's launch: a tap's, in the leg's own normalised units. */
export const FORUM_TRANSFORM_LAUNCH = stripLaunchFor(STRIP_LAUNCH);

/** Progress over the leg's own time, `t ∈ [0, 1]` → `p ∈ [0, 1]`. */
export const forumTransformProgress = stripProgress(FORUM_TRANSFORM_LAUNCH);

/** A fresh leg of `duration` ms (already scaled by the motion speed), as the strip states one. */
export function freshContainerLeg(duration: number): StripLeg {
  return { from: 0, to: 1, duration, launch: FORUM_TRANSFORM_LAUNCH };
}

/**
 * The leg a container turns onto `elapsed` ms into `leg` — the strip's own turn, in the same
 * units: `from`/`to` are travel between the two ends the container was flying between (0 its
 * first end, 1 its second), so a turn of a turn heads for the second end again.
 */
export function turnContainer(leg: StripLeg, elapsed: number, full: number): StripLeg {
  return turnStrip(leg, elapsed, full);
}

/**
 * When each content is on screen, as windows on the container's *progress* (not its clock — the
 * same rule as the hero's thresholds). Opening, the card arrives early, over the first half of
 * the travel; returning, the row arrives late, once the container is most of the way home. The
 * outgoing content never fades: it stays opaque under the incoming one and is covered or cut away.
 */
export const FORUM_FADE = {
  open: { start: 0.05, end: 0.4 },
  back: { start: 0.6, end: 0.9 },
} as const;

/** A clip larger than any container: every edge but the one a level owns is this far away. */
export const SHUTTER_SPAN = 16384;

export const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

export function boxAt(from: Box, to: Box, p: number): Box {
  return {
    left: lerp(from.left, to.left, p),
    top: lerp(from.top, to.top, p),
    width: lerp(from.width, to.width, p),
    height: lerp(from.height, to.height, p),
  };
}

export function radiiAt(from: Radii, to: Radii, p: number): Radii {
  return [lerp(from[0], to[0], p), lerp(from[1], to[1], p), lerp(from[2], to[2], p), lerp(from[3], to[3], p)];
}

const channels = (colour: string): number[] | null => {
  const match = /^rgba?\(([^)]*)\)$/.exec(colour.trim());
  const parts = match?.[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (!parts || parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return null;
  return [parts[0], parts[1], parts[2], parts[3] ?? 1];
};

/** A container's tone `p` of the way between two computed colours (`rgb()`/`rgba()`, as
    `getComputedStyle` gives them); anything else is taken at the nearer end. */
export function colourAt(from: string, to: string, p: number): string {
  if (from === to) return from;
  const a = channels(from);
  const b = channels(to);
  if (!a || !b) return p < 0.5 ? from : to;
  const [r, g, bl, alpha] = a.map((value, index) => lerp(value, b[index], p));
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(bl)}, ${+alpha.toFixed(3)})`;
}

/**
 * Where a leg from `a` to `b` has the container `elapsed` ms in: every level's translation is
 * linear in the box, and the corners and the tone ride the same easing, so this is the clip the
 * shutters draw then. A turn leaves from it, computed rather than read off the shutters: the
 * main thread's animation clock is the last main frame's, which a long task leaves hundreds of
 * milliseconds behind the compositor that is drawing the leg (the strip's turn reads the same
 * clock, `turnStrip`).
 */
export function containerPose(
  leg: StripLeg,
  a: { box: Box; radii: Radii; colour: string },
  b: { box: Box; radii: Radii; colour: string },
  elapsed: number,
): { box: Box; radii: Radii; colour: string } {
  const p = stripProgress(leg.launch)(leg.duration > 0 ? elapsed / leg.duration : 1);
  return { box: boxAt(a.box, b.box, p), radii: radiiAt(a.radii, b.radii, p), colour: colourAt(a.colour, b.colour, p) };
}

/** The part of `rect` inside `view`, or null when nothing of it is. */
export function visibleBox(rect: Box, view: Box): Box | null {
  const left = Math.max(rect.left, view.left);
  const top = Math.max(rect.top, view.top);
  const right = Math.min(rect.left + rect.width, view.left + view.width);
  const bottom = Math.min(rect.top + rect.height, view.top + view.height);
  if (right - left < 1 || bottom - top < 1) return null;
  return { left, top, width: right - left, height: bottom - top };
}

/** Whether both ends share a column, so the two-level clip carries the whole transform. */
export function sameColumn(a: Box, b: Box): boolean {
  return Math.abs(a.left - b.left) <= 0.5 && Math.abs(a.width - b.width) <= 0.5;
}

/**
 * One clipping level: its box before its own translation, in its parent level's coordinates (the
 * first level's parent is the overlay), which corners it rounds, and its translation for a
 * container box. The content frame, last, clips nothing: its origin is the container's top left.
 */
export interface ShutterLevel {
  left: number;
  top: number;
  width: number;
  height: number;
  corners: readonly number[];
  translate: (box: Box) => [number, number];
}

/**
 * The clip chain for a container. Two levels when the column is fixed (`sameColumn`): the top
 * edge with the top corners, the bottom edge with the bottom ones. Four otherwise, one per corner.
 * The last entry is the content frame.
 */
export function shutterLevels(column: { left: number; width: number } | null): ShutterLevel[] {
  const S = SHUTTER_SPAN;
  if (column) {
    return [
      { left: column.left, top: 0, width: column.width, height: S, corners: [0, 1], translate: (b) => [0, b.top] },
      { left: 0, top: -S, width: column.width, height: S, corners: [2, 3], translate: (b) => [0, b.height] },
      { left: 0, top: S, width: 0, height: 0, corners: [], translate: (b) => [0, -b.height] },
    ];
  }
  return [
    { left: 0, top: 0, width: S, height: S, corners: [0], translate: (b) => [b.left, b.top] },
    { left: -S, top: 0, width: S, height: S, corners: [1], translate: (b) => [b.width, 0] },
    { left: S, top: -S, width: S, height: S, corners: [3], translate: (b) => [-b.width, b.height] },
    { left: -S, top: 0, width: S, height: S, corners: [2], translate: (b) => [b.width, 0] },
    { left: S, top: S, width: 0, height: 0, corners: [], translate: (b) => [-b.width, -b.height] },
  ];
}

/**
 * What the chain clips to and where the content frame's origin lands, for a container box — the
 * check that the construction is the container (the tests run it at every sample).
 */
export function resolveShutter(levels: readonly ShutterLevel[], box: Box): { clip: Box; origin: [number, number] } {
  let ox = 0;
  let oy = 0;
  let clip = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
  levels.forEach((level, index) => {
    const [tx, ty] = level.translate(box);
    ox += level.left + tx;
    oy += level.top + ty;
    if (index === levels.length - 1) return;
    clip = {
      left: Math.max(clip.left, ox),
      top: Math.max(clip.top, oy),
      right: Math.min(clip.right, ox + level.width),
      bottom: Math.min(clip.bottom, oy + level.height),
    };
  });
  return {
    clip: { left: clip.left, top: clip.top, width: clip.right - clip.left, height: clip.bottom - clip.top },
    origin: [ox, oy],
  };
}

/** A content's opacity at progress `p` for a fade window. */
export function fadeAt(window: { start: number; end: number }, p: number): number {
  if (p <= window.start) return 0;
  if (p >= window.end) return 1;
  return (p - window.start) / (window.end - window.start);
}

/**
 * The incoming content's opacity over a leg that runs the travel from `from` to `to` (each 0 or 1
 * at the ends, anything between for a turned leg), as keyframes in the leg's own progress: the
 * window is always the same stretch of travel, whichever way it is crossed — a card that came in
 * over 5–40% of the way goes back out over the same 40–5% when the container is sent back.
 * Piecewise linear in the leg's progress (travel is linear in it), so its corners are the only
 * keyframes it needs.
 */
export function fadeTrack(window: { start: number; end: number }, from: number, to: number): { offset: number; opacity: number }[] {
  const at = (u: number) => fadeAt(window, from + (to - from) * u);
  const offsets = new Set([0, 1]);
  if (Math.abs(to - from) > 1e-9) {
    for (const edge of [window.start, window.end]) {
      const u = (edge - from) / (to - from);
      if (u > 0 && u < 1) offsets.add(u);
    }
  }
  return [...offsets].sort((a, b) => a - b).map((offset) => ({ offset, opacity: at(offset) }));
}

/**
 * `ease` as a `linear()` easing, sampled where it bends until each straight segment stays within
 * `tolerance` of it — the Web Animations form of the progress above (keyframe offsets are then
 * in progress, which is what makes the fade windows progress windows).
 */
export function linearEasing(ease: (t: number) => number, tolerance = 0.0015): string {
  const stops: string[] = [`${+ease(0).toFixed(4)} 0%`];
  const split = (t0: number, v0: number, t1: number, v1: number, depth: number) => {
    const mid = (t0 + t1) / 2;
    const value = ease(mid);
    if (depth < 4 || (depth < 12 && Math.abs(value - (v0 + v1) / 2) > tolerance)) {
      split(t0, v0, mid, value, depth + 1);
      split(mid, value, t1, v1, depth + 1);
      return;
    }
    stops.push(`${+v1.toFixed(4)} ${+(t1 * 100).toFixed(3)}%`);
  };
  split(0, ease(0), 1, ease(1), 0);
  return `linear(${stops.join(', ')})`;
}
