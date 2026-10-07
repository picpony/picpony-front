'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { flushSync } from 'react-dom';
import { findDetailOriginLink, findDetailOriginRow } from '@/lib/detailTransit';
import { clearImageSequence, createPagedSequence, type ImageSequenceSource } from '@/lib/imageSequence';
import { scrollCardIntoView } from '@/lib/masonry';
import type { HistoryEntry } from '@/lib/api/history';
import { browsingHistory } from '@/lib/resources';
import { readingOrder } from './days';

/**
 * How long a reveal waits for a row that was not there at once, and how long the focus hand-off
 * waits for the detail to leave: a render or two, and a close, with room for a slow commit. The
 * controller bounds the close itself (`STEP_REVEAL_TIMEOUT_MS`); these only stop a wait from
 * outliving it. The controller's own hand-off for a card waits 3s as well.
 */
const ROW_WAIT_MS = 3000;
const FOCUS_WAIT_MS = 3000;

/**
 * Resolves with the row for picture `id` once it is in the list and laid out, or `null` after
 * `ROW_WAIT_MS`. Frame-polled, like `waitForCard`: the wait is a few frames, and a
 * MutationObserver over twenty rows would fire for every attribute they write.
 */
function waitForRow(id: number): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const started = performance.now();
    const check = () => {
      const row = findDetailOriginRow(id);
      if (row) {
        resolve(row);
        return;
      }
      if (performance.now() - started > ROW_WAIT_MS) {
        resolve(null);
        return;
      }
      requestAnimationFrame(check);
    };
    check();
  });
}

/** Whether the picture detail is still mounted — its exit copies aside, which are not the detail. */
function detailMounted(): boolean {
  return [...document.querySelectorAll('[data-image-detail-overlay]')].some(
    (overlay) => !overlay.closest('[data-detail-exit], [data-detail-transform]'),
  );
}

/**
 * The revealed row takes focus once the detail has gone, and only while focus is lost — the
 * controller's rule for a revealed card (`focusRevealedCard`), which looks for a gallery thumbnail
 * and so never finds a row. The overlay's own return lands on the row whenever the turn has
 * committed by then (`returnFocus` asks `findDetailOriginLink`); this covers a page read that came
 * from the network and landed after it, unmounting the row focus had returned to.
 */
function handOffFocus(id: number) {
  const deadline = performance.now() + FOCUS_WAIT_MS;
  const attempt = () => {
    if (performance.now() > deadline) return;
    const link = findDetailOriginLink(id);
    if (detailMounted() || link?.closest('[inert]')) {
      requestAnimationFrame(attempt);
      return;
    }
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && active.isConnected) return;
    link?.focus({ preventScroll: true });
  };
  requestAnimationFrame(attempt);
}

interface LiveList {
  token: string | null;
  date: string;
  page: number;
  setPage: (page: number) => void;
  hidden: ReadonlySet<number>;
}

/**
 * The source's two readers, stable for the screen's life and reading its live values: the source
 * is built during render, and the one the viewer holds is the one built when the row was pressed
 * (`openFromSequence`), so a reader closing over that render's values would turn a page the list
 * has since left — the reason `useListReveal` keeps a ref. A hook of its own so the source is built
 * from values, not from a ref.
 */
