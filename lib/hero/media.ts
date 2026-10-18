'use client';

import type { ImagePreview } from '@/lib/types/image';
import {
  cancelOtherBackgroundImageDetailPrefetch,
  prefetchImageDetail,
  type DetailRequestPriority,
} from '@/lib/detail';
import { HERO_GALLERY_ANCHOR_SELECTOR } from './constants';
import { motionTier } from '@/lib/appearance';
import { toCurrentImageLine } from '@/lib/imageLoader';
import {
  findImageHeroThumbnail,
  getHeroRect,
  getVisualMedia,
  isAnimatedVisualSource,
  isVolatileVisualMedia,
  normalizeHeroSrc,
} from './dom';
import { captureHeroFrame, type FrameAsset } from './frameCache';
import type { ImageHeroSnapshot } from './types';

let detailComponentWarmup: Promise<unknown> | null = null;

/**
 * Detail-sized frames **already rasterised**, per image id — for steps (上一张 / 下一张) only.
 *
 * When the viewer arrives on a picture, both neighbours are warmed (`warmImageHeroSource`), so
 * a step lands on a detail-sized preview instead of the gallery card's ~300px variant
 * (`prepareImageHeroStep`). The opening flight does not read this: it takes off from the
 * card's own frame and sharpens in the air from the detail's final `<img>`
 * (`lib/hero/upgrade.ts`).
 *
 * A canvas, not an `<img>`: the probe is dropped as soon as the canvas exists, and the canvas
 * is the unit `heroFrameCache` budgets in pixels.
 *
 * **Recorded only after `decode()` resolves**: a source that has not decoded paints nothing.
 *
 * Cross-origin is fine: the canvas may be *tainted* (a derpicdn derivative is not same-origin),
 * and nothing in the hero path reads pixels back. Do not add a readback here without giving
 * this an opt-in `crossOrigin`, which derpicdn may not answer.
 */
const warmedDetailFrames = new Map<number, { src: string; asset: FrameAsset }>();
/**
 * Four, and the number is a memory bound rather than a mirror of `HERO_FRAME_CACHE_LIMIT`.
 * These canvases also land in `heroFrameCache`, whose per-entry budget a landscape `medium`
 * capture slightly exceeds — six would flush every gallery-card frame out of that cache *and*
 * hold six of its own on top, ~22MB of backing store on a phone. Four covers both neighbours of
 * the current picture and of the one just left.
 */
const MAX_WARMED_DETAIL_FRAMES = 4;

/**
 * The rung a step's preview paints: `medium`, the smallest rung that reads at the detail's
 * size (800px against the ~944px well), falling back to whatever the detail itself would show.
 * The same URL becomes the step's `previewSrc`, so it is one fetch for two consumers.
 */
function previewRungFor(image: ImagePreview): string {
  return (
    image.representations?.medium ||
    image.representations?.large ||
    image.representations?.full ||
    image.view_url ||
    ''
  );
}

/**
 * A record whose `medium` is a *video file*, which must never be handed to an `Image()`.
 * `representations.medium` is the same expression `PicDetail` passes to `<DetailVideo>`, and
 * `isAnimatedVisualSource` does not catch it — so without this the warm issued an
 * `Accept: image/*` request for a file that can never yield a frame, recorded nothing, and
 * repeated on every arrival beside a video.
 */
