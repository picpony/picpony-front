'use client';

import {
  HERO_FRAME_CACHE_LIMIT,
  HERO_FRAME_MAX_DIMENSION,
  HERO_FRAME_MAX_DPR,
  HERO_MAX_HEIGHT_DVH,
} from './constants';
import {
  getMediaSize,
  getVisualMedia,
  getVisualMediaSrc,
  isVolatileVisualMedia,
  type VisualMedia,
} from './dom';
import { initializeHeroInput, isHeroInteractionQuiet, subscribeHeroInteraction } from './input';

const HERO_FRAME_CACHE_MAX_PIXELS = HERO_FRAME_MAX_DIMENSION * HERO_FRAME_MAX_DIMENSION * 2;

export type FrameLease = {
  canvas: HTMLCanvasElement;
  release: () => void;
};

export type FrameAsset = {
  readonly source: string;
  readonly width: number;
  readonly height: number;
  readonly pixels: number;
  acquire: () => FrameLease;
};

type HeroFrameCapture = {
  source: string;
  sourceWidth: number;
  sourceHeight: number;
  width: number;
  height: number;
  /** `<= 1`. 1 means a 1:1 blit, which needs no resampling filter at all. */
  scale: number;
};

const heroFrameCache = new Map<string, FrameAsset>();

function getHeroFrameDimension(width: number, height: number) {
  const ratio = width / height;
  const maxViewportHeight = window.innerHeight * (HERO_MAX_HEIGHT_DVH / 100);
  const maxHeight = Math.min(maxViewportHeight, height, window.innerWidth / ratio);
  const maxWidth = Math.min(window.innerWidth, width, maxViewportHeight * ratio);
  const dpr = Math.min(HERO_FRAME_MAX_DPR, Math.max(1, window.devicePixelRatio || 1));
  return Math.min(
    HERO_FRAME_MAX_DIMENSION,
    Math.max(1, Math.ceil(Math.max(maxWidth, maxHeight) * dpr)),
  );
}

function getHeroFrameCapture(media: VisualMedia): HeroFrameCapture | null {
  const size = getMediaSize(media);
  if (!size) return null;
  const { width: sourceWidth, height: sourceHeight } = size;
  const maxDimension = getHeroFrameDimension(sourceWidth, sourceHeight);
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  return {
    source: getVisualMediaSrc(media),
    sourceWidth,
    sourceHeight,
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
    scale,
  };
}

function getHeroFrameCacheKey(capture: HeroFrameCapture) {
  return [
    capture.source,
    `${capture.sourceWidth}x${capture.sourceHeight}`,
    `${capture.width}x${capture.height}`,
  ].join('\n');
}

function getCachedHeroFrame(key: string) {
  const cached = heroFrameCache.get(key);
  if (!cached) return null;
  // LRU touch.
  heroFrameCache.delete(key);
  heroFrameCache.set(key, cached);
  return cached;
}

function trimHeroFrameCache() {
  let pixels = 0;
  heroFrameCache.forEach((asset) => {
    pixels += asset.pixels;
  });
  while (heroFrameCache.size > HERO_FRAME_CACHE_LIMIT || pixels > HERO_FRAME_CACHE_MAX_PIXELS) {
    const oldest = heroFrameCache.entries().next();
    if (oldest.done) break;
    const [key, asset] = oldest.value;
    heroFrameCache.delete(key);
    pixels -= asset.pixels;
  }
}

function clearCanvasPresentation(canvas: HTMLCanvasElement) {
  canvas.getAnimations?.().forEach((animation) => {
    try {
      animation.cancel();
    } catch {
      // The flight may already have settled and canceled this animation.
    }
  });
  canvas.remove();
  canvas.removeAttribute('style');
  canvas.removeAttribute('class');
  canvas.removeAttribute('aria-hidden');
}

function copyCanvas(source: HTMLCanvasElement) {
  const copy = document.createElement('canvas');
  copy.width = source.width;
  copy.height = source.height;
  const context = copy.getContext('2d');
  if (!context) return null;
  try {
    context.drawImage(source, 0, 0);
  } catch {
    return null;
  }
  return copy;
}

function createFrameAsset(source: string, primary: HTMLCanvasElement): FrameAsset {
  let primaryLeased = false;

  return {
    source,
    width: primary.width,
    height: primary.height,
    pixels: primary.width * primary.height,
    acquire() {
      const ownsPrimary = !primaryLeased;
      const concurrentCopy = ownsPrimary ? null : copyCanvas(primary);
      if (!ownsPrimary && !concurrentCopy) {
        throw new Error('Unable to copy a concurrently leased Hero frame');
      }
      const canvas = ownsPrimary ? primary : concurrentCopy!;
      if (ownsPrimary) primaryLeased = true;

      let released = false;
      return {
        canvas,
        release() {
          if (released) return;
          released = true;
          clearCanvasPresentation(canvas);
          if (ownsPrimary) primaryLeased = false;
        },
      };
    },
  };
}

