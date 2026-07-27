'use client';

import type { CSSProperties } from 'react';
import type { PonyImage } from '@/lib/types/image';
import {
  HERO_BACKGROUND_SINK_SCALE_DELTA,
  HERO_BACKGROUND_SINK_Y_PX,
  HERO_MAX_HEIGHT_DVH,
  HERO_MEDIA_BREAKPOINT_PX,
  HERO_MEDIA_DESKTOP_HORIZONTAL_PADDING_PX,
  HERO_MEDIA_MAX_WIDTH_PX,
  HERO_MEDIA_MOBILE_HORIZONTAL_PADDING_PX,
} from './constants';

export type HeroRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type HeroHost = HeroRect & { element: HTMLElement };

/** Outer box transform: translate + scale relative to a fixed base size. */
export type HeroBoxTransform = {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
};

type HeroMediaDimensions = Pick<PonyImage, 'width' | 'height'>;

// ---------------------------------------------------------------------------
// Media box sizing — single source shared by the Stage landing target and the
// routed detail media. Both MUST render pixel-identical boxes or the handoff
// visibly shifts.
// ---------------------------------------------------------------------------

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

export function getHeroMediaStyle(image: HeroMediaDimensions): CSSProperties {
  const { width, height, aspectRatio } = getHeroMediaDimensions(image);
  return {
    aspectRatio: `${width} / ${height}`,
    width: `min(100%, ${width}px, calc(${HERO_MAX_HEIGHT_DVH}dvh * ${aspectRatio}))`,
    maxWidth: '100%',
    maxHeight: `${HERO_MAX_HEIGHT_DVH}dvh`,
  };
}

// ---------------------------------------------------------------------------
// Flyer geometry
//
// The flyer is sized once to its destination box (`base`) and then only ever
// transformed, so the browser never relayouts mid-flight. The clip child
// carries the corner radius pre-divided by the parent's scale, which keeps the
// painted radius constant in screen space.
// ---------------------------------------------------------------------------

export function getHeroBoxTransform(
  base: HeroRect,
  display: HeroRect,
  host: HeroHost,
): HeroBoxTransform {
  return {
    x: display.left - host.left,
    y: display.top - host.top,
    scaleX: display.width / base.width,
    scaleY: display.height / base.height,
  };
}

/**
 * Transform for the media inside the flyer. The gallery thumbnail is
 * `object-cover` (cropped) while the detail media is `object-contain`, so the
 * inner layer must morph its own crop as the outer box changes aspect ratio.
 * Expressed relative to the already-scaled outer box.
 */
export function getHeroCoverTransform(
  base: HeroRect,
  display: HeroRect,
  host: HeroHost,
): HeroBoxTransform {
  const outer = getHeroBoxTransform(base, display, host);
  const localLeft = display.left - host.left;
  const localTop = display.top - host.top;
  const cover = Math.max(display.width / base.width, display.height / base.height);
  const coverX = localLeft + (display.width - base.width * cover) / 2;
  const coverY = localTop + (display.height - base.height * cover) / 2;
  return {
    x: (coverX - outer.x) / outer.scaleX,
    y: (coverY - outer.y) / outer.scaleY,
    scaleX: cover / outer.scaleX,
    scaleY: cover / outer.scaleY,
  };
}

export function formatHeroTransform({ x, y, scaleX, scaleY }: HeroBoxTransform) {
  return `translate3d(${x}px, ${y}px, 0) scale(${scaleX}, ${scaleY})`;
}

/** Local-space radius for the clip child, whose parent carries the scale. */
export function formatHeroClipRadius(
  base: HeroRect,
  width: number,
  height: number,
  radius: number,
) {
  const scaleX = width / base.width;
  const scaleY = height / base.height;
  return `${radius / scaleX}px / ${radius / scaleY}px`;
}

export function getHeroBackgroundSinkTransform(amount: number) {
  // The visual is isolated in its own compositor layer, so the depth cue costs
  // no layout work.
  if (amount <= 0.001) return 'none';
  const clamped = Math.min(1, Math.max(0, amount));
  return `translate3d(0, ${HERO_BACKGROUND_SINK_Y_PX * clamped}px, 0) scale(${1 - HERO_BACKGROUND_SINK_SCALE_DELTA * clamped})`;
}

export function heroRectCenterDistance(from: HeroRect, to: HeroRect) {
  return Math.hypot(
    (to.left + to.width / 2) - (from.left + from.width / 2),
    (to.top + to.height / 2) - (from.top + from.height / 2),
    (to.width - from.width) / 2,
    (to.height - from.height) / 2,
  );
}

export function heroRectsEqual(a: HeroRect, b: HeroRect, epsilon: number) {
  return (
    Math.abs(a.top - b.top) < epsilon &&
    Math.abs(a.left - b.left) < epsilon &&
    Math.abs(a.width - b.width) < epsilon &&
    Math.abs(a.height - b.height) < epsilon
  );
}
