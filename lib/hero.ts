'use client';

import type { PonyImage } from '@/lib/types/image';
import {
  peekImageDetail,
  prefetchImageDetail,
  type DetailRequestPriority,
} from '@/lib/detail';
import type {
  HeroDirection,
  HeroPhase,
  ImageHeroSnapshot,
  ImageHeroBackgroundLocation,
  ImageHeroStageState,
  Rect,
  Host,
  Flight,
  FlightMotion,
  ScrollSync,
  OpeningInterrupt,
  ImageHeroNavigationOptions,
  ImageHeroHistoryMarker,
  ImageHeroHistoryRecord,
  ImageHeroHistoryPosition,
  ClosingHistoryOutcome,
  VisualMedia,
} from './hero/types';
export type {
  ImageHeroSnapshot,
  ImageHeroBackgroundLocation,
  ImageHeroStageState,
} from './hero/types';

const SNAPSHOT_TTL = 2 * 60 * 1000;
const ROUTE_TIMEOUT = 4000;
const DURATIONS: Record<HeroDirection, number> = {
  forward: 300,
  back: 245,
};
const HOST_SELECTOR = '[data-image-detail-host]';
const BACKGROUND_SELECTOR = '[data-image-detail-background]';
const BACKGROUND_VISUAL_SELECTOR = '[data-image-detail-background-visual]';
const DESTINATION_SELECTOR = '[data-image-hero-destination-box]';
const DETAIL_OVERLAY_SELECTOR = '[data-image-detail-overlay]';
const STAGE_TARGET_SELECTOR = '[data-image-hero-stage-target]';
const STAGE_READY_TARGET_SELECTOR = `${STAGE_TARGET_SELECTOR}[data-image-hero-stage-ready="true"]`;
const BACKGROUND_SINK = 'translate3d(0, 10px, 0) scale(0.985)';
const HISTORY_STATE_KEY = '__picponyImageHero';

const MOTION_RESPONSE: Record<HeroDirection, {
  rate: number;
  initialVelocity: number;
}> = {
  // A critically damped response keeps the flight lively without overshooting
  // its exact landing geometry. These rates still leave visible motion in the
  // final third, so the animation finishes decisively instead of coasting.
  forward: { rate: 5.6, initialVelocity: 1 },
  back: { rate: 5.9, initialVelocity: 1 },
};

let phase: HeroPhase = 'idle';
let snapshot: ImageHeroSnapshot | null = null;
let sourceElement: HTMLElement | null = null;
let lastLocation: ImageHeroBackgroundLocation | null = null;
let transitionFinished: Promise<void> = Promise.resolve();
let resolveTransition: (() => void) | null = null;
let componentWarmup: Promise<unknown> | null = null;
let stageState: ImageHeroStageState = { phase: 'idle', snapshot: null };
const stageListeners = new Set<() => void>();
let wheelCapture: {
  direction: HeroDirection;
  deltaX: number;
  deltaY: number;
  stop: () => void;
} | null = null;
let requestOpeningInterrupt: ((navigationHandled: boolean) => void) | null = null;
let openingExpectedDetailHref: string | null = null;
let openingObservedExpectedRoute = false;
let stopTransitionScroll: (() => void) | null = null;
let preserveInterruptedRoute = false;
let releaseInterruptedRouteHold: (() => void) | null = null;
let historyNavigationListenerInstalled = false;
let imageHeroHistoryRecord: ImageHeroHistoryRecord | null = null;
let imageHeroHistoryPosition: ImageHeroHistoryPosition = 'unknown';
let closingHistoryRestoreRequested = false;
let notifyClosingHistoryRestore: (() => void) | null = null;

function readImageHeroHistoryMarker(state: unknown): ImageHeroHistoryMarker | null {
  if (!state || typeof state !== 'object') return null;
  const value = (state as Record<string, unknown>)[HISTORY_STATE_KEY];
  if (!value || typeof value !== 'object') return null;
  const marker = value as Partial<ImageHeroHistoryMarker>;
  if (
    marker.version !== 1 ||
    typeof marker.token !== 'string' ||
    (marker.kind !== 'base' && marker.kind !== 'guard') ||
    typeof marker.imageId !== 'number' ||
    typeof marker.detailHref !== 'string' ||
    !marker.background ||
    typeof marker.background.pathname !== 'string' ||
    typeof marker.background.search !== 'string'
  ) {
    return null;
  }
  return marker as ImageHeroHistoryMarker;
}

function currentImageHeroHistoryMarker() {
  return readImageHeroHistoryMarker(window.history.state);
}

function normalizePathSearch(href: string) {
  try {
    const url = new URL(href, window.location.href);
    return `${url.pathname}${url.search}`;
  } catch {
    return href;
  }
}

function isAtOpeningDetailLocation() {
  return Boolean(
    openingExpectedDetailHref &&
    normalizePathSearch(window.location.href) === openingExpectedDetailHref,
  );
}

function findImageHeroThumbnail(imageId: number, sourceKey?: string | null) {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(
    `[data-image-hero-role="thumbnail"][data-image-hero-id="${imageId}"]`,
  ));
  if (!sourceKey) return candidates[0] ?? null;
  return candidates.find((element) => element.dataset.imageHeroSourceKey === sourceKey) ?? null;
}

function isCurrentImageHeroHistoryMarker(
  marker: ImageHeroHistoryMarker | null,
  kind?: ImageHeroHistoryMarker['kind'],
) {
  return Boolean(
    marker &&
    imageHeroHistoryRecord &&
    marker.token === imageHeroHistoryRecord.token &&
    (!kind || marker.kind === kind),
  );
}

function installImageHeroHistoryGuard(value: ImageHeroSnapshot) {
  if (!lastLocation || !/^\/pic\/[^/]+\/?$/.test(window.location.pathname)) return;
  const detailHref = `${window.location.pathname}${window.location.search}`;
  const token = `${value.image.id}:${value.createdAt}:${Math.random().toString(36).slice(2)}`;
  const shared = {
    version: 1 as const,
    token,
    imageId: value.image.id,
    detailHref,
    background: lastLocation,
  };
  const state = window.history.state && typeof window.history.state === 'object'
    ? window.history.state as Record<string, unknown>
    : {};
  const baseMarker: ImageHeroHistoryMarker = { ...shared, kind: 'base' };
  window.history.replaceState({ ...state, [HISTORY_STATE_KEY]: baseMarker }, '', window.location.href);
  const guardState = window.history.state && typeof window.history.state === 'object'
    ? window.history.state as Record<string, unknown>
    : state;
  const guardMarker: ImageHeroHistoryMarker = { ...shared, kind: 'guard' };
  window.history.pushState({ ...guardState, [HISTORY_STATE_KEY]: guardMarker }, '', window.location.href);
  imageHeroHistoryRecord = {
    token,
    imageId: value.image.id,
    detailHref,
    background: lastLocation,
    snapshot: value,
  };
  imageHeroHistoryPosition = 'guard';
}

function commitImageHeroBack(fallback: () => void) {
  const marker = currentImageHeroHistoryMarker();
  if (isCurrentImageHeroHistoryMarker(marker, 'guard')) {
    imageHeroHistoryPosition = 'background';
    window.history.go(-2);
    return;
  }
  if (isCurrentImageHeroHistoryMarker(marker, 'base')) {
    imageHeroHistoryPosition = 'background';
    window.history.back();
    return;
  }
  fallback();
}

function resolveClosingHistoryOutcome(imageId: number, popStateCount: number): ClosingHistoryOutcome {
  if (closingHistoryRestoreRequested) return 'restore-detail';
  if (popStateCount === 0) return 'commit';
  const marker = currentImageHeroHistoryMarker();
  if (isCurrentImageHeroHistoryMarker(marker, 'base')) return 'commit';
  if (isCurrentImageHeroHistoryMarker(marker, 'guard')) return 'restore-detail';
  return normalizePathSearch(window.location.href) === `/pic/${imageId}`
    ? 'restore-detail'
    : 'handled';
}

function restoreImageHeroHistoryGuard(record: ImageHeroHistoryRecord) {
  const marker = currentImageHeroHistoryMarker();
  const currentHref = `${window.location.pathname}${window.location.search}`;
  if (
    imageHeroHistoryPosition !== 'base' ||
    !marker ||
    marker.kind !== 'base' ||
    marker.token !== record.token ||
    currentHref !== record.detailHref
  ) {
    return;
  }
  imageHeroHistoryPosition = 'guard';
  window.history.forward();
}

async function restoreImageHeroFromHistory(record: ImageHeroHistoryRecord) {
  const source = findImageHeroThumbnail(record.imageId, record.snapshot.sourceKey);
  if (source?.isConnected) {
    await navigateToImageWithHero(
      record.snapshot,
      source,
      () => {},
      (navigationHandled) => {
        if (!navigationHandled) commitImageHeroBack(() => window.history.back());
      },
      {
        backgroundLocation: record.background,
        detailHref: record.detailHref,
        historyMode: 'restore',
      },
    );
  }
  restoreImageHeroHistoryGuard(record);
}

function handleImageHeroHistoryNavigation(event: PopStateEvent) {
  const previousPosition = imageHeroHistoryPosition;
  const marker = readImageHeroHistoryMarker(event.state);
  imageHeroHistoryPosition = marker?.kind ?? 'background';
  const record = imageHeroHistoryRecord;
  if (!marker || marker.kind !== 'base') return;

  if (!record || marker.token !== record.token) {
    // A full reload keeps the same-URL guard/base entries in browser history,
    // but the in-memory snapshot needed for a Hero transition is gone. When
    // the first Back lands on that orphaned base entry, continue immediately
    // to the real background entry instead of making the user press Back twice.
    if (previousPosition === 'guard') {
      imageHeroHistoryPosition = 'background';
      window.history.back();
    }
    return;
  }

  // A close can already have committed its two-step history return when the
  // user immediately presses Forward. Keep that base entry instead of letting
  // the still-running close tear down the remounting detail route.
  if (
    phase === 'closing' &&
    previousPosition === 'background' &&
    marker.kind === 'base'
  ) {
    closingHistoryRestoreRequested = true;
    notifyClosingHistoryRestore?.();
    return;
  }

  if (previousPosition === 'guard') {
    if (phase === 'opening') {
      requestOpeningInterrupt?.(true);
      return;
    }
    if (phase !== 'idle') return;
    void navigateBackWithImageHero(record.imageId, () => {
      commitImageHeroBack(() => window.history.back());
    });
    return;
  }

  if (previousPosition === 'background' || previousPosition === 'unknown') {
    if (phase !== 'idle') return;
    void restoreImageHeroFromHistory(record);
  }
}

function ensureHistoryNavigationListener() {
  if (historyNavigationListenerInstalled) return;
  historyNavigationListenerInstalled = true;
  window.addEventListener('popstate', handleImageHeroHistoryNavigation, { capture: true });
}

export function initializeImageHeroHistory() {
  ensureHistoryNavigationListener();
  const marker = currentImageHeroHistoryMarker();
  imageHeroHistoryPosition = marker?.kind ?? 'background';
}

