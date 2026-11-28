'use client';

import { scaledMs } from '@/lib/appearance';
import type { MotionCategory } from '@/lib/motionPreferences';
import { springTiming } from '@/lib/springTiming';
import { supportsLinearEasing } from '@/lib/spring';
import { sampleEasing } from '@/lib/sampledAnimation';
import {
  FORUM_TRANSFORM_EASING,
  FORUM_TRANSFORM_MS,
  boxAt,
  containerPose,
  colourAt,
  coverImageRect,
  fadeAt,
  fadeTrack,
  forumTransformProgress,
  freshContainerLeg,
  legAt,
  sameColumn,
  radiiAt,
  sharedContentShift,
  shutterLevels,
  turnContainer,
  type Box,
  type ContainerLeg,
  type FadeWindow,
  type Radii,
  type ShutterLevel,
} from '@/lib/forumContainer';

/**
 * The container transform's DOM half, shared by everything in a list that opens into something
 * larger: a forum post (`lib/forumTransitionPlay.ts`) and a folder (`lib/folderTransitPlay.ts`),
 * both riding the route cross-fade (`lib/routeContainerPlay.ts`), and a picture opened from a list
 * with no shared image to fly (`lib/detailTransitPlay.ts`, the detail overlay). The geometry, the
 * clock and why they are what they are live in `lib/forumContainer.ts`; this file builds the
 * overlay and plays its legs.
 *
 * **It plays on a layer of its own**, holding the container — its surface, there from the first
 * frame to the last — and a copy of each content, each on screen over its own window of the travel
 * (`FORUM_FADE`): the outgoing one goes, then the incoming one comes. Both contents are **anchored
 * at the container's top left and never scaled**, and each stacks as one block (a copy keeps no
 * z-index of its own: the detail overlay's `z-detail-overlay` came along with its copy and painted
 * it over the row arriving above it, so a picture closed back into its row never showed the row
 * until the layer went). The live elements are hidden for the run, so nothing is on screen twice,
 * and the layer is removed once the container has landed, when the live element under it is
 * exactly what the layer shows. Web Animations throughout, every moving part a compositor
 * transform or opacity (the corners and the container's tone are the only main-thread properties,
 * and a frame of lag there is invisible).
 *
 * **A run is a handle, not a one-shot.** Its owner can land it (`finish`), stop it landing on a
 * scroll while a route change restores an offset (`suspend`/`resume`), fade it off where it is
 * (`fadeOut`), or send it from its pose on screen to another rectangle (`turn`): the pose is the
 * leg's own at the display's clock (`containerPose`), the clip carries on — rebuilt only if the
 * new pair needs another shape — and the new leg flies the curve from there (`turnContainer`) with
 * each content retracing its own fade window (`fadeTrack`). Nothing is re-copied for a turn: the
 * contents are already in the frame, anchored at the container's corner, and simply ride the new
 * leg.
 */

export interface Surface {
  box: Box;
  radii: Radii;
  colour: string;
}

export type Hidden = { el: HTMLElement; prop: 'visibility' | 'opacity'; value: string };

export const radiiOf = (style: CSSStyleDeclaration): Radii => [
  parseFloat(style.borderTopLeftRadius) || 0,
  parseFloat(style.borderTopRightRadius) || 0,
  parseFloat(style.borderBottomRightRadius) || 0,
  parseFloat(style.borderBottomLeftRadius) || 0,
];

export const rectOf = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};

export function surfaceOf(el: Element, box: Box): Surface {
  const style = getComputedStyle(el);
  return { box, radii: radiiOf(style), colour: style.backgroundColor };
}

const CORNER_PROPS = [
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomRightRadius',
  'borderBottomLeftRadius',
] as const;

/** The markers a copy must not carry, or a lookup for the live element would resolve into it. */
const COPY_MARKERS = [
  'data-forum-row',
  'data-forum-card',
  'data-detail-origin',
  'data-folder-card',
  'data-folder-page',
];

export function hide(el: HTMLElement, prop: 'visibility' | 'opacity', hidden: Hidden[]) {
  hidden.push({ el, prop, value: el.style[prop] });
  el.style[prop] = prop === 'visibility' ? 'hidden' : '0';
}

