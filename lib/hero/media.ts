'use client';

import type { PonyImage } from '@/lib/types/image';
import {
  cancelOtherBackgroundImageDetailPrefetch,
  prefetchImageDetail,
  type DetailRequestPriority,
} from '@/lib/detail';
import { getHeroRect, getVisualMedia, normalizeHeroSrc } from './dom';
import { captureHeroFrame } from './frameCache';
import { imageHeroController } from './controller';
import type { ImageHeroSnapshot } from './types';

let detailComponentWarmup: Promise<unknown> | null = null;

export function warmImageHero(
  imageId?: number,
  priority: DetailRequestPriority = 'immediate',
) {
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
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
    typeof HTMLElement !== 'undefined' &&
    typeof HTMLElement.prototype.animate === 'function' &&
    document.querySelector('[data-image-hero-gallery-anchor]'),
  );
}

export function canUseImageHeroTransition(snapshot: ImageHeroSnapshot) {
  const phase = imageHeroController.getRuntime().phase;
  return canAnimateImageHero(snapshot) && (
    phase === 'gallery-idle' || phase === 'closing.flight'
  );
}

