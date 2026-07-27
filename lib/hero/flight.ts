'use client';

import {
  HERO_ARC_DISTANCE_MAX_PX,
  HERO_ARC_DISTANCE_RATIO,
  HERO_ARC_GRAVITY_PX_PER_S2,
  HERO_ARC_MAX_PX,
  HERO_ARC_MIN_PX,
  HERO_ARC_SCALE,
  HERO_FLIGHT_SAMPLES,
  HERO_RADIUS_LEAD,
  HERO_TARGET_RADIUS_PX,
} from './constants';
import {
  formatHeroClipRadius,
  formatHeroTransform,
  getHeroBoxTransform,
  getHeroCoverTransform,
  type HeroHost,
  type HeroRect,
} from './geometry';
import { interpolate, sampleSpring, springProgress, springVelocity } from './spring';
import { screenRectToPlane, sizePlaneLayer, type HeroScrollPlane } from './plane';
import type { FrameAsset, FrameLease } from './frameCache';
import type { HeroDirection } from './types';
import type { SpringResponse } from './spring';

export type HeroFlightRole = 'foreground' | 'retiring';

/**
 * A flight's complete visual state at one instant. Derived analytically from
 * the leg description, never read back from the DOM.
 */
export type HeroPose = {
  /** Plane-space box produced by the flight keyframes alone. */
  rect: HeroRect;
  radius: number;
  /** Signed px/ms along the leg's own travel direction. */
  speed: number;
  elapsed: number;
  /**
   * Dismiss-drag offset, carried by the compensator and therefore *not* included
   * in `rect`. A reverse folds it in and clears the compensator; a rebuild
   * leaves both alone, since the compensator keeps applying it.
   */
  pullOffset: number;
};

/** One continuous spring leg: everything needed to evaluate it at any time. */
export type HeroLeg = {
  from: HeroRect;
  to: HeroRect;
  fromRadius: number;
  toRadius: number;
  direction: HeroDirection;
  response: SpringResponse;
  duration: number;
  /** Ballistic lift height in px; the apex sits mid-timeline. */
  arc: number;
  startedAt: number;
};

export type HeroFlight = {
  layer: HTMLElement;
  compensator: HTMLElement;
  flyer: HTMLElement;
  clip: HTMLElement;
  image: HTMLCanvasElement;
  frameLease: FrameLease;
  plane: HeroScrollPlane;
  /** The box the flyer element is sized to; all transforms are relative to it. */
  base: HeroRect;
  sourceRadius: number;
  targetRadius: number;
  sessionId: number;
  imageId: number;
  role: HeroFlightRole;
  release: () => void;
};

function planeHost(flight: HeroFlight): HeroHost {
  return {
    element: flight.layer,
    top: 0,
    left: 0,
    width: flight.plane.host.width,
    height: flight.plane.host.height,
  };
}

/**
 * Screen-space ballistic lift. Under constant downward acceleration, a launch
 * that starts and lands on the chord peaks at g·t²/8 above it halfway through.
 * Clamped only at the visual extremes — never by device class.
 */
export function getFlightArc(from: HeroRect, to: HeroRect, duration: number, direction: HeroDirection) {
  const distance = Math.hypot(
    (to.left + to.width / 2) - (from.left + from.width / 2),
    (to.top + to.height / 2) - (from.top + from.height / 2),
  );
  const seconds = Math.max(0.001, duration / 1000);
  const gravityLift = (HERO_ARC_GRAVITY_PX_PER_S2 * seconds * seconds) / 8;
  const distanceLift = Math.min(HERO_ARC_DISTANCE_MAX_PX, distance * HERO_ARC_DISTANCE_RATIO);
  const lift = Math.min(HERO_ARC_MAX_PX, Math.max(HERO_ARC_MIN_PX, gravityLift + distanceLift));
  return lift * HERO_ARC_SCALE[direction];
}

/** Corner radius resolves ahead of position, so the shape settles first. */
function radiusProgress(progress: number) {
  return Math.min(1, progress * HERO_RADIUS_LEAD);
}

