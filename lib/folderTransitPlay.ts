'use client';

import { getAppScroller } from '@/lib/appScroller';
import { captureVisualClone } from '@/lib/pageSnapshot';
import { FORUM_FADE, visibleBox, type Box, type Radii } from '@/lib/forumContainer';
import { hide, rectOf, reveal, surfaceOf, type Hidden, type Surface } from '@/lib/containerTransformPlay';
import {
  claimable,
  crossFadeLayer,
  dismissFlight,
  flightOn,
  flyOnRoute,
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
 */

const SQUARE: Radii = [0, 0, 0, 0];

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

/** Whether every tab pane around `el` is the one on screen: a concealed pane keeps its layout, so
    its cards still answer with rectangles, but nobody is looking at them. */
function inShownPanes(el: HTMLElement): boolean {
  for (let pane = el.closest('[data-tab-pane]'); pane; pane = pane.parentElement?.closest('[data-tab-pane]') ?? null) {
    if (!pane.hasAttribute('data-tab-pane-active')) return false;
  }
  return true;
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
      if (toBox && turnFlight(closing, 'open', page, { to: pageSurface(toBox), hidden })) flight = closing;
      else {
        if (!toBox) dismissFlight(closing);
        reveal(hidden);
      }
      return;
    }
    const cardCopy = crossFade ? cardIn(crossFade, href) : null;
    const cardBox = cardCopy ? rectOf(cardCopy) : null;
    const fromBox = cardBox && view ? visibleBox(cardBox, view) : null;
    const incoming = fresh && fromBox && toBox && crossFade ? captureVisualClone(page, crossFade) : null;
    if (!crossFade || !cardCopy || !cardBox || !fromBox || !toBox || !incoming) {
      reveal(hidden);
      return;
    }
    /* The route may have committed a placeholder first and this page a round trip later, by when
       the list's still frame is already fading: its card is not brought back. */
    const listFrame = crossFade.firstElementChild;
    const leaving = listFrame ? parseFloat(getComputedStyle(listFrame).opacity) > 0.9 : false;
    const outgoing = leaving ? { el: cardCopy.cloneNode(true) as HTMLElement, box: cardBox } : null;
    hide(cardCopy, 'visibility', hidden);
    flight = flyOnRoute(
      {
        from: cardSurface(cardCopy, fromBox),
        to: pageSurface(toBox),
        outgoing,
        incoming: incoming.node,
        incomingBox: pageBox,
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
    if (!turnFlight(opening, 'back', card, { to: cardSurface(card, cardBox), hidden })) {
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
  const incoming = captureVisualClone(card, crossFade);
  if (!incoming) return () => {};
  const hidden: Hidden[] = [];
  const outgoing = pageCopy.cloneNode(true) as HTMLElement;
  hide(pageCopy, 'visibility', hidden);
  hide(card, 'visibility', hidden);
  const flight = flyOnRoute(
    {
      from: pageSurface(fromBox),
      to: cardSurface(card, cardBox),
      outgoing: { el: outgoing, box: pageBox },
      incoming: incoming.node,
      incomingBox: cardBox,
      fade: FORUM_FADE.back,
      hidden,
    },
    { kind: 'folder', key, leg: 'back', target: card, handoffFade: true },
  );
  return () => {
    if (flight) release(flight);
  };
}
