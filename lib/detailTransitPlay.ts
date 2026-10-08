'use client';

import { MOTION_SPEED_SCALE } from '@/lib/appearance';
import { getAppScroller } from '@/lib/appScroller';
import { captureVisualClone, restoreSnapshotScroll } from '@/lib/pageSnapshot';
import { FORUM_FADE, FORUM_TRANSFORM_MS, visibleBox, type Box, type Radii } from '@/lib/forumContainer';
import { hide, playContainerRun, rectOf, supportsLinearEasing, surfaceOf, type Hidden } from '@/lib/containerTransformPlay';
import type { DetailExitSnapshot } from '@/lib/detailTransit';

/**
 * The picture detail's container transform from a list row, and back (`lib/detailTransit.ts` says
 * when). The forum's construction and engine (`lib/containerTransformPlay.ts`), on a layer beside
 * the overlay rather than above a route cross-fade: the list stays mounted under the overlay, so
 * the row is live on both legs.
 *
 * **Open.** The row grows into the overlay's box; the overlay, copied as it mounts, comes in on top
 * of the row's copy over the first part of the travel (`FORUM_FADE.open`). The live overlay is
 * hidden for the run and the layer then fades off it (`handoffFade`), because the copy is a frame
 * of the overlay as it mounted — the picture or its record can land during the run, and that
 * change cross-fades in rather than popping at the handoff.
 *
 * **Close.** The overlay, copied in the commit that removes it, shrinks into the row; the row's own
 * copy comes in late (`FORUM_FADE.back`), as the forum's does, and the layer goes when the
 * container is the row.
 */

const SQUARE: Radii = [0, 0, 0, 0];

/** The overlay's own surface — its plate is `bg-surface`. */
const surfaceColour = () => getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-surface').trim();

const boxOf = (rect: DOMRect | Box): Box => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });

/** By the wall-clock rule: the container's leg at the slowest speed. */
const BOUND_MS = FORUM_TRANSFORM_MS * MOTION_SPEED_SCALE.slow;

function mountBeside(parent: HTMLElement) {
  return (layer: HTMLElement) => {
    layer.setAttribute('data-detail-transform', '');
    parent.appendChild(layer);
    return true;
  };
}

/** Opening. Null when it cannot run, and the caller takes the plain arrival instead. */
export function playDetailOpen(section: HTMLElement, row: HTMLElement): (() => void) | null {
  const parent = section.parentElement;
  const scroller = getAppScroller();
  if (!parent || !scroller || !supportsLinearEasing()) return null;
  const rowBox = rectOf(row);
  const fromBox = visibleBox(rowBox, rectOf(scroller));
  const toBox = rectOf(section);
  if (!fromBox || toBox.width < 1 || toBox.height < 1) return null;
  const outgoing = captureVisualClone(row, scroller);
  const incoming = captureVisualClone(section, parent);
  if (!outgoing || !incoming) return null;
  const hidden: Hidden[] = [];
  /* Opacity, not visibility: the overlay takes focus as it opens. */
  hide(section, 'opacity', hidden);
  const run = playContainerRun(
    {
      from: surfaceOf(row, fromBox),
      to: { box: toBox, radii: SQUARE, colour: surfaceColour() },
      outgoing: { el: outgoing.node, box: rowBox },
      incoming: incoming.node,
      incomingBox: toBox,
      fade: FORUM_FADE.open,
      hidden,
    },
    {
      mount: mountBeside(parent),
      zIndex: 'var(--z-detail-overlay)',
      /* What a wheel over the opening overlay scrolls; the list under it is inert. */
      scroller: section.querySelector<HTMLElement>('.image-detail-overlay-scroll'),
      boundMs: BOUND_MS,
      handoffFade: true,
    },
  );
  return run.finish;
}

/** Closing, back into the row. False when it cannot run, and the caller fades the overlay out. */
export function playDetailReturn(exit: DetailExitSnapshot, row: HTMLElement): boolean {
  const scroller = getAppScroller();
  if (!scroller || !supportsLinearEasing()) return false;
  const rowBox = rectOf(row);
  /* A row the list's offset leaves off screen has nowhere to be carried to. */
  if (!visibleBox(rowBox, rectOf(scroller))) return false;
  const incoming = captureVisualClone(row, scroller);
  if (!incoming) return false;
  const from = boxOf(exit.box);
  playContainerRun(
    {
      from: { box: from, radii: SQUARE, colour: surfaceColour() },
      to: surfaceOf(row, rowBox),
      outgoing: { el: exit.snapshot.node, box: from },
      incoming: incoming.node,
      incomingBox: rowBox,
      fade: FORUM_FADE.back,
      hidden: [],
    },
    { mount: mountBeside(exit.parent), zIndex: 'var(--z-detail-overlay)', scroller, boundMs: BOUND_MS },
  );
  /* The overlay's own column, where the reader had scrolled it: set once the copy is attached. */
  restoreSnapshotScroll(exit.snapshot);
  return true;
}
