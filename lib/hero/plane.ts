'use client';

import { HERO_BACKGROUND_SELECTOR, HERO_GALLERY_ANCHOR_SELECTOR } from './constants';
import type { HeroHost, HeroRect } from './geometry';

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

function createPlane(anchor: HTMLElement, scroller: HTMLElement): HeroScrollPlane {
  const rect = scroller.getBoundingClientRect();
  const scrollLeft = scroller.scrollLeft;
  const scrollTop = scroller.scrollTop;
  const viewportWidth = scroller.clientWidth;
  const viewportHeight = scroller.clientHeight;
  return {
    anchor,
    scroller,
    host: {
      element: scroller,
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
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

export function getElementScrollPlane(anchor: HTMLElement, scroller: HTMLElement) {
  return createPlane(anchor, scroller);
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
  plane.originTop = Math.min(plane.maxScrollTop, Math.max(0, plane.originTop));
  plane.originLeft = Math.min(plane.maxScrollLeft, Math.max(0, plane.originLeft));
  layer.style.top = `${plane.originTop}px`;
  layer.style.left = `${plane.originLeft}px`;
  layer.style.width = `${plane.viewportWidth}px`;
  layer.style.height = `${plane.viewportHeight}px`;
}
