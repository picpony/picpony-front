'use client';

import { scaledMs } from '@/lib/appearance';
import { springTiming } from '@/lib/springTiming';
import { stripProgress, type StripLeg } from '@/lib/tabStrip';
import {
  FORUM_TRANSFORM_MS,
  containerPose,
  fadeTrack,
  freshContainerLeg,
  linearEasing,
  sameColumn,
  shutterLevels,
  turnContainer,
  type Box,
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
 * **It plays on a layer of its own**, holding the container and a copy of each content: the
 * outgoing one stays opaque, the incoming one comes in on top of it with a surface covering the
 * whole container (`MaterialContainerTransform`'s `FADE_MODE_IN`), so the container is never
 * empty. Both contents are **anchored at the container's top left and never scaled**. The live
 * elements are hidden for the run, so nothing is on screen twice, and the layer is removed once
 * the container has landed, when the live element under it is exactly what the layer shows.
 * Web Animations throughout, every moving part a compositor transform or opacity (the corners
 * and the container's tone are the only main-thread properties, and a frame of lag there is
 * invisible).
 *
 * **A run is a handle, not a one-shot.** Its owner can land it (`finish`), stop it landing on a
 * scroll while a route change restores an offset (`suspend`/`resume`), fade it off where it is
 * (`fadeOut`), or send it from its pose on screen to another rectangle (`turn`): the pose is the
 * leg's own at the display's clock (`containerPose`), the clip carries on — rebuilt only if the
 * new pair needs another shape — and the new leg leaves on the strip's turn (`turnContainer`) with
 * the incoming content retracing its own fade window (`fadeTrack`). Nothing is re-copied for a
 * turn: the contents are already in the frame, anchored at the container's corner, and simply
 * ride the new leg.
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

const CORNER_PROPS = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'] as const;

/** The markers a copy must not carry, or a lookup for the live element would resolve into it. */
const COPY_MARKERS = ['data-forum-row', 'data-forum-card', 'data-detail-origin', 'data-folder-card', 'data-folder-page'];

export function supportsLinearEasing(): boolean {
  return typeof CSS !== 'undefined' && !!CSS.supports?.('transition-timing-function', 'linear(0, 1)');
}

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
 * from the list rules, and its corners would change at the handoff.
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
  /** When the incoming content is on screen, as a window on the travel (`FORUM_FADE`). */
  fade: { start: number; end: number };
  /** Live elements hidden for the run, shown again at the handoff. */
  hidden: Hidden[];
}

export interface ContainerStage {
  /** Puts the layer into the document, where it stacks above what it covers; false to give up. */
  mount: (layer: HTMLElement) => boolean;
  /** The layer's z-index, a `--z-*` token. */
  zIndex: string;
  /** A scroll here moves the live element out from under the layer: land at once. */
  scroller: HTMLElement | null;
  /** While true after the container lands, the handoff waits (the forum: the route's own fade). */
  holdHandoff?: () => boolean;
  /** The wall-clock bound, already at the slowest speed (AGENTS: the wall-clock rule). */
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
const LANDED: ContainerHandle = { finish() {}, suspend() {}, resume() {}, fadeOut() {}, turn: () => false, done: true };

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
  const local = (b: Box): Box => ({ left: b.left - origin.left, top: b.top - origin.top, width: b.width, height: b.height });
  const from = local(run.from.box);
  const to = local(run.to.box);

  /* The container's surface, as large as it ever gets: one under the outgoing content, and one
     that comes in with the incoming content and covers the whole container — so the outgoing
     content is covered everywhere as the incoming one arrives, not only inside the incoming
     one's own box (a row's box is shorter than the card it leaves, and the strip of the card
     under it read as a stray line of text while the container finished closing). A turn that
     sends it somewhere larger grows them with it. */
  const plates: HTMLElement[] = [];
  const reach = { width: 0, height: 0 };
  const cover = (box: Box) => {
    reach.width = Math.max(reach.width, box.width);
    reach.height = Math.max(reach.height, box.height);
    for (const el of plates) Object.assign(el.style, { width: `${reach.width}px`, height: `${reach.height}px` });
  };
  const plate = (colour: string) => {
    const el = document.createElement('div');
    Object.assign(el.style, { position: 'absolute', left: '0px', top: '0px', backgroundColor: colour });
    plates.push(el);
    return el;
  };
  const surface = plate(run.from.colour);
  const arriving = document.createElement('div');
  Object.assign(arriving.style, { position: 'absolute', left: '0px', top: '0px', width: '0px', height: '0px' });
  /* Both contents are laid out at their own width, so their words wrap exactly as on the page. */
  if (run.outgoing) place(run.outgoing.el, run.outgoing.box, run.from.box, run.from.radii);
  place(run.incoming, run.incomingBox, run.to.box, run.to.radii);
  arriving.append(plate(run.to.colour), run.incoming);
  cover(from);
  cover(to);
  let chain = buildChain(layer, from, to, run.from.radii);
  chain.frame.append(surface, ...(run.outgoing ? [run.outgoing.el] : []), arriving);
  still(layer);
  /* With no outgoing content the whole container arrives through its fade, surface and all. */
  const fading = run.outgoing ? arriving : layer;

  const full = scaledMs(FORUM_TRANSFORM_MS);
  /** The current leg's two ends, for the pose a turn leaves from (`containerPose`). */
  let ends: { a: Surface; b: Surface };
  /**
   * One leg: the clip from `a` to `b`, its corners and its tone, and the incoming content over
   * the leg's stretch of travel. Offsets are in progress (the easing), so the fade window is a
   * window on the travel.
   */
  const playLeg = (leg: StripLeg, a: Surface, b: Surface): Animation[] => {
    ends = { a, b };
    const timing: KeyframeAnimationOptions = { duration: leg.duration, easing: linearEasing(stripProgress(leg.launch)), fill: 'both' };
    const list: Animation[] = [];
    chain.levels.forEach((level, index) => {
      const el = chain.elements[index];
      const [x0, y0] = level.translate(a.box);
      const [x1, y1] = level.translate(b.box);
      list.push(el.animate([{ transform: `translate(${x0}px, ${y0}px)` }, { transform: `translate(${x1}px, ${y1}px)` }], timing));
      /* The corners, on an animation of their own so the transform above stays on the compositor. */
      const corners = level.corners.filter((corner) => a.radii[corner] !== b.radii[corner]);
      if (corners.length > 0) {
        const at = (radii: Radii) => Object.fromEntries(corners.map((corner) => [CORNER_PROPS[corner], `${radii[corner]}px`]));
        list.push(el.animate([at(a.radii), at(b.radii)], timing));
      }
    });
    if (a.colour !== b.colour) list.push(surface.animate([{ backgroundColor: a.colour }, { backgroundColor: b.colour }], timing));
    /* The incoming content and its surface come in on top, the outgoing content stays opaque
       beneath them: one of the two fills the container on every frame. */
    list.push(fading.animate(fadeTrack(run.fade, leg.from, leg.to), timing));
    /* One frame ahead: the first frame that shows the container already shows it moving (the
       response leaves at speed), rather than the page it replaced standing still. A current time,
       not a start time, so the leg stays pending until the compositor draws it, and starts there.
       The frame that brings the layer in has a whole page's copy to paint and raster — about
       120ms on the development server — and the display keeps showing the old frame until it is
       ready; a start time fixed when the leg was built (a commit's, which is stale after a long
       task, or the building frame's own) was spent in that wait, and the container's first frame
       on screen was 45% of the way along. On the main thread a pending leg reads its first pose
       for those frames; that is not what the display shows, and measuring it per rAF misleads. */
    for (const animation of list) animation.currentTime = 1000 / 60;
    return list;
  };

  let leg = freshContainerLeg(full);
  let animations = playLeg(leg, { box: from, radii: run.from.radii, colour: run.from.colour }, { box: to, radii: run.to.radii, colour: run.to.colour });
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
    layer.remove();
    reveal(hidden);
    stage.onDone?.();
  };
  const fadeOff = (onEnd: () => void) => {
    const opacity = getComputedStyle(layer).opacity;
    retiring = layer.animate([{ opacity }, { opacity: 0 }], { ...springTiming('fastEffects'), fill: 'forwards' });
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
    const now = containerPose(leg, ends.a, ends.b, elapsed);
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
        for (const corner of level.corners) chain.elements[index].style[CORNER_PROPS[corner]] = `${now.radii[corner]}px`;
      });
    } else {
      /* A clip for the new pair, at the pose it is leaving from, with the contents moved across:
         they sit at the container's corner in both chains, so nothing they show moves. */
      const old = chain;
      chain = buildChain(layer, now.box, next, now.radii);
      chain.frame.append(...old.frame.childNodes);
      old.elements[0].remove();
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
