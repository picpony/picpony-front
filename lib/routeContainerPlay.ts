'use client';

import { MOTION_SPEED_SCALE, motionTier } from '@/lib/appearance';
import { getAppScroller } from '@/lib/appScroller';
import { PAGE_FADE_TIMING } from '@/lib/motionTokens';
import { routeTransitActive } from '@/lib/pageTransit';
import { FORUM_TRANSFORM_MS } from '@/lib/forumContainer';
import {
  playContainerRun,
  reveal,
  supportsLinearEasing,
  type ContainerHandle,
  type ContainerRun,
  type ContainerTurn,
} from '@/lib/containerTransformPlay';

/**
 * The container transforms that ride a route change — a forum post opening from its row and
 * shrinking back into it (`lib/forumTransitionPlay.ts`), a folder from its card
 * (`lib/folderTransitPlay.ts`) — and what keeps each one alive across the *next* route change.
 * The leg itself is `lib/containerTransformPlay.ts`'s.
 *
 * **It rides the route cross-fade.** Its layer sits just above the cross-fade's, and the outgoing
 * content is taken from the cross-fade's still frame of the page being left (already there,
 * already pruned to what was on screen), the incoming one from the live element. The handoff
 * waits for the route to have faded the page in: until it has, the live element under the layer
 * is dimmer than the layer's copy. Standard tier only, and only riding a route change: under 减弱
 * the route's own fade is the whole transition, under 关闭 it is a cut, and without the route's
 * still frame there is no outgoing content to carry.
 *
 * **A flight outlives its owner by a microtask, and its page by two frames.** The owner — a ref on
 * the live element, a list's effect — lets go in two situations that look the same from inside a
 * cleanup: React's development double invoke of refs and effects (the element is still there a
 * microtask later, and the flight simply carries on: a second attach adopts it, `flightOn`), and
 * the route changing under it (the element is gone). Gone, the flight is an orphan: the page the
 * route brings in may claim it within two frames (`claimable`) and turn it from its pose on screen
 * — Back pressed while a post or a folder is still opening sends the container back into its row
 * or card, Forward while it closes sends it back out — and unclaimed it fades where it is. It used
 * to be landed in the commit that removed its page: the container vanished, the page it was
 * flying into showed blank for as long as the next page took to render, and a fresh return then
 * jumped to the far end of the old leg to shrink back from there.
 */

export function crossFadeLayer(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-route-crossfade-layer]');
}

/** Whether a transform may ride this route change at all. */
export function routePlayable(el: HTMLElement): boolean {
  return motionTier() === 'standard' && routeTransitActive(el) && supportsLinearEasing();
}

/** By the wall-clock rule: the slowest speed, the transform or the page fade, whichever ends later. */
const BOUND_MS = Math.max(FORUM_TRANSFORM_MS, (PAGE_FADE_TIMING.delay + PAGE_FADE_TIMING.duration) * 1000) * MOTION_SPEED_SCALE.slow;

/** Which way a flight goes along its pair: into the larger thing, or back into the list. */
export type Leg = 'open' | 'back';

export interface Flight {
  /** The pair it carries — a post's id, a folder's address — namespaced by its kind. */
  readonly key: string;
  leg: Leg;
  /** The live element it lands on, hidden for the run. */
  target: HTMLElement;
  readonly handle: ContainerHandle;
  /** Its page has gone and nothing has claimed it yet. */
  orphaned: boolean;
  /** The frame an orphan waits on. */
  wait: number;
}

const flights = new Set<Flight>();

/** Plays a leg above the route cross-fade. Null when it cannot start. */
export function flyOnRoute(
  run: ContainerRun,
  how: { kind: 'forum' | 'folder'; key: string; leg: Leg; target: HTMLElement; handoffFade?: boolean },
): Flight | null {
  const crossFade = crossFadeLayer();
  const scroller = getAppScroller();
  if (!crossFade || !scroller) {
    reveal(run.hidden);
    return null;
  }
  let flight: Flight | null = null;
  const handle = playContainerRun(run, {
    mount: (layer) => {
      layer.setAttribute(`data-${how.kind}-transform`, '');
      /* Above the cross-fade, and above any flight still fading off there: the newest on top. */
      let anchor: Element = crossFade;
      while (anchor.nextElementSibling?.hasAttribute('data-container-transform')) anchor = anchor.nextElementSibling;
      anchor.after(layer);
      return true;
    },
    zIndex: 'var(--z-route-crossfade)',
    scroller,
    holdHandoff: () => scroller.hasAttribute('data-route-transit'),
    boundMs: BOUND_MS,
    handoffFade: how.handoffFade,
    onDone: () => {
      if (flight) untrackFlight(flight);
    },
  });
  if (handle.done) return null;
  flight = trackFlight(handle, how);
  return flight;
}

/** Keeps a running leg as a flight — `flyOnRoute` does for every leg it starts; the registry's
    own test (`scripts/testFolderTransit.mjs`) does with a stand-in. */
export function trackFlight(handle: ContainerHandle, how: { key: string; leg: Leg; target: HTMLElement }): Flight {
  const flight: Flight = { key: how.key, leg: how.leg, target: how.target, handle, orphaned: false, wait: 0 };
  flights.add(flight);
  return flight;
}

/** Forgets a flight whose leg is over. */
export function untrackFlight(flight: Flight) {
  cancelAnimationFrame(flight.wait);
  flight.wait = 0;
  flights.delete(flight);
}

/** The flight already landing on `target`, for a second attach to take over rather than start another. */
export function flightOn(target: HTMLElement): Flight | null {
  for (const flight of flights) if (flight.target === target && !flight.handle.done) return flight;
  return null;
}

/**
 * The owner's stop: the flight carries on if its element is still there a microtask later, and is
 * an orphan otherwise (see the note above). It stops landing on a scroll at once, before the route
 * change that may be under way restores an offset.
 */
export function release(flight: Flight) {
  if (flight.handle.done) return;
  flight.handle.suspend();
  queueMicrotask(() => {
    if (flight.handle.done) return;
    if (flight.target.isConnected) {
      flight.handle.resume();
      return;
    }
    if (flight.orphaned) return;
    flight.orphaned = true;
    /* The incoming page claims it from a frame after it mounts — the frame its own scroll offset
       has landed in; the second frame is the margin. */
    flight.wait = requestAnimationFrame(() => {
      flight.wait = requestAnimationFrame(() => {
        flight.wait = 0;
        if (flight.orphaned) dismissFlight(flight);
      });
    });
  });
}

/**
 * A flight along `key` going the other way from `leg` whose page has gone — what the page coming
 * in turns, from wherever it is.
 */
export function claimable(key: string, leg: Leg): Flight | null {
  let found: Flight | null = null;
  for (const flight of flights) {
    if (flight.key === key && flight.leg !== leg && !flight.handle.done && !flight.target.isConnected) found = flight;
  }
  return found;
}

/** Turns `flight` onto `target`, now going `leg`; when it cannot be turned it fades where it is. */
export function turnFlight(flight: Flight, leg: Leg, target: HTMLElement, turn: ContainerTurn): boolean {
  cancelAnimationFrame(flight.wait);
  flight.wait = 0;
  flight.orphaned = false;
  if (!flight.handle.turn(turn)) {
    dismissFlight(flight);
    return false;
  }
  flight.leg = leg;
  flight.target = target;
  return true;
}

/** Fades a flight off where it is: its page went, and nothing coming in has anywhere to land it. */
export function dismissFlight(flight: Flight) {
  flight.orphaned = false;
  untrackFlight(flight);
  flight.handle.fadeOut();
}