export function reveal(hidden: Hidden[]) {
  for (const { el, prop, value } of hidden) el.style[prop] = value;
  hidden.length = 0;
}

/**
 * A copy, placed in the content frame at its offset from the container's top left. Its corners
 * are the original's, written out: a lone list row in the frame would take a whole run's shape
 * from the list rules, and its corners would change at the handoff. Its z-index is the layer's to
 * decide, so it is a stacking context at zero: whatever its original stacked at, and whatever its
 * descendants stack at, stays inside it.
 */
function place(node: HTMLElement, box: Box, anchor: Box, radii: Radii) {
  for (const marker of COPY_MARKERS) node.removeAttribute(marker);
  node.style.position = 'absolute';
  node.style.margin = '0';
  node.style.left = `${box.left - anchor.left}px`;
  node.style.top = `${box.top - anchor.top}px`;
  node.style.width = `${box.width}px`;
  node.style.height = `${box.height}px`;
  node.style.transform = 'none';
  node.style.zIndex = '0';
  node.style.opacity = '';
  node.style.visibility = 'visible';
  CORNER_PROPS.forEach((prop, corner) => {
    node.style[prop] = `${radii[corner]}px`;
  });
}

/**
 * **A copy is a still frame**, as the route cross-fade's are (globals.css stills everything in
 * that layer): an entrance keyframe or a shimmer copied with its element starts again from its
 * first frame the moment the copy is attached — a folder page's grid placeholder faded in a second
 * time inside the container. An entrance is finished (it lands on its end state); a loop, which
 * cannot finish, is cancelled.
 */
function still(root: HTMLElement) {
  for (const animation of root.getAnimations({ subtree: true })) {
    if (!(animation instanceof CSSAnimation) && !(animation instanceof CSSTransition)) continue;
    try {
      animation.finish();
    } catch {
      animation.cancel();
    }
  }
}

/** One endpoint of a shared media element riding the container (viewport coords). */
export interface SharedMediaEnd {
  box: Box;
  radii: Radii;
  /** Vertical `object-position` fraction: `0.5` centred (default), `0` top-aligned. */
  anchorY?: number;
}

/**
 * A shared picture that stays opaque throughout the container transform — e.g., a folder card's
 * cover flying into the folder grid's matching picture (and back) — morphing its bounds, circular
 * corners and `object-cover` crop on the same spring clock without stretching the artwork.
 */
export interface SharedMedia {
  src: string;
  /** Natural aspect ratio (`naturalWidth / naturalHeight`). */
  ratio: number;
  from: SharedMediaEnd;
  to: SharedMediaEnd;
}

export interface ContainerRun {
  from: Surface;
  to: Surface;
  /**
   * The outgoing content's copy and its own box (viewport), anchored at `from` — or null when
   * there is nothing left to carry: the container then comes in with the incoming content.
   */
  outgoing: { el: HTMLElement; box: Box } | null;
  /** The incoming content's copy and its own box (viewport), anchored at `to`. */
  incoming: HTMLElement;
  incomingBox: Box;
  /** Optional shared picture morphing between `from` and `to` above the cross-fading contents. */
  shared?: SharedMedia | null;
  /** When each content is on screen, as windows on the travel (`FORUM_FADE`). */
  fade: { readonly outgoing: FadeWindow; readonly incoming: FadeWindow };
  /** Live elements hidden for the run, shown again at the handoff. */
  hidden: Hidden[];
}

export interface ContainerStage {
  /** Whose motion preference times it — the speed and the tier of the screen it opens. */
  category: MotionCategory;
  /** Puts the layer into the document, where it stacks above what it covers; false to give up. */
  mount: (layer: HTMLElement) => boolean;
  /** The layer's z-index, a `--z-*` token. */
  zIndex: string;
  /** A scroll here moves the live element out from under the layer: land at once. */
  scroller: HTMLElement | null;
  /** While true after the container lands, the handoff waits (the forum: the route's own fade). */
  holdHandoff?: () => boolean;
  /** The wall-clock bound, already at the slowest speed (docs/motion-system.md#animation-watchdogs). */
  boundMs: number;
  /**
   * Hand off by fading the layer out over the live element (FastEffects) rather than removing it
   * in one frame. For an incoming copy that may have gone stale during the run — the picture
   * detail is copied as it mounts, and its picture or its record can land before the container
   * does — so whatever changed under the layer cross-fades in instead of popping.
   */
  handoffFade?: boolean;
  /** Called once the layer is gone and the live elements are back. */
  onDone?: () => void;
}