function isVideoRecord(image: ImagePreview): boolean {
  const source = image.representations?.full || image.view_url || '';
  const format = (image.format || source.split(/[?#]/)[0].split('.').pop() || '').toUpperCase();
  return format === 'WEBM' || format === 'MP4';
}

/** In-flight probes, so arriving on the same neighbourhood twice is one download per picture. */
const warmingDetail = new Set<number>();

/**
 * Start decoding a **viewer neighbour's** picture, and remember it once it is genuinely ready,
 * so a step (上一张 / 下一张) lands on a detail-sized preview (`prepareImageHeroStep`).
 *
 * Steps only. The opening flight no longer warms anything: it takes off from the card's own
 * frame and sharpens in the air from the detail's final `<img>` (`lib/hero/upgrade.ts`).
 * Runs in every motion tier, because a step paints this rung as its preview in all of them.
 *
 * `toCurrentImageLine`, so the warmed URL is the one the detail view will request — warming the
 * raw host while the visitor is on a proxy line downloads the bytes twice.
 */
export function warmImageHeroSource(image: ImagePreview | null | undefined) {
  if (!image || typeof window === 'undefined') return;
  if (warmedDetailFrames.has(image.id) || warmingDetail.has(image.id)) return;
  if (isVideoRecord(image)) return;
  const url = toCurrentImageLine(previewRungFor(image));
  /* An animated source is excluded rather than captured: a freshly decoded copy is at frame 0,
     and a still canvas of it would freeze the preview on a frame nobody chose. */
  if (!url || isAnimatedVisualSource(url)) return;
  const probe = new Image();
  probe.decoding = 'async';
  probe.src = url;
  warmingDetail.add(image.id);
  void probe
    .decode()
    .then(() => {
      if (probe.naturalWidth <= 0 || warmedDetailFrames.has(image.id)) return;
      const asset = captureHeroFrame(probe);
      if (!asset) return;
      if (warmedDetailFrames.size >= MAX_WARMED_DETAIL_FRAMES) {
        warmedDetailFrames.delete(warmedDetailFrames.keys().next().value!);
      }
      warmedDetailFrames.set(image.id, { src: url, asset });
    })
    .catch(() => {
      /* A dead line, a 404, a format the browser will not decode. The step falls back to the
         card's frame or the preview URL, which is what it had before this existed. */
    })
    .finally(() => {
      warmingDetail.delete(image.id);
    });
}

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
  image: ImagePreview,
  source: HTMLElement | null,
  canAnimate: boolean,
  previewSrcOverride?: string,
): ImageHeroSnapshot | null {
  if (!source) return null;
  const visual = getVisualMedia(source);
  const mediaType = visual instanceof HTMLVideoElement ? 'video' : 'image';
  /* **The card's own frame, always**, and the preview layer paints the same variant, so the two
     cannot disagree. The card's bitmap is sized for a card; the flyer sharpens in the air from
     the detail's final `<img>` (`lib/hero/upgrade.ts`) rather than needing anything sharper
     before take-off. */
  const previewFrame = captureHeroFrame(visual);
  if (!previewFrame) return null;
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

/**
 * The snapshot a step (上一张 / 下一张) lands on: what the detail paints the moment it swaps,
 * before the record arrives. The list's own preview record, and the best bitmap already decoded
 * for the picture — the card's, when the list is showing it, or the rung warmed when the viewer
 * arrived beside it (`warmImageHeroSource`). There is no press to capture from, so the frame
 * may be absent: it matters only to a later flight home, which captures the live frame first.
 */
export function prepareImageHeroStep(image: ImagePreview): ImageHeroSnapshot {
  const card = findImageHeroThumbnail(image.id);
  const visual = card ? getVisualMedia(card) : null;
  const warmed = warmedDetailFrames.get(image.id);
  const cardFrame = visual ? captureHeroFrame(visual) : null;
  const usedWarmed = Boolean(
    warmed && (!visual || !isVolatileVisualMedia(visual)) &&
      (!cardFrame || warmed.asset.pixels > cardFrame.pixels),
  );
  const previewFrame = usedWarmed ? warmed!.asset : cardFrame;
  /* With nothing decoded to show, the smallest rung that reads at the detail's size: `medium` for
     a still, the poster thumbnail for a video (whose `medium` is the video file itself — the
     preview layer then paints it as an image until the video's first frame). */
  const fallback = toCurrentImageLine(
    isVideoRecord(image)
      ? image.representations?.thumb || image.representations?.small || ''
      : previewRungFor(image) || image.representations?.small || '',
  );
  const previewSrc = normalizeHeroSrc(
    (usedWarmed ? warmed!.src : undefined) ||
      visual?.currentSrc ||
      visual?.getAttribute('src') ||
      fallback,
  );
  return {
    image,
    previewSrc,
    previewFrame,
    sourceKey: card?.dataset.imageHeroSourceKey ?? null,
    mediaType: visual instanceof HTMLVideoElement ? 'video' : 'image',
    canAnimate: false,
    createdAt: Date.now(),
  };
}

export function canAnimateImageHero(snapshot: ImageHeroSnapshot) {
  return Boolean(
    snapshot.canAnimate &&
    /* The flight is a container transform — a box travelling and resizing across the
       screen, the whole of what the reduced tier removes — so only the standard tier
       flies; the other two fall back to an ordinary navigation (under `reduced` the
       overlay fades in instead; under `off` the same rule collapses to 0s).

       Read through `motionTier()` rather than `matchMedia` directly: the tier is an
       attribute on `<html>`, already correct before the first paint, so this is a
       synchronous attribute lookup with no listener and no import cycle. */
    motionTier('image') === 'standard' &&
    typeof HTMLElement !== 'undefined' &&
    typeof HTMLElement.prototype.animate === 'function' &&
    document.querySelector(HERO_GALLERY_ANCHOR_SELECTOR),
  );
}
