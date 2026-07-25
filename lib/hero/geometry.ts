'use client';

import type { CSSProperties } from 'react';
import type { PonyImage } from '@/lib/types/image';
import type { HeroDirection } from './types';
import {
  HERO_BACKGROUND_SINK_SCALE_DELTA,
  HERO_BACKGROUND_SINK_Y_PX,
  HERO_DURATIONS,
  HERO_KEYFRAME_SAMPLES,
  HERO_MAX_HEIGHT_DVH,
  HERO_MEDIA_BREAKPOINT_PX,
  HERO_MEDIA_DESKTOP_HORIZONTAL_PADDING_PX,
  HERO_MEDIA_MAX_WIDTH_PX,
  HERO_MEDIA_MOBILE_HORIZONTAL_PADDING_PX,
  MOTION_RESPONSE,
} from './constants';

export {
  HERO_MAX_HEIGHT_DVH,
  HERO_MEDIA_BREAKPOINT_PX,
  HERO_MEDIA_MOBILE_HORIZONTAL_PADDING_PX,
  HERO_MEDIA_DESKTOP_HORIZONTAL_PADDING_PX,
  HERO_MEDIA_MAX_WIDTH_PX,
  HERO_DURATIONS,
  HERO_BACKGROUND_SINK_Y_PX,
  HERO_BACKGROUND_SINK_SCALE_DELTA,
};

export type HeroRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type HeroHost = HeroRect & { element: HTMLElement };

type HeroMediaDimensions = Pick<PonyImage, 'width' | 'height'>;

function getHeroMediaDimensions(image: HeroMediaDimensions) {
  const width = Math.max(1, image.width || 1);
  const height = Math.max(1, image.height || 1);
  return { width, height, aspectRatio: width / height };
}

export function getHeroMediaResponsiveSizes(image: HeroMediaDimensions) {
  const { width, aspectRatio } = getHeroMediaDimensions(image);
  const mobilePaddingRem = HERO_MEDIA_MOBILE_HORIZONTAL_PADDING_PX / 16;
  const desktopPaddingRem = HERO_MEDIA_DESKTOP_HORIZONTAL_PADDING_PX / 16;
  return `(max-width: ${HERO_MEDIA_BREAKPOINT_PX - 1}px) min(calc(100vw - ${mobilePaddingRem}rem), ${width}px, calc(${HERO_MAX_HEIGHT_DVH}dvh * ${aspectRatio})), min(calc(100vw - ${desktopPaddingRem}rem), ${HERO_MEDIA_MAX_WIDTH_PX}px, ${width}px, calc(${HERO_MAX_HEIGHT_DVH}dvh * ${aspectRatio}))`;
}

export function getHeroMediaPreviewSizes() {
  return `(max-width: ${HERO_MEDIA_BREAKPOINT_PX - 1}px) 100vw, ${HERO_MEDIA_MAX_WIDTH_PX}px`;
}

export function getHeroMediaRenderedWidth(
  image: HeroMediaDimensions,
  viewport: { width: number; height: number },
) {
  const { width, aspectRatio } = getHeroMediaDimensions(image);
  const horizontalPadding = viewport.width < HERO_MEDIA_BREAKPOINT_PX
    ? HERO_MEDIA_MOBILE_HORIZONTAL_PADDING_PX
    : HERO_MEDIA_DESKTOP_HORIZONTAL_PADDING_PX;
  return Math.min(
    width,
    HERO_MEDIA_MAX_WIDTH_PX,
    Math.max(1, viewport.width - horizontalPadding),
    Math.max(1, viewport.height * (HERO_MAX_HEIGHT_DVH / 100) * aspectRatio),
  );
}

// Single source for the hero media box sizing. The stage landing target and
// the routed detail media MUST render pixel-identical boxes for the flight
// handoff to be seamless — both derive their style from here.
export function getHeroMediaStyle(
  image: HeroMediaDimensions,
): CSSProperties {
  const { width, height, aspectRatio } = getHeroMediaDimensions(image);
  return {
    aspectRatio: `${width} / ${height}`,
    width: `min(100%, ${width}px, calc(${HERO_MAX_HEIGHT_DVH}dvh * ${aspectRatio}))`,
    maxWidth: '100%',
    maxHeight: `${HERO_MAX_HEIGHT_DVH}dvh`,
  };
}

export function heroPhysicalProgress(time: number, direction: HeroDirection) {
  const { rate, initialVelocity } = MOTION_RESPONSE[direction];
  const response = (value: number) =>
    1 - (1 + (rate - initialVelocity) * value) * Math.exp(-rate * value);
  const end = response(1);
  return time === 1 ? 1 : response(time) / end;
}

type HeroProgressFrame = { offset: number; progress: number };

