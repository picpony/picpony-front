'use client';

import {
  HERO_HOST_SELECTOR,
} from './constants';
import type { HeroHost, HeroRect } from './geometry';

export type VisualMedia = HTMLImageElement | HTMLVideoElement;

export type DomLease = {
  release: () => void;
};

type LeasedStyleProperty =
  | 'opacity'
  | 'visibility'
  | 'pointerEvents'
  | 'transform'
  | 'transformOrigin'
  | 'willChange'
  | 'minHeight'
  | 'touchAction';

type InlineStyleLeaseEntry = {
  id: symbol;
  value: string;
};

type InlineStyleLeaseState = {
  baseline: string;
  entries: InlineStyleLeaseEntry[];
};

const inlineStyleLeases = new WeakMap<
  HTMLElement,
  Map<LeasedStyleProperty, InlineStyleLeaseState>
>();

function escapeSelector(value: string) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, '\\$&');
}

export function normalizeHeroSrc(src: string) {
  if (!src) return '';
  try {
    return new URL(src, window.location.href).href;
  } catch {
    return src;
  }
}

export function getHeroRect(element: HTMLElement): HeroRect {
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

export function getHeroRectWithoutAncestorTransform(
  element: HTMLElement,
  ancestor: HTMLElement | null,
): HeroRect {
  const rect = getHeroRect(element);
  if (!ancestor || !ancestor.contains(element)) return rect;
  const style = getComputedStyle(ancestor);
  if (!style.transform || style.transform === 'none') return rect;

  try {
    const matrix = new DOMMatrixReadOnly(style.transform);
    // Hero background motion is axis-aligned. Refuse a rotated/skewed matrix
    // rather than inventing a bounding box whose corners do not match media.
    if (Math.abs(matrix.b) > 0.0001 || Math.abs(matrix.c) > 0.0001) return rect;
    const [originX = 0, originY = 0] = style.transformOrigin
      .split(/\s+/)
      .slice(0, 2)
      .map((value) => Number.parseFloat(value) || 0);
    const transformedAncestor = ancestor.getBoundingClientRect();
    const shiftX = originX + matrix.e - matrix.a * originX - matrix.c * originY;
    const shiftY = originY + matrix.f - matrix.b * originX - matrix.d * originY;
    const worldOriginX = transformedAncestor.left - shiftX + originX;
    const worldOriginY = transformedAncestor.top - shiftY + originY;
    const inverse = matrix.inverse();
    const map = (x: number, y: number) => {
      const point = new DOMPoint(x - worldOriginX, y - worldOriginY).matrixTransform(inverse);
      return { x: point.x + worldOriginX, y: point.y + worldOriginY };
    };
    const topLeft = map(rect.left, rect.top);
    const bottomRight = map(rect.left + rect.width, rect.top + rect.height);
    return {
      top: topLeft.y,
      left: topLeft.x,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
    };
  } catch {
    return rect;
  }
}

export function getHeroHost(): HeroHost | null {
  const element = document.querySelector<HTMLElement>(HERO_HOST_SELECTOR);
  if (!element) return null;
  return { element, ...getHeroRect(element) };
}

export function findImageHeroThumbnail(imageId: number, sourceKey?: string | null) {
  const id = String(imageId);
  if (sourceKey) {
    const exact = document.querySelector<HTMLElement>(
      `[data-image-hero-role="thumbnail"][data-image-hero-id="${escapeSelector(id)}"]` +
      `[data-image-hero-source-key="${escapeSelector(sourceKey)}"]`,
    );
    if (exact) return exact;
  }
  return document.querySelector<HTMLElement>(
    `[data-image-hero-role="thumbnail"][data-image-hero-id="${escapeSelector(id)}"]`,
  );
}

export function getVisualMedia(element: HTMLElement | null): VisualMedia | null {
  if (!element) return null;
  const directMedia = element instanceof HTMLImageElement || element instanceof HTMLVideoElement
    ? element
    : null;
  const detailHost = directMedia?.hasAttribute('data-image-detail-layer')
    ? (directMedia.matches('[data-image-detail-hero-active]')
        ? directMedia
        : directMedia.closest<HTMLElement>('[data-image-detail-hero-active]'))
    : element.matches('[data-image-detail-hero-active]')
      ? element
      : element.querySelector<HTMLElement>('[data-image-detail-hero-active]');

  if (detailHost) {
    const layers = [
      ...(detailHost.matches('img[data-image-detail-layer], video[data-image-detail-layer]')
        ? [detailHost as VisualMedia]
        : []),
      ...detailHost.querySelectorAll<VisualMedia>(
        'img[data-image-detail-layer], video[data-image-detail-layer]',
      ),
    ].filter((media) => (
      media.closest<HTMLElement>('[data-image-detail-hero-active]') === detailHost
    ));
    const final = layers.find((media) => media.dataset.imageDetailLayer === 'final') ?? null;
    const preview = layers.find((media) => media.dataset.imageDetailLayer === 'preview') ?? null;
    // Capture the actual presentation. Data attributes remain CSS/debug mirrors,
    // not an animation correctness gate.
    const candidates = [preview, final]
      .filter((media): media is VisualMedia => Boolean(media && isPaintableVisualMedia(media)))
      .map((media) => ({ media, opacity: getPresentedMediaOpacity(media) }))
      .filter(({ opacity }) => opacity > 0.001)
      .sort((a, b) => b.opacity - a.opacity);
    return candidates[0]?.media ?? null;
  }

  if (directMedia) return isPaintableVisualMedia(directMedia) ? directMedia : null;
  const candidates = element.querySelectorAll<VisualMedia>('img, video');
  for (let index = 0; index < candidates.length; index += 1) {
    const media = candidates.item(index);
    if (media && isPaintableVisualMedia(media)) return media;
  }
  return null;
}

export function getVisualMediaSrc(media: VisualMedia) {
  return normalizeHeroSrc(media.currentSrc || media.getAttribute('src') || '');
}

export function isAnimatedVisualSource(src: string) {
  if (!src) return false;
  let decoded = src;
  try {
    decoded = decodeURIComponent(src);
  } catch {
    // A malformed escape does not prevent the plain URL checks below.
  }
  if (/(?:\.gif|\.apng)(?:[?#]|$)/i.test(decoded)) return true;
  try {
    const base = typeof window === 'undefined' ? 'http://localhost/' : window.location.href;
    const url = new URL(decoded, base);
    const format = url.searchParams.get('format') ?? url.searchParams.get('ext');
    if (format && /^(?:gif|apng)$/i.test(format)) return true;
    const nested = url.searchParams.get('url');
    if (!nested || nested === src) return false;
    let decodedNested = nested;
    try {
      decodedNested = decodeURIComponent(nested);
    } catch {
      // The URLSearchParams value may already be decoded.
    }
    return /(?:\.gif|\.apng)(?:[?#]|$)/i.test(decodedNested);
  } catch {
    return /[?&](?:format|ext)=(?:gif|apng)(?:&|$)/i.test(decoded);
  }
}

export function isVolatileVisualMedia(media: VisualMedia) {
  return media instanceof HTMLVideoElement || isAnimatedVisualSource(getVisualMediaSrc(media));
}

export function getMediaSize(media: VisualMedia) {
  const isVideo = media instanceof HTMLVideoElement;
  if (isVideo && media.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
  if (!isVideo && !media.complete) return null;
  const width = isVideo ? media.videoWidth : media.naturalWidth;
  const height = isVideo ? media.videoHeight : media.naturalHeight;
  return width > 0 && height > 0 ? { width, height } : null;
}

function isPaintableVisualMedia(media: VisualMedia) {
  if (!getVisualMediaSrc(media) || !getMediaSize(media)) return false;
  if (media instanceof HTMLImageElement) return true;
  return media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
}

function getPresentedMediaOpacity(media: VisualMedia) {
  const style = getComputedStyle(media);
  if (style.display === 'none' || style.visibility === 'hidden') return 0;
  const opacity = Number.parseFloat(style.opacity);
  return Number.isFinite(opacity) ? opacity : 1;
}

export function leaseInlineStyles(
  element: HTMLElement,
  values: Partial<Record<LeasedStyleProperty, string>>,
): DomLease {
  const entries = Object.entries(values) as Array<[LeasedStyleProperty, string]>;
  const leaseId = Symbol('hero-inline-style');
  let elementLeases = inlineStyleLeases.get(element);
  if (!elementLeases) {
    elementLeases = new Map();
    inlineStyleLeases.set(element, elementLeases);
  }

  entries.forEach(([property, value]) => {
    let state = elementLeases.get(property);
    if (!state) {
      state = { baseline: element.style[property], entries: [] };
      elementLeases.set(property, state);
    }
    state.entries.push({ id: leaseId, value });
    try {
      element.style[property] = value;
    } catch {
      // Ignore browser-specific readonly style members.
    }
  });
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const [property, written] = entries[index];
        const state = elementLeases.get(property);
        if (!state) continue;
        const leaseIndex = state.entries.findIndex((entry) => entry.id === leaseId);
        if (leaseIndex < 0) continue;
        const wasTop = leaseIndex === state.entries.length - 1;
        state.entries.splice(leaseIndex, 1);
        if (!wasTop) continue;

        const next = state.entries.at(-1);
        const restore = next?.value ?? state.baseline;
        if (!next && element.style[property] !== written) {
          elementLeases.delete(property);
          continue;
        }
        try {
          element.style[property] = restore;
        } catch {
          // Element may have disconnected during route reconciliation.
        }
        if (!next) elementLeases.delete(property);
      }
      if (elementLeases.size === 0) inlineStyleLeases.delete(element);
    },
  };
}

export function leaseAttribute(
  element: HTMLElement,
  name: string,
  value: string | null,
): DomLease {
  const hadAttribute = element.hasAttribute(name);
  const previous = element.getAttribute(name);
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      const current = element.getAttribute(name);
      if (value === null ? current !== null : current !== value) return;
      if (hadAttribute && previous !== null) element.setAttribute(name, previous);
      else element.removeAttribute(name);
    },
  };
}

export function leaseHeroVisibility(element: HTMLElement | null, visible: boolean): DomLease {
  if (!element) return { release() {} };
  return leaseInlineStyles(element, {
    opacity: visible ? '1' : '0',
    pointerEvents: visible ? '' : 'none',
  });
}

export function leaseHeroCardChrome(element: HTMLElement | null): DomLease {
  const card = element?.closest<HTMLElement>('.image-hero-card-link');
  if (!card) return { release() {} };
  const leases = [...card.querySelectorAll<HTMLElement>('[data-image-hero-chrome]')]
    .map((chrome) => leaseInlineStyles(chrome, {
      opacity: '0',
      willChange: 'opacity',
    }));
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      for (let index = leases.length - 1; index >= 0; index -= 1) {
        leases[index].release();
      }
    },
  };
}

