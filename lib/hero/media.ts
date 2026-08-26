'use client';

import type { PonyImage } from '@/lib/types/image';
import {
  cancelOtherBackgroundImageDetailPrefetch,
  prefetchImageDetail,
  type DetailRequestPriority,
} from '@/lib/detail';
import { HERO_GALLERY_ANCHOR_SELECTOR } from './constants';
import { motionTier } from '@/lib/appearance';
import { getHeroRect, getVisualMedia, normalizeHeroSrc } from './dom';
import { captureHeroFrame } from './frameCache';
import type { ImageHeroSnapshot } from './types';

let detailComponentWarmup: Promise<unknown> | null = null;

export function warmImageHero(imageId?: number, priority: DetailRequestPriority = 'immediate') {
  detailComponentWarmup ??= import('@/components/PicDetail').catch(() => {
    detailComponentWarmup = null;
  });
  if (imageId === undefined) return detailComponentWarmup;
  if (priority === 'immediate') cancelOtherBackgroundImageDetailPrefetch(imageId);
  return Promise.all([
    detailComponentWarmup,
    prefetchImageDetail(imageId, { priority }).catch(() => undefined),
  ]);
}

export function prepareImageHero(
  image: PonyImage,
  source: HTMLElement | null,
  canAnimate: boolean,
  previewSrcOverride?: string,
): ImageHeroSnapshot | null {
  if (!source) return null;
  const visual = getVisualMedia(source);
  const previewFrame = captureHeroFrame(visual);
  if (!previewFrame) return null;
  const mediaType = visual instanceof HTMLVideoElement ? 'video' : 'image';
  const previewSrc = normalizeHeroSrc(
    visual?.currentSrc ||
      visual?.getAttribute('src') ||
      previewSrcOverride ||
      (mediaType === 'video'
        ? image.representations?.thumb ||
          image.representations?.thumb_small ||
          image.representations?.thumb_tiny ||
          image.representations?.small ||
          image.representations?.full
        : image.representations?.small) ||
      image.representations?.thumb ||
      image.representations?.small ||
      image.representations?.full ||
      image.view_url ||
      '',
  );
  const rect = getHeroRect(source);
  return {
    image,
    previewSrc,
    previewFrame,
    sourceKey: source.dataset.imageHeroSourceKey ?? null,
    mediaType,
    canAnimate: canAnimate && rect.width > 0 && rect.height > 0,
    createdAt: Date.now(),
  };
}

export function canAnimateImageHero(snapshot: ImageHeroSnapshot) {
  return Boolean(
    snapshot.canAnimate &&
    /* The flight is a container transform: a box travelling and resizing across the
       screen, which is the whole of what the reduced tier removes. So only the standard
       tier flies, and the other two fall back to an ordinary navigation.
       That is not the same as having no weak form. Under `reduced` the overlay fades in
       instead — `.image-detail-route` in globals.css carries the keyframe for exactly
       the two tiers that do not fly — and under `off` the same rule collapses to 0s.

       Read through `motionTier()` rather than `matchMedia` directly. This file used to
       hold one of the app's two private copies of the OS query, which was deliberate
       (this is the flight's master gate and runs before anything is mounted) and is no
       longer necessary: the tier is an attribute on `<html>`, already correct before the
       first paint, so reading it here is a synchronous attribute lookup with no listener
       and no import cycle. */
    motionTier() === 'standard' &&
    typeof HTMLElement !== 'undefined' &&
    typeof HTMLElement.prototype.animate === 'function' &&
    document.querySelector(HERO_GALLERY_ANCHOR_SELECTOR),
  );
}