/** Where a turned container goes, and what of the page it lands on stays hidden until it does. */
export interface ContainerTurn {
  to: Surface;
  /** Where an active shared picture should turn to; absent or null fades it off in place. */
  sharedTo?: SharedMediaEnd | null;
  /** Live elements already hidden by the caller — the new destination — shown again at the handoff. */
  hidden: Hidden[];
}

export interface ContainerHandle {
  /** Lands it at once: the layer goes and the live elements come back. Idempotent. */
  finish: () => void;
  /** Stops it landing on a scroll or a resize (a route change is about to restore an offset). */
  suspend: () => void;
  /** And lets it again, counting from wherever the scroller now is. */
  resume: () => void;
  /** Fades the layer off where it is, on FastEffects, and then finishes. */
  fadeOut: () => void;
  /** Sends the container from its pose on screen to `target`. False when it cannot carry one. */
  turn: (target: ContainerTurn) => boolean;
  readonly done: boolean;
}

/** What a run that could not start hands back. */
const LANDED: ContainerHandle = {
  finish() {},
  suspend() {},
  resume() {},
  fadeOut() {},
  turn: () => false,
  done: true,
};

interface Chain {
  /** The column both ends share, or null for the four-corner chain (`shutterLevels`). */
  column: { left: number; width: number } | null;
  levels: ShutterLevel[];
  elements: HTMLElement[];
  frame: HTMLElement;
}

/** The column the pair `a` → `b` shares, if it shares one: what decides the chain's shape. */
const columnOf = (a: Box, b: Box) => (sameColumn(a, b) ? { left: a.left, width: a.width } : null);

/** Whether a chain built for one column carries a pair needing the other. */
const sameShape = (a: Chain['column'], b: Chain['column']) =>
  a === null || b === null ? a === b : Math.abs(a.left - b.left) <= 0.5 && Math.abs(a.width - b.width) <= 0.5;

/** The clip chain for the pair `a` → `b` (`shutterLevels`), corners at `radii`, under `parent`. */
function buildChain(parent: HTMLElement, a: Box, b: Box, radii: Radii): Chain {
  const column = columnOf(a, b);
  const levels = shutterLevels(column);
  const elements: HTMLElement[] = [];
  let host = parent;
  for (const [index, level] of levels.entries()) {
    const el = document.createElement('div');
    el.dataset.containerShutter = String(index);
    Object.assign(el.style, {
      position: 'absolute',
      left: `${level.left}px`,
      top: `${level.top}px`,
      width: `${level.width}px`,
      height: `${level.height}px`,
      overflow: level.corners.length > 0 ? 'clip' : 'visible',
      willChange: 'transform',
    });
    for (const corner of level.corners) el.style[CORNER_PROPS[corner]] = `${radii[corner]}px`;
    host.appendChild(el);
    elements.push(el);
    host = el;
  }
  return { column, levels, elements, frame: host };
}