export function leaseHeroRouteSealed(nodes: {
  overlay: HTMLElement;
  floatingBack: HTMLElement | null;
}): DomLease {
  const overlayStyle = leaseInlineStyles(nodes.overlay, {
    opacity: '0',
    visibility: 'hidden',
    pointerEvents: 'none',
  });
  const inert = leaseAttribute(nodes.overlay, 'inert', '');
  const state = leaseAttribute(nodes.overlay, 'data-image-hero-route-state', 'sealed');
  const backStyle = nodes.floatingBack
    ? leaseInlineStyles(nodes.floatingBack, {
        opacity: '0',
        visibility: 'hidden',
        pointerEvents: 'none',
      })
    : { release() {} };
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      state.release();
      inert.release();
      overlayStyle.release();
      backStyle.release();
    },
  };
}

export function focusHeroElement(element: HTMLElement | null) {
  if (!element?.isConnected) return;
  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }
}

export function clearHeroThumbnailFocus(preferred?: HTMLElement | null) {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return;
  const owner = active.closest<HTMLElement>('a:has([data-image-hero-role="thumbnail"])');
  if (!owner) return;
  if (preferred?.contains(active)) return;
  active.blur();
}

export function isDetailPathname(pathname = window.location.pathname) {
  return /^\/pic\/[^/]+\/?$/.test(pathname);
}
