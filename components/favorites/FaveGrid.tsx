'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { MdTune } from 'react-icons/md';
import { SKIP, useResource } from '@/lib/resource';
import { favePictures, useBrowsingFingerprint } from '@/lib/resources';
import { getBrowsingSettings, readHiddenTags } from '@/lib/api/client';
import { currentBlockFilters, currentPublicBlacklist } from '@/lib/blockFilters';
import { clearImageSequence, createPagedSequence, type ImageSequenceSource } from '@/lib/imageSequence';
import { useListReveal } from '@/lib/listReveal';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { FAVE_PAGE_SIZE, withheldSentence, withholdFromDevice, type FilteredPage } from '@/lib/favorites';
import type { PonyImage } from '@/lib/types/image';
import MasonryGrid, { type GridSelection } from '@/components/MasonryGrid';
import ImageGridSkeleton from '@/components/ImageGridSkeleton';
import Pagination from '@/components/Pagination';
import ErrorRetry from '@/components/ErrorRetry';
import EmptyState from '@/components/EmptyState';
import FailedTurnHold from '@/components/FailedTurnHold';
import Button from '@/components/Button';

/** The device's content settings, now — the rules every search writes into its query (C11). */
function withholdNow(found: readonly PonyImage[], asked: readonly number[]): FilteredPage {
  return withholdFromDevice(
    found,
    asked,
    { ...getBrowsingSettings(), hiddenTags: readHiddenTags() },
    currentBlockFilters(),
    currentPublicBlacklist(),
  );
}

/**
 * The same rules as a value a component re-renders on: the browsing fingerprint moves whenever
 * any of them does (the settings writer, another tab, an administrator's blacklist).
 */
export function useDeviceRules() {
  const fp = useBrowsingFingerprint();
  return useMemo(
    () => ({
      fp,
      withhold: (found: readonly PonyImage[], asked: readonly number[]) => withholdNow(found, asked),
    }),
    [fp],
  );
}

