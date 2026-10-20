'use client';

import { MOTION_SPEED_SCALE } from '@/lib/appearance';
import { getAppScroller } from '@/lib/appScroller';
import { captureVisualClone, restoreSnapshotScroll } from '@/lib/pageSnapshot';
import { FORUM_FADE, FORUM_TRANSFORM_MS, visibleBox, type Box, type Radii } from '@/lib/forumContainer';
import { hide, playContainerRun, rectOf, supportsLinearEasing, surfaceOf, type Hidden } from '@/lib/containerTransformPlay';
import { unsealDetailCopy, type DetailExitSnapshot } from '@/lib/detailTransit';

/**
 * The picture detail's container transform from a list row, and back (`lib/detailTransit.ts` says
 * when). The forum's construction, engine and clock (`lib/containerTransformPlay.ts`) — the
 * gallery flight's curve, over the container's 250ms — on a layer beside the overlay rather than
 * above a route cross-fade: the list stays mounted under the overlay, so the row is live on both
 * legs. Timed by the picture's own motion preference (`image`), as the flight is.
 *
 * **Open.** The row grows into the overlay's box; the row's content goes over the first stretch of
 * the way and the overlay, copied as it mounts, comes in over the middle of it (`FORUM_FADE.open`)
 * — the flight's own windows. The live overlay is hidden for the run and the layer then fades off
 * it (`handoffFade`), because the copy is a frame of the overlay as it mounted — the full picture
 * or its record can land during the run, and that change cross-fades in rather than popping at the
 * handoff. The picture is in the copy from the start when the row has warmed it
 * (`app/history/page.tsx`): the still the overlay shows first (`detailStillPreview`), decoded
 * ahead of the open.
 *
 * **Close.** The overlay, copied in the commit that removes it, shrinks into the row: its content
 * leaves from the first frame and the row's own copy comes in late (`FORUM_FADE.back`), as the
 * forum's does, and the layer goes when the container is the row.
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
  /* Taken in the commit that mounts the overlay: a picture still landing is kept, to paint in the
     copy when it lands rather than leave an empty well for the run (`keepLoading`). */
  const incoming = captureVisualClone(section, parent, { keepLoading: true });
  if (!outgoing || !incoming) return null;
  /* The overlay mounts sealed — the hero hides a route until it has reconciled the location — and
     its back affordance is copied hidden with it, so the copy had none and it appeared at the
     handoff. The copy is the overlay as it is about to be shown. */
  unsealDetailCopy(incoming.node);
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
      category: 'image',
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
    { category: 'image', mount: mountBeside(exit.parent), zIndex: 'var(--z-detail-overlay)', scroller, boundMs: BOUND_MS },
  );
  /* The overlay's own column, where the reader had scrolled it: set once the copy is attached. */
  restoreSnapshotScroll(exit.snapshot);
  return true;
}
