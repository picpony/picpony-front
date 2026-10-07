'use client';

/**
 * A folder card opening into its page as a container transform, and the page closing back into
 * its card: the forum's construction, on the forum's engine (`lib/containerTransformPlay.ts`, the
 * route half `lib/routeContainerPlay.ts`; this module's DOM half is `lib/folderTransitPlay.ts`).
 * /favorites' 收藏夹 tab opens your own folders, a profile's 收藏夹 tab somebody's public ones;
 * both draw `FolderCard`, and both pages mark their column.
 *
 * **The card grows into the page, not into its header.** What a folder card opens is a screen —
 * its name, its count and its first band of pictures — so the container ends as that screen does:
 * the page column, as much of it as is on screen, square, in the page's own tone. Ending on the
 * header alone would have squeezed a 4:3 cover into a 64px strip while the pictures under it
 * faded in on a clock of their own: two motions for one gesture. The column's top cannot move
 * under the landing — its header is drawn in its final shape in the frame the page mounts (the
 * folder list the card came from is in the cache, and a profile's public list seeds a shared
 * folder's header), and what is below it is clipped at the bottom of the screen whatever its
 * height. What *can* change during the run is the band's content: a placeholder becomes pictures,
 * or an empty folder's message. The layer therefore hands off by fading off the live page
 * (`handoffFade`), so a change made under it cross-fades in rather than popping at the landing.
 *
 * **Standard tier only**, as the forum's: under 减弱 the route's own fade is the whole
 * transition, under 关闭 a cut. A press in the folder batch mode toggles its card and records
 * nothing (the link is inert under its checkbox), and a click with a modifier is the browser's.
 */

import { useCallback, useLayoutEffect, type RefObject } from 'react';
import { heroOwnsScreen } from '@/lib/appScroller';
import { motionTier } from '@/lib/appearance';

/** Which folder page a card was pressed for — its address — and when. */
export interface FolderOrigin {
  key: string;
  at: number;
}

/** How long a press stays the reason for the next open: the navigation, with room (the forum's). */
const ORIGIN_TTL_MS = 3000;

let pending: FolderOrigin | null = null;
let returning: FolderOrigin | null = null;
/** The folder page last left, on every tier: its card takes the focus back (`useFolderReturn`). */
let left: FolderOrigin | null = null;

function fresh(origin: FolderOrigin | null, key: string): FolderOrigin | null {
  if (!origin || origin.key !== key) return null;
  if (performance.now() - origin.at > ORIGIN_TTL_MS) return null;
  /* A flight owns the screen: the card is not where the press left it. */
  if (heroOwnsScreen()) return null;
  return origin;
}

/**
 * Call on a plain press of a folder card, before the route is pushed; `href` is the folder page's
 * address, which is also the key both ends find each other by. Nothing is recorded below the
 * standard tier.
 */
export function rememberFolderOrigin(href: string, card: HTMLElement) {
  if (motionTier() !== 'standard') return;
  const rect = card.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  /* The gesture-driven warm, as the forum's: the page is a round trip away. */
  ensurePlay();
  pending = { key: href, at: performance.now() };
}

/**
 * The page being left with its column on screen, for its card to take it back. Recorded from the
 * column's ref as it detaches, while it is still laid out.
 */
export function rememberFolderReturn(href: string, page: HTMLElement) {
  left = { key: href, at: performance.now() };
  if (motionTier() !== 'standard') return;
  const rect = page.getBoundingClientRect();
  if (rect.top >= window.innerHeight || rect.bottom <= 0) return;
  ensurePlay();
  returning = { key: href, at: performance.now() };
}

/** The folder page the list was just left from, while it is fresh. Consumed by `clearFolderReturn`. */
export function readFolderReturn(): FolderOrigin | null {
  return returning && fresh(returning, returning.key);
}

export function clearFolderReturn() {
  returning = null;
}

/**
 * The DOM half, behind a dynamic import (`lib/folderTransitPlay.ts`): every list of folders
 * renders a card, and the half that builds the layer is wanted only a navigation later. Warmed by
 * the press that will want it; if it loses that race the page simply arrives on the route's fade.
 */
let play: typeof import('@/lib/folderTransitPlay') | null = null;
let loading = false;

function ensurePlay() {
  if (play || loading) return;
  loading = true;
  void import('@/lib/folderTransitPlay').then(
    (module) => {
      play = module;
    },
    () => {
      /* A failed chunk fetch is not retried per press: every open is then the route's fade. */
    },
  );
}

/**
 * The folder page's column, as it mounts: its card grows into it after a press — or, Forward while
 * it was closing back into that card, turns back out. Returns a cleanup.
 */
export function playFolderOpen(page: HTMLElement, href: string): () => void {
  const origin = fresh(pending, href);
  if (!play) {
    if (origin) ensurePlay();
    return () => {};
  }
  return play.playFolderOpen(page, href, origin !== null);
}

/** The list's card for the page just left, a frame after the list is laid out. Returns a cleanup. */
export function playFolderReturn(card: HTMLElement, origin: FolderOrigin): () => void {
  if (!play) return () => {};
  return play.playFolderReturn(card, origin.key);
}

/**
 * The ref for a folder page's column — the container's far end. Its detach records the page as
 * left, while it is still laid out, for the card to take it back. Put it on the column only in
 * the page's final shape: a placeholder's height is not the page's.
 */
export function useFolderPage(href: string) {
  return useCallback(
    (page: HTMLElement | null) => {
      if (!page) return;
      const stop = playFolderOpen(page, href);
      return () => {
        rememberFolderReturn(href, page);
        stop();
      };
    },
    [href],
  );
}

/**
 * **The way back**, for a list of folder cards: the page that was left shrinks back into its card
 * — a frame after the list is laid out, when the restored scroll offset has landed and the
 * incoming page is still transparent. A card the offset leaves off screen takes the route's fade.
 * Read, not consumed, from an effect React may run twice; consumed when it plays.
 *
 * **The focus comes back to the card too**, on every tier (where focus lands is not motion): the
 * card's link is marked `data-return-focus`, which the shell's route landing prefers to the page's
 * heading while the navigation has left the focus nowhere — the page that held it is gone — as the
 * image detail returns its focus to its card (`components/AppLayout.tsx`). Marked only while the
 * page was left a moment ago (`ORIGIN_TTL_MS`), never scrolled to: the restored offset owns the
 * position.
 */
export function useFolderReturn(root: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const back = left && performance.now() - left.at <= ORIGIN_TTL_MS ? left.key : null;
    const link = back ? root.current?.querySelector<HTMLElement>(`[data-folder-card="${CSS.escape(back)}"] > a[href]`) : null;
    if (!link) return;
    link.setAttribute('data-return-focus', '');
    return () => link.removeAttribute('data-return-focus');
  }, [root]);

  useLayoutEffect(() => {
    const origin = readFolderReturn();
    if (!origin) return;
    let stop: (() => void) | null = null;
    const frame = requestAnimationFrame(() => {
      const card = root.current?.querySelector<HTMLElement>(`[data-folder-card="${CSS.escape(origin.key)}"]`);
      clearFolderReturn();
      if (card) stop = playFolderReturn(card, origin);
    });
    return () => {
      cancelAnimationFrame(frame);
      stop?.();
    };
  }, [root]);
}