function useHistoryReaders(values: LiveList) {
  const live = useRef(values);
  useLayoutEffect(() => {
    live.current = values;
  });

  /* One page of the list as the screen would show it: in reading order, and without the rows
     whose delete is held for 撤销. Through the list's own resource, so a page the walk reads is
     the page the list then turns to, with no second request. */
  const readPage = useCallback(async (target: number): Promise<{ ids: number[]; totalPages: number }> => {
    const { token, date, hidden } = live.current;
    if (!token) return { ids: [], totalPages: 1 };
    const result = await browsingHistory.read({ token, page: target, date: date || null });
    return {
      ids: readingOrder(result.entries).filter((id) => !hidden.has(id)),
      totalPages: result.totalPages,
    };
  }, []);

  /**
   * Turns the list to the picture's page and puts its row on screen. **In the close's own task**:
   * a close that nothing flies plays its exit at the hero's phase change, which follows the
   * router's popstate — by then the turn and the scroll must have landed under the overlay, or the
   * exit finds the row off screen (and fades rather than returning into it) and the list jumps
   * under the fading copy. A page the walk has read is cached, so the read below answers in a
   * microtask and the turn is committed there (`flushSync`) rather than at React's next turn.
   */
  const reveal = useCallback(
    async (id: number, targetPage: number): Promise<boolean> => {
      if (targetPage !== live.current.page) {
        const read = await readPage(targetPage).catch(() => null);
        if (!read?.ids.includes(id)) return false;
        flushSync(() => live.current.setPage(targetPage));
      }
      const row = findDetailOriginRow(id) ?? (await waitForRow(id));
      if (!row) return false;
      scrollCardIntoView(row);
      handOffFocus(id);
      return true;
    },
    [readPage],
  );

  return { readPage, reveal };
}

export interface HistorySequenceOptions extends LiveList {
  /** The page the rows on screen belong to: during a turn they are still the previous page's. */
  dataPage: number;
  /** The rows on screen, with the held deletes already taken out. */
  entries: readonly HistoryEntry[];
  totalPages: number;
  /** A page's length, so the window knows a short page is the last one. */
  pageSize: number;
}

/**
 * The list 上一张 / 下一张 walk when a picture is opened from 浏览历史 (G4-004).
 *
 * The rows are the list, so the source is the ordinary paged one (`createPagedSequence`): the
 * window starts on the page on screen and grows a page at a time as the viewer steps past an end,
 * while the list itself stays where it was until a close asks it to turn. What makes it this
 * list's rather than a grid's:
 *
 * - **The screen's order.** A page is walked as it is shown, day group by day group
 *   (`readingOrder`), so the next picture is always the row under this one.
 * - **No `preview`.** A history row carries a 56px thumbnail URL and no geometry, and
 *   `ImagePreview` is a geometry contract — a record with invented dimensions would lay the next
 *   picture's media box out wrong. So a step reads the picture's own record (the row's intent
 *   ladder and `useDetailStep`'s neighbour warm have usually already fetched it).
 * - **A row is the card.** `reveal` turns the page through the screen's own state and waits for
 *   `[data-detail-origin]` rather than a gallery thumbnail; the close then grows the overlay back
 *   into that row (`lib/detailTransit.ts`), or fades when it is not on screen.
 * - **A held delete is not in the list.** The rows on screen are already filtered; a page read
 *   later is filtered the same way, so 撤销's window cannot put a removed picture into the walk.
 *
 * The walk is the list as it was when the row was pressed. Opening a picture writes a view
 * (`add_browsing_history`), which moves it to the top of the backend's list; the window keeps the
 * pages it read, so the walk stays in the order the reader saw rather than reshuffling under them.
 */
export function useHistorySequence({
  token,
  date,
  page,
  setPage,
  hidden,
  dataPage,
  entries,
  totalPages,
  pageSize,
}: HistorySequenceOptions): ImageSequenceSource | undefined {
  const { readPage, reveal } = useHistoryReaders({ token, date, page, setPage, hidden });

  const listKey = `history:${token ?? ''}:${date}`;
  const sequence = useMemo(
    () =>
      token && entries.length > 0
        ? createPagedSequence({
            key: listKey,
            page: dataPage,
            current: { ids: readingOrder(entries), totalPages },
            pageSize,
            fetchPage: readPage,
            reveal,
          })
        : undefined,
    [token, entries, dataPage, totalPages, pageSize, listKey, readPage, reveal],
  );

  /* Leaving the screen — or emptying the list — leaves no stale list behind for a picture opened
     somewhere else to inherit. Keyed, so it can never clear another screen's. */
  const hasRows = sequence !== undefined;
  useEffect(() => {
    if (!hasRows) clearImageSequence(listKey);
    return () => clearImageSequence(listKey);
  }, [listKey, hasRows]);

  return sequence;
}
