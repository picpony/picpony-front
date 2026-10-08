'use client';

/**
 * The list a picture was opened from, so 上一张 / 下一张 step in **that list's order** — home,
 * search, a profile tab, favourites — rather than in the order pictures happened to be pressed.
 *
 * The contract has two sides and they never import each other:
 *
 * - **A list** builds a source (`createPagedSequence` for anything paged) and hands it to
 *   `MasonryGrid` as `sequence`; the card calls `openFromSequence` as it is activated, before
 *   the hero launches. A list that hands over nothing leaves the detail with no neighbours,
 *   which hides the pair rather than offering buttons that go nowhere.
 * - **The detail** reads `useImageNeighbours(id)`, steps with `stepImageSequence`, and before a
 *   return flight asks `revealInImageSequence(id)` for a card to land on.
 *
 * The store holds one source: opening a picture from a list replaces whatever was open before,
 * and a picture opened from nowhere (a link, a cold load of `/pic/…`) clears it.
 */

import { useSyncExternalStore } from 'react';
import type { ImagePreview } from '@/lib/types/image';

export interface ImageSequenceSource {
  /**
   * Identity of the list instance: route, query, owner, sort, filter fingerprint. A list memoises
   * its source on this (and its page), so opening a second card from it keeps the pages the
   * detail already loaded instead of starting a new window.
   */
  readonly key: string;
  /** Every loaded id in the list's reading order, contiguous across the loaded pages. */
  ids(): readonly number[];
  /** A preview record the list already holds, so a step can paint before the detail read lands. */
  preview?(id: number): ImagePreview | undefined;
  /** Loads the page after the window; resolves with the ids it added (`[]` at the end of the list). */
  loadNext?(): Promise<readonly number[]>;
  /** Loads the page before the window (a list shown from its third page); `[]` at the start. */
  loadPrevious?(): Promise<readonly number[]>;
  /** Whether a page exists past either end of the window, so the ends can say 已是最后一张 honestly. */
  hasNext?(): boolean;
  hasPrevious?(): boolean;
  /**
   * Brings `id`'s card into the list and into view — turning the list's page with its own
   * page-turn semantics (C1: never a new history entry) — and resolves `true` once the card is
   * in the DOM, `false` if it cannot be shown. May be called while the list is the background of
   * the detail overlay.
   */
  reveal?(id: number): Promise<boolean>;
  /** Called with a listener that must run whenever `ids()` changes. */
  subscribe?(listener: () => void): () => void;
}

export interface ImageNeighbours {
  /** The ids either side of the picture, or `null` where the window ends. */
  previous: number | null;
  next: number | null;
  /** Whether stepping past an end can still load something (a page exists beyond the window). */
  canLoadPrevious: boolean;
  canLoadNext: boolean;
  /** `true` when the picture belongs to the active list at all; `false` hides the pair. */
  inSequence: boolean;
}

interface Snapshot {
  source: ImageSequenceSource | null;
  /** Bumped on every change, so `useSyncExternalStore` sees a new identity. */
  version: number;
}

let snapshot: Snapshot = { source: null, version: 0 };
let unsubscribeSource: (() => void) | null = null;
const listeners = new Set<() => void>();
const SERVER_SNAPSHOT: Snapshot = { source: null, version: 0 };

function publish(source: ImageSequenceSource | null) {
  snapshot = { source, version: snapshot.version + 1 };
  for (const listener of listeners) listener();
}

/** A list's card was activated: this list is now the one 上一张 / 下一张 walk through. */
export function openFromSequence(source: ImageSequenceSource) {
  if (snapshot.source === source) return;
  unsubscribeSource?.();
  unsubscribeSource = source.subscribe?.(() => {
    if (snapshot.source === source) publish(source);
  }) ?? null;
  publish(source);
}

/** Forgets the active list — every list, or only the one with this key. */
export function clearImageSequence(key?: string) {
  if (!snapshot.source || (key !== undefined && snapshot.source.key !== key)) return;
  unsubscribeSource?.();
  unsubscribeSource = null;
  publish(null);
}

export function activeImageSequence(): ImageSequenceSource | null {
  return snapshot.source;
}

