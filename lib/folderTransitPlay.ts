'use client';

import { getAppScroller } from '@/lib/appScroller';
import { captureVisualClone } from '@/lib/pageSnapshot';
import { FORUM_FADE, visibleBox, type Box, type Radii } from '@/lib/forumContainer';
import {
  hide,
  radiiOf,
  rectOf,
  reveal,
  surfaceOf,
  type Hidden,
  type SharedMedia,
  type SharedMediaEnd,
  type Surface,
} from '@/lib/containerTransformPlay';
import {
  claimable,
  crossFadeLayer,
  dismissFlight,
  flightOn,
  flyOnRoute,
  inShownPanes,
  release,
  routePlayable,
  turnFlight,
  type Flight,
} from '@/lib/routeContainerPlay';

/**
 * A folder card ⇄ its page, the half that touches the DOM (`lib/folderTransit.ts` says when and
 * why the page column is the far end). The forum's construction on the forum's engine: the card
 * is taken from the route cross-fade's still frame of the list, the page from its live column,
 * and the other way round on the way back.
 *
 * When the card carries a decoded cover picture and its matching card (or first grid slot on a
 * cold open) is visible on the folder page, the cover rides above the cross-fading text as a
 * shared media morph (`SharedMedia`), keeping the image visible and circular-clipped while
 * morphing its bounds and `object-cover` crop on the same spring clock. Visible arriving images
 * also stay alive in the clone (`keepImages`) so cached grids and card covers translate visibly
 * rather than fading through blank shimmer blocks.
 */

const SQUARE: Radii = [0, 0, 0, 0];

/** The cover picture last seen on a folder's card, for mid-flight turns and scrolled returns. */
const lastCover = new Map<string, { id: string; src: string }>();

const keyOf = (href: string) => `folder:${href}`;
const cardIn = (root: ParentNode, href: string) => root.querySelector<HTMLElement>(`[data-folder-card="${CSS.escape(href)}"]`);
const pageIn = (root: ParentNode, href: string) => root.querySelector<HTMLElement>(`[data-folder-page="${CSS.escape(href)}"]`);

/** The page's own surface: square, in the tone the scroller paints under every page. */
function pageSurface(box: Box): Surface {
  const scroller = getAppScroller();
  return { box, radii: SQUARE, colour: scroller ? getComputedStyle(scroller).backgroundColor : 'transparent' };
}

/** A card's surface is its face — the link, which draws the tone and the 12dp corner; the marked
    wrapper around it also holds the card's ⋮, and is what is copied. */
function cardSurface(card: HTMLElement, box: Box): Surface {
  return surfaceOf(card.querySelector('a[href]') ?? card, box);
}

/** The cover's top corners come from the card's `overflow-hidden` face; its bottom edge is flat. */
const coverTopRadii = (cardRadii: Radii): Radii => [cardRadii[0], cardRadii[1], 0, 0];

/** Hides a cloned slot via opacity so descendant `visibility: visible` image reveals cannot bleed through. */
function hideCloneSlot(el: HTMLElement | null) {
  if (!el) return;
  el.style.opacity = '0';
}

/** Hides every `ImageCard` badge overlay inside an opening folder clone so badges fade in cleanly at handoff. */
function hideCloneCardBadges(root: HTMLElement) {
  for (const link of root.querySelectorAll<HTMLElement>('.image-hero-card-link')) {
    const chrome = link.children[1];
    if (chrome instanceof HTMLElement) hideCloneSlot(chrome);
  }
}

/** Reads a decoded, visible `<img>` inside `container`, or null when nothing is painted yet. */
function readVisibleImg(container: HTMLElement | null): { src: string; ratio: number; anchorY: number } | null {
  const img = container?.querySelector<HTMLImageElement>('img') ?? null;
  if (!img || !img.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0) return null;
  const style = getComputedStyle(img);
  if (style.visibility === 'hidden' || parseFloat(style.opacity) <= 0.5) return null;
  const src = img.currentSrc || img.src;
  if (!src) return null;
  return {
    src,
    ratio: img.naturalWidth / img.naturalHeight,
    anchorY: img.classList.contains('object-top') ? 0 : 0.5,
  };
}