function arcOffset(arc: number, offset: number) {
  // Parabola through (0,0) and (1,0), peaking at offset 0.5.
  return arc * 4 * offset * (1 - offset);
}

export function getFlightRadii(flight: HeroFlight, direction: HeroDirection) {
  return direction === 'forward'
    ? { from: flight.sourceRadius, to: flight.targetRadius }
    : { from: flight.targetRadius, to: flight.sourceRadius };
}

/**
 * Evaluate a leg at wall-clock `time`.
 *
 * This is the same math that generates the keyframes, so the value it returns
 * is what the compositor is showing — with no forced layout and no precision
 * lost through matrix serialization.
 */
export function evaluateLeg(leg: HeroLeg, time: number): HeroPose {
  const elapsed = Math.min(leg.duration, Math.max(0, time - leg.startedAt));
  const offset = leg.duration > 0 ? elapsed / leg.duration : 1;
  const progress = springProgress(offset, leg.response);
  const bow = arcOffset(leg.arc, offset);

  const rect: HeroRect = {
    top: interpolate(leg.from.top, leg.to.top, progress) - bow,
    left: interpolate(leg.from.left, leg.to.left, progress),
    width: interpolate(leg.from.width, leg.to.width, progress),
    height: interpolate(leg.from.height, leg.to.height, progress),
  };

  // Chord speed: |Δcenter| · dp/dt. The arc term is deliberately excluded so an
  // interruption inherits travel along the path, not the vertical bow.
  const chord = Math.hypot(
    (leg.to.left + leg.to.width / 2) - (leg.from.left + leg.from.width / 2),
    (leg.to.top + leg.to.height / 2) - (leg.from.top + leg.from.height / 2),
  );
  const speed = leg.duration > 0
    ? (chord * springVelocity(offset, leg.response)) / leg.duration
    : 0;

  return {
    rect,
    radius: interpolate(leg.fromRadius, leg.toRadius, radiusProgress(progress)),
    speed,
    elapsed,
    pullOffset: 0,
  };
}

export type FlightKeyframes = {
  flyer: Keyframe[];
  clip: Keyframe[];
  image: Keyframe[];
};

/**
 * Build the three parallel keyframe tracks for a leg.
 *
 * Every value is precomputed here so the compositor runs the flight without any
 * main-thread involvement: the outer box carries translate+scale, the clip child
 * carries a scale-compensated radius, and the canvas carries its own crop morph.
 */
export function buildFlightKeyframes(flight: HeroFlight, leg: HeroLeg): FlightKeyframes {
  const host = planeHost(flight);
  const frames = sampleSpring(leg.response, HERO_FLIGHT_SAMPLES[leg.direction]);
  const flyer: Keyframe[] = new Array(frames.length);
  const clip: Keyframe[] = new Array(frames.length);
  const image: Keyframe[] = new Array(frames.length);

  for (let index = 0; index < frames.length; index += 1) {
    const { offset, progress } = frames[index];
    const display: HeroRect = {
      top: interpolate(leg.from.top, leg.to.top, progress) - arcOffset(leg.arc, offset),
      left: interpolate(leg.from.left, leg.to.left, progress),
      width: interpolate(leg.from.width, leg.to.width, progress),
      height: interpolate(leg.from.height, leg.to.height, progress),
    };
    const radius = interpolate(leg.fromRadius, leg.toRadius, radiusProgress(progress));

    flyer[index] = {
      offset,
      transform: formatHeroTransform(getHeroBoxTransform(flight.base, display, host)),
    };
    clip[index] = {
      offset,
      borderRadius: formatHeroClipRadius(flight.base, display.width, display.height, radius),
    };
    image[index] = {
      offset,
      transform: formatHeroTransform(getHeroCoverTransform(flight.base, display, host)),
    };
  }

  return { flyer, clip, image };
}

/** Write a pose directly, for a paused or just-rebased flight. */
export function applyFlightPose(flight: HeroFlight, rect: HeroRect, radius: number) {
  const host = planeHost(flight);
  flight.flyer.style.transform = formatHeroTransform(
    getHeroBoxTransform(flight.base, rect, host),
  );
  flight.clip.style.borderRadius = formatHeroClipRadius(
    flight.base,
    rect.width,
    rect.height,
    radius,
  );
  flight.image.style.transform = formatHeroTransform(
    getHeroCoverTransform(flight.base, rect, host),
  );
}

