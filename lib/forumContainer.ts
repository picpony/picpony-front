/**
 * The container transform, the pure half: its clock, its geometry and the shape of the clip that
 * carries it (`lib/containerTransformPlay.ts` builds the DOM and plays it, for a forum post, a
 * folder and a picture opened from a history row). A module of its own so the numbers are a test
 * (`scripts/testForum.mjs`) rather than a comment.
 *
 * **What moves.** One rounded container travels from the list row's rectangle to the post card's
 * (and back); the two contents ride inside it, **anchored at its top left and never scaled** —
 * a row's title slides up to where the card's title sits and the card's slides back down into the
 * row. Scaled content is the failure this replaces: the row used to be stretched to the card's
 * size with its words hidden (a blank slab), and its words then faded in while it was still 1.5×
 * tall. Each content is on screen over a window of the travel (`FORUM_FADE`), over the
 * container's own surface, which is there from the first frame to the last.
 *
 * **Its motion is the hero flight's: Compose's shared-element spring.** A gallery card opening
 * into its picture, a row into its post or its picture and a card into its folder are one gesture
 * — a shared container changing bounds — so all of them fly `SharedTransitionLayout`'s
 * `DefaultBoundsTransform`; ours is the flight spring (`FLIGHT_SPRING`, `lib/spring.ts`), over its own
 * settle time: on the move from the next frame, halfway at ~85ms, 90% of the way by ~195ms, then
 * a soft settle onto the card, never past it. Riding a route change, the route's fade runs on this
 * clock too (`playUnderContainer`, `lib/routeCrossFadePlay.ts`), so the page around the container
 * arrives as it lands, and the handoff to the live element waits for that fade to end
 * (`holdHandoff`).
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
 * screen, on the same spring, over the flight's reversal rule for what is left of the way
 * (`HERO_REVERSE_*`), and each content retraces its own window (`fadeTrack`). It does not coast
 * on the old way first — the reader has just sent it back, as with the tab strip's turn — and
 * it does not lunge either: a Back is a press, and every leg a press starts is the flight's.
 */
import {
  HERO_CONTAINER_FADE,
  HERO_CONTENT_FADE,
  HERO_REVERSE_BASE_RATIO,
  HERO_REVERSE_MIN_DURATION_MS,
  HERO_REVERSE_TRAVEL_RATIO,
} from '@/lib/hero/constants';
import { FLIGHT_SPRING, springDurationMs, springEase, springToLinear } from '@/lib/spring';

/** A rectangle, in the overlay's coordinates (px). */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Corner radii, clockwise from the top left: top-left, top-right, bottom-right, bottom-left. */
export type Radii = readonly [number, number, number, number];

/** The container transform's duration at the default speed, both ways: the layout spring's
 *  settle time, the flight's own (`HERO_DURATIONS`). */
export const FORUM_TRANSFORM_MS = springDurationMs(FLIGHT_SPRING);

/** Its shape: the layout spring, as a Web Animations easing for the legs' keyframes. */
export const FORUM_TRANSFORM_EASING = springToLinear(FLIGHT_SPRING);

/** Progress over a leg's own time, `t ∈ [0, 1]` → `[0, 1]`: the closed form the easing samples. */
export const forumTransformProgress = springEase(FLIGHT_SPRING);

/**
 * One leg: travel from `from` to `to` over `duration` ms (already scaled by the motion speed).
 * Travel runs between the two ends the container flies between, 0 its first end and 1 its
 * second, so a turn of a turn heads for the second end again.
 */
export type ContainerLeg = { from: number; to: number; duration: number };

/** A fresh leg of `duration` ms, from the first end to the second. */
export function freshContainerLeg(duration: number): ContainerLeg {
  return { from: 0, to: 1, duration };
}

/** Where a leg is `elapsed` ms in: its progress (the easing's output) and the travel it has reached. */
export function legAt(leg: ContainerLeg, elapsed: number): { progress: number; travel: number } {
  const progress = forumTransformProgress(leg.duration > 0 ? elapsed / leg.duration : 1);
  return { progress, travel: leg.from + (leg.to - leg.from) * progress };
}

/**
 * The leg a container turns onto `elapsed` ms into `leg`: towards the other end from the pose on
 * screen, over `full · (0.35 + 0.65·√remaining)` — the flight's reversal rule, floored at its
 * 90ms scaled with `full` — so a turn with little left to undo is quick and one from the far end
 * takes a full leg.
 */
export function turnContainer(leg: ContainerLeg, elapsed: number, full: number): ContainerLeg {
  const { travel } = legAt(leg, elapsed);
  const to = leg.to === 1 ? 0 : 1;
  const remaining = Math.min(1, Math.abs(to - travel));
  const share = Math.max(
    HERO_REVERSE_MIN_DURATION_MS / FORUM_TRANSFORM_MS,
    HERO_REVERSE_BASE_RATIO + HERO_REVERSE_TRAVEL_RATIO * Math.sqrt(remaining),
  );
  return { from: travel, to, duration: full * share };
}

