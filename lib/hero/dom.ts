'use client';

import type { HeroHost, HeroRect } from './geometry';

export const HERO_ROUTE_TIMEOUT_MS = 4000;
const INTERRUPT_HOLD_TIMEOUT_MS = 4000;
const RESUME_DECODE_TIMEOUT_MS = 250;

export const HERO_HOST_SELECTOR = '[data-image-detail-host]';
export const HERO_BACKGROUND_SELECTOR = '[data-image-detail-background]';
export const HERO_BACKGROUND_VISUAL_SELECTOR = '[data-image-detail-background-visual]';
export const HERO_DETAIL_OVERLAY_SELECTOR = '[data-image-detail-overlay]';
export const HERO_STAGE_TARGET_SELECTOR = '[data-image-hero-stage-target]';

export type VisualMedia = HTMLImageElement | HTMLVideoElement;

export type TransitionScrollNodes = {
  stageScroller: HTMLElement | null;
  routeScroller: HTMLElement | null;
};

type PendingElementWait = {
  selector: string;
  resolve: (element: HTMLElement | null) => void;
  timer: number | null;
};

export function normalizePathSearch(href: string) {
  try {
    const url = new URL(href, window.location.href);
    return `${url.pathname}${url.search}`;
  } catch {
    return href;
  }
}

export function normalizeHeroSrc(src: string) {
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

export function getHeroRect(element: HTMLElement): HeroRect {
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top,
    left: rect.left,
    width: Math.max(1, rect.width),
    height: Math.max(1, rect.height),
  };
}

export function getHeroHost(): HeroHost | null {
  const element = document.querySelector<HTMLElement>(HERO_HOST_SELECTOR);
  return element ? { element, ...getHeroRect(element) } : null;
}

export function findImageHeroThumbnail(imageId: number, sourceKey?: string | null) {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(
    `[data-image-hero-role="thumbnail"][data-image-hero-id="${imageId}"]`,
  ));
  if (!sourceKey) return candidates[0] ?? null;
  return candidates.find((element) => element.dataset.imageHeroSourceKey === sourceKey) ?? null;
}

export function getVisualMedia(element: HTMLElement | null) {
  return element?.querySelector<VisualMedia>('img, video') ?? null;
}

export function getVisualMediaSrc(media: VisualMedia) {
  return normalizeHeroSrc(media.currentSrc || media.getAttribute('src') || '');
}

export function isAnimatedVisualSource(src: string) {
  return /(?:\.gif|\.apng)(?:[?#]|$)|[?&](?:format|ext)=(?:gif|apng)(?:&|$)/i.test(src);
}

export function isVolatileVisualMedia(media: VisualMedia) {
  return media instanceof HTMLVideoElement || isAnimatedVisualSource(getVisualMediaSrc(media));
}

export function getMediaSize(media: VisualMedia) {
  const isVideo = media instanceof HTMLVideoElement;
  const width = isVideo ? media.videoWidth : media.naturalWidth;
  const height = isVideo ? media.videoHeight : media.naturalHeight;
  if (isVideo && media.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
  if (!isVideo && !media.complete) return null;
  return width > 0 && height > 0 ? { width, height } : null;
}

export function hideHeroElement(element: HTMLElement | null) {
  if (!element) return '';
  const previous = element.style.opacity;
  element.style.opacity = '0';
  return previous;
}

export function restoreHeroElement(element: HTMLElement | null, previous: string) {
  if (element) element.style.opacity = previous;
}

export function focusHeroElement(element: HTMLElement | null) {
  if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) return;
  element?.closest<HTMLElement>('a, button, [tabindex]')?.focus({ preventScroll: true });
}

const SUSPENDED_IMAGE_SRC =
  'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

function isAnimatedDetailImage(element: HTMLImageElement) {
  return isAnimatedVisualSource(element.currentSrc || element.getAttribute('src') || '');
}

export function suspendHeavyDetailMedia(source: HTMLElement) {
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
        new Promise<void>((resolve) => window.setTimeout(resolve, RESUME_DECODE_TIMEOUT_MS)),
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

export function createElementWaiter(signal?: AbortSignal) {
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
      attributeFilter: ['data-image-hero-ready'],
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
    wait(selector: string, timeout = HERO_ROUTE_TIMEOUT_MS) {
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

export function createInterruptedRouteHold(onRelease: () => void) {
  const selector = `${HERO_DETAIL_OVERLAY_SELECTOR}:not([data-image-hero-stage])`;
  const held = new Set<HTMLElement>();
  document.querySelectorAll<HTMLElement>(
    `${selector}, [data-image-detail-floating-back="route"]`,
  ).forEach((element) => {
    element.dataset.imageHeroHidden = 'true';
    held.add(element);
  });
  delete document.documentElement.dataset.imageHeroInterrupted;

  let frame = 0;
  let timer = 0;
  let released = false;
  const finish = () => {
    if (released) return;
    released = true;
    if (frame) cancelAnimationFrame(frame);
    if (timer) window.clearTimeout(timer);
    observer.disconnect();
    window.removeEventListener('popstate', check);
    held.forEach((element) => { delete element.dataset.imageHeroHidden; });
    delete document.documentElement.dataset.imageHeroInterrupted;
    onRelease();
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
  window.addEventListener('popstate', check);
  observer.observe(document.body, { childList: true, subtree: true });
  timer = window.setTimeout(finish, INTERRUPT_HOLD_TIMEOUT_MS);
  check();
  return finish;
}

export function waitForRouteOverlayGone(timeout = 1200, signal?: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    const selector = `${HERO_DETAIL_OVERLAY_SELECTOR}:not([data-image-hero-stage])`;
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

export function getRouteScroller() {
  return Array.from(
    document.querySelectorAll<HTMLElement>(HERO_DETAIL_OVERLAY_SELECTOR),
  ).find((element) => !element.hasAttribute('data-image-hero-stage'))
    ?.querySelector<HTMLElement>('.image-detail-overlay-scroll') ?? null;
}

export function createTransitionScrollNodes(): TransitionScrollNodes {
  return {
    stageScroller: document.querySelector<HTMLElement>(
      '[data-image-hero-stage] .image-detail-overlay-scroll',
    ),
    routeScroller: getRouteScroller(),
  };
}

export function syncStageScroll(
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
