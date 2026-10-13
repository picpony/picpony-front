'use client';

import { leanDepth, LEAN_BAND_PX } from '@/lib/tabStrip';

/**
 * Whether the stylesheet conceals this pane — attribute for attribute the rule in globals.css
 * ("React's own active flag decides normally…"). Read from attributes, never from layout:
 * geometry read inside a `content-visibility: hidden` subtree makes the engine lay that
 * subtree out just to answer.
 */
export function isConcealedPane(el: Element): boolean {
  if (!el.hasAttribute('data-tab-pane')) return false;
  if (el.hasAttribute('data-tab-pane-done')) return true;
  return (
    !el.hasAttribute('data-tab-pane-active') &&
    !el.hasAttribute('data-tab-pane-leaving') &&
    !el.hasAttribute('data-tab-pane-entering')
  );
}

/* --- the band a pane can show --------------------------------------------------------------- */

/** Insets from a pane's own top and bottom edges, px: what is clipped for a run. */
export type PaneClip = { top: number; bottom: number };

/**
 * **What of a pane the window can show for a run**, as the clip that cuts the rest away — or null
 * when the band covers the pane. An element whose transform is animated is painted whole, without
 * culling (the animation may carry any of it into view), and a pane is a whole page tall: the
 * frame that started a switch painted every row and card of both panes, and laid out a layer list
 * for all of it — on a phone-class CPU the largest single cost before anything moved. The strip
 * moves the panes sideways only, so nothing outside the window's rows can come into view; `margin`
 * keeps a band either side for a page scrolled during the run, and the run widens the clip as it
 * is (`playSharedAxis`). `shiftY` is where the pane will sit for the run relative to where it is
 * measured (a scroll restore moves the arriving pane). Reads only.
 */
export function paneClip(pane: HTMLElement, viewTop: number, viewBottom: number, shiftY: number, margin: number): PaneClip | null {
  const rect = pane.getBoundingClientRect();
  const top = Math.max(0, Math.floor(viewTop - margin - (rect.top + shiftY)));
  const bottom = Math.max(0, Math.floor(rect.bottom + shiftY - (viewBottom + margin)));
  return top > 0 || bottom > 0 ? { top, bottom } : null;
}

/* --- the lean: which blocks, and how far behind ------------------------------------------- */

/** A block of a leaning pane: how deep it sits in the lean (`leanDepth`, which sets how far behind
 *  its pane it eases), and the transform its own style gives it, which every keyframe carries so
 *  the lean adds to it rather than replacing it. */
export type LeanBlock = { el: HTMLElement; depth: number; base: string };

/**
 * What a leaning run animates (`leanPlan`), and the blocks it restacks for the run (`lift`), with
 * whether each needs `relative`.
 *
 * **A leaning block paints last in its stacking context.** An element whose transform is
 * animating may move anywhere, so the engine cannot fold anything painted after it into a layer
 * beneath it — and inside a scroller that holds for the whole scrolled content: with the blocks
 * stacked where they were, every row and card after the first leaning one, off screen too, came
 * out a compositor layer of its own (58 more at 1440 on the gallery, measured). Stacked at 1 for
 * the run, a block paints after the rest of its stacking context, which the lean never lets it
 * overlap, and the extra layers are the blocks themselves. `relative` where the block is static
 * moves nothing: its transform already makes it the containing block of what is positioned inside
 * it. This is why a masonry slot, a positioned stacking context of its own, is the block rather
 * than the card inside it (`leanPlan`): stacked inside the slot, the card would paint last there
 * and nowhere else. A block given a z-index of its own keeps it. Restacking the stacking contexts
 * further up measured worse (the grid's own restack cost three more layers than it saved), so it
 * stops at the block.
 */
export type LeanPlan = { blocks: LeanBlock[]; lift: Array<{ el: HTMLElement; position: boolean }> };

/** Blocks per pane, at most — each is a compositor layer for the length of a run. */
const LEAN_BLOCK_CAP = 32;
/** A wrapper shorter than two bands leans as one piece: its children would share a beat anyway. */
const LEAN_SPLIT_MIN_PX = 2 * LEAN_BAND_PX;
/** Runaway guard on the descent. */
const LEAN_DESCEND_LIMIT = 8;

