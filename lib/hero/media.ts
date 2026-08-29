'use client';

import type { PonyImage } from '@/lib/types/image';
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
 * The detail-sized frame we have **already rasterised**, per image id.
 *
 * ## What the flyer actually paints
 *
 * Not an `<img>`. `launchFlight` hands `createHeroFlight` the snapshot's `previewFrame`, which is a
 * `<canvas>` blitted from the gallery card's own bitmap — so the flight's sharpness is a property
 * of *that bitmap* and of nothing else. Measured in a browser on the real grid at 1920x1080:
 *
 * | | card bitmap | flight box | upscale |
 * | --- | --- | --- | --- |
 * | production | **304px** (`/_next/image`, `sizes` resolving to `304px`) | 944px | **3.11x** |
 * | development | **800px** (raw — `images.unoptimized`) | 944px | 1.18x |
 *
 * That table is the whole of the production-only softness. Dev is not doing anything clever; it is
 * skipping the optimizer, so the card happens to hold 2.6x the pixels the card itself needs and the
 * flight gets them for free.
 *
 * ## Why warming a URL did nothing
 *
 * This map used to hold a *source string*, feeding `previewSrc` — the `<img>` **behind** the
 * canvas. The flyer never reads it, so however long a visitor hovered, nothing changed. Warming has
 * to produce the thing the consumer consumes: here that is a rasterised frame, so the capture
 * happens on the intent ladder, off the press path, the moment the detail bytes decode.
 *
 * `captureHeroFrame` bounds the result itself — `HERO_FRAME_MAX_DIMENSION` (1152) at
 * `HERO_FRAME_MAX_DPR` — so a 1280px `large.jpg` lands as a 1152px canvas against a 944px box, and
 * a much larger source is downscaled rather than kept at source size.
 *
 * **The `<img>` is dropped as soon as the canvas exists.** Retaining the elements would pin their
 * decoded bitmaps: 24 of them at 1280x853 is ~105MB. The canvas is the artefact worth keeping, and
 * it is already the unit `heroFrameCache` budgets in pixels.
 *
 * **Recorded only after `decode()` resolves**, because the flight cannot wait for anything: a
 * source that has not decoded paints nothing for the whole 250ms, which is far worse than a soft
 * frame. A warm that has not landed leaves the flight exactly as it was.
 *
 * Cross-origin is fine, and is new here — the card's optimized URL is same-origin where a
 * derpicdn derivative is not, so this canvas is *tainted*. Nothing in the hero path reads pixels
 * back (the repo's only `getImageData`/`toBlob` site is `ImageCropper`, on its own canvas) and
 * `drawImage` of a tainted image never throws. Do not add a readback here without giving this an
 * opt-in `crossOrigin`, which derpicdn may not answer.
 */
const warmedDetailFrames = new Map<number, { src: string; asset: FrameAsset }>();
/**
 * Four, and the number is a memory bound rather than a mirror of `HERO_FRAME_CACHE_LIMIT`.
 *
 * These canvases also land in `heroFrameCache`, whose budget is `HERO_FRAME_MAX_DIMENSION^2 * 2`
 * pixels — about 442k per entry at six entries, while a landscape `medium` capture is 480k. So
 * six warms would flush every gallery-card frame out of that cache *and* this map would hold
 * its own six on top: roughly 22MB of canvas backing store on a phone, rather than the "not
 * much" an earlier version of this comment claimed. Four keeps the pair inside the cache's own
 * intent while still covering a run along a row of cards.
 */
const MAX_WARMED_DETAIL_FRAMES = 4;

/**
 * The same ladder `PicDetail` uses to choose what it will display, so this warms the bytes it is
 * about to request rather than a second, redundant download. Kept in step by hand; if that ladder
 * moves, this must move with it.
 */
function detailSourceFor(image: PonyImage): string {
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
 * `detailSourceFor` is `large` — 1280px, and at 373KB for a real photograph it is too big to land
 * inside a hover. That is the whole of "the first open is still soft, the second is fine": the
 * mechanism works, the bytes simply have not arrived, and on the second open they are in the HTTP
 * cache so the decode is instant.
 *
 * `medium` is derpibooru's 800px derivative, and 800px against the 944px well is **1.18x** — the
 * same figure development shows, which is the configuration nobody reports as blurry. So the flight
 * warms the *smallest rung that is sharp enough* rather than the sharpest one. Measured at 10Mbps
 * with the probe's shaped CDN: medium is 110KB and arrives in **132ms**, large is 370KB and arrives
 * in **344ms**. Add the 70ms intent delay and a decode, and large needs something over 430ms of
 * hover before it can be used where medium needs about 230ms — which is exactly the difference
 * between the first open being soft and being sharp. Against large's 0.82x this trades a downscale
 * for a 1.18x upscale; the picture the user then sits and looks at is still large, fetched by the
 * final layer as it always was.
 *
 * These bytes are not speculative waste, which is the rule this would otherwise breach: the same
 * URL becomes `previewSrc`, so the detail's preview layer paints it too — it used to paint the
 * card's own 384px variant at 2.46x. One fetch, two consumers, and neither of them is the final
 * layer's.
 *
 * For a picture whose original is under 800px, or one large enough that `detailSourceFor` already
 * prefers `medium`, this *is* the detail's source and the warm is a pure prefetch.
 */
function flightSourceFor(image: PonyImage): string {
  return image.representations?.medium || detailSourceFor(image);
}

/**
 * A record whose `medium` is a *video file*, which must never be handed to an `Image()`.
 *
 * `representations.medium` is the same expression `PicDetail` passes to `<DetailVideo>` as its
 * source, so for a webm or mp4 record it *is* the video. `isAnimatedVisualSource` does not catch
 * it — that tests `.gif`/`.apng` — so without this the warm issued a request with
 * `Accept: image/*` for a file that can never yield a frame, `decode()` rejected into the empty
 * catch, nothing was recorded, and because the `has()` guard never became true it repeated on
 * every hover and every press of every video card. On the default `picpony` line it also made
 * the image worker fetch the whole video upstream.
 */
function isVideoRecord(image: PonyImage): boolean {
  const format = (image.format || '').toUpperCase();
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
export function warmImageHeroSource(image: PonyImage | null | undefined) {
  if (!image || typeof window === 'undefined') return;
  if (warmedDetailFrames.has(image.id) || warmingDetail.has(image.id)) return;
  /* Nothing to warm for a tier that cannot fly. On `reduced` and `off` `canAnimateImageHero` is
     false, so no snapshot is ever registered, `PicDetail`'s `heroSeed` is null and the preview
     layer is not rendered at all — the bytes and the canvas would have no consumer whatsoever,
     on the tier this file elsewhere describes as a device that cannot afford the flight. */
  if (motionTier() !== 'standard') return;
  if (isVideoRecord(image)) return;
  const url = toCurrentImageLine(flightSourceFor(image));
  /* An animated source is excluded rather than captured. `captureHeroFrame` refuses to cache
     volatile media precisely because the flyer has to start on the frame the user was looking at,
     and a freshly decoded copy is at frame 0 — a visible jump on take-off. Those cards keep the
     card's own capture, which is the frame on screen. */
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
      /* A dead line, a 404, a format the browser will not decode. The flight keeps the card's own
         bitmap, which is what it had before this existed. */
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
  image: PonyImage,
  source: HTMLElement | null,
  canAnimate: boolean,
  previewSrcOverride?: string,
): ImageHeroSnapshot | null {
  if (!source) return null;
  const visual = getVisualMedia(source);
  const mediaType = visual instanceof HTMLVideoElement ? 'video' : 'image';
  /* The warmed detail frame wins when it is ready, because the card's bitmap is a ~300px variant
     about to fill the viewport — 3.11x, measured. Only when ready, and only for a still image
     whose card is itself not volatile: a video paints its own captured frame, and an animated card
     must take off on the frame that is on screen. See `warmedDetailFrames`. */
  const warmed =
    mediaType === 'image' && visual && !isVolatileVisualMedia(visual)
      ? warmedDetailFrames.get(image.id)
      : undefined;
  /* **Whichever frame has more pixels, rather than the warmed one on principle.**

     `representations.medium` is a fit-*within* box, so its long edge is 600 rather than 800 for
     anything taller than 4:3 — and the card's own variant is picked from a srcset by DPR, so on
     a 2x screen it can be 640 or 750 wide. For a portrait upload the warmed canvas is therefore
     sometimes *smaller* than the frame it was meant to replace: a 1500x2500 picture at DPR 2
     measures 640 from the card against 360 from `medium`, which would have made the flight
     blurrier on the exact axis this mechanism exists to fix.

     Comparing is cheap and assumes nothing about either box: `warmImageHeroFrame` has normally
     already cached the card's capture, so this is an LRU hit rather than a second `drawImage`.
     Deriving the right rung from `image.width`/`height` instead would be guessing at the CDN's
     derivative boxes; measuring both is not. */
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
