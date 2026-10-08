'use client';

import { HERO_BACKGROUND_SELECTOR, HERO_GALLERY_ANCHOR_SELECTOR } from './constants';
import type { HeroHost, HeroRect } from './geometry';
import { clamp } from '@/lib/utils';

/**
 * A scroll plane pins the flyer into a scroller's own coordinate system.
 *
 * The flight layer is positioned at the scroll offset captured when the flight
 * begins, so ordinary and inertial scrolling carry the flyer along with its
 * source for free — no per-frame scrollTop correction, and therefore no
 * scroll-linked layout work at all.
 */
export type HeroScrollPlane = {
  anchor: HTMLElement;
  scroller: HTMLElement;
  host: HeroHost;
  originLeft: number;
  originTop: number;
  scrollLeft: number;
  scrollTop: number;
  viewportWidth: number;
  viewportHeight: number;
  maxScrollLeft: number;
  maxScrollTop: number;
};

/**
 * @param host An element whose border box is the scroller's untransformed border box,
 *   defaulting to the scroller itself (the origin is then moved to the padding edge, below).
 *   It exists because the scroller may sit **inside the container transform's window**, and a
 *   mid-flight `rebuild` re-creates the plane — at which point the scroller's rect is the
 *   *scaled* box and every later `screenRectToPlane` is wrong by the whole transform. The
 *   Stage passes its overlay, the one node in that chain never carrying a transform; its box
 *   *is* the scroller's untransformed box — exact, one rect read, no matrix.
 *
 *   Only `top`/`left` are read from it. The client/scroll sizes and offsets are layout
 *   values, unaffected by any ancestor transform.
 *
 * The plane's origin is the scroller's **padding** edge, not its border edge: the anchor is
 * absolutely positioned, and `inset: 0` resolves against the padding box. The two differ by a
 * border and by a leading scrollbar gutter — the page scroller's `scrollbar-gutter: stable
 * both-edges` puts one on the left, 10px with a classic scrollbar — which is exactly what
 * `clientLeft` / `clientTop` measure. Taken from the border edge, every flight planted in the
 * gallery plane (every return) landed one gutter right of its thumbnail and snapped back at
 * the handoff. Layout values, so the offset holds for the Stage's overlay host too. The host
 * box is the padding box — the region the anchor's content is painted and clipped in.
 */
function createPlane(
  anchor: HTMLElement,
  scroller: HTMLElement,
  host: HTMLElement = scroller,
): HeroScrollPlane {
  const rect = host.getBoundingClientRect();
  const scrollLeft = scroller.scrollLeft;
  const scrollTop = scroller.scrollTop;
  const viewportWidth = scroller.clientWidth;
  const viewportHeight = scroller.clientHeight;
  return {
    anchor,
    scroller,
    host: {
      element: scroller,
      top: rect.top + scroller.clientTop,
      left: rect.left + scroller.clientLeft,
      width: viewportWidth,
      height: viewportHeight,
    },
    originLeft: scrollLeft,
    originTop: scrollTop,
    scrollLeft,
    scrollTop,
    viewportWidth,
    viewportHeight,
    maxScrollLeft: Math.max(0, scroller.scrollWidth - viewportWidth),
    maxScrollTop: Math.max(0, scroller.scrollHeight - viewportHeight),
  };
}

export function getGalleryScrollPlane(): HeroScrollPlane | null {
  const anchor = document.querySelector<HTMLElement>(HERO_GALLERY_ANCHOR_SELECTOR);
  const scroller = document.querySelector<HTMLElement>(HERO_BACKGROUND_SELECTOR);
  return anchor && scroller ? createPlane(anchor, scroller) : null;
}

export function getElementScrollPlane(
  anchor: HTMLElement,
  scroller: HTMLElement,
  host?: HTMLElement,
) {
  return createPlane(anchor, scroller, host);
}

/**
 * Screen box → plane box.
 *
 * Uses the scroller's live offset rather than the captured one: the flyer moves
 * with its scroller, so once the user has scrolled during a flight the two
 * differ and only the live value describes where the flyer actually is. At
 * capture time they are equal, so this reduces to the plain host offset.
 */
export function screenRectToPlane(rect: HeroRect, plane: HeroScrollPlane): HeroRect {
  return {
    top: rect.top - plane.host.top + plane.scroller.scrollTop - plane.originTop,
    left: rect.left - plane.host.left + plane.scroller.scrollLeft - plane.originLeft,
    width: rect.width,
    height: rect.height,
  };
}

/** Exact inverse of `screenRectToPlane`. */
export function planeRectToScreen(rect: HeroRect, plane: HeroScrollPlane): HeroRect {
  return {
    top: rect.top + plane.host.top - plane.scroller.scrollTop + plane.originTop,
    left: rect.left + plane.host.left - plane.scroller.scrollLeft + plane.originLeft,
    width: rect.width,
    height: rect.height,
  };
}

export function sizePlaneLayer(layer: HTMLElement, plane: HeroScrollPlane) {
  plane.originTop = clamp(plane.originTop, 0, plane.maxScrollTop);
  plane.originLeft = clamp(plane.originLeft, 0, plane.maxScrollLeft);
  layer.style.top = `${plane.originTop}px`;
  layer.style.left = `${plane.originLeft}px`;
  layer.style.width = `${plane.viewportWidth}px`;
  layer.style.height = `${plane.viewportHeight}px`;
}