export function subscribeImageSequence(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function imageNeighbours(id: number, source = snapshot.source): ImageNeighbours {
  const ids = source?.ids() ?? [];
  const index = ids.indexOf(id);
  if (!source || index === -1) {
    return { previous: null, next: null, canLoadPrevious: false, canLoadNext: false, inSequence: false };
  }
  return {
    previous: index > 0 ? ids[index - 1] : null,
    next: index < ids.length - 1 ? ids[index + 1] : null,
    canLoadPrevious: index === 0 && Boolean(source.loadPrevious) && (source.hasPrevious?.() ?? false),
    canLoadNext: index === ids.length - 1 && Boolean(source.loadNext) && (source.hasNext?.() ?? false),
    inSequence: true,
  };
}

export function useImageNeighbours(id: number): ImageNeighbours {
  const current = useSyncExternalStore(subscribeImageSequence, () => snapshot, () => SERVER_SNAPSHOT);
  return imageNeighbours(id, current.source);
}

/**
 * The id one step away from `id`, loading the next (or previous) page when the step crosses the
 * end of the window. Resolves `null` when there is nothing there — the caller says 已是最后一张
 * / 已是第一张.
 */
export async function stepImageSequence(id: number, direction: 1 | -1): Promise<number | null> {
  const source = snapshot.source;
  if (!source) return null;
  const before = imageNeighbours(id, source);
  if (!before.inSequence) return null;
  const adjacent = direction === 1 ? before.next : before.previous;
  if (adjacent !== null) return adjacent;
  const load = direction === 1 ? source.loadNext : source.loadPrevious;
  if (!load || !(direction === 1 ? before.canLoadNext : before.canLoadPrevious)) return null;
  await load.call(source);
  if (snapshot.source !== source) return null;
  const after = imageNeighbours(id, source);
  return direction === 1 ? after.next : after.previous;
}

/** Asks the active list to show `id`'s card, for a return flight to land on. */
export async function revealInImageSequence(id: number): Promise<boolean> {
  const source = snapshot.source;
  if (!source?.reveal || !source.ids().includes(id)) return false;
  return source.reveal(id);
}

export interface SequencePage {
  ids: readonly number[];
  /** Preview records for the page's pictures, where the list has them. */
  previews?: readonly ImagePreview[];
  /** Total pages when the list knows it; `null` or absent means a short page is the last. */
  totalPages?: number | null;
}

export interface PagedSequenceOptions {
  key: string;
  /** The page the list is showing, and what it holds. */
  page: number;
  current: SequencePage;
  /** A full page's length: without `totalPages`, a shorter page is the last one. */
  pageSize: number;
  /** Reads one page through the list's own resource, so it shares the list's cache and slots. */
  fetchPage(page: number): Promise<SequencePage>;
  /**
   * Turns the list to `page` (its own page-turn semantics — C1, no new history entry) and brings
   * `id`'s card into view; resolves `true` once the card is in the DOM.
   */
  reveal?(id: number, page: number): Promise<boolean>;
}

/**
 * A source over a paged list. It starts with the page on screen and grows a contiguous window of
 * pages in either direction as the detail steps past an end; the list itself stays on its page
 * until `reveal` asks it to turn.
 */
export function createPagedSequence(options: PagedSequenceOptions): ImageSequenceSource {
  const { reveal } = options;
  const pages = new Map<number, readonly number[]>([[options.page, options.current.ids]]);
  const previews = new Map<number, ImagePreview>();
  const inflight = new Map<number, Promise<readonly number[]>>();
  const sourceListeners = new Set<() => void>();
  let first = options.page;
  let last = options.page;
  let totalPages = options.current.totalPages ?? null;
  let exhausted = options.current.ids.length < options.pageSize;
  let flat: readonly number[] = options.current.ids;

  const remember = (page: SequencePage) => {
    for (const item of page.previews ?? []) previews.set(item.id, item);
    if (page.totalPages != null) totalPages = page.totalPages;
  };
  remember(options.current);

  const rebuild = () => {
    const ids: number[] = [];
    const seen = new Set<number>();
    for (let page = first; page <= last; page += 1) {
      /* A feed that moved between two reads repeats a picture across a page seam; stepping must
         not visit it twice. */
      for (const id of pages.get(page) ?? []) {
        if (!seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      }
    }
    flat = ids;
    for (const listener of sourceListeners) listener();
  };

  const hasNext = () => (totalPages != null ? last < totalPages : !exhausted);
  const hasPrevious = () => first > 1;

  const load = (page: number): Promise<readonly number[]> => {
    const pending = inflight.get(page);
    if (pending) return pending;
    const request = options
      .fetchPage(page)
      .then((result) => {
        remember(result);
        pages.set(page, result.ids);
        if (page === last + 1) {
          last = page;
          if (result.ids.length < options.pageSize) exhausted = true;
        } else if (page === first - 1) {
          first = page;
        }
        rebuild();
        return result.ids;
      })
      .finally(() => {
        inflight.delete(page);
      });
    inflight.set(page, request);
    return request;
  };

  const pageOf = (id: number) => {
    for (let page = first; page <= last; page += 1) {
      if (pages.get(page)?.includes(id)) return page;
    }
    return null;
  };

  return {
    key: options.key,
    ids: () => flat,
    preview: (id) => previews.get(id),
    hasNext,
    hasPrevious,
    loadNext: () => (hasNext() ? load(last + 1) : Promise.resolve([])),
    loadPrevious: () => (hasPrevious() ? load(first - 1) : Promise.resolve([])),
    reveal: reveal
      ? (id) => {
          const page = pageOf(id);
          return page === null ? Promise.resolve(false) : reveal(id, page);
        }
      : undefined,
    subscribe(listener) {
      sourceListeners.add(listener);
      return () => {
        sourceListeners.delete(listener);
      };
    },
  };
}
