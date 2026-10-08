'use client';

import type { CSSProperties } from 'react';
import type { PonyImage } from '@/lib/types/image';
import {
  HERO_MAX_HEIGHT_DVH,
  HERO_MEDIA_BREAKPOINT_PX,
  HERO_MEDIA_DESKTOP_HORIZONTAL_PADDING_PX,
  HERO_MEDIA_MAX_WIDTH_PX,
  HERO_MEDIA_MOBILE_HORIZONTAL_PADDING_PX,
  HERO_MEDIA_VIEWPORT_CHROME_PX,
} from './constants';

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
  const horizontalPadding =
    viewport.width < HERO_MEDIA_BREAKPOINT_PX
      ? HERO_MEDIA_MOBILE_HORIZONTAL_PADDING_PX
      : HERO_MEDIA_DESKTOP_HORIZONTAL_PADDING_PX;
  // Both terms of the height cap — the same expression the stylesheet's cap uses. Omitting
  // the chrome term makes this return a width the element never paints, and anything
  // measuring against this instead of the DOM places the landing box off.
  const heightCap = Math.min(
    viewport.height * (HERO_MAX_HEIGHT_DVH / 100),
    viewport.height - HERO_MEDIA_VIEWPORT_CHROME_PX,
  );
  return Math.min(
    width,
    HERO_MEDIA_MAX_WIDTH_PX,
    Math.max(1, viewport.width - horizontalPadding),
    Math.max(1, heightCap * aspectRatio),
  );
}

/** The media box's height cap, as one CSS expression both presentations share. */
const MEDIA_MAX_HEIGHT =
  `min(${HERO_MAX_HEIGHT_DVH}dvh, calc(100dvh - ${HERO_MEDIA_VIEWPORT_CHROME_PX}px))`;

export function getHeroMediaStyle(image: HeroMediaDimensions): CSSProperties {
  const { width, height, aspectRatio } = getHeroMediaDimensions(image);
  return {
    aspectRatio: `${width} / ${height}`,
    // The cap is the *smaller* of 80dvh and the viewport minus the chrome around the media
    // (see `HERO_MEDIA_VIEWPORT_CHROME_PX`); without the second term a portrait picture
    // lands in a box whose bottom is below the overlay's, and the flight clips it.
    width: `min(100%, ${width}px, calc(${MEDIA_MAX_HEIGHT} * ${aspectRatio}))`,
    maxWidth: '100%',
    maxHeight: MEDIA_MAX_HEIGHT,
  };
}