export function captureHeroFrame(media: VisualMedia | null): FrameAsset | null {
  if (!media) return null;
  const capture = getHeroFrameCapture(media);
  if (!capture) return null;

  const volatile = isVolatileVisualMedia(media);
  const cacheKey = getHeroFrameCacheKey(capture);
  if (!volatile) {
    const cached = getCachedHeroFrame(cacheKey);
    if (cached) return cached;
  }

  const frame = document.createElement('canvas');
  frame.width = capture.width;
  frame.height = capture.height;
  const context = frame.getContext('2d');
  if (!context) return null;
  /* Quality follows the scale rather than being `high` unconditionally.
   *
   * This `drawImage` is the biggest single item in the press handler, and Skia's `high`
   * is a multi-pass filter armed for a downscale. A gallery thumbnail's natural size is
   * usually at or under the cap, i.e. `scale === 1` — a 1:1 blit, where a resampling
   * filter has nothing to resample and the cost is pure. `medium` covers the genuine
   * downscales: this is a bitmap that exists for 250ms behind a growing mask, not the
   * picture the user is going to look at. */
  context.imageSmoothingEnabled = capture.scale < 1;
  context.imageSmoothingQuality = 'medium';
  try {
    context.drawImage(media, 0, 0, frame.width, frame.height);
  } catch {
    return null;
  }

  const asset = createFrameAsset(capture.source, frame);
  if (!volatile) {
    heroFrameCache.set(cacheKey, asset);
    trimHeroFrameCache();
  }
  return asset;
}

/**
 * Captures a source's pixels into the cache before they are needed.
 *
 * `immediate` is for the press path, and it changes *when* rather than *what*. The idle
 * path below refuses to run while input is active and schedules through
 * `requestIdleCallback`, neither of which can fire during a tap: a touch screen has no
 * hover, so `pointerenter` never happens, and an idle callback does not run while a
 * gesture is in flight. The result was that the one capture that mattered — the card the
 * finger is on — always landed synchronously inside `handleClick`, at full size, which is
 * exactly the intermittent press-time spike. With `immediate` the capture is posted as a
 * macrotask from `pointerdown`, and pointerdown-to-click is ≥100ms on touch, so
 * `prepareImageHero` finds it in the LRU and the click costs nothing.
 *
 * A press that turns into a scroll therefore pays one `drawImage` it did not need. That
 * is bounded by the viewport check in `captureFrame` and by the LRU, and it is one
 * capture against the alternative of paying the same one at the worst possible moment.
 */
export function warmImageHeroFrame(
  source: HTMLElement | null,
  { immediate = false }: { immediate?: boolean } = {},
) {
  if (!source || typeof window === 'undefined') return () => {};
  initializeHeroInput();
  const initialMedia = getVisualMedia(source);
  const initialCapture = initialMedia ? getHeroFrameCapture(initialMedia) : null;
  // Animated media must be captured at activation so the flyer starts on the
  // frame the user actually saw. A warm capture cannot be reused correctly.
  if (initialMedia && isVolatileVisualMedia(initialMedia)) return () => {};
  if (
    initialMedia &&
    initialCapture &&
    !isVolatileVisualMedia(initialMedia) &&
    getCachedHeroFrame(getHeroFrameCacheKey(initialCapture))
  ) {
    return () => {};
  }

  let cancelled = false;
  let finished = false;
  let idleId = 0;
  let timerId = 0;
  let firstFrame = 0;
  let secondFrame = 0;

  const clearScheduled = () => {
    if (idleId) window.cancelIdleCallback(idleId);
    if (timerId) window.clearTimeout(timerId);
    if (firstFrame) cancelAnimationFrame(firstFrame);
    if (secondFrame) cancelAnimationFrame(secondFrame);
    idleId = 0;
    timerId = 0;
    firstFrame = 0;
    secondFrame = 0;
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    clearScheduled();
    source.removeEventListener('load', schedule, true);
    source.removeEventListener('loadeddata', schedule, true);
    releaseInteraction();
  };

  const captureFrame = () => {
    idleId = 0;
    timerId = 0;
    if (cancelled || finished) return;
    if (!source.isConnected) {
      finish();
      return;
    }
    if (!immediate && !isHeroInteractionQuiet()) return;
    const media = getVisualMedia(source);
    if (!media) return;
    if (isVolatileVisualMedia(media)) {
      finish();
      return;
    }
    const rect = source.getBoundingClientRect();
    if (rect.bottom >= -200 && rect.top <= window.innerHeight + 200) {
      captureHeroFrame(media);
    }
    finish();
  };

  const schedule = () => {
    clearScheduled();
    if (cancelled || finished) return;
    if (immediate) {
      // A macrotask, not an idle callback: an idle callback does not run while a
      // gesture is live, which is the whole reason this option exists.
      timerId = window.setTimeout(captureFrame, 0);
      return;
    }
    if (!isHeroInteractionQuiet()) return;
    if ('requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(captureFrame, { timeout: 400 });
    } else {
      firstFrame = requestAnimationFrame(() => {
        firstFrame = 0;
        secondFrame = requestAnimationFrame(() => {
          secondFrame = 0;
          captureFrame();
        });
      });
    }
  };

  const releaseInteraction = subscribeHeroInteraction(schedule);
  source.addEventListener('load', schedule, true);
  source.addEventListener('loadeddata', schedule, true);
  schedule();
  return () => {
    cancelled = true;
    clearScheduled();
    source.removeEventListener('load', schedule, true);
    source.removeEventListener('loadeddata', schedule, true);
    releaseInteraction();
  };
}