export function moveFlightToPlane(
  flight: HeroFlight,
  plane: HeroScrollPlane,
  rect: HeroRect,
  radius: number,
) {
  flight.layer.remove();
  flight.plane = plane;
  plane.anchor.appendChild(flight.layer);
  sizePlaneLayer(flight.layer, plane);
  applyFlightPose(flight, rect, radius);
}

export function setFlightRole(flight: HeroFlight, role: HeroFlightRole) {
  flight.role = role;
  flight.layer.dataset.imageHeroRole = role;
}

export function createHeroFlight({
  asset,
  treatment,
  plane,
  from,
  to,
  direction,
  sessionId,
  imageId,
}: {
  asset: FrameAsset;
  treatment: HTMLElement;
  plane: HeroScrollPlane;
  /** Screen-space source box. */
  from: HeroRect;
  /** Screen-space destination box. */
  to: HeroRect;
  direction: HeroDirection;
  sessionId: number;
  imageId: number;
}): HeroFlight {
  const layer = document.createElement('div');
  layer.className = 'image-hero-flight-layer';
  layer.setAttribute('aria-hidden', 'true');
  layer.dataset.imageHeroSession = String(sessionId);
  layer.dataset.imageHeroImage = String(imageId);
  layer.dataset.imageHeroRole = 'foreground';

  const compensator = document.createElement('div');
  compensator.className = 'image-hero-flight-compensator';
  const flyer = document.createElement('div');
  flyer.className = 'image-hero-flyer';
  const clip = document.createElement('div');
  clip.className = 'image-hero-flyer-clip';
  const frameLease = asset.acquire();
  let constructed = false;

  try {
    const image = frameLease.canvas;
    image.className = 'image-hero-flyer-image';
    image.setAttribute('aria-hidden', 'true');
    clip.appendChild(image);
    flyer.appendChild(clip);
    compensator.appendChild(flyer);
    layer.appendChild(compensator);
    plane.anchor.appendChild(layer);
    sizePlaneLayer(layer, plane);

    const cardRadius = Number.parseFloat(getComputedStyle(treatment).borderRadius) || 0;
    const sourceRadius = direction === 'forward' ? cardRadius : HERO_TARGET_RADIUS_PX;
    const targetRadius = direction === 'forward' ? HERO_TARGET_RADIUS_PX : cardRadius;

    // Size the flyer to its destination box once; everything after is transform
    // only, so the flight never triggers layout.
    const base = screenRectToPlane(direction === 'forward' ? to : from, plane);
    flyer.style.width = `${base.width}px`;
    flyer.style.height = `${base.height}px`;
    image.style.position = 'absolute';
    image.style.inset = '0 auto auto 0';
    image.style.display = 'block';
    image.style.width = `${base.width}px`;
    image.style.height = `${base.height}px`;
    image.style.transformOrigin = 'top left';
    image.style.willChange = 'transform';

    const flight: HeroFlight = {
      layer,
      compensator,
      flyer,
      clip,
      image,
      frameLease,
      plane,
      base,
      sourceRadius,
      targetRadius,
      sessionId,
      imageId,
      role: 'foreground',
      release: () => {
        layer.remove();
        frameLease.release();
      },
    };

    // Establish the exact source pose synchronously. Relying on the WAAPI
    // backwards fill for the first paint can expose the untransformed base box
    // while a slower compositor promotes and rasterizes the new canvas layer.
    applyFlightPose(
      flight,
      screenRectToPlane(from, plane),
      direction === 'forward' ? sourceRadius : targetRadius,
    );

    let released = false;
    flight.release = () => {
      if (released) return;
      released = true;
      layer.remove();
      frameLease.release();
    };
    constructed = true;
    return flight;
  } finally {
    if (!constructed) {
      layer.remove();
      frameLease.release();
    }
  }
}