/** The folder card's cover box inside `card`, if visible in `view`. */
function cardCoverEnd(
  card: HTMLElement,
  cardRadii: Radii,
  view: Box,
): { el: HTMLElement; id: string | null; end: SharedMediaEnd } | null {
  const el = card.querySelector<HTMLElement>('[data-folder-cover]');
  if (!el) return null;
  const box = rectOf(el);
  if (!visibleBox(box, view)) return null;
  return { el, id: el.dataset.folderCover || null, end: { box, radii: coverTopRadii(cardRadii), anchorY: 0.5 } };
}

/** Where a folder card's cover lands on the folder page: its matching card, seeded cover slot, or fallback placeholder #0. */
function pageCoverTarget(
  page: HTMLElement,
  coverId: string | null,
  view: Box,
): { end: SharedMediaEnd; hideInClone: (clone: HTMLElement) => void } | null {
  if (coverId) {
    const selector = `[data-masonry-id="${CSS.escape(coverId)}"]`;
    const slot = page.querySelector<HTMLElement>(selector);
    const spoilered = slot?.querySelector('.card-spoiler:not([inert])') !== null;
    const link = !spoilered ? (slot?.querySelector<HTMLElement>('.image-hero-card-link') ?? null) : null;
    const thumb = link?.firstElementChild instanceof HTMLElement ? link.firstElementChild : null;
    if (thumb) {
      const box = rectOf(thumb);
      if (visibleBox(box, view)) {
        const anchorY = thumb.querySelector('img')?.classList.contains('object-top') ? 0 : 0.5;
        return {
          end: { box, radii: radiiOf(getComputedStyle(thumb)), anchorY },
          hideInClone: (clone) => hideCloneSlot(clone.querySelector<HTMLElement>(selector)),
        };
      }
    }
    const seedSelector = `[data-folder-seed-cover="${CSS.escape(coverId)}"]`;
    const seed = page.querySelector<HTMLElement>(seedSelector);
    if (seed) {
      const box = rectOf(seed);
      if (visibleBox(box, view)) {
        const anchorY = seed.querySelector('img')?.classList.contains('object-top') ? 0 : 0.5;
        return {
          end: { box, radii: radiiOf(getComputedStyle(seed)), anchorY },
          hideInClone: (clone) => hideCloneSlot(clone.querySelector<HTMLElement>(seedSelector)),
        };
      }
    }
  }
  const placeholder = page.querySelector<HTMLElement>('[data-grid-placeholder]');
  if (placeholder) {
    const box = rectOf(placeholder);
    if (visibleBox(box, view)) {
      return {
        end: { box, radii: radiiOf(getComputedStyle(placeholder)), anchorY: 0.5 },
        hideInClone: (clone) => hideCloneSlot(clone.querySelector<HTMLElement>('[data-grid-placeholder]')),
      };
    }
  }
  return null;
}

/** The folder page's matching cover picture inside the route cross-fade snapshot, when visible. */
function pageCoverSource(
  pageCopy: HTMLElement,
  coverId: string | null,
  view: Box,
): { src: string; ratio: number; end: SharedMediaEnd; selector: string } | null {
  if (!coverId) return null;
  const selector = `[data-masonry-id="${CSS.escape(coverId)}"]`;
  const slot = pageCopy.querySelector<HTMLElement>(selector);
  if (slot && slot.querySelector('.card-spoiler:not([inert])') === null) {
    const link = slot.querySelector<HTMLElement>('.image-hero-card-link');
    const thumb = link?.firstElementChild instanceof HTMLElement ? link.firstElementChild : null;
    if (thumb) {
      const box = rectOf(thumb);
      if (visibleBox(box, view)) {
        const media = readVisibleImg(thumb);
        if (media) {
          return {
            src: media.src,
            ratio: media.ratio,
            end: { box, radii: radiiOf(getComputedStyle(thumb)), anchorY: media.anchorY },
            selector,
          };
        }
      }
    }
  }
  const seedSelector = `[data-folder-seed-cover="${CSS.escape(coverId)}"]`;
  const seed = pageCopy.querySelector<HTMLElement>(seedSelector);
  if (seed) {
    const box = rectOf(seed);
    if (visibleBox(box, view)) {
      const media = readVisibleImg(seed);
      if (media) {
        return {
          src: media.src,
          ratio: media.ratio,
          end: { box, radii: radiiOf(getComputedStyle(seed)), anchorY: media.anchorY },
          selector: seedSelector,
        };
      }
    }
  }
  return null;
}

