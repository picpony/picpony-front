'use client';

import { HERO_MAX_HEIGHT_DVH } from './geometry';
import {
  getMediaSize,
  getVisualMedia,
  getVisualMediaSrc,
  isVolatileVisualMedia,
  type VisualMedia,
} from './dom';

const HERO_FRAME_CACHE_LIMIT = 4;
const HERO_FRAME_MAX_DIMENSION = 1280;
const HERO_FRAME_MAX_DPR = 2;
const HERO_FRAME_CACHE_MAX_PIXELS = HERO_FRAME_MAX_DIMENSION * HERO_FRAME_MAX_DIMENSION * 2;

type HeroFrameCacheEntry = {
  src: string;
  frame: HTMLCanvasElement;
  dimension: number;
};

const heroFrameCache = new Map<VisualMedia, HeroFrameCacheEntry>();

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

function getCachedHeroFrame(media: VisualMedia, requiredDimension = 0) {
  const cached = heroFrameCache.get(media);
  if (!cached || cached.src !== getVisualMediaSrc(media)) {
    if (cached) heroFrameCache.delete(media);
    return null;
  }
  if (cached.dimension < requiredDimension) return null;
  heroFrameCache.delete(media);
  heroFrameCache.set(media, cached);
  return cached.frame;
}

function trimHeroFrameCache() {
  let pixels = 0;
  heroFrameCache.forEach(({ frame }) => {
    pixels += frame.width * frame.height;
  });
  while (heroFrameCache.size > HERO_FRAME_CACHE_LIMIT || pixels > HERO_FRAME_CACHE_MAX_PIXELS) {
    const oldest = heroFrameCache.keys().next().value;
    if (!oldest) break;
    const entry = heroFrameCache.get(oldest);
    heroFrameCache.delete(oldest);
    if (entry) pixels -= entry.frame.width * entry.frame.height;
  }
}

export function captureHeroFrame(media: VisualMedia | null) {
  if (!media) return null;
  const size = getMediaSize(media);
  if (!size) return null;
  const { width: sourceWidth, height: sourceHeight } = size;
  const maxDimension = getHeroFrameDimension(sourceWidth, sourceHeight);
  const volatile = isVolatileVisualMedia(media);
  const cached = getCachedHeroFrame(media, maxDimension);
  if (cached && !volatile) return cached;
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  const frame = cached ?? document.createElement('canvas');
  const frameWidth = Math.max(1, Math.round(sourceWidth * scale));
  const frameHeight = Math.max(1, Math.round(sourceHeight * scale));
  if (frame.width !== frameWidth || frame.height !== frameHeight) {
    frame.width = frameWidth;
    frame.height = frameHeight;
  }
  const context = frame.getContext('2d');
  if (!context) return null;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  try {
    context.drawImage(media, 0, 0, frame.width, frame.height);
    heroFrameCache.set(media, {
      src: getVisualMediaSrc(media),
      frame,
      dimension: Math.max(frame.width, frame.height),
    });
    trimHeroFrameCache();
    return frame;
  } catch {
    return null;
  }
}

export function warmImageHeroFrame(source: HTMLElement | null) {
  if (!source || typeof window === 'undefined') return () => {};
  const media = getVisualMedia(source);
  const size = media ? getMediaSize(media) : null;
  if (!media || (size && !isVolatileVisualMedia(media) &&
      getCachedHeroFrame(media, getHeroFrameDimension(size.width, size.height)))) {
    return () => {};
  }

  let cancelled = false;
  const capture = () => {
    if (cancelled || !source.isConnected) return;
    // Image decode callbacks can be queued while a swipe is in progress. Do
    // the viewport check at execution time so an image that has already moved
    // away does not force layout and spend a frame on a canvas capture.
    const rect = source.getBoundingClientRect();
    if (rect.bottom < -200 || rect.top > window.innerHeight + 200) return;
    captureHeroFrame(media);
  };
  if ('requestIdleCallback' in window) {
    // Do not force a high-resolution draw while the user is actively scrolling.
    // `prepareImageHero` still captures synchronously on an actual activation;
    // this path only warms likely future activations when the main thread is
    // genuinely idle.
    const idleId = window.requestIdleCallback(capture);
    return () => {
      cancelled = true;
      window.cancelIdleCallback(idleId);
    };
  }

  const timer = setTimeout(capture, 120);
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}
