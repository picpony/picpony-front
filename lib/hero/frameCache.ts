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
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
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

export function warmImageHeroFrame(source: HTMLElement | null) {
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
  let firstFrame = 0;
  let secondFrame = 0;

  const clearScheduled = () => {
    if (idleId) window.cancelIdleCallback(idleId);
    if (firstFrame) cancelAnimationFrame(firstFrame);
    if (secondFrame) cancelAnimationFrame(secondFrame);
    idleId = 0;
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
    if (cancelled || finished) return;
    if (!source.isConnected) {
      finish();
      return;
    }
    if (!isHeroInteractionQuiet()) return;
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
    if (cancelled || finished || !isHeroInteractionQuiet()) return;
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
