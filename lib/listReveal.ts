'use client';

import { useCallback, useLayoutEffect, useRef } from 'react';
import { scrollCardIntoView, waitForCard } from '@/lib/masonry';

/**
 * A paged grid's `reveal` for `createPagedSequence` (`lib/imageSequence.ts`): before a return
 * flight, turn the list to the card's page through its own page state (never a history entry),
 * wait for the card to mount, and put it on screen. Resolves `false` when the page no longer holds
 * the picture, and the close is then flightless rather than aimed off screen.
 *
 * The profile tabs and the Derpibooru profile use it; the home feed has its own copy inside
 * `PagedImages`. The live values sit in a ref so the returned function is stable — the sequence
 * that carries it is built during render and must not change identity on every one.
 */
export function useListReveal(
  readPage: (page: number) => Promise<readonly number[]>,
  page: number,
  setPage: (page: number) => void,
  root: () => HTMLElement | null,
) {
  const live = useRef({ readPage, page, setPage, root });
  useLayoutEffect(() => {
    live.current = { readPage, page, setPage, root };
  });
  return useCallback(async (id: number, targetPage: number): Promise<boolean> => {
    const current = live.current;
    if (targetPage !== current.page) {
      const ids = await current.readPage(targetPage).catch(() => null);
      if (!ids?.includes(id)) return false;
      current.setPage(targetPage);
    }
    const card = await waitForCard(() => live.current.root(), id);
    if (!card) return false;
    scrollCardIntoView(card);
    return true;
  }, []);
}