/** Points a freshly cloned card cover at its cached `currentSrc` when no shared cover flies to it. */
function warmCardCoverClone(clone: HTMLElement, coverId: string | null, href: string) {
  const cached = lastCover.get(href);
  if (!cached || !coverId || cached.id !== coverId) return;
  const img = clone.querySelector<HTMLImageElement>('[data-folder-cover] img');
  if (!img || (img.complete && img.naturalWidth > 0)) return;
  const revealImg = () => {
    if (img.naturalWidth <= 0) return;
    img.style.transition = 'none';
    img.style.opacity = '1';
    img.style.visibility = 'visible';
    const shimmer = img.previousElementSibling;
    if (shimmer instanceof HTMLElement && shimmer.getAttribute('aria-hidden') === 'true') {
      shimmer.style.transition = 'none';
      shimmer.style.opacity = '0';
    }
  };
  img.removeAttribute('srcset');
  img.removeAttribute('sizes');
  img.setAttribute('loading', 'eager');
  img.setAttribute('decoding', 'async');
  img.setAttribute('src', cached.src);
  if (img.complete && img.naturalWidth > 0) revealImg();
  else img.addEventListener('load', revealImg, { once: true });
}

/**
 * Opening: the card the folder was pressed on grows into the page's column, from the column's ref
 * in the commit that mounts it — built a frame later, once the list's still frame is in place and
 * the page's offset has landed, still before anything is painted. With `fresh` false it only
 * turns a card that was closing back into this page (Forward). Returns a cleanup.
 */
export function playFolderOpen(page: HTMLElement, href: string, fresh: boolean): () => void {
  const adopted = flightOn(page);
  if (adopted) return () => release(adopted);
  const key = keyOf(href);
  if (!routePlayable(page) || (!fresh && claimable(key, 'open') === null)) return () => {};
  const hidden: Hidden[] = [];
  /* Opacity, not visibility: the route lands focus on the page's heading as soon as it can. */
  hide(page, 'opacity', hidden);
  let flight: Flight | null = null;
  const frame = requestAnimationFrame(() => {
    const crossFade = crossFadeLayer();
    const view = crossFade ? rectOf(crossFade) : null;
    const pageBox = rectOf(page);
    const toBox = view ? visibleBox(pageBox, view) : null;
    /* The page was closing back into its card when Forward brought it back. */
    const closing = claimable(key, 'open');
    if (closing) {
      const cardCopy = crossFade ? cardIn(crossFade, href) : null;
      if (cardCopy) hide(cardCopy, 'visibility', hidden);
      const coverId = cardCopy?.querySelector<HTMLElement>('[data-folder-cover]')?.dataset.folderCover || lastCover.get(href)?.id || null;
      const sharedTo = view ? (pageCoverTarget(page, coverId, view)?.end ?? null) : null;
      if (toBox && turnFlight(closing, 'open', page, { to: pageSurface(toBox), sharedTo, hidden })) flight = closing;
      else {
        if (!toBox) dismissFlight(closing);
        reveal(hidden);
      }
      return;
    }
    const cardCopy = crossFade ? cardIn(crossFade, href) : null;
    const cardBox = cardCopy ? rectOf(cardCopy) : null;
    const fromBox = cardBox && view ? visibleBox(cardBox, view) : null;
    const incoming = fresh && fromBox && toBox && crossFade ? captureVisualClone(page, crossFade, { keepImages: true }) : null;
    if (!crossFade || !cardCopy || !cardBox || !fromBox || !toBox || !incoming || !view) {
      reveal(hidden);
      return;
    }
    const fromSurface = cardSurface(cardCopy, fromBox);
    /* The route may have committed a placeholder first and this page a round trip later, by when
       the list's still frame is already fading: its card is not brought back. */
    const listFrame = crossFade.firstElementChild;
    const leaving = listFrame ? parseFloat(getComputedStyle(listFrame).opacity) > 0.9 : false;
    const outgoing = leaving ? { el: cardCopy.cloneNode(true) as HTMLElement, box: cardBox } : null;
    let shared: SharedMedia | null = null;
    const fromCover = cardCoverEnd(cardCopy, fromSurface.radii, view);
    const coverMedia = fromCover ? readVisibleImg(fromCover.el) : null;
    if (fromCover?.id && coverMedia) lastCover.set(href, { id: fromCover.id, src: coverMedia.src });
    hideCloneCardBadges(incoming.node);
    if (outgoing && fromCover && coverMedia) {
      const target = pageCoverTarget(page, fromCover.id, view);
      if (target) {
        shared = {
          src: coverMedia.src,
          ratio: coverMedia.ratio,
          from: fromCover.end,
          to: target.end,
        };
        hideCloneSlot(outgoing.el.querySelector<HTMLElement>('[data-folder-cover]'));
        target.hideInClone(incoming.node);
      }
    }
    hide(cardCopy, 'visibility', hidden);
    flight = flyOnRoute(
      {
        from: fromSurface,
        to: pageSurface(toBox),
        outgoing,
        incoming: incoming.node,
        incomingBox: pageBox,
        shared,
        fade: FORUM_FADE.open,
        hidden,
      },
      { kind: 'folder', key, leg: 'open', target: page, handoffFade: true },
    );
  });
  return () => {
    cancelAnimationFrame(frame);
    if (flight) release(flight);
    else reveal(hidden);
  };
}