type BoxChild = { el: HTMLElement; rect: DOMRect; style: CSSStyleDeclaration };

/** An element's children that have a box and reach into the view (`kids`), and how many have a
 *  box at all (`boxes`) — through wrappers without one (`display: contents`), past anything not
 *  rendered, and never into a concealed pane, whose geometry would be laid out just to answer. A
 *  child out of view costs a rect and nothing more: a fifty-card grid reads ten styles, not fifty. */
function boxChildren(node: Element, inView: (rect: DOMRect) => boolean): { kids: BoxChild[]; boxes: number } {
  const kids: BoxChild[] = [];
  let boxes = 0;
  for (const child of node.children) {
    if (!(child instanceof HTMLElement) || isConcealedPane(child)) continue;
    const rect = child.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) {
      boxes += 1;
      if (inView(rect)) kids.push({ el: child, rect, style: getComputedStyle(child) });
    } else if (getComputedStyle(child).display === 'contents') {
      const inner = boxChildren(child, inView);
      kids.push(...inner.kids);
      boxes += inner.boxes;
    }
  }
  return { kids, boxes };
}

/** Whether taking this element apart can tear anything: it paints nothing of its own and clips
 *  and contains nothing, so its children moving apart for a moment shows no seam. */
function isBareWrapper(style: CSSStyleDeclaration): boolean {
  const border =
    parseFloat(style.borderTopWidth) +
    parseFloat(style.borderRightWidth) +
    parseFloat(style.borderBottomWidth) +
    parseFloat(style.borderLeftWidth);
  return (
    (style.backgroundColor === 'transparent' || style.backgroundColor === 'rgba(0, 0, 0, 0)') &&
    style.backgroundImage === 'none' &&
    style.boxShadow === 'none' &&
    !(border > 0) &&
    style.overflowX === 'visible' &&
    style.overflowY === 'visible' &&
    !/paint|strict|content/.test(style.contain)
  );
}

/** Whether any two of these overlap: coincident layers — a picture and the bar over it — must
 *  move as one. Only the pieces on screen are asked: one off screen rides its pane, and where it
 *  meets a leaning one the seam is off screen too. A sweep down the tops. */
function anyOverlap(kids: BoxChild[]): boolean {
  const sorted = [...kids].sort((a, b) => a.rect.top - b.rect.top);
  for (let i = 0; i < sorted.length; i += 1) {
    const a = sorted[i].rect;
    for (let j = i + 1; j < sorted.length && sorted[j].rect.top < a.bottom - 0.5; j += 1) {
      const b = sorted[j].rect;
      if (b.left < a.right - 0.5 && a.left < b.right - 0.5) return true;
    }
  }
  return false;
}

/**
 * **Which blocks lean — decided by the structure, not by marks.** Every child of the pane with a
 * box (through wrappers that have none) is a block; a block that is a bare wrapper (above) taller
 * than two bands, whose own children do not overlap — a grid, a list, a column of sections — is
 * taken apart into those children, and so on down. So a list's rows and a grid's cards lean one
 * by one, a card never comes apart from its caption, a surface never loses its content, and a
 * component added later is a block or inside one without anybody marking it.
 *
 * Only blocks on screen lean (their tops set how far behind the pane they fall, `leanDepth`); the rest — below
 * the fold, above it, a block in the top band, which rides its pane — ride the pane's own transform,
 * so nothing is ever left behind, whatever the page does during the run. Bounded: a wrapper whose
 * pieces would take the pane past `LEAN_BLOCK_CAP` leans whole. Reads only — call it where the
 * switch has already laid the panes out, before anything is written. `shiftY` is where this pane
 * will sit vertically for the run relative to where it is measured (a scroll restore moves the
 * arriving pane).
 *
 * `leadTop` is where the depths count from: the panel's own top on screen, or the view's top once
 * the panel starts above it. So the first row of the panel that is on screen always leads, even
 * under shared chrome — the gallery's 全部 / 本站讨论 under the banner, a profile's tabs under its
 * header. Counted from the view's top instead, a panel starting halfway down the screen set off
 * 12ms late as a whole: a slow start rather than a lean. The slope stays one view height to the
 * longest lag, so a panel with less of itself on screen leans less rather than more steeply.
 */