/** Builds the layer and plays its first leg. */
export function playContainerRun(run: ContainerRun, stage: ContainerStage): ContainerHandle {
  const layer = document.createElement('div');
  layer.setAttribute('data-container-transform', '');
  layer.setAttribute('aria-hidden', 'true');
  layer.inert = true;
  Object.assign(layer.style, {
    position: 'absolute',
    inset: '0',
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: stage.zIndex,
  });
  if (!stage.mount(layer)) {
    reveal(run.hidden);
    stage.onDone?.();
    return LANDED;
  }
  const origin = layer.getBoundingClientRect();
  const local = (b: Box): Box => ({
    left: b.left - origin.left,
    top: b.top - origin.top,
    width: b.width,
    height: b.height,
  });
  const from = local(run.from.box);
  const to = local(run.to.box);

  /* The container's surface, as large as it ever gets, under both contents: it is what shows
     where neither content's own box reaches (a row's box is shorter than the card it leaves) and
     between the two windows. A turn that sends it somewhere larger grows it with it. */
  const surface = document.createElement('div');
  Object.assign(surface.style, {
    position: 'absolute',
    left: '0px',
    top: '0px',
    backgroundColor: run.from.colour,
  });
  const reach = { width: 0, height: 0 };
  const cover = (box: Box) => {
    reach.width = Math.max(reach.width, box.width);
    reach.height = Math.max(reach.height, box.height);
    Object.assign(surface.style, { width: `${reach.width}px`, height: `${reach.height}px` });
  };
  const leavingShift = run.outgoing ? document.createElement('div') : null;
  if (leavingShift) {
    Object.assign(leavingShift.style, {
      position: 'absolute',
      left: '0px',
      top: '0px',
      width: '0px',
      height: '0px',
    });
  }
  const arrivingShift = document.createElement('div');
  Object.assign(arrivingShift.style, {
    position: 'absolute',
    left: '0px',
    top: '0px',
    width: '0px',
    height: '0px',
  });
  const arriving = document.createElement('div');
  Object.assign(arriving.style, {
    position: 'absolute',
    left: '0px',
    top: '0px',
    width: '0px',
    height: '0px',
  });
  /* Both contents are laid out at their own width, so their words wrap exactly as on the page. */
  if (run.outgoing && leavingShift) {
    place(run.outgoing.el, run.outgoing.box, run.from.box, run.from.radii);
    leavingShift.append(run.outgoing.el);
  }
  place(run.incoming, run.incomingBox, run.to.box, run.to.radii);
  arriving.append(run.incoming);
  arrivingShift.append(arriving);
  cover(from);
  cover(to);
  let chain = buildChain(layer, from, to, run.from.radii);
  chain.elements[0].style.zIndex = '0';
  chain.frame.append(surface, ...(leavingShift ? [leavingShift] : []), arrivingShift);

  type Shift = { x: number; y: number };
  type SharedPose = { box: Box; radii: Radii; img: Box };
  let sharedState: { chain: Chain; img: HTMLImageElement; ratio: number; baseW: number } | null = null;
  let sharedEnds: { a: SharedPose; b: SharedPose } | null = null;
  let outSlotOffset: Shift | null = null;
  let inSlotOffset: Shift | null = null;
  let outShiftEnds: { a: Shift; b: Shift } | null = null;
  let inShiftEnds: { a: Shift; b: Shift } | null = null;
  let sharedRetiring: Animation | null = null;
  if (run.shared) {
    const sharedFromBox = local(run.shared.from.box);
    const sharedToBox = local(run.shared.to.box);
    const ratio = Number.isFinite(run.shared.ratio) && run.shared.ratio > 0 ? run.shared.ratio : 1;
    const fromImg = coverImageRect(sharedFromBox.width, sharedFromBox.height, ratio, run.shared.from.anchorY ?? 0.5);
    const toImg = coverImageRect(sharedToBox.width, sharedToBox.height, ratio, run.shared.to.anchorY ?? 0.5);
    const baseW = Math.max(fromImg.width, toImg.width, 1);
    const baseH = baseW / ratio;
    const sharedChain = buildChain(layer, sharedFromBox, sharedToBox, run.shared.from.radii);
    sharedChain.elements[0].setAttribute('data-container-shared', '');
    sharedChain.elements[0].style.zIndex = '1';
    const img = document.createElement('img');
    img.src = run.shared.src;
    img.alt = '';
    img.decoding = 'async';
    Object.assign(img.style, {
      position: 'absolute',
      left: '0px',
      top: '0px',
      width: `${baseW}px`,
      height: `${baseH}px`,
      maxWidth: 'none',
      maxHeight: 'none',
      transformOrigin: '0 0',
      willChange: 'transform',
    });
    sharedChain.frame.append(img);
    sharedState = { chain: sharedChain, img, ratio, baseW };
    sharedEnds = {
      a: { box: sharedFromBox, radii: run.shared.from.radii, img: fromImg },
      b: { box: sharedToBox, radii: run.shared.to.radii, img: toImg },
    };
    /* Keep outgoing and incoming contents aligned to the flying shared slot so headers unfold
       cleanly above the cover and neighbouring grid cards glide in lockstep beside it. */
    outSlotOffset = { x: sharedFromBox.left - from.left, y: sharedFromBox.top - from.top };
    inSlotOffset = { x: sharedToBox.left - to.left, y: sharedToBox.top - to.top };
    if (leavingShift) {
      leavingShift.style.willChange = 'transform';
      outShiftEnds = {
        a: sharedContentShift(from, sharedFromBox, outSlotOffset),
        b: sharedContentShift(to, sharedToBox, outSlotOffset),
      };
    }
    arrivingShift.style.willChange = 'transform';
    inShiftEnds = {
      a: sharedContentShift(from, sharedFromBox, inSlotOffset),
      b: sharedContentShift(to, sharedToBox, inSlotOffset),
    };
  }
  still(layer);
  /* With no outgoing content the whole container arrives through its fade, surface and all. */
  const fading = run.outgoing ? arriving : layer;

  const full = scaledMs(FORUM_TRANSFORM_MS, stage.category);
  /** The current leg's two ends, for the pose a turn leaves from (`containerPose`). */
  let ends: { a: Surface; b: Surface };
  const legacySamples = supportsLinearEasing() ? null : sampleEasing(forumTransformProgress);
  const track = (frame: (progress: number) => Keyframe): Keyframe[] =>
    legacySamples
      ? legacySamples.map(({ offset, progress }) => ({ ...frame(progress), offset }))
      : [frame(0), frame(1)];
  const animateShutters = (
    targetChain: Chain,
    aBox: Box,
    bBox: Box,
    aRadii: Radii,
    bRadii: Radii,
    timing: KeyframeAnimationOptions,
    list: Animation[],
  ) => {
    targetChain.levels.forEach((level, index) => {
      const el = targetChain.elements[index];
      const [x0, y0] = level.translate(aBox);
      const [x1, y1] = level.translate(bBox);
      list.push(
        el.animate(
          track((p) => ({
            transform: `translate(${x0 + (x1 - x0) * p}px, ${y0 + (y1 - y0) * p}px)`,
          })),
          timing,
        ),
      );
      /* The corners, on an animation of their own so the transform above stays on the compositor. */
      const corners = level.corners.filter((corner) => aRadii[corner] !== bRadii[corner]);
      if (corners.length > 0) {
        const at = (radii: Radii) =>
          Object.fromEntries(corners.map((corner) => [CORNER_PROPS[corner], `${radii[corner]}px`]));
        list.push(
          el.animate(
            track((p) => at(radiiAt(aRadii, bRadii, p))),
            timing,
          ),
        );
      }
    });
  };
  const sharedImgTransform = (rect: Box, baseW: number) =>
    `translate(${rect.left}px, ${rect.top}px) scale(${rect.width / baseW})`;
  const shiftAt = (a: Shift, b: Shift, p: number): Shift => ({
    x: a.x + (b.x - a.x) * p,
    y: a.y + (b.y - a.y) * p,
  });
  const animateShift = (el: HTMLElement, a: Shift, b: Shift, timing: KeyframeAnimationOptions, list: Animation[]) => {
    if (Math.abs(a.x) <= 0.01 && Math.abs(a.y) <= 0.01 && Math.abs(b.x) <= 0.01 && Math.abs(b.y) <= 0.01) {
      el.style.transform = '';
      return;
    }
    list.push(
      el.animate(
        track((p) => {
          const s = shiftAt(a, b, p);
          return { transform: `translate(${s.x}px, ${s.y}px)` };
        }),
        timing,
      ),
    );
  };
  /**
   * One leg: the clip from `a` to `b`, its corners and its tone, and each content over its own
   * stretch of the travel. Offsets are in progress (the easing), so the fade windows are windows
   * on the travel.
   */
  const playLeg = (leg: ContainerLeg, a: Surface, b: Surface): Animation[] => {
    ends = { a, b };
    const timing: KeyframeAnimationOptions = {
      duration: leg.duration,
      easing: legacySamples ? 'linear' : FORUM_TRANSFORM_EASING,
      fill: 'both',
    };
    const list: Animation[] = [];
    animateShutters(chain, a.box, b.box, a.radii, b.radii, timing, list);
    if (leavingShift && outShiftEnds) animateShift(leavingShift, outShiftEnds.a, outShiftEnds.b, timing, list);
    if (inShiftEnds) animateShift(arrivingShift, inShiftEnds.a, inShiftEnds.b, timing, list);
    if (sharedState && sharedEnds) {
      const { a: sa, b: sb } = sharedEnds;
      const { baseW } = sharedState;
      animateShutters(sharedState.chain, sa.box, sb.box, sa.radii, sb.radii, timing, list);
      list.push(
        sharedState.img.animate(
          track((p) => ({ transform: sharedImgTransform(boxAt(sa.img, sb.img, p), baseW) })),
          timing,
        ),
      );
    }
    if (a.colour !== b.colour)
      list.push(
        surface.animate(
          legacySamples
            ? track((p) => ({ backgroundColor: colourAt(a.colour, b.colour, p) }))
            : [{ backgroundColor: a.colour }, { backgroundColor: b.colour }],
          timing,
        ),
      );
    /* The outgoing content goes over its window and the incoming one comes over its own, on top
       of it, so where the two would meet the newer one is in front. */
    const fade = (window: FadeWindow, out = false) =>
      legacySamples
        ? track((p) => ({ opacity: fadeAt(window, leg.from + (leg.to - leg.from) * p, out) }))
        : fadeTrack(window, leg.from, leg.to, out);
    if (run.outgoing) list.push(run.outgoing.el.animate(fade(run.fade.outgoing, true), timing));
    list.push(fading.animate(fade(run.fade.incoming), timing));
    /* One frame ahead: the first frame that shows the container already shows it moving (the
       curve leaves at once), rather than the page it replaced standing still. A current time,
       not a start time, so the leg stays pending until the compositor draws it, and starts there.
       The frame that brings the layer in has a whole page's copy to paint and raster — about
       120ms on the development server — and the display keeps showing the old frame until it is
       ready; a start time fixed when the leg was built (a commit's, which is stale after a long
       task, or the building frame's own) was spent in that wait, and the container's first frame
       on screen was 45% of the way along. On the main thread a pending leg reads its first pose
       for those frames; that is not what the display shows, and measuring it per rAF misleads. */
    const leadMs = Math.min(1000 / 60, leg.duration * 0.08);
    for (const animation of list) animation.currentTime = leadMs;
    return list;
  };

  let leg = freshContainerLeg(full);
  let animations = playLeg(
    leg,
    { box: from, radii: run.from.radii, colour: run.from.colour },
    { box: to, radii: run.to.radii, colour: run.to.colour },
  );
  let hidden = run.hidden;

  let done = false;
  let poll = 0;
  let watchdog = 0;
  let retiring: Animation | null = null;
  let listening = false;
  let startScroll = 0;
  const scroller = stage.scroller;

  /* A scroll moves the live element out from under the layer: land at once. A restore that
     happened before this frame does not count, only a real scroll gets here. */
  const onScroll = () => {
    if (scroller && Math.abs(scroller.scrollTop - startScroll) > 1) finish();
  };
  const listen = (on: boolean) => {
    if (on === listening) return;
    listening = on;
    if (on) {
      startScroll = scroller?.scrollTop ?? 0;
      scroller?.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', finish);
    } else {
      scroller?.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', finish);
    }
  };
  const finish = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(poll);
    window.clearTimeout(watchdog);
    listen(false);
    window.removeEventListener('pointerdown', finish, true);
    window.removeEventListener('keydown', finish, true);
    for (const animation of animations) animation.cancel();
    retiring?.cancel();
    sharedRetiring?.cancel();
    layer.remove();
    reveal(hidden);
    stage.onDone?.();
  };
  const fadeOff = (onEnd: () => void) => {
    const opacity = getComputedStyle(layer).opacity;
    retiring = layer.animate([{ opacity }, { opacity: 0 }], {
      ...springTiming('fastEffects', stage.category),
      fill: 'forwards',
    });
    retiring.finished.then(onEnd, () => {});
  };
  let leaving = false;
  const handoff = () => {
    if (done || leaving) return;
    if (stage.holdHandoff?.()) {
      poll = requestAnimationFrame(handoff);
      return;
    }
    if (!stage.handoffFade) {
      finish();
      return;
    }
    /* The live element comes back under the layer, which then fades off it. */
    reveal(hidden);
    fadeOff(finish);
  };
  /**
   * Waits for the leg to land, then hands off; bounded by the wall clock either way — counted
   * from the leg's first frame, as the route cross-fade's own bound is. A new animation is pending
   * until a frame starts it, and a long task right after the commit it plays from would hold it
   * there: a bound counted from its creation cut the leg's tail and its handoff short.
   */
  const arm = () => {
    const current = animations;
    Promise.all(current.map((animation) => animation.finished)).then(
      () => {
        if (animations === current && !done) poll = requestAnimationFrame(handoff);
      },
      () => {},
    );
    window.clearTimeout(watchdog);
    const bound = () => {
      if (animations === current && !done) watchdog = window.setTimeout(finish, stage.boundMs + 300);
    };
    if (current[0]) current[0].ready.then(bound, () => {});
    else bound();
  };
  listen(true);
  window.addEventListener('pointerdown', finish, true);
  window.addEventListener('keydown', finish, true);
  arm();

  /**
   * How far into its leg the display has the container. The main thread's animation clock is the
   * last main frame's, and the frame a turn is claimed in typically comes after a long task (the
   * page it lands on rendering) during which the compositor drew the leg on: read off the
   * shutters, the pose was that far behind the display, and the container jumped back to it —
   * a Back pressed mid-open on the development server showed the folder's container land full,
   * then reappear 58px lower and 148px shorter. A leg not started yet is still at its first pose.
   */
  const elapsedNow = (): number => {
    const start = animations[0]?.startTime;
    if (typeof start !== 'number') return Math.min(leg.duration, 1000 / 60);
    return Math.min(leg.duration, Math.max(0, performance.now() - start));
  };

  const turn = (target: ContainerTurn): boolean => {
    /* With no outgoing content there is nothing to land on at the far end. */
    if (done || leaving || !run.outgoing) return false;
    const elapsed = elapsedNow();
    const { progress } = legAt(leg, elapsed);
    const now = containerPose(leg, ends.a, ends.b, elapsed);
    const nowShared: SharedPose | null =
      sharedState && sharedEnds
        ? {
            box: boxAt(sharedEnds.a.box, sharedEnds.b.box, progress),
            radii: radiiAt(sharedEnds.a.radii, sharedEnds.b.radii, progress),
            img: boxAt(sharedEnds.a.img, sharedEnds.b.img, progress),
          }
        : null;
    const nowOutShift = outShiftEnds ? shiftAt(outShiftEnds.a, outShiftEnds.b, progress) : null;
    const nowInShift = inShiftEnds ? shiftAt(inShiftEnds.a, inShiftEnds.b, progress) : null;
    cancelAnimationFrame(poll);
    poll = 0;
    retiring?.cancel();
    retiring = null;
    for (const animation of animations) animation.cancel();
    const next = local(target.to.box);
    const column = columnOf(now.box, next);
    if (sameShape(chain.column, column)) {
      /* The clip it has carries the new pair — a turn sends a container back along its own pair,
         which needs the same shape: only the translations change, from the corners it has now.
         Nothing it holds is moved or painted again, so the turn's frame commits new animations
         rather than a page's copy re-parented into new layers. */
      chain.levels.forEach((level, index) => {
        for (const corner of level.corners)
          chain.elements[index].style[CORNER_PROPS[corner]] = `${now.radii[corner]}px`;
      });
    } else {
      /* A clip for the new pair, at the pose it is leaving from, with the contents moved across:
         they sit at the container's corner in both chains, so nothing they show moves. */
      const old = chain;
      chain = buildChain(layer, now.box, next, now.radii);
      chain.elements[0].style.zIndex = '0';
      chain.frame.append(...old.frame.childNodes);
      old.elements[0].remove();
    }
    if (sharedState && nowShared) {
      if (target.sharedTo) {
        const nextBox = local(target.sharedTo.box);
        const nextColumn = columnOf(nowShared.box, nextBox);
        if (sameShape(sharedState.chain.column, nextColumn)) {
          sharedState.chain.levels.forEach((level, index) => {
            for (const corner of level.corners) {
              sharedState!.chain.elements[index].style[CORNER_PROPS[corner]] = `${nowShared.radii[corner]}px`;
            }
          });
        } else {
          const old = sharedState.chain;
          sharedState.chain = buildChain(layer, nowShared.box, nextBox, nowShared.radii);
          sharedState.chain.elements[0].setAttribute('data-container-shared', '');
          sharedState.chain.elements[0].style.zIndex = '1';
          sharedState.chain.frame.append(sharedState.img);
          old.elements[0].remove();
        }
        sharedEnds = {
          a: nowShared,
          b: {
            box: nextBox,
            radii: target.sharedTo.radii,
            img: coverImageRect(nextBox.width, nextBox.height, sharedState.ratio, target.sharedTo.anchorY ?? 0.5),
          },
        };
        if (nowOutShift && outSlotOffset) {
          outShiftEnds = { a: nowOutShift, b: sharedContentShift(next, nextBox, outSlotOffset) };
        }
        if (nowInShift && inSlotOffset) {
          inShiftEnds = { a: nowInShift, b: sharedContentShift(next, nextBox, inSlotOffset) };
        }
      } else {
        /* No shared target on the destination: pin the flyer at its current pose and fade it out. */
        const retiringEl = sharedState.chain.elements[0];
        sharedState.chain.levels.forEach((level, index) => {
          const el = sharedState!.chain.elements[index];
          const [tx, ty] = level.translate(nowShared.box);
          el.style.transform = `translate(${tx}px, ${ty}px)`;
          for (const corner of level.corners) el.style[CORNER_PROPS[corner]] = `${nowShared.radii[corner]}px`;
        });
        sharedState.img.style.transform = sharedImgTransform(nowShared.img, sharedState.baseW);
        sharedRetiring?.cancel();
        sharedRetiring = retiringEl.animate([{ opacity: 1 }, { opacity: 0 }], {
          ...springTiming('fastEffects', stage.category),
          fill: 'forwards',
        });
        sharedRetiring.finished.then(
          () => retiringEl.remove(),
          () => {},
        );
        sharedState = null;
        sharedEnds = null;
        if (nowOutShift) outShiftEnds = { a: nowOutShift, b: { x: 0, y: 0 } };
        if (nowInShift) inShiftEnds = { a: nowInShift, b: { x: 0, y: 0 } };
      }
    } else {
      if (nowOutShift) outShiftEnds = { a: nowOutShift, b: { x: 0, y: 0 } };
      if (nowInShift) inShiftEnds = { a: nowInShift, b: { x: 0, y: 0 } };
    }
    cover(next);
    leg = turnContainer(leg, elapsed, full);
    animations = playLeg(leg, now, { box: next, radii: target.to.radii, colour: target.to.colour });
    /* The live elements the old leg kept hidden belong to the page it was flying into, which has
       gone; the new destination is the caller's, already hidden. */
    reveal(hidden);
    hidden = target.hidden;
    listen(false);
    listen(true);
    arm();
    return true;
  };

  return {
    finish,
    suspend: () => listen(false),
    resume: () => {
      if (!done) listen(true);
    },
    fadeOut: () => {
      if (done || leaving) return;
      leaving = true;
      cancelAnimationFrame(poll);
      /* Already fading off its live element at the handoff: that fade is this one. */
      if (!retiring) fadeOff(finish);
    },
    turn,
    get done() {
      return done;
    },
  };
}