/**
 * The return: the page that was left shrinks back into `card`, a frame after the list is laid out
 * (the caller's job). The page is taken from the route's still frame, exactly where it was on
 * screen, and only its visible part is the container's first shape — or, when the page was still
 * opening as it was left, the opening container itself turns.
 */
export function playFolderReturn(card: HTMLElement, href: string): () => void {
  const adopted = flightOn(card);
  if (adopted) return () => release(adopted);
  if (!routePlayable(card) || !inShownPanes(card)) return () => {};
  const crossFade = crossFadeLayer();
  if (!crossFade) return () => {};
  const key = keyOf(href);
  const view = rectOf(crossFade);
  const cardBox = rectOf(card);
  const cardShown = visibleBox(cardBox, view);
  const cardSurf = cardSurface(card, cardBox);
  const cardCover = cardCoverEnd(card, cardSurf.radii, view);
  const pageCopy = pageIn(crossFade, href);
  const opening = claimable(key, 'back');
  if (opening) {
    /* A card the restored offset leaves off screen has nowhere to be flown to. */
    if (!cardShown) {
      dismissFlight(opening);
      return () => {};
    }
    const hidden: Hidden[] = [];
    hide(card, 'visibility', hidden);
    if (pageCopy) hide(pageCopy, 'visibility', hidden);
    if (!turnFlight(opening, 'back', card, { to: cardSurf, sharedTo: cardCover?.end ?? null, hidden })) {
      reveal(hidden);
      return () => {};
    }
    return () => release(opening);
  }
  if (!pageCopy) return () => {};
  const pageBox = rectOf(pageCopy);
  const fromBox = visibleBox(pageBox, view);
  /* A card the restored offset leaves off screen has nowhere to be flown to: the route's fade. */
  if (!fromBox || !cardShown) return () => {};
  const incoming = captureVisualClone(card, crossFade, { keepImages: true });
  if (!incoming) return () => {};
  const hidden: Hidden[] = [];
  const outgoing = pageCopy.cloneNode(true) as HTMLElement;
  let shared: SharedMedia | null = null;
  if (cardCover) {
    const source = pageCoverSource(pageCopy, cardCover.id, view);
    if (source) {
      shared = {
        src: source.src,
        ratio: source.ratio,
        from: source.end,
        to: cardCover.end,
      };
      hideCloneSlot(outgoing.querySelector<HTMLElement>(source.selector));
      hideCloneSlot(incoming.node.querySelector<HTMLElement>('[data-folder-cover]'));
    } else {
      warmCardCoverClone(incoming.node, cardCover.id, href);
    }
  }
  hide(pageCopy, 'visibility', hidden);
  hide(card, 'visibility', hidden);
  const flight = flyOnRoute(
    {
      from: pageSurface(fromBox),
      to: cardSurf,
      outgoing: { el: outgoing, box: pageBox },
      incoming: incoming.node,
      incomingBox: cardBox,
      shared,
      fade: FORUM_FADE.back,
      hidden,
    },
    { kind: 'folder', key, leg: 'back', target: card, handoffFade: true },
  );
  return () => {
    if (flight) release(flight);
  };
}
