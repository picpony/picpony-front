'use client';

import { captureVisualClone } from '@/lib/pageSnapshot';
import { FORUM_FADE, visibleBox } from '@/lib/forumContainer';
import { hide, rectOf, reveal, surfaceOf, type Hidden } from '@/lib/containerTransformPlay';
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
import type { ForumOrigin } from '@/lib/forumTransition';

/**
 * The forum's container transform, the half that touches the DOM (the geometry, the clock and why
 * they are what they are: `lib/forumContainer.ts`; the layer and its legs:
 * `lib/containerTransformPlay.ts`, shared with the picture detail's and the folders'; riding the
 * route and surviving the next one: `lib/routeContainerPlay.ts`, shared with the folders').
 *
 * The outgoing content is taken from the route cross-fade's still frame of the page being left,
 * the incoming one from the live element. A post still opening when Back is pressed turns back
 * into its row from where it is, and a post still closing when Forward is pressed turns back out
 * (`claimable`).
 */

const keyOf = (id: string) => `forum:${id}`;

/** Whether a post's card is on its way back into its row with nowhere left to land: a Forward is
    bringing the thread back, and the card turns back out (`readForumOrigin`). */
export function forumReturnInFlight(id: string): boolean {
  return claimable(keyOf(id), 'open') !== null;
}

/**
 * Opening: the row the post was pressed in grows into the card. Called from the card's ref in the
 * commit that mounts it (the route's still frame of the list is placed later in that commit, so
 * the overlay is built a frame later — still before anything is painted). Returns a cleanup.
 */
export function playForumContainerTransform(card: HTMLElement, origin: ForumOrigin): () => void {
  const adopted = flightOn(card);
  if (adopted) return () => release(adopted);
  const key = keyOf(origin.id);
  if (!routePlayable(card)) return () => {};
  const hidden: Hidden[] = [];
  /* Opacity, not visibility: the route moves focus to the card's heading as soon as it can. */
  hide(card, 'opacity', hidden);
  let flight: Flight | null = null;
  const frame = requestAnimationFrame(() => {
    const crossFade = crossFadeLayer();
    const view = crossFade ? rectOf(crossFade) : null;
    const cardBox = rectOf(card);
    const toBox = view ? visibleBox(cardBox, view) : null;
    /* The card was closing back into its row when Forward brought its thread back. */
    const closing = claimable(key, 'open');
    if (closing) {
      const rowCopy = crossFade?.querySelector<HTMLElement>(`[data-forum-row="${CSS.escape(origin.id)}"]`);
      if (rowCopy) hide(rowCopy, 'visibility', hidden);
      if (toBox && turnFlight(closing, 'open', card, { to: surfaceOf(card, toBox), hidden })) flight = closing;
      else {
        if (!toBox) dismissFlight(closing);
        reveal(hidden);
      }
      return;
    }
    const rowCopy = crossFade?.querySelector<HTMLElement>(`[data-forum-row="${CSS.escape(origin.id)}"]`);
    const rowBox = rowCopy ? rectOf(rowCopy) : null;
    const fromBox = rowBox && view ? visibleBox(rowBox, view) : null;
    const incoming = fromBox && toBox && crossFade ? captureVisualClone(card, crossFade) : null;
    if (!rowCopy || !rowBox || !fromBox || !toBox || !incoming) {
      reveal(hidden);
      return;
    }
    /* The route may have committed its placeholder first and this card a round trip later,
       by when the list's still frame is already fading: its row is not brought back. */
    const listFrame = crossFade?.firstElementChild;
    const leaving = listFrame ? parseFloat(getComputedStyle(listFrame).opacity) > 0.9 : false;
    const outgoing = leaving ? { el: rowCopy.cloneNode(true) as HTMLElement, box: rowBox } : null;
    hide(rowCopy, 'visibility', hidden);
    flight = flyOnRoute(
      {
        from: surfaceOf(rowCopy, fromBox),
        to: surfaceOf(card, toBox),
        outgoing,
        incoming: incoming.node,
        incomingBox: cardBox,
        fade: FORUM_FADE.open,
        hidden,
      },
      { kind: 'forum', key, leg: 'open', target: card },
    );
  });
  return () => {
    cancelAnimationFrame(frame);
    if (flight) release(flight);
    else reveal(hidden);
  };
}

/**
 * The return: the card the thread was left from shrinks back into its row. Called a frame after
 * the list is laid out (the caller's job), once the list's scroll offset has been restored.
 * `origin` only says which post; the card is taken from the route's still frame, which is
 * exactly where it was on screen, and only its visible part is the container's first shape — or,
 * when the card was still opening as the thread was left, the opening container itself turns.
 */
export function playForumReturn(row: HTMLElement, origin: ForumOrigin): () => void {
  const adopted = flightOn(row);
  if (adopted) return () => release(adopted);
  if (!routePlayable(row)) return () => {};
  const crossFade = crossFadeLayer();
  if (!crossFade) return () => {};
  const key = keyOf(origin.id);
  const view = rectOf(crossFade);
  const rowBox = rectOf(row);
  const rowShown = visibleBox(rowBox, view);
  const cardCopy = crossFade.querySelector<HTMLElement>(`[data-forum-card="${CSS.escape(origin.id)}"]`);
  const opening = claimable(key, 'back');
  if (opening) {
    /* A row the restored offset leaves off screen has nowhere to be flown to. */
    if (!rowShown) {
      dismissFlight(opening);
      return () => {};
    }
    const hidden: Hidden[] = [];
    hide(row, 'visibility', hidden);
    if (cardCopy) hide(cardCopy, 'visibility', hidden);
    if (!turnFlight(opening, 'back', row, { to: surfaceOf(row, rowBox), hidden })) {
      reveal(hidden);
      return () => {};
    }
    return () => release(opening);
  }
  if (!cardCopy) return () => {};
  const cardBox = rectOf(cardCopy);
  const fromBox = visibleBox(cardBox, view);
  /* A row the restored offset leaves off screen has nowhere to be flown to: the route's fade. */
  if (!fromBox || !rowShown) return () => {};
  const incoming = captureVisualClone(row, crossFade);
  if (!incoming) return () => {};
  const hidden: Hidden[] = [];
  const outgoing = cardCopy.cloneNode(true) as HTMLElement;
  hide(cardCopy, 'visibility', hidden);
  hide(row, 'visibility', hidden);
  const flight = flyOnRoute(
    {
      from: surfaceOf(cardCopy, fromBox),
      to: surfaceOf(row, rowBox),
      outgoing: { el: outgoing, box: cardBox },
      incoming: incoming.node,
      incomingBox: rowBox,
      fade: FORUM_FADE.back,
      hidden,
    },
    { kind: 'forum', key, leg: 'back', target: row },
  );
  return () => {
    if (flight) release(flight);
  };
}