export function leanPlan(pane: HTMLElement, viewTop: number, viewBottom: number, shiftY: number, leadTop: number): LeanPlan {
  const height = viewBottom - viewTop;
  const blocks: LeanBlock[] = [];
  const lift: LeanPlan['lift'] = [];
  const inView = (rect: DOMRect) => rect.bottom + shiftY > viewTop && rect.top + shiftY < viewBottom;
  const visit = (kids: BoxChild[], depth: number) => {
    for (const kid of kids) {
      if (depth < LEAN_DESCEND_LIMIT && kid.rect.height > LEAN_SPLIT_MIN_PX && isBareWrapper(kid.style)) {
        const { kids: inner, boxes } = boxChildren(kid.el, inView);
        /* A wrapper around a single child adds nothing — unless it is a positioned stacking
           context (a masonry slot, which contains its layout): then it is the unit its parent
           stacks, and the one that has to paint last (`LeanPlan`). */
        const single = boxes === 1 && !(kid.style.position !== 'static' && isStackingContext(kid.style));
        if (inner.length > 0 && blocks.length + inner.length <= LEAN_BLOCK_CAP && (single || (boxes > 1 && !anyOverlap(inner)))) {
          visit(inner, depth + 1);
          continue;
        }
      }
      const blockDepth = leanDepth(kid.rect.top + shiftY, leadTop, height);
      if (blockDepth > 0 && blocks.length < LEAN_BLOCK_CAP) {
        blocks.push({ el: kid.el, depth: blockDepth, base: kid.style.transform });
        if (kid.style.zIndex === 'auto') lift.push({ el: kid.el, position: kid.style.position === 'static' });
      }
    }
  };
  visit(boxChildren(pane, inView).kids, 0);
  return { blocks, lift };
}

/**
 * **A switch whose panes are still loading does not lean.** Checks whether a first-load
 * placeholder is on screen in this pane: a `data-page-loading` root, the mark every first-load
 * skeleton root already carries for the footer hold. Such a placeholder is about to be replaced,
 * and a block React replaces mid-run stops leaning. It would jump by its lag, and at the seam
 * the two panes' lower blocks would overlap by the same amount. So that switch slides as one
 * plane. A pane that reads when its tab is first selected leans from its next visit on, once
 * its rows are cached.
 *
 * A placeholder inside a concealed pane is skipped by its attributes before any geometry is
 * read. Reads only.
 */
export function loadingInView(pane: HTMLElement, viewTop: number, viewBottom: number, shiftY: number): boolean {
  for (const el of pane.querySelectorAll('[data-page-loading]')) {
    let concealed = false;
    for (let node: Element | null = el; node && node !== pane; node = node.parentElement) {
      if (isConcealedPane(node)) {
        concealed = true;
        break;
      }
    }
    if (concealed) continue;
    const rect = el.getBoundingClientRect();
    if ((rect.width > 0 || rect.height > 0) && rect.bottom + shiftY > viewTop && rect.top + shiftY < viewBottom) return true;
  }
  return false;
}

/** Whether this computed style makes its element a stacking context (the common ways). */
function isStackingContext(style: CSSStyleDeclaration): boolean {
  return (
    (style.position !== 'static' && style.zIndex !== 'auto') ||
    style.position === 'fixed' ||
    style.position === 'sticky' ||
    style.opacity !== '1' ||
    style.transform !== 'none' ||
    style.filter !== 'none' ||
    style.isolation === 'isolate' ||
    style.mixBlendMode !== 'normal' ||
    /layout|paint|strict|content/.test(style.contain) ||
    (style.containerType !== undefined && style.containerType !== '' && style.containerType !== 'normal')
  );
}