// Progress tables are pure functions of direction + sample count. Cache them so
// open/close/reverse flights reuse the same arrays instead of reallocating and
// re-evaluating the spring at every transition.
const progressFrameCache = new Map<string, readonly HeroProgressFrame[]>();

function getHeroProgressFrames(direction: HeroDirection, count: number) {
  const key = `${direction}:${count}`;
  const cached = progressFrameCache.get(key);
  if (cached) return cached;

  const frames = Array.from({ length: count }, (_, index) => {
    const offset = index / (count - 1);
    return { offset, progress: heroPhysicalProgress(offset, direction) };
  });
  progressFrameCache.set(key, frames);
  return frames;
}

export function heroMotionFrames(direction: HeroDirection, count = 32) {
  return getHeroProgressFrames(direction, count);
}

export function heroGeometryFrames(direction: HeroDirection) {
  // Fixed sample counts (not device-scaled). 32/28 points track the spring
  // closely while WAAPI interpolates between them — denser than needed for
  // visual fidelity and far cheaper than a 120fps table rebuild every reverse.
  return getHeroProgressFrames(direction, HERO_KEYFRAME_SAMPLES[direction]);
}

export function interpolateHeroValue(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

export function getLocalHeroRect(rect: HeroRect, host: HeroHost) {
  return {
    top: rect.top - host.top,
    left: rect.left - host.left,
    width: rect.width,
    height: rect.height,
  };
}

export function getHeroCoverTransform(
  baseWidth: number,
  baseHeight: number,
  display: HeroRect,
  host: HeroHost,
) {
  const local = getLocalHeroRect(display, host);
  const scale = Math.max(local.width / baseWidth, local.height / baseHeight);
  return {
    x: local.left + (local.width - baseWidth * scale) / 2,
    y: local.top + (local.height - baseHeight * scale) / 2,
    scale,
  };
}

export function getHeroRectTransform(base: HeroRect, display: HeroRect, host: HeroHost) {
  const local = getLocalHeroRect(display, host);
  return {
    x: local.left,
    y: local.top,
    scaleX: local.width / base.width,
    scaleY: local.height / base.height,
  };
}

export function getNestedHeroCoverTransform(
  base: HeroRect,
  display: HeroRect,
  host: HeroHost,
) {
  const outer = getHeroRectTransform(base, display, host);
  const cover = getHeroCoverTransform(base.width, base.height, display, host);
  return {
    x: (cover.x - outer.x) / outer.scaleX,
    y: (cover.y - outer.y) / outer.scaleY,
    scaleX: cover.scale / outer.scaleX,
    scaleY: cover.scale / outer.scaleY,
  };
}

export function getHeroFlyerFrame(
  base: HeroRect,
  display: HeroRect,
  host: HeroHost,
  radius: number,
) {
  const outer = getHeroRectTransform(base, display, host);
  return {
    borderRadius: `${radius / outer.scaleX}px / ${radius / outer.scaleY}px`,
    transform: `translate3d(${outer.x}px, ${outer.y}px, 0) scale(${outer.scaleX}, ${outer.scaleY})`,
  };
}

/** Write flyer outer transform into an existing keyframe object (no alloc). */
export function writeHeroFlyerFrame(
  base: HeroRect,
  displayTop: number,
  displayLeft: number,
  displayWidth: number,
  displayHeight: number,
  host: HeroHost,
  radius: number,
  out: { borderRadius: string; transform: string },
) {
  const localTop = displayTop - host.top;
  const localLeft = displayLeft - host.left;
  const scaleX = displayWidth / base.width;
  const scaleY = displayHeight / base.height;
  // Radius is applied on the unscaled clip child (see writeHeroClipRadius).
  out.borderRadius = `${radius / scaleX}px / ${radius / scaleY}px`;
  out.transform = `translate3d(${localLeft}px, ${localTop}px, 0) scale(${scaleX}, ${scaleY})`;
}

/** Local-space radius for the clip child (parent carries scale). */
export function writeHeroClipRadius(
  base: HeroRect,
  displayWidth: number,
  displayHeight: number,
  radius: number,
  out: { borderRadius: string },
) {
  const scaleX = displayWidth / base.width;
  const scaleY = displayHeight / base.height;
  out.borderRadius = `${radius / scaleX}px / ${radius / scaleY}px`;
}

export function getHeroBackgroundSinkTransform(amount: number) {
  // Keep the original translate + scale sink. The visual is isolated in its
  // own compositor layer, so the depth cue does not require any layout work.
  if (amount <= 0.001) return 'none';
  const clamped = Math.min(1, Math.max(0, amount));
  return `translate3d(0, ${HERO_BACKGROUND_SINK_Y_PX * clamped}px, 0) scale(${1 - HERO_BACKGROUND_SINK_SCALE_DELTA * clamped})`;
}
