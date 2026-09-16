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
 * The detail-sized frames **already rasterised**, per image id — what the flyer actually paints.
 *
 * Not an `<img>`: the flight's sharpness is a property of the blitted canvas's bitmap and of
 * nothing else. In production the card's bitmap is sized *for a card* (304px against a 944px
 * flight box, 3.11x) and development looks sharp only because it skips the optimizer. So this
 * map holds a rasterised frame captured off the intent ladder, bounded by `captureHeroFrame`
 * itself.
 *
 * Warming a *URL* did nothing — the flyer never reads `previewSrc`; warming has to produce the
 * thing the consumer consumes, which here is a rasterised frame the moment the detail bytes
 * decode.
 *
 * **The card's `<img>` is dropped as soon as the canvas exists** — retaining 24 decoded
 * 1280x853 bitmaps is ~105MB, and the canvas is already the unit `heroFrameCache` budgets in
 * pixels.
 *
 * **Recorded only after `decode()` resolves**: the flight cannot wait for anything, and a
 * source that has not decoded paints nothing for the whole leg — far worse than a soft frame.
 *
 * Cross-origin is fine: the canvas may be *tainted* (a derpicdn derivative is not same-origin),
 * and nothing in the hero path reads pixels back. Do not add a readback here without giving
 * this an opt-in `crossOrigin`, which derpicdn may not answer.
 */
const warmedDetailFrames = new Map<number, { src: string; asset: FrameAsset }>();
/**
 * Four, and the number is a memory bound rather than a mirror of `HERO_FRAME_CACHE_LIMIT`.
 * These canvases also land in `heroFrameCache`, whose per-entry budget a landscape `medium`
 * capture slightly exceeds — six warms would flush every gallery-card frame out of that cache
 * *and* hold six of its own on top, ~22MB of backing store on a phone. Four keeps the pair
 * inside the cache's own intent while covering a run along a row of cards.
 */
const MAX_WARMED_DETAIL_FRAMES = 4;

/**
 * The same ladder `PicDetail` uses to choose what it will display, so this warms the bytes it is
 * about to request rather than a second, redundant download. Kept in step by hand; if that ladder
 * moves, this must move with it.
 */
function detailSourceFor(image: ImagePreview): string {
  const preferMedium =
    (image.size || 0) > 16 * 1024 * 1024 || (image.width || 0) * (image.height || 0) > 40_000_000;
  return (
    (preferMedium ? image.representations?.medium : undefined) ||
    image.representations?.large ||
    image.representations?.medium ||
    image.representations?.full ||
    image.view_url ||
    ''
  );
}

/**
 * The rung the **flight** warms, which is deliberately not the rung the detail displays.
 *
 * `detailSourceFor` is the 1280px rung — ~370KB for a real photograph, too big to land inside
 * a hover: that is the whole of "the first open is still soft, the second is fine". The
 * 800px `medium` rung against the 944px well is 1.18x (development's own figure) and arrives
 * in ~130ms at 10Mbps against ~340ms, so the flight warms the *smallest rung that is sharp
 * enough*. The bytes are not speculative waste: the same URL becomes `previewSrc`, so the
 * detail's preview layer paints it too — one fetch, two consumers. For a picture whose
 * original is under 800px this *is* the detail's source and the warm is a pure prefetch.
 */
function flightSourceFor(image: ImagePreview): string {
  return image.representations?.medium || detailSourceFor(image);
}

/**
 * A record whose `medium` is a *video file*, which must never be handed to an `Image()`.
 * `representations.medium` is the same expression `PicDetail` passes to `<DetailVideo>`, and
 * `isAnimatedVisualSource` does not catch it — so without this the warm issued an
 * `Accept: image/*` request for a file that can never yield a frame, recorded nothing, and
 * repeated on every hover and press of every video card.
 */
function isVideoRecord(image: ImagePreview): boolean {
  const source = image.representations?.full || image.view_url || '';
  const format = (image.format || source.split(/[?#]/)[0].split('.').pop() || '').toUpperCase();
  return format === 'WEBM' || format === 'MP4';
}

/** In-flight probes, so hover then pointerdown then click is one download rather than three. */
const warmingDetail = new Set<number>();

/**
 * Start decoding the detail's own picture, and remember it once it is genuinely ready.
 *
 * `toCurrentImageLine`, so the warmed URL is the one the detail view will request — warming the
 * raw host while the visitor is on a proxy line downloads the bytes twice and still hands the
 * flyer something the browser has to fetch again.
 */
export function warmImageHeroSource(image: ImagePreview | null | undefined) {
  if (!image || typeof window === 'undefined') return;
  if (warmedDetailFrames.has(image.id) || warmingDetail.has(image.id)) return;
  /* Nothing to warm for a tier that cannot fly: no snapshot is registered, so the preview
     layer is not rendered and the bytes and canvas would have no consumer whatsoever. */
  if (motionTier() !== 'standard') return;
  if (isVideoRecord(image)) return;
  const url = toCurrentImageLine(flightSourceFor(image));
  /* An animated source is excluded rather than captured: the flyer must start on the frame
     the user was looking at, and a freshly decoded copy is at frame 0 — a visible jump on
     take-off. Those cards keep the card's own capture, which is the frame on screen. */
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
      /* A dead line, a 404, a format the browser will not decode. The flight keeps the
         card's own bitmap, which is what it had before this existed. */
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
  /* The warmed detail frame wins when it is ready, because the card's bitmap is a ~300px
     variant about to fill the viewport. Only for a still image whose card is itself not
     volatile: a video paints its own captured frame, and an animated card must take off on
     the frame that is on screen. See `warmedDetailFrames`. */
  const warmed =
    mediaType === 'image' && visual && !isVolatileVisualMedia(visual)
      ? warmedDetailFrames.get(image.id)
      : undefined;
  /* **Whichever frame has more pixels, rather than the warmed one on principle.**
     `representations.medium` is a fit-*within* box and the card's variant is picked by DPR,
     so for a portrait upload on a 2x screen the warmed canvas can be *smaller* than the frame
     it was meant to replace — blurrier on the exact axis this mechanism exists to fix.
     Comparing is cheap and assumes nothing about either derivative's box; deriving the rung
     from `image.width`/`height` would be guessing. */
  const cardFrame = captureHeroFrame(visual);
  const previewFrame =
    warmed && (!cardFrame || warmed.asset.pixels > cardFrame.pixels) ? warmed.asset : cardFrame;
  if (!previewFrame) return null;
  /* The preview layer paints whatever the flyer took off from, so the two cannot disagree about
     which variant this picture is. */
  const usedWarmed = previewFrame === warmed?.asset;
  const previewSrc = normalizeHeroSrc(
    (usedWarmed ? warmed?.src : undefined) ||
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
    /* The flight is a container transform — a box travelling and resizing across the
       screen, the whole of what the reduced tier removes — so only the standard tier
       flies; the other two fall back to an ordinary navigation (under `reduced` the
       overlay fades in instead; under `off` the same rule collapses to 0s).

       Read through `motionTier()` rather than `matchMedia` directly: the tier is an
       attribute on `<html>`, already correct before the first paint, so this is a
       synchronous attribute lookup with no listener and no import cycle. */
    motionTier() === 'standard' &&
    typeof HTMLElement !== 'undefined' &&
    typeof HTMLElement.prototype.animate === 'function' &&
    document.querySelector(HERO_GALLERY_ANCHOR_SELECTOR),
  );
}
