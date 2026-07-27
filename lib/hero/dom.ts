'use client';

import { HERO_BACKGROUND_VISUAL_SELECTOR } from './constants';
import type { HeroRect } from './geometry';

export type VisualMedia = HTMLImageElement | HTMLVideoElement;

export type DomLease = {
  release: () => void;
};

export const NO_OP_LEASE: DomLease = { release() {} };

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

/**
 * Stacked inline-style ownership. Concurrent sessions (a retiring close beneath
 * a fresh open) routinely want the same property on the same node; last writer
 * wins visually and releasing out of order still restores the correct value.
 */
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

/**
 * Measure an element as if a transformed ancestor were at rest.
 *
 * The gallery sinks under an open detail view, so a thumbnail measured during
 * that sink reports a shrunken box. The flyer must land on the box the
 * thumbnail will occupy once the sink unwinds.
 */
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

export function findImageHeroThumbnail(imageId: number, sourceKey?: string | null) {
  const id = escapeSelector(String(imageId));
  if (sourceKey) {
    const exact = document.querySelector<HTMLElement>(
      `[data-image-hero-role="thumbnail"][data-image-hero-id="${id}"]` +
      `[data-image-hero-source-key="${escapeSelector(sourceKey)}"]`,
    );
    if (exact) return exact;
  }
  return document.querySelector<HTMLElement>(
    `[data-image-hero-role="thumbnail"][data-image-hero-id="${id}"]`,
  );
}

let backgroundVisual: HTMLElement | null = null;

/**
 * The gallery layer that sinks behind an open detail view.
 *
 * Memoized because it is read on every frame of a dismiss drag; a document-wide
 * query per frame was the most expensive thing in the gesture. The cache
 * self-heals whenever the node is replaced by a route change.
 */
export function getHeroBackgroundVisual() {
  if (backgroundVisual?.isConnected) return backgroundVisual;
  backgroundVisual = document.querySelector<HTMLElement>(HERO_BACKGROUND_VISUAL_SELECTOR);
  return backgroundVisual;
}

// ---------------------------------------------------------------------------
// Visual media resolution
// ---------------------------------------------------------------------------

export function getVisualMediaSrc(media: VisualMedia) {
  return normalizeHeroSrc(media.currentSrc || media.getAttribute('src') || '');
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

/**
 * Find the media element that is actually on screen inside `element`.
 *
 * A detail target stacks a preview layer over a full-resolution layer and
 * cross-fades them, so the answer depends on presented opacity rather than on
 * which layer exists. Data attributes stay CSS/debug mirrors, never the gate.
 */
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

/** Media whose pixels change over time cannot be captured ahead of activation. */
export function isVolatileVisualMedia(media: VisualMedia) {
  return media instanceof HTMLVideoElement || isAnimatedVisualSource(getVisualMediaSrc(media));
}

// ---------------------------------------------------------------------------
// Leases
// ---------------------------------------------------------------------------

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
  const leases = elementLeases;

  entries.forEach(([property, value]) => {
    let state = leases.get(property);
    if (!state) {
      state = { baseline: element.style[property], entries: [] };
      leases.set(property, state);
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
        const state = leases.get(property);
        if (!state) continue;
        const leaseIndex = state.entries.findIndex((entry) => entry.id === leaseId);
        if (leaseIndex < 0) continue;
        const wasTop = leaseIndex === state.entries.length - 1;
        state.entries.splice(leaseIndex, 1);
        // Only the visible (top) owner may write; inner releases just unstack.
        if (!wasTop) continue;

        const next = state.entries.at(-1);
        // Something outside the lease system took over this property; leave it.
        if (!next && element.style[property] !== written) {
          leases.delete(property);
          continue;
        }
        try {
          element.style[property] = next?.value ?? state.baseline;
        } catch {
          // Element may have disconnected during route reconciliation.
        }
        if (!next) leases.delete(property);
      }
      if (leases.size === 0) inlineStyleLeases.delete(element);
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
      // A newer owner replaced this value; it owns the restore.
      if (value === null ? current !== null : current !== value) return;
      if (hadAttribute && previous !== null) element.setAttribute(name, previous);
      else element.removeAttribute(name);
    },
  };
}

export function combineHeroLeases(...leases: Array<DomLease | null | undefined>): DomLease {
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      for (let index = leases.length - 1; index >= 0; index -= 1) {
        try {
          leases[index]?.release();
        } catch {
          // Best-effort: one disconnected node cannot block the rest.
        }
      }
    },
  };
}

/** Hide the real element whose pixels the flyer is currently presenting. */
export function leaseHeroVisibility(element: HTMLElement | null, visible: boolean): DomLease {
  if (!element) return NO_OP_LEASE;
  return leaseInlineStyles(element, {
    opacity: visible ? '1' : '0',
    pointerEvents: visible ? '' : 'none',
  });
}

/** Fade a gallery card's score/format badges while its thumbnail is in flight. */
export function leaseHeroCardChrome(element: HTMLElement | null): DomLease {
  const card = element?.closest<HTMLElement>('.image-hero-card-link');
  if (!card) return NO_OP_LEASE;
  return combineHeroLeases(
    ...[...card.querySelectorAll<HTMLElement>('[data-image-hero-chrome]')]
      .map((chrome) => leaseInlineStyles(chrome, { opacity: '0', willChange: 'opacity' })),
  );
}

/** Make a detail route invisible and non-interactive without unmounting it. */
export function leaseHeroRouteSealed(nodes: {
  overlay: HTMLElement;
  floatingBack: HTMLElement | null;
}): DomLease {
  const sealed = { opacity: '0', visibility: 'hidden', pointerEvents: 'none' } as const;
  return combineHeroLeases(
    leaseInlineStyles(nodes.overlay, sealed),
    leaseAttribute(nodes.overlay, 'inert', ''),
    leaseAttribute(nodes.overlay, 'data-image-hero-route-state', 'sealed'),
    nodes.floatingBack ? leaseInlineStyles(nodes.floatingBack, sealed) : null,
  );
}