export function observeImageHeroClientNavigation(href: string) {
  if (phase !== 'opening' || !requestOpeningInterrupt) return false;
  const nextHref = normalizePathSearch(href);
  if (openingExpectedDetailHref && nextHref === openingExpectedDetailHref) {
    openingObservedExpectedRoute = true;
    return false;
  }
  const backgroundHref = lastLocation
    ? normalizePathSearch(`${lastLocation.pathname}${lastLocation.search}`)
    : null;
  // The stage can commit one render before App Router publishes the target
  // pathname. Ignore that initial source-route observation, but interrupt any
  // other route immediately, even if the detail route has not mounted yet.
  if (!openingObservedExpectedRoute && backgroundHref === nextHref) return false;
  requestOpeningInterrupt(true);
  return true;
}

function publishStage(next: ImageHeroStageState) {
  stageState = next;
  stageListeners.forEach((listener) => listener());
}

function now() {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function stopWheelCapture(replay: boolean) {
  const capture = wheelCapture;
  wheelCapture = null;
  if (!capture) return;

  capture.stop();
  if (!replay || (Math.abs(capture.deltaX) < 0.5 && Math.abs(capture.deltaY) < 0.5)) {
    return;
  }

  const routeOverlay = Array.from(
    document.querySelectorAll<HTMLElement>(DETAIL_OVERLAY_SELECTOR),
  ).find((element) => !element.hasAttribute('data-image-hero-stage'))
    ?? null;
  const scroller = capture.direction === 'forward'
    ? routeOverlay?.querySelector<HTMLElement>('.image-detail-overlay-scroll')
    : document.querySelector<HTMLElement>(BACKGROUND_SELECTOR);

  scroller?.scrollBy({
    left: capture.deltaX,
    top: capture.deltaY,
    behavior: 'auto',
  });
}

function stopActiveTransitionScroll() {
  stopTransitionScroll?.();
  stopTransitionScroll = null;
}

function getRouteScroller() {
  return Array.from(
    document.querySelectorAll<HTMLElement>(DETAIL_OVERLAY_SELECTOR),
  ).find((element) => !element.hasAttribute('data-image-hero-stage'))
    ?.querySelector<HTMLElement>('.image-detail-overlay-scroll') ?? null;
}

function createTransitionScrollNodes(): TransitionScrollNodes {
  return {
    stageScroller: document.querySelector<HTMLElement>(
      '[data-image-hero-stage] .image-detail-overlay-scroll',
    ),
    routeScroller: getRouteScroller(),
  };
}

function syncStageScroll(
  scrollLeft: number,
  scrollTop: number,
  source?: HTMLElement | null,
  nodes = createTransitionScrollNodes(),
  mirrorRoute = true,
) {
  const { stageScroller, routeScroller } = nodes;
  if (stageScroller && stageScroller !== source) {
    stageScroller.scrollLeft = scrollLeft;
    stageScroller.scrollTop = scrollTop;
  }
  if (mirrorRoute && routeScroller && routeScroller !== source) {
    routeScroller.scrollLeft = scrollLeft;
    routeScroller.scrollTop = scrollTop;
  }
}

function startWheelCapture(direction: HeroDirection) {
  stopWheelCapture(false);

  const capture = {
    direction,
    deltaX: 0,
    deltaY: 0,
    stop: () => {},
  };
  const handleWheel = (event: WheelEvent) => {
    if (event.ctrlKey || phase !== 'opening') return;

    const scale = event.deltaMode === 1
      ? 16
      : event.deltaMode === 2
        ? window.innerHeight
        : 1;
    const deltaX = event.deltaX * scale;
    const deltaY = event.deltaY * scale;
    capture.deltaX += deltaX;
    capture.deltaY += deltaY;
    event.preventDefault();
  };

  window.addEventListener('wheel', handleWheel, { capture: true, passive: false });
  capture.stop = () => window.removeEventListener('wheel', handleWheel, true);
  wheelCapture = capture;
}

function redirectWheelCapture(direction: HeroDirection) {
  if (direction === 'back') {
    stopWheelCapture(false);
    return;
  }
  if (wheelCapture) {
    wheelCapture.direction = direction;
    return;
  }
  startWheelCapture(direction);
}

function createOpeningInterrupt(): OpeningInterrupt {
  let resolvePromise: (() => void) | null = null;
  const state: OpeningInterrupt = {
    promise: new Promise<void>((resolve) => {
      resolvePromise = resolve;
    }),
    requested: false,
    navigationHandled: false,
    replayNavigation: null,
    request(navigationHandled) {
      if (state.requested) {
        state.navigationHandled ||= navigationHandled;
        return;
      }
      state.requested = true;
      state.navigationHandled = navigationHandled;
      // Hide the real intercepted route as soon as an opening is interrupted.
      // The stage/flyer remain visible, so this closes the small handoff window
      // where the route could otherwise paint for one frame before reversing.
      document.documentElement.dataset.imageHeroInterrupted = 'true';
      resolvePromise?.();
    },
    dispose() {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('click', handleClick, true);
      if (requestOpeningInterrupt === state.request) requestOpeningInterrupt = null;
    },
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    state.request(false);
  };
  const handlePopState = () => state.request(true);
  const handleClick = (event: MouseEvent) => {
    if (
      state.navigationHandled ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    const target = event.target instanceof Element
      ? event.target.closest<HTMLAnchorElement>('a[href]')
      : null;
    if (!target || target.target === '_blank' || target.hasAttribute('download')) return;
    let href: string;
    try {
      const url = new URL(target.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      href = `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return;
    }
    if (normalizePathSearch(href) === openingExpectedDetailHref) return;

    event.preventDefault();
    event.stopPropagation();
    state.replayNavigation = () => {
      if (target.isConnected) target.click();
    };
    state.request(false);
  };

  requestOpeningInterrupt = state.request;
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('popstate', handlePopState);
  window.addEventListener('click', handleClick, true);
  return state;
}

function normalizeSrc(src: string) {
  if (!src || typeof window === 'undefined') return src;
  try {
    const url = new URL(src, window.location.href);
    return url.origin === window.location.origin
      ? `${url.pathname}${url.search}${url.hash}`
      : url.href;
  } catch {
    return src;
  }
}

function physicalProgress(time: number, direction: HeroDirection) {
  const { rate, initialVelocity } = MOTION_RESPONSE[direction];
  const response = (value: number) =>
    1 - (1 + (rate - initialVelocity) * value) * Math.exp(-rate * value);
  const end = response(1);
  return time === 1 ? 1 : response(time) / end;
}

function motionFrames(direction: HeroDirection, count = 32) {
  return Array.from({ length: count }, (_, index) => {
    const offset = index / (count - 1);
    return { offset, progress: physicalProgress(offset, direction) };
  });
}

function geometryFrames(direction: HeroDirection) {
  const count = Math.ceil((DURATIONS[direction] / 1000) * 120) + 1;
  return Array.from({ length: count }, (_, index) => {
    const offset = index / (count - 1);
    return { offset, progress: physicalProgress(offset, direction) };
  });
}

function interpolate(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

function getRect(element: HTMLElement): Rect {
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top,
    left: rect.left,
    width: Math.max(1, rect.width),
    height: Math.max(1, rect.height),
  };
}

function getHost(): Host | null {
  const element = document.querySelector<HTMLElement>(HOST_SELECTOR);
  return element ? { element, ...getRect(element) } : null;
}

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

function getVisualMedia(element: HTMLElement | null) {
  return element?.querySelector<VisualMedia>('img, video') ?? null;
}

function getVisualMediaSrc(media: VisualMedia) {
  return normalizeSrc(media.currentSrc || media.getAttribute('src') || '');
}

function isAnimatedVisualSource(src: string) {
  return /(?:\.gif|\.apng)(?:[?#]|$)|[?&](?:format|ext)=(?:gif|apng)(?:&|$)/i.test(src);
}

function isVolatileVisualMedia(media: VisualMedia) {
  return media instanceof HTMLVideoElement || isAnimatedVisualSource(getVisualMediaSrc(media));
}

function getMediaSize(media: VisualMedia) {
  const isVideo = media instanceof HTMLVideoElement;
  const width = isVideo ? media.videoWidth : media.naturalWidth;
  const height = isVideo ? media.videoHeight : media.naturalHeight;
  if (isVideo && media.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
  if (!isVideo && !media.complete) return null;
  return width > 0 && height > 0 ? { width, height } : null;
}

function getHeroFrameDimension(width: number, height: number) {
  const ratio = width / height;
  const maxHeight = Math.min(window.innerHeight * 0.8, height, window.innerWidth / ratio);
  const maxWidth = Math.min(window.innerWidth, width, window.innerHeight * 0.8 * ratio);
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

function captureHeroFrame(media: VisualMedia | null) {
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

  const rect = source.getBoundingClientRect();
  if (rect.bottom < -200 || rect.top > window.innerHeight + 200) return () => {};

  let cancelled = false;
  const capture = () => {
    if (!cancelled && source.isConnected) captureHeroFrame(media);
  };
  if ('requestIdleCallback' in window) {
    const idleId = window.requestIdleCallback(capture, { timeout: 160 });
    return () => {
      cancelled = true;
      window.cancelIdleCallback(idleId);
    };
  }

  const timer = setTimeout(capture, 48);
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}

function getDestination(image: PonyImage) {
  const element = document.querySelector<HTMLElement>(DESTINATION_SELECTOR);
  if (!element) return null;

  const width = Math.max(1, image.width || 1);
  const height = Math.max(1, image.height || 1);
  const ratio = width / height;
  element.style.aspectRatio = `${width} / ${height}`;
  element.style.width = `min(100%, ${width}px, calc(80dvh * ${ratio}))`;
  element.style.maxWidth = '100%';
  element.style.maxHeight = '80dvh';
  element.style.borderRadius = '0.5rem';
  return { element, rect: getRect(element) };
}

function hide(element: HTMLElement | null) {
  if (!element) return '';
  const previous = element.style.opacity;
  element.style.opacity = '0';
  return previous;
}

function restore(element: HTMLElement | null, previous: string) {
  if (element) element.style.opacity = previous;
}

const SUSPENDED_IMAGE_SRC =
  'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

function isAnimatedDetailImage(element: HTMLImageElement) {
  return isAnimatedVisualSource(element.currentSrc || element.getAttribute('src') || '');
}

function suspendHeavyDetailMedia(source: HTMLElement) {
  const layers = Array.from(source.querySelectorAll<HTMLElement>('[data-image-detail-layer]'));
  const previous = layers.map((element) => ({
    element,
    opacity: element.style.opacity,
    src: element instanceof HTMLImageElement ? element.getAttribute('src') : null,
    srcSet: element instanceof HTMLImageElement ? element.getAttribute('srcset') : null,
    sizes: element instanceof HTMLImageElement ? element.getAttribute('sizes') : null,
    animated: element instanceof HTMLImageElement && isAnimatedDetailImage(element),
    wasPlaying: element instanceof HTMLVideoElement && !element.paused,
  }));
  previous.forEach(({ element, animated }) => {
    if (element.dataset.imageDetailLayer === 'final') {
      if (element instanceof HTMLVideoElement) element.pause();
      element.style.opacity = '0';
      if (element instanceof HTMLImageElement && animated) {
        element.removeAttribute('srcset');
        element.removeAttribute('sizes');
        element.src = SUSPENDED_IMAGE_SRC;
      }
    } else if (element.dataset.imageDetailLayer === 'preview') {
      element.style.opacity = '1';
    }
  });
  return async () => {
    const animatedDecodes: Promise<unknown>[] = [];
    previous.forEach(({ element, src, srcSet, sizes, animated }) => {
      if (!element.isConnected || !(element instanceof HTMLImageElement) || !animated) return;
      if (sizes === null) element.removeAttribute('sizes');
      else element.setAttribute('sizes', sizes);
      if (srcSet === null) element.removeAttribute('srcset');
      else element.setAttribute('srcset', srcSet);
      if (src === null) element.removeAttribute('src');
      else element.setAttribute('src', src);
      animatedDecodes.push(element.decode().catch(() => undefined));
    });
    if (animatedDecodes.length > 0) {
      await Promise.race([
        Promise.allSettled(animatedDecodes),
        new Promise<void>((resolve) => window.setTimeout(resolve, 250)),
      ]);
    }
    previous.forEach(({ element, opacity, wasPlaying }) => {
      if (!element.isConnected) return;
      element.style.opacity = opacity;
      if (element instanceof HTMLVideoElement && wasPlaying) {
        void element.play().catch(() => undefined);
      }
    });
  };
}

type PendingElementWait = {
  selector: string;
  resolve: (element: HTMLElement | null) => void;
  timer: number | null;
};

function createElementWaiter(signal?: AbortSignal) {
  const waits = new Set<PendingElementWait>();
  let observer: MutationObserver | null = null;
  let disposed = false;

  const finish = (wait: PendingElementWait, element: HTMLElement | null) => {
    if (!waits.delete(wait)) return;
    if (wait.timer !== null) window.clearTimeout(wait.timer);
    wait.resolve(element);
    if (waits.size === 0) {
      observer?.disconnect();
      observer = null;
    }
  };
  const check = () => {
    if (disposed || waits.size === 0) return;
    const selectors = [...new Set([...waits].map((wait) => wait.selector))].join(',');
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(selectors));
    [...waits].forEach((wait) => {
      const element = candidates.find((candidate) => candidate.matches(wait.selector)) ?? null;
      if (element) finish(wait, element);
    });
  };
  const ensureObserver = () => {
    if (observer || disposed) return;
    observer = new MutationObserver(check);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-image-hero-ready', 'data-image-hero-stage-ready'],
    });
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    observer?.disconnect();
    observer = null;
    signal?.removeEventListener('abort', dispose);
    [...waits].forEach((wait) => finish(wait, null));
  };

  signal?.addEventListener('abort', dispose, { once: true });
  return {
    wait(selector: string, timeout = ROUTE_TIMEOUT) {
      if (disposed || signal?.aborted) return Promise.resolve<HTMLElement | null>(null);
      const existing = document.querySelector<HTMLElement>(selector);
      if (existing) return Promise.resolve(existing);
      return new Promise<HTMLElement | null>((resolve) => {
        const wait: PendingElementWait = { selector, resolve, timer: null };
        if (timeout > 0) {
          wait.timer = window.setTimeout(() => finish(wait, null), timeout);
        }
        waits.add(wait);
        ensureObserver();
        check();
      });
    },
    dispose,
  };
}

function holdInterruptedRouteUntilGone() {
  if (releaseInterruptedRouteHold) return;
  preserveInterruptedRoute = true;
  const selector = `${DETAIL_OVERLAY_SELECTOR}:not([data-image-hero-stage])`;
  let frame = 0;
  const finish = () => {
    if (frame) cancelAnimationFrame(frame);
    observer.disconnect();
    window.removeEventListener('popstate', check);
    if (releaseInterruptedRouteHold === finish) releaseInterruptedRouteHold = null;
    preserveInterruptedRoute = false;
    delete document.documentElement.dataset.imageHeroInterrupted;
  };
  const check = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!/^\/pic\/[^/]+\/?$/.test(window.location.pathname) &&
          !document.querySelector(selector)) {
        finish();
      }
    });
  };
  const observer = new MutationObserver(check);
  releaseInterruptedRouteHold = finish;
  window.addEventListener('popstate', check);
  observer.observe(document.body, { childList: true, subtree: true });
  check();
}

function waitForRouteOverlayGone(timeout = 1200, signal?: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    const selector = `${DETAIL_OVERLAY_SELECTOR}:not([data-image-hero-stage])`;
    let settled = false;
    let settling = false;
    let observer: MutationObserver | null = null;
    let timer = 0;
    const finish = (gone: boolean) => {
      if (settled) return;
      settled = true;
      observer?.disconnect();
      window.clearTimeout(timer);
      window.removeEventListener('popstate', check);
      signal?.removeEventListener('abort', handleAbort);
      resolve(gone);
    };
    const handleAbort = () => finish(false);
    const check = () => {
      if (settled || settling || /^\/pic\/[^/]+\/?$/.test(window.location.pathname) ||
          document.querySelector(selector)) {
        return;
      }
      settling = true;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        settling = false;
        if (!/^\/pic\/[^/]+\/?$/.test(window.location.pathname) &&
            !document.querySelector(selector)) {
          finish(true);
        }
      }));
    };
    if (signal?.aborted) {
      finish(false);
      return;
    }
    observer = new MutationObserver(check);
    timer = window.setTimeout(() => finish(false), timeout);
    window.addEventListener('popstate', check);
    signal?.addEventListener('abort', handleAbort, { once: true });
    check();
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

function bindOpeningScroll(
  motion: FlightMotion,
  waitForElement: (selector: string, timeout?: number) => Promise<HTMLElement | null>,
): ScrollSync {
  let disposed = false;
  let frame = 0;
  let initialized = false;
  let currentX = 0;
  let currentY = 0;
  let targetX = wheelCapture?.direction === 'forward' ? wheelCapture.deltaX : 0;
  let targetY = wheelCapture?.direction === 'forward' ? wheelCapture.deltaY : 0;
  let lastTime = now();
  let stageScroller: HTMLElement | null = null;
  const backgroundScroller = document.querySelector<HTMLElement>(BACKGROUND_SELECTOR);
  const backgroundOriginX = backgroundScroller?.scrollLeft ?? 0;
  const backgroundOriginY = backgroundScroller?.scrollTop ?? 0;
  let backgroundX = backgroundOriginX;
  let backgroundY = backgroundOriginY;
  let backgroundBridge = false;
  let touchActive = false;
  let touchOwner: 'stage' | 'background' | null = null;
  let lastNativeScroll = Number.NEGATIVE_INFINITY;
  let releaseTimer = 0;
  const releaseWaiters = new Set<() => void>();
  const nodes = createTransitionScrollNodes();
  stopWheelCapture(false);

  // The stage is the stable scroll surface for the whole opening flight.
  // The route overlay can mount earlier than its content and briefly report a
  // zero scroll range; using it here would discard wheel intent during that
  // window. Handoff copies the final stage position to the real route.
  const getScroller = () => nodes.stageScroller ?? nodes.routeScroller;
  const clamp = (value: number, max: number) => Math.min(Math.max(0, value), Math.max(0, max));
  const resolveReleaseWaiters = () => {
    releaseWaiters.forEach((resolve) => resolve());
    releaseWaiters.clear();
  };
  const restoreBackgroundScroll = () => {
    if (!backgroundBridge || !backgroundScroller) return;
    backgroundBridge = false;
    backgroundX = backgroundOriginX;
    backgroundY = backgroundOriginY;
    backgroundScroller.scrollLeft = backgroundOriginX;
    backgroundScroller.scrollTop = backgroundOriginY;
  };
  const isReleaseReady = () =>
    !touchActive && !frame && now() - lastNativeScroll >= 72;
  const scheduleReleaseCheck = () => {
    if (releaseTimer) window.clearTimeout(releaseTimer);
    releaseTimer = 0;
    if (isReleaseReady()) {
      restoreBackgroundScroll();
      touchOwner = null;
      resolveReleaseWaiters();
      return;
    }
    const remaining = touchActive
      ? 16
      : frame
        ? 16
        : Math.max(0, 72 - (now() - lastNativeScroll));
    releaseTimer = window.setTimeout(scheduleReleaseCheck, Math.max(1, remaining));
  };
  const waitForRelease = () => {
    if (isReleaseReady()) return Promise.resolve();
    return new Promise<void>((resolve) => {
      releaseWaiters.add(resolve);
      scheduleReleaseCheck();
    });
  };
  const sync = () => {
    if (disposed || !initialized) return;
    const scroller = getScroller();
    if (!scroller) return;
    scroller.scrollLeft = currentX;
    scroller.scrollTop = currentY;
    syncStageScroll(currentX, currentY, scroller, nodes);
    motion.retarget(-currentX, -currentY, 'to');
  };
  const tick = (time: number) => {
    frame = 0;
    if (disposed || !initialized) return;
    const scroller = getScroller();
    if (!scroller) return;
    const desiredX = clamp(targetX, scroller.scrollWidth - scroller.clientWidth);
    const desiredY = clamp(targetY, scroller.scrollHeight - scroller.clientHeight);
    const delta = Math.min(50, Math.max(1, time - lastTime));
    lastTime = time;
    const amount = 1 - Math.exp(-delta / 42);
    currentX += (desiredX - currentX) * amount;
    currentY += (desiredY - currentY) * amount;
    if (Math.abs(desiredX - currentX) < 0.15) currentX = desiredX;
    if (Math.abs(desiredY - currentY) < 0.15) currentY = desiredY;
    sync();
    if (Math.abs(desiredX - currentX) >= 0.15 || Math.abs(desiredY - currentY) >= 0.15) {
      frame = requestAnimationFrame(tick);
    } else {
      scheduleReleaseCheck();
    }
  };
  const scheduleSync = () => {
    if (!frame) {
      lastTime = now();
      frame = requestAnimationFrame(tick);
    }
  };
  const handleWheel = (event: WheelEvent) => {
    if (event.ctrlKey || phase !== 'opening') return;
    const scale = event.deltaMode === 1
      ? 16
      : event.deltaMode === 2
        ? window.innerHeight
        : 1;
    targetX += event.deltaX * scale;
    targetY += event.deltaY * scale;
    event.preventDefault();
    scheduleSync();
  };
  const syncNativeScroll = () => {
    if (disposed || !stageScroller) return;
    const nextX = stageScroller.scrollLeft;
    const nextY = stageScroller.scrollTop;
    if (Math.abs(nextX - currentX) < 0.5 && Math.abs(nextY - currentY) < 0.5) {
      return;
    }
    currentX = nextX;
    currentY = nextY;
    targetX = nextX;
    targetY = nextY;
    lastNativeScroll = now();
    // The routed detail is hidden until handoff and gets an exact final
    // position during `flush()`. Avoid re-scrolling that offscreen surface on
    // every native touch event: on mobile it adds work to the scroll frame
    // without contributing to the visible result.
    motion.retarget(-currentX, -currentY, 'to');
    scheduleReleaseCheck();
  };
  const handleNativeScroll = () => {
    // Native touch scrolling already advances on the compositor. Queueing this
    // transform compensation through another rAF makes the fixed Hero target
    // visibly trail the finger by one frame on coarse pointers. This path only
    // reads scroll offsets and writes composited transforms, so synchronizing
    // in the scroll callback avoids that latency without forcing layout.
    syncNativeScroll();
  };
  const handleBackgroundScroll = () => {
    if (disposed || !backgroundScroller ||
        (touchOwner !== 'background' && !backgroundBridge)) {
      return;
    }
    const nextX = backgroundScroller.scrollLeft;
    const nextY = backgroundScroller.scrollTop;
    const deltaX = nextX - backgroundX;
    const deltaY = nextY - backgroundY;
    backgroundX = nextX;
    backgroundY = nextY;
    if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return;

    backgroundBridge = true;
    lastNativeScroll = now();
    if (stageScroller) {
      const nextStageX = clamp(
        stageScroller.scrollLeft + deltaX,
        stageScroller.scrollWidth - stageScroller.clientWidth,
      );
      const nextStageY = clamp(
        stageScroller.scrollTop + deltaY,
        stageScroller.scrollHeight - stageScroller.clientHeight,
      );
      stageScroller.scrollLeft = nextStageX;
      stageScroller.scrollTop = nextStageY;
      syncNativeScroll();
    } else {
      currentX = Math.max(0, currentX + deltaX);
      currentY = Math.max(0, currentY + deltaY);
      targetX = currentX;
      targetY = currentY;
      motion.retarget(-currentX, -currentY, 'to');
      scheduleReleaseCheck();
    }
  };
  const handleTouchStart = (event: TouchEvent) => {
    touchActive = true;
    const path = event.composedPath();
    touchOwner = stageScroller && path.includes(stageScroller)
      ? 'stage'
      : backgroundScroller && path.includes(backgroundScroller)
        ? 'background'
        : stageScroller
          ? 'stage'
          : 'background';
    if (releaseTimer) window.clearTimeout(releaseTimer);
    releaseTimer = 0;
  };
  const handleTouchEnd = (event: TouchEvent) => {
    touchActive = event.touches.length > 0;
    if (!touchActive) lastNativeScroll = now();
    scheduleReleaseCheck();
  };
  window.addEventListener('wheel', handleWheel, { capture: true, passive: false });
  window.addEventListener('touchstart', handleTouchStart, { capture: true, passive: true });
  window.addEventListener('touchend', handleTouchEnd, { capture: true, passive: true });
  window.addEventListener('touchcancel', handleTouchEnd, { capture: true, passive: true });
  backgroundScroller?.addEventListener('scroll', handleBackgroundScroll, { passive: true });
  void waitForElement(
    '[data-image-hero-stage] .image-detail-overlay-scroll',
    ROUTE_TIMEOUT,
  ).then((element) => {
    if (disposed || !element) return;
    stageScroller = element;
    nodes.stageScroller = element;
    stageScroller.addEventListener('scroll', handleNativeScroll, { passive: true });
    if (backgroundBridge) {
      currentX = clamp(currentX, stageScroller.scrollWidth - stageScroller.clientWidth);
      currentY = clamp(currentY, stageScroller.scrollHeight - stageScroller.clientHeight);
      targetX = currentX;
      targetY = currentY;
    } else {
      currentX = stageScroller.scrollLeft;
      currentY = stageScroller.scrollTop;
      targetX += currentX;
      targetY += currentY;
    }
    initialized = true;
    sync();
    scheduleSync();
  });

  const stop = () => {
    if (disposed) return;
    disposed = true;
    if (frame) cancelAnimationFrame(frame);
    if (releaseTimer) window.clearTimeout(releaseTimer);
    window.removeEventListener('wheel', handleWheel, true);
    window.removeEventListener('touchstart', handleTouchStart, true);
    window.removeEventListener('touchend', handleTouchEnd, true);
    window.removeEventListener('touchcancel', handleTouchEnd, true);
    backgroundScroller?.removeEventListener('scroll', handleBackgroundScroll);
    stageScroller?.removeEventListener('scroll', handleNativeScroll);
    if (phase !== 'closing') restoreBackgroundScroll();
    resolveReleaseWaiters();
  };
  const flush = (preferRoute = false) => {
    if (disposed || !initialized) return;
    if (preferRoute && (!nodes.routeScroller || !nodes.routeScroller.isConnected)) {
      nodes.routeScroller = getRouteScroller();
    }
    const scroller = preferRoute ? nodes.routeScroller ?? getScroller() : getScroller();
    if (!scroller) return;
    currentX = clamp(targetX, scroller.scrollWidth - scroller.clientWidth);
    currentY = clamp(targetY, scroller.scrollHeight - scroller.clientHeight);
    sync();
  };
  return { sync, flush, waitForRelease, stop };
}

function bindClosingScroll(
  motion: FlightMotion,
  target: HTMLElement,
  landingRect: Rect,
  endpoint: 'from' | 'to',
): ScrollSync {
  stopWheelCapture(false);
  const stageScroller = document.querySelector<HTMLElement>(
    '[data-image-hero-stage] .image-detail-overlay-scroll',
  );
  const overlays = Array.from(
    document.querySelectorAll<HTMLElement>(DETAIL_OVERLAY_SELECTOR),
  );
  const stageOverlay = stageScroller?.closest<HTMLElement>(
    '[data-image-hero-stage]',
  ) ?? null;
  const interactionLayers = Array.from(new Set<HTMLElement>([
    // Keep the Stage scroll surface alive on touch devices. A swipe that
    // starts while the opening transition is being interrupted remains bound
    // to that surface; `handleResidualStageScroll` below transfers its native
    // delta to the background gallery. Disabling the whole Stage makes that
    // continuation impossible and drops the gesture mid-flight.
    ...overlays.filter((overlay) => overlay !== stageOverlay),
    ...overlays.flatMap((overlay) => Array.from(
      overlay.querySelectorAll<HTMLElement>(
        '[data-image-hero-stage-foreground], [data-image-detail-back-button]',
      ),
    ).filter((element) => element !== stageScroller)),
    ...document.querySelectorAll<HTMLElement>('[data-image-detail-floating-back]'),
  ]));
  const pointerEvents = interactionLayers.map((element) => ({
    element,
    value: element.style.pointerEvents,
  }));
  // Closing gestures belong to the gallery scroller. The Hero Stage uses
  // explicit pointer-events:auto children while opening; disable those too or
  // touch scrolling is captured by the fading detail UI on coarse pointers.
  pointerEvents.forEach(({ element }) => { element.style.pointerEvents = 'none'; });

  let stopped = false;
  let frame = 0;
  let syncing = false;
  const nativeScroll = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  const scroller = document.querySelector<HTMLElement>(BACKGROUND_SELECTOR);
  let currentX = scroller?.scrollLeft ?? 0;
  let currentY = scroller?.scrollTop ?? 0;
  let stageX = stageScroller?.scrollLeft ?? 0;
  let stageY = stageScroller?.scrollTop ?? 0;
  const initialX = currentX;
  const initialY = currentY;
  let targetX = currentX;
  let targetY = currentY;
  let lastTime = now();
  const sync = (measureTarget = false) => {
    if (stopped || !target.isConnected) return;
    if (measureTarget) {
      const current = getRect(target);
      motion.retarget(
        current.left - landingRect.left,
        current.top - landingRect.top,
        endpoint,
      );
      return;
    }
    motion.retarget(initialX - currentX, initialY - currentY, endpoint);
  };
  const scheduleTick = () => {
    if (!frame) {
      lastTime = now();
      frame = requestAnimationFrame(tick);
    }
  };
  const handleWheel = (event: WheelEvent) => {
    if (event.ctrlKey || phase !== 'closing' || !scroller || nativeScroll) return;
    const scale = event.deltaMode === 1
      ? 16
      : event.deltaMode === 2
        ? window.innerHeight
        : 1;
    targetX += event.deltaX * scale;
    targetY += event.deltaY * scale;
    event.preventDefault();
    scheduleTick();
  };
  const handleScroll = () => {
    if (!scroller || syncing) return;
    if (Math.abs(scroller.scrollLeft - currentX) < 0.5 &&
        Math.abs(scroller.scrollTop - currentY) < 0.5) {
      return;
    }
    currentX = scroller.scrollLeft;
    currentY = scroller.scrollTop;
    targetX = currentX;
    targetY = currentY;
    // Match native touch scrolling in the same event turn. The transform is
    // compositor-only, while a deferred rAF consistently made the return
    // flight lag behind a mobile swipe.
    sync();
  };
  const handleResidualStageScroll = () => {
    if (!nativeScroll || !stageScroller || !scroller) return;
    const nextStageX = stageScroller.scrollLeft;
    const nextStageY = stageScroller.scrollTop;
    const deltaX = nextStageX - stageX;
    const deltaY = nextStageY - stageY;
    stageX = nextStageX;
    stageY = nextStageY;
    if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return;

    const maxX = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    const maxY = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    currentX = Math.min(Math.max(0, scroller.scrollLeft + deltaX), maxX);
    currentY = Math.min(Math.max(0, scroller.scrollTop + deltaY), maxY);
    targetX = currentX;
    targetY = currentY;
    syncing = true;
    scroller.scrollLeft = currentX;
    scroller.scrollTop = currentY;
    syncing = false;
    sync();
  };
  const tick = (time: number) => {
    frame = 0;
    if (stopped || !scroller || nativeScroll) return;
    targetX = Math.min(Math.max(0, targetX), Math.max(0, scroller.scrollWidth - scroller.clientWidth));
    targetY = Math.min(Math.max(0, targetY), Math.max(0, scroller.scrollHeight - scroller.clientHeight));
    const delta = Math.min(50, Math.max(1, time - lastTime));
    lastTime = time;
    const amount = 1 - Math.exp(-delta / 42);
    currentX += (targetX - currentX) * amount;
    currentY += (targetY - currentY) * amount;
    if (Math.abs(targetX - currentX) < 0.15) currentX = targetX;
    if (Math.abs(targetY - currentY) < 0.15) currentY = targetY;
    syncing = true;
    scroller.scrollLeft = currentX;
    scroller.scrollTop = currentY;
    syncing = false;
    sync();
    if (Math.abs(targetX - currentX) >= 0.15 || Math.abs(targetY - currentY) >= 0.15) {
      frame = requestAnimationFrame(tick);
    }
  };
  window.addEventListener('wheel', handleWheel, { capture: true, passive: false });
  scroller?.addEventListener('scroll', handleScroll, { passive: true });
  stageScroller?.addEventListener('scroll', handleResidualStageScroll, { passive: true });
  sync(true);

  const stop = () => {
    if (stopped) return;
    sync(true);
    stopped = true;
    if (frame) cancelAnimationFrame(frame);
    window.removeEventListener('wheel', handleWheel, true);
    scroller?.removeEventListener('scroll', handleScroll);
    stageScroller?.removeEventListener('scroll', handleResidualStageScroll);
    pointerEvents.forEach(({ element, value }) => {
      if (element.isConnected) element.style.pointerEvents = value;
    });
  };
  const flush = () => {
    if (stopped || !scroller) return;
    if (nativeScroll) {
      currentX = scroller.scrollLeft;
      currentY = scroller.scrollTop;
      targetX = currentX;
      targetY = currentY;
      sync(true);
      return;
    }
    targetX = Math.min(Math.max(0, targetX), Math.max(0, scroller.scrollWidth - scroller.clientWidth));
    targetY = Math.min(Math.max(0, targetY), Math.max(0, scroller.scrollHeight - scroller.clientHeight));
    currentX = targetX;
    currentY = targetY;
    syncing = true;
    scroller.scrollLeft = currentX;
    scroller.scrollTop = currentY;
    syncing = false;
    sync(true);
  };
  return {
    sync,
    flush,
    waitForRelease: () => Promise.resolve(),
    stop,
  };
}

function begin(direction: HeroDirection) {
  phase = direction === 'forward' ? 'opening' : 'closing';
  closingHistoryRestoreRequested = false;
  stopActiveTransitionScroll();
  document.documentElement.dataset.imageHeroTransition = direction;
  if (direction === 'forward') startWheelCapture(direction);
  else stopWheelCapture(false);
  if (direction === 'forward' && snapshot) {
    publishStage({ phase: 'opening', snapshot });
  } else {
    publishStage({ phase: 'idle', snapshot: null });
  }
  transitionFinished = new Promise<void>((resolve) => {
    resolveTransition = resolve;
  });
}

function end() {
  phase = 'idle';
  closingHistoryRestoreRequested = false;
  openingExpectedDetailHref = null;
  openingObservedExpectedRoute = false;
  delete document.documentElement.dataset.imageHeroTransition;
  if (!preserveInterruptedRoute) {
    delete document.documentElement.dataset.imageHeroInterrupted;
  }
  publishStage({ phase: 'idle', snapshot: null });
  resolveTransition?.();
  resolveTransition = null;
  stopActiveTransitionScroll();
  stopWheelCapture(true);
}

function localRect(rect: Rect, host: Host) {
  return {
    top: rect.top - host.top,
    left: rect.left - host.left,
    width: rect.width,
    height: rect.height,
  };
}

function coverTransform(baseWidth: number, baseHeight: number, display: Rect, host: Host) {
  const local = localRect(display, host);
  const scale = Math.max(local.width / baseWidth, local.height / baseHeight);
  return {
    x: local.left + (local.width - baseWidth * scale) / 2,
    y: local.top + (local.height - baseHeight * scale) / 2,
    scale,
  };
}

function rectTransform(base: Rect, display: Rect, host: Host) {
  const local = localRect(display, host);
  return {
    x: local.left,
    y: local.top,
    scaleX: local.width / base.width,
    scaleY: local.height / base.height,
  };
}

function createLayer(host: Host) {
  const layer = document.createElement('div');
  layer.className = 'image-hero-flight-layer';
  layer.setAttribute('aria-hidden', 'true');
  layer.style.position = 'fixed';
  layer.style.zIndex = '45';
  layer.style.display = 'block';
  layer.style.overflow = 'hidden';
  layer.style.pointerEvents = 'none';
  layer.style.contain = 'layout paint style';
  layer.style.boxSizing = 'border-box';
  layer.style.inset = 'auto';
  layer.style.top = `${host.top}px`;
  layer.style.left = `${host.left}px`;
  layer.style.width = `${host.width}px`;
  layer.style.height = `${host.height}px`;
  layer.style.right = 'auto';
  layer.style.bottom = 'auto';
  layer.style.borderRadius = window.getComputedStyle(host.element).borderRadius;
  document.body.appendChild(layer);
  return layer;
}

function createShade(
  flyer: HTMLElement,
  treatment: HTMLElement,
  direction: HeroDirection,
): ShadeLayer | null {
  const owner = treatment.closest<HTMLElement>('a');
  const shades = owner
    ? Array.from(owner.querySelectorAll<HTMLElement>('[data-image-hero-shade]'))
    : [];
  if (shades.length === 0) return null;

  const element = document.createElement('div');
  element.setAttribute('aria-hidden', 'true');
  element.style.position = 'absolute';
  element.style.zIndex = '3';
  element.style.inset = '0';
  element.style.pointerEvents = 'none';
  element.style.willChange = 'opacity';
  element.style.opacity = direction === 'back' ? '0' : '1';

  shades.forEach((shade) => {
    const clone = shade.cloneNode(true) as HTMLElement;
    clone.removeAttribute('data-image-hero-shade');
    clone.setAttribute('aria-hidden', 'true');
    clone.style.pointerEvents = 'none';
    clone.style.inset = '0';
    clone.style.width = '100%';
    clone.style.height = '100%';
    clone.style.borderRadius = '0';
    clone.style.transform = 'none';
    element.appendChild(clone);
  });
  flyer.appendChild(element);
  return { element };
}

function isTransparent(color: string) {
  return color === 'transparent' || /rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(color);
}

function getFlightBackground(element: HTMLElement, host: Host) {
  let current: HTMLElement | null = element;
  while (current) {
    const color = window.getComputedStyle(current).backgroundColor;
    if (!isTransparent(color)) return color;
    if (current === host.element) break;
    current = current.parentElement;
  }
  return window.getComputedStyle(host.element).backgroundColor;
}

function createFlight(
  layer: HTMLElement,
  element: HTMLElement,
  previewFrame: HTMLCanvasElement,
  host: Host,
  treatment: HTMLElement,
  direction: HeroDirection,
): Flight {
  const startRect = getRect(element);
  const computed = window.getComputedStyle(element);
  const radius = Number.parseFloat(computed.borderRadius) || 0;
  const start = localRect(startRect, host);

  const compensator = document.createElement('div');
  compensator.className = 'image-hero-flight-compensator';
  compensator.style.position = 'absolute';
  compensator.style.left = '0';
  compensator.style.top = '0';
  compensator.style.width = '0';
  compensator.style.height = '0';
  compensator.style.pointerEvents = 'none';
  compensator.style.transform = 'translate3d(0, 0, 0)';
  compensator.style.willChange = 'transform';

  const flyer = document.createElement('div');
  flyer.className = 'image-hero-flyer';
  flyer.style.position = 'absolute';
  flyer.style.left = '0';
  flyer.style.top = '0';
  flyer.style.zIndex = '2';
  flyer.style.display = 'block';
  flyer.style.overflow = 'hidden';
  flyer.style.boxSizing = 'border-box';
  flyer.style.width = `${startRect.width}px`;
  flyer.style.height = `${startRect.height}px`;
  flyer.style.backgroundColor = getFlightBackground(element, host);
  flyer.style.boxShadow = 'none';
  flyer.style.borderRadius = `${radius}px`;
  flyer.style.transform = `translate3d(${start.left}px, ${start.top}px, 0)`;
  flyer.style.transformOrigin = 'top left';
  flyer.style.backfaceVisibility = 'hidden';
  flyer.style.willChange = 'transform, border-radius';

  const flyerImage = previewFrame;
  flyerImage.style.position = 'absolute';
  flyerImage.style.left = '0';
  flyerImage.style.top = '0';
  flyerImage.style.width = `${startRect.width}px`;
  flyerImage.style.height = `${startRect.height}px`;
  flyerImage.style.transform = `translate3d(${start.left}px, ${start.top}px, 0)`;
  flyerImage.style.transformOrigin = 'top left';
  flyerImage.style.willChange = 'transform';
  flyerImage.style.display = 'block';
  flyerImage.style.backfaceVisibility = 'hidden';
  flyerImage.style.objectFit = 'fill';
  flyer.appendChild(flyerImage);

  const shade = createShade(flyer, treatment, direction);
  compensator.appendChild(flyer);
  layer.appendChild(compensator);
  return {
    layer,
    compensator,
    flyer,
    image: flyerImage,
    shade,
    startRect,
    radius: computed.borderRadius,
    host,
  };
}

function nestedCoverTransform(base: Rect, display: Rect, host: Host) {
  const outer = rectTransform(base, display, host);
  const cover = coverTransform(base.width, base.height, display, host);
  return {
    x: (cover.x - outer.x) / outer.scaleX,
    y: (cover.y - outer.y) / outer.scaleY,
    scaleX: cover.scale / outer.scaleX,
    scaleY: cover.scale / outer.scaleY,
  };
}

function flyerFrame(base: Rect, display: Rect, host: Host, radius: number) {
  const outer = rectTransform(base, display, host);
  return {
    borderRadius: `${radius / outer.scaleX}px / ${radius / outer.scaleY}px`,
    transform: `translate3d(${outer.x}px, ${outer.y}px, 0) scale(${outer.scaleX}, ${outer.scaleY})`,
  };
}

function animateFlight(
  flight: Flight,
  from: Rect,
  to: Rect,
  toRadius: string,
  direction: HeroDirection,
): FlightMotion {
  const duration = DURATIONS[direction];
  const startRadius = Number.parseFloat(flight.radius) || 0;
  const endRadius = Number.parseFloat(toRadius) || 0;
  const base = direction === 'forward' ? to : from;
  const fromOuter = flyerFrame(base, from, flight.host, startRadius);
  const fromImage = nestedCoverTransform(base, from, flight.host);
  const toImage = nestedCoverTransform(base, to, flight.host);
  const frames = geometryFrames(direction);

  flight.flyer.style.width = `${base.width}px`;
  flight.flyer.style.height = `${base.height}px`;
  flight.flyer.style.borderRadius = fromOuter.borderRadius;
  flight.flyer.style.transform = fromOuter.transform;
  flight.image.style.width = `${base.width}px`;
  flight.image.style.height = `${base.height}px`;
  flight.image.style.objectFit = 'cover';
  flight.image.style.objectPosition = '50% 50%';
  flight.image.style.transform = `translate3d(${fromImage.x}px, ${fromImage.y}px, 0) scale(${fromImage.scaleX}, ${fromImage.scaleY})`;

  const geometry = flight.flyer.animate(
    frames.map(({ offset, progress }) => ({
      offset,
      ...flyerFrame(base, {
        top: interpolate(from.top, to.top, progress),
        left: interpolate(from.left, to.left, progress),
        width: interpolate(from.width, to.width, progress),
        height: interpolate(from.height, to.height, progress),
      }, flight.host, interpolate(startRadius, endRadius, progress)),
    })),
    { duration, easing: 'linear', fill: 'forwards' },
  );
  const imageMotion = flight.image.animate(
    frames.map(({ offset, progress }) => ({
      offset,
      transform: `translate3d(${interpolate(fromImage.x, toImage.x, progress)}px, ${interpolate(fromImage.y, toImage.y, progress)}px, 0) scale(${interpolate(fromImage.scaleX, toImage.scaleX, progress)}, ${interpolate(fromImage.scaleY, toImage.scaleY, progress)})`,
    })),
    { duration, easing: 'linear', fill: 'forwards' },
  );

  const shadeMotion = flight.shade
    ? flight.shade.element.animate(
          frames.map(({ offset, progress }) => ({
            offset,
            opacity: direction === 'forward'
              ? 1 - progress
              : progress,
          })),
          { duration, easing: 'linear', fill: 'forwards' },
        )
    : null;

  const animations = [geometry, imageMotion, ...(shadeMotion ? [shadeMotion] : [])];
  const offsets = {
    from: { x: 0, y: 0 },
    to: { x: 0, y: 0 },
  };
  const transient = { x: 0, y: 0, progress: 0 };
  let compensationFrame = 0;
  let endpoint: 'from' | 'to' = 'to';
  let reversing = false;
  let animationsCancelled = false;
  const currentProgress = () => {
    const time = Math.min(
      1,
      Math.max(0, Number(geometry.currentTime ?? 0) / duration),
    );
    return physicalProgress(time, direction);
  };
  const compensationAt = (progress: number) => {
    const baseX = interpolate(offsets.from.x, offsets.to.x, progress);
    const baseY = interpolate(offsets.from.y, offsets.to.y, progress);
    const denominator = reversing ? transient.progress : 1 - transient.progress;
    const distance = reversing ? progress : 1 - progress;
    const transientAmount = denominator <= 0.0001
      ? 0
      : Math.min(1, Math.max(0, distance / denominator));
    return {
      x: baseX + transient.x * transientAmount,
      y: baseY + transient.y * transientAmount,
    };
  };
  const rebaseTransient = (progress: number, x: number, y: number) => {
    transient.progress = progress;
    transient.x = x - interpolate(offsets.from.x, offsets.to.x, progress);
    transient.y = y - interpolate(offsets.from.y, offsets.to.y, progress);
  };
  const syncCompensation = (progress = currentProgress()) => {
    const { x, y } = compensationAt(progress);
    flight.compensator.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  };
  const keepCompensationSynced = () => {
    compensationFrame = 0;
    syncCompensation();
    if (geometry.playState === 'running' || geometry.pending) {
      compensationFrame = requestAnimationFrame(keepCompensationSynced);
    }
  };
  const startCompensationSync = () => {
    if (!compensationFrame) {
      compensationFrame = requestAnimationFrame(keepCompensationSynced);
    }
  };
  const settleEndpoint = () => {
    const finalRect = endpoint === 'to' ? to : from;
    const finalRadius = endpoint === 'to' ? endRadius : startRadius;
    const finalImage = endpoint === 'to' ? toImage : fromImage;
    const finalOuter = flyerFrame(base, finalRect, flight.host, finalRadius);
    flight.flyer.style.borderRadius = finalOuter.borderRadius;
    flight.flyer.style.transform = finalOuter.transform;
    flight.image.style.transform = `translate3d(${finalImage.x}px, ${finalImage.y}px, 0) scale(${finalImage.scaleX}, ${finalImage.scaleY})`;
    if (shadeMotion && flight.shade) {
      flight.shade.element.style.opacity = endpoint === 'to'
        ? direction === 'forward' ? '0' : '1'
        : direction === 'forward' ? '1' : '0';
    }
    syncCompensation(endpoint === 'to' ? 1 : 0);
  };
  const finished = Promise.allSettled([
    geometry.finished,
    imageMotion.finished,
    shadeMotion?.finished ?? Promise.resolve(),
  ]).then(settleEndpoint);

  return {
    finished,
    reverse() {
      endpoint = 'from';
      const currentTime = Math.min(duration, Math.max(0, Number(geometry.currentTime ?? 0)));
      const progress = physicalProgress(currentTime / duration, direction);
      const currentOffset = compensationAt(progress);
      reversing = true;
      rebaseTransient(progress, currentOffset.x, currentOffset.y);
      if (currentTime <= 0.5) {
        animations.forEach((animation) => {
          animation.pause();
          animation.currentTime = 0;
        });
        settleEndpoint();
        animationsCancelled = true;
        animations.forEach((animation) => animation.cancel());
        return Promise.resolve();
      }

      const reverseDuration = Math.min(currentTime, DURATIONS.back);
      const playbackRate = currentTime / reverseDuration;
      animations.forEach((animation) => {
        animation.pause();
        animation.currentTime = currentTime;
        animation.playbackRate = -playbackRate;
        animation.play();
      });
      startCompensationSync();
      return Promise.allSettled(
        animations.map((animation) => animation.finished),
      ).then(() => { settleEndpoint(); });
    },
    finish() {
      if (!animationsCancelled) {
        animations.forEach((animation) => animation.finish());
      }
      settleEndpoint();
    },
    retarget(x, y, targetEndpoint = 'to') {
      if (
        Math.abs(offsets[targetEndpoint].x - x) < 0.01 &&
        Math.abs(offsets[targetEndpoint].y - y) < 0.01
      ) {
        return;
      }
      offsets[targetEndpoint].x = x;
      offsets[targetEndpoint].y = y;
      rebaseTransient(currentProgress(), x, y);
      syncCompensation();
      startCompensationSync();
    },
    cancel() {
      if (compensationFrame) cancelAnimationFrame(compensationFrame);
      animationsCancelled = true;
      animations.forEach((animation) => animation.cancel());
    },
  };
}

function animateBackground(direction: HeroDirection) {
  const element = document.querySelector<HTMLElement>(BACKGROUND_VISUAL_SELECTOR) ??
    document.querySelector<HTMLElement>(BACKGROUND_SELECTOR);
  if (!element) return null;

  element.style.transformOrigin = 'center center';
  element.style.willChange = 'transform';
  if (direction === 'back') element.style.transform = BACKGROUND_SINK;
  const frames = motionFrames(direction).map(({ offset, progress }) => {
    const amount = direction === 'forward' ? progress : 1 - progress;
    return {
      offset,
      transform: `translate3d(0, ${10 * amount}px, 0) scale(${1 - 0.015 * amount})`,
    };
  });
  const animation = element.animate(frames, {
    duration: DURATIONS[direction],
    easing: 'linear',
    fill: 'forwards',
  });
  return { element, animation };
}

function finishBackground(motion: ReturnType<typeof animateBackground>) {
  if (!motion) return;
  motion.animation.cancel();
  motion.element.style.transform = '';
  motion.element.style.transformOrigin = '';
  motion.element.style.willChange = '';
}

function reverseAnimation(animation: Animation | null | undefined) {
  if (!animation) return Promise.resolve();
  try {
    const timing = animation.effect?.getComputedTiming();
    const duration = Math.max(1, Number(timing?.duration ?? DURATIONS.forward));
    const currentTime = Math.min(duration, Math.max(0, Number(animation.currentTime ?? 0)));
    animation.pause();
    animation.currentTime = currentTime;
    if (currentTime <= 0.5) return Promise.resolve();
    animation.playbackRate = -(currentTime / Math.min(currentTime, DURATIONS.back));
    animation.play();
    return animation.finished.then(() => undefined).catch(() => undefined);
  } catch {
    return Promise.resolve();
  }
}

function settleAnimation(animation: Animation | null | undefined) {
  if (!animation) return;
  try {
    animation.finish();
  } catch {
    // Cleanup may have already canceled the animation.
  }
}

function animateDetailExit(duration: number) {
  const frames = motionFrames('back');
  const animations: Animation[] = [];
  const overlays = Array.from(
    document.querySelectorAll<HTMLElement>(DETAIL_OVERLAY_SELECTOR),
  );
  const pointerEvents = overlays.map((overlay) => ({
    overlay,
    value: overlay.style.pointerEvents,
  }));

  overlays.forEach((overlay) => {
    overlay.style.pointerEvents = 'none';
    const surface = overlay.querySelector<HTMLElement>('[data-image-detail-surface]');
    if (surface) {
      const opacity = Number.parseFloat(getComputedStyle(surface).opacity) || 0;
      animations.push(surface.animate(
        frames.map(({ offset, progress }) => {
          const value = Math.min(1, Math.max(0, progress));
          return { offset, opacity: opacity * (1 - value) };
        }),
        { duration, easing: 'linear', fill: 'forwards' },
      ));
    }

    const floatingOwner = overlay.hasAttribute('data-image-hero-stage') ? 'stage' : 'route';
    const foregrounds = [
      overlay.querySelector<HTMLElement>('.image-detail-overlay-scroll'),
      overlay.querySelector<HTMLElement>('[data-image-detail-back-button]'),
      document.querySelector<HTMLElement>(
        `[data-image-detail-floating-back="${floatingOwner}"]`,
      ),
    ].filter((element): element is HTMLElement => Boolean(element));
    foregrounds.forEach((element) => {
      const computed = getComputedStyle(element);
      const opacity = Number.parseFloat(computed.opacity) || 0;
      const transform = computed.transform === 'none' ? 'translate3d(0, 0, 0)' : computed.transform;
      animations.push(element.animate(
        frames.map(({ offset, progress }) => {
          const value = Math.min(1, Math.max(0, progress));
          return {
            offset,
            opacity: opacity * (1 - value),
            transform: value === 0
              ? transform
              : `translate3d(0, ${10 * value}px, 0) scale(${1 - 0.002 * value})`,
          };
        }),
        { duration, easing: 'linear', fill: 'forwards' },
      ));
    });
  });

  return {
    finished: Promise.allSettled(animations.map((animation) => animation.finished)),
    finish() {
      animations.forEach(settleAnimation);
    },
    restore() {
      animations.forEach((animation) => animation.cancel());
      pointerEvents.forEach(({ overlay, value }) => {
        if (overlay.isConnected) overlay.style.pointerEvents = value;
      });
    },
  };
}

function syncedAnimation(
  element: HTMLElement,
  keyframes: Keyframe[],
  startedAt: number,
  startAt: number,
  duration: number,
) {
  const elapsed = now() - startedAt;
  const animation = element.animate(keyframes, {
    duration,
    delay: Math.max(0, startAt - elapsed),
    easing: 'linear',
    fill: 'both',
  });
  if (elapsed > startAt) {
    animation.currentTime = Math.min(duration, elapsed - startAt);
  }
  return animation;
}

function revealOverlay(overlay: HTMLElement, startedAt: number) {
  const frames = motionFrames('forward');
  const animations: Array<{ element: HTMLElement; animation: Animation }> = [];
  const surface = overlay.querySelector<HTMLElement>('[data-image-detail-surface]');
  if (surface) {
    animations.push({
      element: surface,
      animation: syncedAnimation(
        surface,
        frames.map(({ offset, progress }) => ({
          offset,
          opacity: Math.min(1, progress * 1.12),
        })),
        startedAt,
        16,
        295,
      ),
    });
  }

  const floatingOwner = overlay.hasAttribute('data-image-hero-stage') ? 'stage' : 'route';
  const revealElements = new Set<HTMLElement>([
    ...overlay.querySelectorAll<HTMLElement>('[data-image-detail-reveal]'),
    ...document.querySelectorAll<HTMLElement>(
      `[data-image-detail-floating-back="${floatingOwner}"][data-image-detail-reveal]`,
    ),
  ]);
  revealElements.forEach((element) => {
    const role = element.dataset.imageDetailReveal;
    const startAt = role === 'chrome' ? 30 : role === 'body' ? 60 : 40;
    const distance = role === 'body' ? 12 : 18;
    animations.push({
      element,
      animation: syncedAnimation(
        element,
        frames.map(({ offset, progress }) => ({
          offset,
          opacity: Math.min(1, progress * 1.18),
          transform: `translate3d(0, ${distance * (1 - progress)}px, 0)`,
        })),
        startedAt,
        startAt,
        255,
      ),
    });
  });

  return Promise.allSettled(animations.map(({ animation }) => animation.finished)).then(() => {
    animations.forEach(({ element, animation }) => {
      element.style.opacity = '1';
      element.style.transform = 'none';
      animation.cancel();
    });
  });
}

function revealRouteOverlay(overlay: HTMLElement, startedAt: number) {
  const revealed = revealOverlay(overlay, startedAt);
  requestAnimationFrame(() => {
    if (phase !== 'opening') return;
    const stage = document.querySelector<HTMLElement>('[data-image-hero-stage]');
    const stageScroller = stage?.querySelector<HTMLElement>('.image-detail-overlay-scroll');
    const routeScroller = overlay.querySelector<HTMLElement>('.image-detail-overlay-scroll');
    if (stageScroller && routeScroller) {
      routeScroller.scrollLeft = stageScroller.scrollLeft;
      routeScroller.scrollTop = stageScroller.scrollTop;
      syncStageScroll(routeScroller.scrollLeft, routeScroller.scrollTop);
    }
  });
  return revealed;
}

async function settleRevealAnimations(overlay: HTMLElement) {
  const floatingOwner = overlay.hasAttribute('data-image-hero-stage') ? 'stage' : 'route';
  const elements = new Set<HTMLElement>([
    ...overlay.querySelectorAll<HTMLElement>(
      '[data-image-detail-surface], [data-image-detail-reveal]',
    ),
    ...document.querySelectorAll<HTMLElement>(
      `[data-image-detail-floating-back="${floatingOwner}"][data-image-detail-reveal]`,
    ),
  ]);
  const animations = Array.from(elements).flatMap((element) => element.getAnimations());
  animations.forEach(settleAnimation);
  await Promise.allSettled(animations.map((animation) => animation.finished));
}

function focus(element: HTMLElement | null) {
  if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) return;
  element?.closest<HTMLElement>('a, button, [tabindex]')?.focus({ preventScroll: true });
}

function isFresh(value: ImageHeroSnapshot | null, id: number) {
  return Boolean(value && value.image.id === id && Date.now() - value.createdAt < SNAPSHOT_TTL);
}

export function isImageHeroTransitionRunning() {
  return phase !== 'idle';
}

export function interruptImageHero() {
  if (phase !== 'opening' || !requestOpeningInterrupt) return false;
  requestOpeningInterrupt(false);
  return true;
}

export function subscribeImageHeroStage(listener: () => void) {
  stageListeners.add(listener);
  return () => stageListeners.delete(listener);
}

export function getImageHeroStage() {
  return stageState;
}

export function waitForImageHeroTransition() {
  return transitionFinished;
}

export function warmImageHero(
  imageId?: number,
  priority: DetailRequestPriority = 'immediate',
) {
  componentWarmup ??= import('@/components/PicDetail').catch(() => {
    componentWarmup = null;
  });
  if (imageId === undefined) return componentWarmup;
  return Promise.all([
    componentWarmup,
    prefetchImageDetail(imageId, { priority }).catch(() => undefined),
  ]);
}

export function getImageHeroDetail(imageId: number) {
  return prefetchImageDetail(imageId);
}

export function peekImageHeroDetail(imageId: number) {
  return peekImageDetail(imageId);
}

export function prepareImageHero(
  image: PonyImage,
  source: HTMLElement | null,
  canAnimate: boolean,
  previewSrcOverride?: string,
) {
  if (!source) return null;
  lastLocation = {
    pathname: window.location.pathname,
    search: window.location.search,
  };
  const visual = getVisualMedia(source);
  const previewFrame = captureHeroFrame(visual);
  const mediaType = visual instanceof HTMLVideoElement ? 'video' : 'image';
  const previewSrc = normalizeSrc(
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
  const rect = getRect(source);
  const next: ImageHeroSnapshot = {
    image,
    previewSrc,
    previewFrame: previewFrame ?? document.createElement('canvas'),
    sourceKey: source.dataset.imageHeroSourceKey ?? null,
    mediaType,
    canAnimate: canAnimate && Boolean(previewFrame) && rect.width > 0 && rect.height > 0,
    createdAt: Date.now(),
  };
  return next;
}

export function consumeImageHeroSeed(imageId: number) {
  return isFresh(snapshot, imageId) ? snapshot : null;
}

export function getImageHeroOrigin(imageId: number) {
  return isFresh(snapshot, imageId) ? snapshot : null;
}

export function getImageHeroBackgroundLocation() {
  return lastLocation;
}

export function canUseImageHeroTransition(value: ImageHeroSnapshot) {
  return Boolean(
    value.canAnimate &&
    phase === 'idle' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
    typeof HTMLElement !== 'undefined' &&
    typeof HTMLElement.prototype.animate === 'function' &&
    document.querySelector(HOST_SELECTOR) &&
    document.querySelector(DESTINATION_SELECTOR),
  );
}

async function handoffStage(
  target: HTMLElement | null,
  targetOpacity: string,
  beforeCommit?: () => Promise<void>,
) {
  const stageTarget = document.querySelector<HTMLElement>(STAGE_TARGET_SELECTOR);
  if (stageTarget) {
    stageTarget.style.opacity = '1';
    if (snapshot) publishStage({ phase: 'landed', snapshot });
  }

  const stage = document.querySelector<HTMLElement>('[data-image-hero-stage]');
  const targetOverlay = target?.closest<HTMLElement>(DETAIL_OVERLAY_SELECTOR);
  const routeOverlay = targetOverlay && !targetOverlay.hasAttribute('data-image-hero-stage')
    ? targetOverlay
    : Array.from(document.querySelectorAll<HTMLElement>(DETAIL_OVERLAY_SELECTOR))
        .find((element) => !element.hasAttribute('data-image-hero-stage')) ?? null;

  if (stage && routeOverlay) {
    await settleRevealAnimations(routeOverlay);
    await beforeCommit?.();
    const routeScroller = routeOverlay.querySelector<HTMLElement>('.image-detail-overlay-scroll');
    const routeScrollerWillChange = routeScroller?.style.willChange;
    if (routeScroller) routeScroller.style.willChange = 'opacity, transform';
    const routeElements = new Set<HTMLElement>([
      ...routeOverlay.querySelectorAll<HTMLElement>(
        '[data-image-detail-surface], [data-image-detail-reveal]',
      ),
      ...document.querySelectorAll<HTMLElement>(
        '[data-image-detail-floating-back="route"][data-image-detail-reveal]',
      ),
      ...(target ? [target] : []),
    ]);
    const previousStyles = Array.from(routeElements, (element) => ({
      element,
      opacity: element.style.opacity,
      transform: element.style.transform,
      transition: element.style.transition,
      visibility: element.style.visibility,
    }));

    previousStyles.forEach(({ element }) => {
      element.style.opacity = '1';
      element.style.transform = 'none';
      element.style.transition = 'none';
      element.style.visibility = 'visible';
    });

    const stageSurface = stage.querySelector<HTMLElement>('[data-image-detail-surface]');
    if (stageSurface) stageSurface.style.visibility = 'hidden';
    delete document.documentElement.dataset.imageHeroTransition;

    stage.querySelectorAll<HTMLElement>('[data-image-hero-stage-foreground]')
      .forEach((element) => { element.style.visibility = 'hidden'; });
    document.querySelectorAll<HTMLElement>('[data-image-detail-floating-back="stage"]')
      .forEach((element) => { element.style.visibility = 'hidden'; });

    previousStyles.forEach(({ element, opacity, transform, transition, visibility }) => {
      element.style.opacity = opacity;
      element.style.transform = transform;
      element.style.transition = transition;
      element.style.visibility = visibility;
    });
    if (target) restore(target, targetOpacity);
    // Keep the composited handoff for the frame that swaps Stage for the
    // routed detail, then release it. Leaving `will-change` here keeps an
    // otherwise static scroll surface promoted for the rest of the detail view.
    if (routeScroller) {
      requestAnimationFrame(() => {
        if (routeScroller.isConnected) routeScroller.style.willChange = routeScrollerWillChange ?? '';
      });
    }
    return;
  }

  await beforeCommit?.();
  if (target) restore(target, targetOpacity);
  delete document.documentElement.dataset.imageHeroTransition;
}

async function reverseOpeningFlight(
  motion: FlightMotion,
  background: ReturnType<typeof animateBackground>,
  target: HTMLElement,
  landingRect: Rect,
  navigateBack: (navigationHandled: boolean) => void,
  wasNavigationHandled: () => boolean,
) {
  phase = 'closing';
  document.documentElement.dataset.imageHeroInterrupted = 'true';
  redirectWheelCapture('back');
  // The opening controller owns a window-level wheel listener. Stop it before
  // installing the closing controller, otherwise both controllers consume the
  // same gesture and the old one is no longer reachable through the global
  // cleanup slot.
  stopActiveTransitionScroll();
  const scrollSync = bindClosingScroll(motion, target, landingRect, 'from');
  stopTransitionScroll = scrollSync.stop;
  const detailExit = animateDetailExit(180);
  const backgroundFinished = reverseAnimation(background?.animation);
  const motionFinished = motion.reverse();
  await Promise.allSettled([
    motionFinished,
    backgroundFinished,
    detailExit.finished,
  ]);
  scrollSync.flush();
  motion.finish();
  if (wasNavigationHandled() && isAtOpeningDetailLocation()) {
    detailExit.restore();
    scrollSync.flush(true);
    return true;
  }
  detailExit.finish();
  // A browser/Android back can arrive while the reverse animation is already
  // running. Read the flag at commit time so we do not issue a second back.
  navigateBack(wasNavigationHandled());
  if (!await waitForRouteOverlayGone()) holdInterruptedRouteUntilGone();
  scrollSync.flush();
  return false;
}

async function reverseLandedOpeningFlight(
  motion: FlightMotion,
  background: ReturnType<typeof animateBackground>,
  target: HTMLElement,
  landingRect: Rect,
  navigateBack: (navigationHandled: boolean) => void,
  wasNavigationHandled: () => boolean,
) {
  phase = 'closing';
  document.documentElement.dataset.imageHeroInterrupted = 'true';
  redirectWheelCapture('back');
  const stageTarget = document.querySelector<HTMLElement>(STAGE_TARGET_SELECTOR);
  hide(stageTarget);
  stopActiveTransitionScroll();
  const scrollSync = bindClosingScroll(motion, target, landingRect, 'from');
  stopTransitionScroll = scrollSync.stop;
  const detailExit = animateDetailExit(DURATIONS.back);
  const backgroundMotion = animateBackground('back');
  const motionFinished = motion.reverse();
  await Promise.allSettled([
    motionFinished,
    backgroundMotion?.animation.finished ?? Promise.resolve(),
    detailExit.finished,
  ]);
  scrollSync.flush();
  motion.finish();
  if (wasNavigationHandled() && isAtOpeningDetailLocation()) {
    detailExit.restore();
    scrollSync.flush(true);
    finishBackground(backgroundMotion);
    finishBackground(background);
    return true;
  }
  detailExit.finish();
  navigateBack(wasNavigationHandled());
  if (!await waitForRouteOverlayGone()) holdInterruptedRouteUntilGone();
  scrollSync.flush();
  finishBackground(backgroundMotion);
  finishBackground(background);
  return false;
}

export async function navigateToImageWithHero(
  value: ImageHeroSnapshot,
  source: HTMLElement,
  navigate: () => void,
  navigateBack: (navigationHandled: boolean) => void,
  options: ImageHeroNavigationOptions = {},
) {
  let host: Host | null = null;
  let destination: ReturnType<typeof getDestination> = null;
  let layer: HTMLElement | null = null;
  let flight: Flight | null = null;
  try {
    if (!canUseImageHeroTransition(value)) {
      navigate();
      return false;
    }
    host = getHost();
    destination = getDestination(value.image);
    layer = host ? createLayer(host) : null;
    flight = host && layer
      ? createFlight(layer, source, value.previewFrame, host, source, 'forward')
      : null;
  } catch {
    layer?.remove();
    navigate();
    return false;
  }
  if (!host || !destination || !layer || !flight) {
    layer?.remove();
    navigate();
    return false;
  }

  snapshot = value;
  sourceElement = source;
  openingExpectedDetailHref = normalizePathSearch(
    options.detailHref ?? `/pic/${value.image.id}`,
  );
  openingObservedExpectedRoute = false;
  lastLocation = options.backgroundLocation ?? {
    pathname: window.location.pathname,
    search: window.location.search,
  };
  ensureHistoryNavigationListener();

  const sourceOpacity = hide(source);
  let target: HTMLElement | null = null;
  let targetOpacity = '';
  let navigated = false;
  let layerRemoved = false;
  let flightLanded = false;
  let interrupted = false;
  let restoredDetail = false;
  let lateBack = false;
  const startedAt = now();
  const waitController = new AbortController();
  const elementWaiter = createElementWaiter(waitController.signal);

  begin('forward');
  const interruption = createOpeningInterrupt();
  const background = animateBackground('forward');
  const revealPromise = elementWaiter.wait(
    '[data-image-hero-stage]',
    ROUTE_TIMEOUT,
  ).then((overlay) => overlay ? revealOverlay(overlay, startedAt) : undefined);
  void revealPromise.catch(() => undefined);
  const routeRevealPromise = elementWaiter.wait(
    `${DETAIL_OVERLAY_SELECTOR}:not([data-image-hero-stage])`,
    ROUTE_TIMEOUT,
  ).then((overlay) => overlay ? revealRouteOverlay(overlay, startedAt) : undefined);
  void routeRevealPromise.catch(() => undefined);
  const stageTargetPromise = elementWaiter.wait(
    STAGE_READY_TARGET_SELECTOR,
    ROUTE_TIMEOUT,
  );
  const targetPromise = elementWaiter.wait(
    `[data-image-hero-role="detail"][data-image-hero-id="${value.image.id}"][data-image-hero-ready="true"]`,
    ROUTE_TIMEOUT,
  ).then((element) => {
    if (element) targetOpacity = hide(element);
    target = element;
    return element;
  });
  const flightMotion = animateFlight(
    flight,
    flight.startRect,
    destination.rect,
    window.getComputedStyle(destination.element).borderRadius,
    'forward',
  );
  const flightPromise = Promise.all([
    flightMotion.finished,
    background?.animation.finished ?? Promise.resolve(),
  ]).then(() => {
    flightLanded = true;
  });
  const openingScroll = bindOpeningScroll(flightMotion, elementWaiter.wait);
  stopTransitionScroll = openingScroll.stop;

  try {
    navigated = true;
    navigate();
    await Promise.race([flightPromise, interruption.promise]);

    if (interruption.requested && !flightLanded) {
      waitController.abort();
      restoredDetail = await reverseOpeningFlight(
        flightMotion,
        background,
        source,
        flight.startRect,
        navigateBack,
        () => interruption.navigationHandled,
      );
      interrupted = !restoredDetail;
    } else {
      await flightPromise;
      const stageResult = await Promise.race([
        stageTargetPromise.then((element) => ({ kind: 'stage' as const, element })),
        interruption.promise.then(() => ({ kind: 'interrupt' as const })),
      ]);

      if (stageResult.kind === 'interrupt') {
        waitController.abort();
        restoredDetail = await reverseLandedOpeningFlight(
          flightMotion,
          background,
          source,
          flight.startRect,
          navigateBack,
          () => interruption.navigationHandled,
        );
        interrupted = !restoredDetail;
      } else {
        const stageTarget = stageResult.element;
        if (stageTarget) {
          stageTarget.style.opacity = '1';
          publishStage({ phase: 'landed', snapshot: value });
        }
        if (interruption.requested) {
          waitController.abort();
          restoredDetail = await reverseLandedOpeningFlight(
            flightMotion,
            background,
            source,
            flight.startRect,
            navigateBack,
            () => interruption.navigationHandled,
          );
          interrupted = !restoredDetail;
        } else {
          const targetResult = await Promise.race([
            targetPromise.then(() => 'target' as const),
            interruption.promise.then(() => 'interrupt' as const),
          ]);

          if (targetResult === 'interrupt') {
            waitController.abort();
            restoredDetail = await reverseLandedOpeningFlight(
              flightMotion,
              background,
              source,
              flight.startRect,
              navigateBack,
              () => interruption.navigationHandled,
            );
            interrupted = !restoredDetail;
          } else {
            // Do not begin the real-route handoff while a touch scroll is still
            // settling. More importantly, let Esc/back win this wait so the
            // opening can reverse from the stable stage without briefly
            // exposing the real detail route.
            const releaseResult = await Promise.race([
              interruption.promise.then(() => 'interrupt' as const),
              openingScroll.waitForRelease().then(() => 'released' as const),
            ]);

            if (releaseResult === 'interrupt' || interruption.requested) {
              waitController.abort();
              restoredDetail = await reverseLandedOpeningFlight(
                flightMotion,
                background,
                source,
                flight.startRect,
                navigateBack,
                () => interruption.navigationHandled,
              );
              interrupted = !restoredDetail;
            } else {
              await handoffStage(target, targetOpacity, async () => {
                openingScroll.flush();
              });
              openingScroll.flush(true);
              restore(source, sourceOpacity);
              layer.remove();
              layerRemoved = true;
              lateBack = interruption.requested;
            }
          }
        }
      }
    }
  } catch {
    if (!navigated) navigate();
  } finally {
    waitController.abort();
    elementWaiter.dispose();
    interruption.dispose();
    finishBackground(background);
    restore(source, sourceOpacity);
    restore(target, targetOpacity);
    if (!layerRemoved) layer.remove();
    if (interrupted) {
      snapshot = null;
      sourceElement = null;
      lastLocation = null;
    }
    end();
  }

  if (interrupted) {
    focus(source);
    interruption.replayNavigation?.();
    return false;
  } else if (lateBack) {
    await navigateBackWithImageHero(
      value.image.id,
      () => navigateBack(interruption.navigationHandled),
    );
    return false;
  } else {
    focus(document.querySelector<HTMLElement>('[data-image-detail-back-button]'));
    if (options.historyMode !== 'restore' && options.historyMode !== 'none') {
      installImageHeroHistoryGuard(value);
    }
    return true;
  }
}

export async function navigateBackWithImageHero(
  imageId: number,
  navigate: () => void,
) {
  const source = document.querySelector<HTMLElement>(
    `[data-image-hero-role="detail"][data-image-hero-id="${imageId}"]`,
  );
  const value = getImageHeroOrigin(imageId);
  const target = sourceElement?.isConnected
    ? sourceElement
    : findImageHeroThumbnail(imageId, value?.sourceKey);
  const host = getHost();

  if (!source || !target || !host || !value || phase !== 'idle' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      typeof HTMLElement.prototype.animate !== 'function') {
    snapshot = null;
    sourceElement = null;
    lastLocation = null;
    commitImageHeroBack(navigate);
    window.setTimeout(() => focus(target), 0);
    return;
  }

  const layer = createLayer(host);
  const currentMedia = getVisualMedia(source);
  const closingFrame = currentMedia && isVolatileVisualMedia(currentMedia)
    ? captureHeroFrame(currentMedia) ?? value.previewFrame
    : value.previewFrame;
  const flight = createFlight(layer, source, closingFrame, host, target, 'back');
  const resumeHeavyMedia = suspendHeavyDetailMedia(source);
  const sourceOpacity = hide(source);
  const targetOpacity = hide(target);
  const landingRect = getRect(target);
  let navigated = false;
  let targetRestored = false;
  let layerRemoved = false;
  let restoredDetail = false;
  let mediaResumed = false;

  begin('back');
  let resolveHistoryRestore!: () => void;
  const historyRestoreRequested = new Promise<void>((resolve) => {
    resolveHistoryRestore = resolve;
    notifyClosingHistoryRestore = resolve;
  });
  let popStateCount = 0;
  const handlePopState = () => { popStateCount += 1; };
  // Re-read the final history position after the flight. A rapid Back then Forward
  // can otherwise leave the still-mounted detail route with its exit fill and
  // pointer lock applied, while a second Back still needs to finish the close.
  window.addEventListener('popstate', handlePopState, { capture: true });
  let background: ReturnType<typeof animateBackground> = null;
  let motion: FlightMotion | null = null;
  let scrollSync: ScrollSync | null = null;
  let detailExit: ReturnType<typeof animateDetailExit> | null = null;
  const restoreClosingDetail = () => {
    detailExit?.restore();
    if (!mediaResumed) {
      void resumeHeavyMedia();
      mediaResumed = true;
    }
    restore(source, sourceOpacity);
    restoredDetail = true;
  };
  const restoreClosingHistoryBounce = () => {
    if (!closingHistoryRestoreRequested) return false;
    restoreClosingDetail();
    if (imageHeroHistoryRecord) restoreImageHeroHistoryGuard(imageHeroHistoryRecord);
    return true;
  };

  try {
    motion = animateFlight(
      flight,
      flight.startRect,
      landingRect,
      window.getComputedStyle(target).borderRadius,
      'back',
    );
    scrollSync = bindClosingScroll(motion, target, landingRect, 'to');
    stopTransitionScroll = scrollSync.stop;
    background = animateBackground('back');
    detailExit = animateDetailExit(DURATIONS.back);
    const flightPromise = Promise.all([
      motion.finished,
      background?.animation.finished ?? Promise.resolve(),
      detailExit.finished,
    ]);
    await flightPromise;
    scrollSync.flush();
    motion.finish();
    finishBackground(background);
    background = null;
    let historyOutcome = resolveClosingHistoryOutcome(imageId, popStateCount);
    if (historyOutcome === 'restore-detail') {
      restoreClosingDetail();
    } else {
      detailExit.finish();
    }
    if (historyOutcome === 'commit') {
      navigated = true;
      commitImageHeroBack(navigate);
    }
    if (historyOutcome !== 'restore-detail') {
      const routeWaitController = new AbortController();
      const waitOutcome = await Promise.race([
        waitForRouteOverlayGone(1200, routeWaitController.signal).then(() => 'route' as const),
        historyRestoreRequested.then(() => 'restore-detail' as const),
      ]);
      routeWaitController.abort();
      if (waitOutcome === 'restore-detail' || restoreClosingHistoryBounce()) {
        historyOutcome = 'restore-detail';
      }
    }
    restore(target, targetOpacity);
    targetRestored = true;
    layer.remove();
    layerRemoved = true;
  } catch {
    const historyOutcome = resolveClosingHistoryOutcome(imageId, popStateCount);
    if (historyOutcome === 'restore-detail') {
      restoreClosingDetail();
    } else if (!navigated && historyOutcome === 'commit') {
      commitImageHeroBack(navigate);
    }
  } finally {
    if (notifyClosingHistoryRestore === resolveHistoryRestore) {
      notifyClosingHistoryRestore = null;
    }
    window.removeEventListener('popstate', handlePopState, true);
    scrollSync?.flush();
    finishBackground(background);
    if (!mediaResumed && source.isConnected && /^\/pic\/[^/]+\/?$/.test(window.location.pathname)) {
      void resumeHeavyMedia();
      restoredDetail = true;
    }
    restore(source, sourceOpacity);
    if (!targetRestored) restore(target, targetOpacity);
    if (!restoredDetail) {
      snapshot = null;
      sourceElement = null;
      lastLocation = null;
    }
    if (!layerRemoved) layer.remove();
    end();
  }
  focus(restoredDetail
    ? document.querySelector<HTMLElement>('[data-image-detail-back-button]')
    : target);
}