/** A window on the travel, `start` → `end`, over which a content comes in (or goes out). */
export type FadeWindow = { readonly start: number; readonly end: number };

/**
 * When each content is on screen, as windows on the container's *travel* (not its clock — the
 * rule `MaterialContainerTransform` applies its thresholds by, and the hero's), and they are the
 * flight's own windows, so a row opening and a card opening hand their contents over on the same
 * stretch of the way:
 *
 * - **Opening**, the row's content goes in the first stretch, 0 → 0.15, as a gallery card's marks
 *   go at take-off, and the larger content comes in over 0.15 → 0.85 (`HERO_CONTENT_FADE`): the box
 *   leads and the page follows. That is 30ms → 128ms on the clock above.
 * - **Returning**, the larger content leaves from the first frame, 0 → 0.6, as the flight's
 *   content does, and the row's comes in late, 0.6 → 0.9 (`HERO_CONTAINER_FADE.back`), once the
 *   container is most of the way home.
 *
 * The two contents are never on screen together at more than a trace. They used to cross: the
 * incoming one came in on top of the outgoing one, which stayed opaque beneath it
 * (`FADE_MODE_IN`, 0.05 → 0.4 opening), and two unscaled contents anchored at one corner doubled
 * every line of text that did not line up — the row's title under the card's for the length of
 * the fade.
 */
export const FORUM_FADE = {
  open: {
    outgoing: { start: 0, end: HERO_CONTENT_FADE.forward.start },
    incoming: HERO_CONTENT_FADE.forward,
  },
  back: { outgoing: HERO_CONTENT_FADE.back, incoming: HERO_CONTAINER_FADE.back },
} as const satisfies Record<'open' | 'back', { outgoing: FadeWindow; incoming: FadeWindow }>;

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
  return [
    lerp(from[0], to[0], p),
    lerp(from[1], to[1], p),
    lerp(from[2], to[2], p),
    lerp(from[3], to[3], p),
  ];
}

const channels = (colour: string): number[] | null => {
  const match = /^rgba?\(([^)]*)\)$/.exec(colour.trim());
  const parts = match?.[1]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
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
 * milliseconds behind the compositor that is drawing the leg (the tab strip's turn reads the same
 * clock, `turnStrip`).
 */
export function containerPose(
  leg: ContainerLeg,
  a: { box: Box; radii: Radii; colour: string },
  b: { box: Box; radii: Radii; colour: string },
  elapsed: number,
): { box: Box; radii: Radii; colour: string } {
  const { progress: p } = legAt(leg, elapsed);
  return {
    box: boxAt(a.box, b.box, p),
    radii: radiiAt(a.radii, b.radii, p),
    colour: colourAt(a.colour, b.colour, p),
  };
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
      {
        left: column.left,
        top: 0,
        width: column.width,
        height: S,
        corners: [0, 1],
        translate: (b) => [0, b.top],
      },
      {
        left: 0,
        top: -S,
        width: column.width,
        height: S,
        corners: [2, 3],
        translate: (b) => [0, b.height],
      },
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
export function resolveShutter(
  levels: readonly ShutterLevel[],
  box: Box,
): { clip: Box; origin: [number, number] } {
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
    clip: {
      left: clip.left,
      top: clip.top,
      width: clip.right - clip.left,
      height: clip.bottom - clip.top,
    },
    origin: [ox, oy],
  };
}

/** A content's opacity at travel `p` for a fade window: coming in across it, or going out. */
export function fadeAt(window: FadeWindow, p: number, out = false): number {
  const shown =
    p <= window.start ? 0 : p >= window.end ? 1 : (p - window.start) / (window.end - window.start);
  return out ? 1 - shown : shown;
}

/**
 * A content's opacity over a leg that runs the travel from `from` to `to` (each 0 or 1 at the
 * ends, anything between for a turned leg), as keyframes in the leg's own progress: the window is
 * always the same stretch of travel, whichever way it is crossed — a card that came in over 15–85%
 * of the way goes back out over the same 85–15% when the container is sent back, and a row that
 * went out over 0–15% comes back over it. Piecewise linear in the leg's progress (travel is linear
 * in it), so its corners are the only keyframes it needs.
 */
export function fadeTrack(
  window: FadeWindow,
  from: number,
  to: number,
  out = false,
): { offset: number; opacity: number }[] {
  const at = (u: number) => fadeAt(window, from + (to - from) * u, out);
  const offsets = new Set([0, 1]);
  if (Math.abs(to - from) > 1e-9) {
    for (const edge of [window.start, window.end]) {
      const u = (edge - from) / (to - from);
      if (u > 0 && u < 1) offsets.add(u);
    }
  }
  return [...offsets].sort((a, b) => a - b).map((offset) => ({ offset, opacity: at(offset) }));
}