/** The pane a list's view is drawn in (`FaveGridView` names it), for a return flight to find a card. */
function paneOf(listKey: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-fave-pane="${CSS.escape(listKey)}"]`);
}

export interface FavePageState {
  /** The pictures on screen, after the device's settings; `undefined` until the first page lands. */
  shown: FilteredPage | undefined;
  /** The list has ids but its page has not been read yet, or a first read failed. */
  error: unknown;
  isLoading: boolean;
  /** The rows on screen belong to the previous page: a turn is in flight, or it failed. */
  isPrevious: boolean;
  /**
   * A page turn is in flight: the rows on screen are another page's and its own are on their way.
   * What the grid dims for — not every read: a picture leaving the page re-reads it underneath
   * (`shiftPicturePages`), and the rows on screen are this page's all along.
   */
  turning: boolean;
  /**
   * The rows on screen are this page's stand-in and short of it: a picture left the page, and the
   * one that moves up into its place belongs to a page nobody read (`shiftPicturePages` leaves it
   * out rather than count it missing). Its re-read brings it; if that read fails, the screen must
   * say so — the page is knowingly a picture short, which no background refresh can be.
   */
  partial: boolean;
  totalPages: number;
  sequence: ImageSequenceSource | undefined;
  refresh: () => void;
  prefetchPage: (page: number) => void;
}

/**
 * One page of a favourites list — ids your own, somebody's or nobody's in particular — as
 * pictures: at most fifty ids a lookup (`favePictures`, one URL never holding a whole folder — the
 * HTTP 431 R7-002 hit), put back in the list's order and passed through the device's content
 * settings and the public blacklist, counting what was withheld and what no longer exists (C11).
 *
 * The detail's 上一张 / 下一张 walk the list in its own order (`createPagedSequence`) and a return
 * turns this list to the picture's page (`useListReveal`). A picture that leaves the list leaves
 * the page at once, before the list is read again.
 */
export function useFavePage({
  ids,
  page,
  setPage,
  listKey,
}: {
  /** The whole list's ids, newest first; `undefined` while they are being read. */
  ids: readonly number[] | undefined;
  page: number;
  setPage: (page: number) => void;
  /** Which list — owner, folder, session — so a page turn keeps its rows and another list does not. */
  listKey: string;
}): FavePageState {
  const rules = useDeviceRules();
  const totalPages = Math.max(1, Math.ceil((ids?.length ?? 0) / FAVE_PAGE_SIZE));
  const pageIds = useMemo(() => ids?.slice((page - 1) * FAVE_PAGE_SIZE, page * FAVE_PAGE_SIZE) ?? [], [ids, page]);
  const read = useResource(favePictures, pageIds.length > 0 ? { ids: pageIds } : SKIP, { keepPrevious: listKey });

  const inList = useMemo(() => new Set(ids ?? []), [ids]);
  const data = read.data;
  /* A read's own answer names every id it was asked for; only a removal's stand-in names fewer. */
  const partial = !read.isPrevious && data !== undefined && data.ids.length < pageIds.length;
  /* Read for real while it is on screen — once, and again only when asked (重试): this read brings
     the missing picture, and its failure, unlike a quiet refresh's, is the screen's to show. */
  const readShort = partial && !read.isLoading && !read.error;
  const refresh = read.refresh;
  useEffect(() => {
    if (readShort) refresh();
  }, [readShort, refresh]);
  const shown = useMemo(() => {
    if (ids !== undefined && pageIds.length === 0) return { images: [], filtered: 0, missing: 0 };
    if (!data) return undefined;
    const page = rules.withhold(data.images, data.ids);
    const images = page.images.filter((image) => inList.has(image.id));
    return images.length === page.images.length ? page : { ...page, images };
  }, [data, inList, rules, ids, pageIds]);

  /* The page the rows on screen belong to, so 上一张 / 下一张 walk the page they show. */
  const [dataPage, setDataPage] = useState(page);
  if (data !== undefined && !read.isPrevious && dataPage !== page) setDataPage(page);

  /* One page of the list, read through the list's own resource and the device's rules. */
  const pageOf = useCallback(
    async (target: number): Promise<PonyImage[]> => {
      const asked = (ids ?? []).slice((target - 1) * FAVE_PAGE_SIZE, target * FAVE_PAGE_SIZE);
      if (asked.length === 0) return [];
      const result = await favePictures.read({ ids: asked });
      return withholdNow(result.images, result.ids).images;
    },
    [ids],
  );
  const readPage = useCallback(async (target: number) => (await pageOf(target)).map((image) => image.id), [pageOf]);
  const reveal = useListReveal(readPage, page, setPage, () => paneOf(listKey));

  const shownImages = shown?.images;
  const sequence = useMemo(
    () =>
      shownImages && shownImages.length > 0
        ? createPagedSequence({
            key: listKey,
            page: dataPage,
            current: { ids: shownImages.map((image) => image.id), previews: shownImages, totalPages },
            pageSize: FAVE_PAGE_SIZE,
            fetchPage: async (target) => {
              const kept = await pageOf(target);
              return { ids: kept.map((image) => image.id), previews: kept, totalPages };
            },
            reveal,
          })
        : undefined,
    [shownImages, dataPage, totalPages, listKey, pageOf, reveal],
  );

  const prefetchPage = useCallback(
    (target: number) => {
      const asked = (ids ?? []).slice((target - 1) * FAVE_PAGE_SIZE, target * FAVE_PAGE_SIZE);
      if (asked.length > 0) favePictures.prefetch({ ids: asked });
    },
    [ids],
  );

  return {
    shown,
    error: read.error,
    isLoading: read.isLoading,
    isPrevious: read.isPrevious,
    turning: read.isPrevious && read.isLoading && dataPage !== page,
    partial,
    totalPages,
    sequence,
    refresh: read.refresh,
    prefetchPage,
  };
}

const noop = () => {};

/**
 * The same page, over pictures already in memory — the privacy space's, which arrive whole and
 * are paged here. The device's settings apply to them as to every list (C11); nothing can be
 * missing, since each is a stored record.
 */
export function useLocalFavePage({
  images,
  page,
  setPage,
  listKey,
}: {
  images: readonly PonyImage[] | null | undefined;
  page: number;
  setPage: (page: number) => void;
  listKey: string;
}): FavePageState {
  const hasImages = images != null;
  useEffect(() => {
    if (!hasImages) clearImageSequence(listKey);
    return () => clearImageSequence(listKey);
  }, [listKey, hasImages]);
  const rules = useDeviceRules();
  const totalPages = Math.max(1, Math.ceil((images?.length ?? 0) / FAVE_PAGE_SIZE));
  const shown = useMemo(() => {
    if (!images) return undefined;
    const slice = images.slice((page - 1) * FAVE_PAGE_SIZE, page * FAVE_PAGE_SIZE);
    return rules.withhold(slice, slice.map((image) => image.id));
  }, [images, page, rules]);

  const pageOf = useCallback(
    (target: number) => {
      const slice = (images ?? []).slice((target - 1) * FAVE_PAGE_SIZE, target * FAVE_PAGE_SIZE);
      return rules.withhold(slice, slice.map((image) => image.id)).images;
    },
    [images, rules],
  );
  const readPage = useCallback(async (target: number) => pageOf(target).map((image) => image.id), [pageOf]);
  const reveal = useListReveal(readPage, page, setPage, () => paneOf(listKey));

  const shownImages = shown?.images;
  const sequence = useMemo(
    () =>
      shownImages && shownImages.length > 0
        ? createPagedSequence({
            key: listKey,
            page,
            current: { ids: shownImages.map((image) => image.id), previews: shownImages, totalPages },
            pageSize: FAVE_PAGE_SIZE,
            fetchPage: async (target) => {
              const kept = pageOf(target);
              return { ids: kept.map((image) => image.id), previews: kept, totalPages };
            },
            reveal,
          })
        : undefined,
    [shownImages, page, totalPages, listKey, pageOf, reveal],
  );

  return {
    shown,
    error: null,
    isLoading: false,
    isPrevious: false,
    turning: false,
    partial: false,
    totalPages,
    sequence,
    refresh: noop,
    prefetchPage: noop,
  };
}

/** 本页有 3 张收藏因当前的内容筛选设置未显示 · 前往设置 — nothing disappears silently (C11). */
export function WithheldNotice({ filtered, missing }: { filtered: number; missing: number }) {
  const router = useRouter();
  if (filtered === 0 && missing === 0) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-body-s text-on-surface-variant">
      <span>{withheldSentence(filtered, missing)}</span>
      {filtered > 0 && (
        <Button variant="text" size="xs" icon={<MdTune />} onClick={() => router.push('/settings', { scroll: false })}>
          前往设置
        </Button>
      )}
    </div>
  );
}

/**
 * The page on screen: the withheld count, a failed read's inline error, the grid — the gallery's
 * own, its selection mode included — and the pager. The caller draws its own empty states (they
 * speak about whose list it is) and passes them as `empty`; a page whose every picture was withheld
 * says so instead.
 */
export function FaveGridView({
  state,
  page,
  setPage,
  listKey,
  selection,
  empty,
  failureTitle,
  entrance = true,
  footer,
}: {
  state: FavePageState;
  page: number;
  setPage: (page: number) => void;
  listKey: string;
  selection?: GridSelection;
  /** What an empty list shows. */
  empty: ReactNode;
  failureTitle: string;
  /** A swapping tab pane owns its entrance. */
  entrance?: boolean;
  /** Under the pager: the room a selection bar needs, for one. */
  footer?: ReactNode;
}) {
  const fp = useBrowsingFingerprint();
  const [rows, setRows] = useState<HTMLDivElement | null>(null);
  const failureRef = useRef<HTMLDivElement>(null);
  const { shown, error, isLoading, isPrevious, turning, partial, totalPages, sequence } = state;

  if (shown === undefined) {
    if (error) {
      return (
        <ErrorRetry
          size="pane"
          title={failureTitle}
          message={apiErrorMessage(error)}
          onRetry={isRetryable(error) ? state.refresh : undefined}
        />
      );
    }
    return <ImageGridSkeleton count={FAVE_PAGE_SIZE} entrance={entrance} />;
  }

  /* A failed read the screen owes an answer for: a turn whose rows are still another page's, or a
     removal's re-read of a page left a picture short (M1-001 drew it from memory at once). A
     background refresh of a whole page that fails keeps what it shows, and says nothing. */
  const failed = (isPrevious || partial) && Boolean(error);
  const nothingShown = shown.images.length === 0 && !isPrevious;
  return (
    <div data-fave-pane={listKey} aria-busy={isLoading || undefined}>
      <WithheldNotice filtered={shown.filtered} missing={shown.missing} />
      {failed && (
        <div ref={failureRef} className="mb-4">
          <ErrorRetry
            size="inline"
            title={`第 ${page} 页加载失败`}
            message={apiErrorMessage(error)}
            onRetry={isRetryable(error) ? state.refresh : undefined}
          />
        </div>
      )}
      {nothingShown ? (
        shown.filtered > 0 || shown.missing > 0 ? (
          <EmptyState size="pane" title="本页没有可显示的图片" />
        ) : (
          empty
        )
      ) : (
        <div
          ref={setRows}
          /* The paging dim, for a turn only (M1-001): dimmed on every read, a removal blinked
             the whole grid while it re-read the page underneath the rows it already showed. */
          className={`transition-opacity duration-standard ease-[var(--ease-standard)] ${
            turning ? 'pointer-events-none opacity-50' : 'opacity-100'
          }`}
        >
          <MasonryGrid
            images={shown.images}
            entrance={entrance}
            sequence={sequence}
            listKey={`${listKey}:${fp}`}
            selection={selection}
          />
        </div>
      )}
      {totalPages > 1 && (
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          onPageChange={setPage}
          onPrefetchPage={state.prefetchPage}
          disabled={turning}
          className="mt-8 mb-4"
        />
      )}
      <FailedTurnHold failed={failed} rows={rows} failure={failureRef} />
      {footer}
    </div>
  );
}
