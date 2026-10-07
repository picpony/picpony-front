'use client';

import {
  Component,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { MdTune } from 'react-icons/md';
import { usePathname, useRouter } from 'next/navigation';
import { getBrowsingSettings } from '@/lib/api';
import { SKIP, useResource } from '@/lib/resource';
import { DEFAULT_BROWSING_FINGERPRINT } from '@/lib/searchQuery';
import { searchPage } from '@/lib/searchState';
import {
  browsingFingerprint,
  discussedImages,
  homeFeed,
  syncBrowsingCookie,
  useBrowsingFingerprint,
} from '@/lib/resources';
import type { FeaturedSeed, FeedSeed } from '@/lib/feed.server';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { createPagedSequence, type SequencePage } from '@/lib/imageSequence';
import { scrollCardIntoView, waitForCard } from '@/lib/masonry';
import { runWhenIdle } from '@/lib/utils';
import { getAppScroller, heroOwnsScreen } from '@/lib/appScroller';
import { useMounted } from '@/lib/overlay';
import { useDeferredLoading } from '@/lib/hooks';
import { useIntentPrefetch } from '@/lib/useIntentPrefetch';
import type { PonyImage } from '@/lib/types/image';
import FeaturedBanner, { FeaturedBannerSkeleton } from '@/components/FeaturedBanner';
import MasonryGrid from '@/components/MasonryGrid';
import ImageGridSkeleton from '@/components/ImageGridSkeleton';
import Pagination from '@/components/Pagination';
import ErrorRetry from '@/components/ErrorRetry';
import EmptyState from '@/components/EmptyState';
import ForumPane, { type ForumSeed } from '@/components/forum/ForumPane';
import { useBackgroundSearchParams } from '@/components/BackgroundLocation';
import TabPanes, { TabPane, tabId } from '@/components/TabPanes';
import Tabs from '@/components/Tabs';
import Button from '@/components/Button';

type HomeTab = 'gallery' | 'forum';

/* ---------------------------------------------------------------------------
 * The gallery's two views and its page, in the URL
 * ------------------------------------------------------------------------ */

/** 全部 (the feed) and 本站讨论 (pictures PicPony users have discussed, decision 15). */
type GalleryView = 'home-feed' | 'home-discussed';

/** Derpibooru's page size for the feed (`lib/api/derpi.ts` asks for 50). */
const FEED_PAGE_SIZE = 50;

const VIEW_TABS = [
  { value: 'home-feed' as const, label: '全部' },
  { value: 'home-discussed' as const, label: '本站讨论' },
];

interface GalleryNav {
  view: GalleryView;
  pages: Record<GalleryView, number>;
  /** `view:page` of the address we last wrote or adopted. */
  url: string;
  /** `view:page` of the address as this component last saw it. */
  seen: string;
}

/**
 * Replaces the current entry's address with this view and page, keeping every other parameter
 * (`?tab=`). A replace, never a push (C1, decision 18): a page turn or a view switch is not a
 * place Back should step through.
 *
 * The state object is the entry's own minus Next's two markers — passed through, those tell
 * Next's patched `replaceState` the write is its own and it skips updating `useSearchParams`;
 * dropped, Next copies its tree back in and the entry keeps any marker another layer put there.
 */
function replaceHomeUrl(view: GalleryView, page: number) {
  const params = new URLSearchParams(window.location.search);
  if (view === 'home-discussed') params.set('view', 'discussed');
  else params.delete('view');
  if (page > 1) params.set('page', String(page));
  else params.delete('page');
  const own: Record<string, unknown> = {};
  const state = window.history.state as Record<string, unknown> | null;
  for (const [key, value] of Object.entries(state ?? {})) {
    if (key !== '__NA' && key !== '_N' && key !== '__PRIVATE_NEXTJS_INTERNALS_TREE') own[key] = value;
  }
  const query = params.toString();
  window.history.replaceState(own, '', query ? `/?${query}` : '/');
}

/**
 * The view and page on screen, reconciled with the address.
 *
 * **The address is read, and written back, but it is not the only source.** A picture opened
 * from the gallery is a history entry over it, and 上一张 / 下一张 past the end of the page turn
 * the gallery underneath (`reveal`) while the address is the picture's. So the gallery keeps
 * its own state; an address it did not write — a Back/Forward traversal, a link — is adopted
 * (the edge, not the level: the address is compared with the one last seen, so a background
 * turn is not undone when the frozen address becomes the live one again); and whatever the
 * gallery shows is written back once the gallery's own entry is current, a task later —
 * never in the task of a history traversal (R10-001).
 */
function useGalleryNav() {
  const searchParams = useBackgroundSearchParams();
  const urlView: GalleryView = searchParams.get('view') === 'discussed' ? 'home-discussed' : 'home-feed';
  const urlPage = searchPage(searchParams.get('page'));
  const urlKey = `${urlView}:${urlPage}`;
  const ownEntry = usePathname() === '/';

  const [nav, setNav] = useState<GalleryNav>(() => ({
    view: urlView,
    pages: { 'home-feed': 1, 'home-discussed': 1, [urlView]: urlPage },
    url: urlKey,
    seen: urlKey,
  }));
  if (urlKey !== nav.seen) {
    setNav(
      urlKey === nav.url
        ? { ...nav, seen: urlKey }
        : { view: urlView, pages: { ...nav.pages, [urlView]: urlPage }, url: urlKey, seen: urlKey },
    );
  }

  const view = nav.view;
  const page = nav.pages[view];
  const desired = `${view}:${page}`;
  useEffect(() => {
    if (!ownEntry || desired === nav.url) return;
    const timer = window.setTimeout(() => {
      if (window.location.pathname !== '/') return;
      setNav((current) => ({ ...current, url: desired }));
      replaceHomeUrl(view, page);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [ownEntry, desired, nav.url, view, page]);

  const setView = useCallback((next: GalleryView) => setNav((current) => ({ ...current, view: next })), []);
  const setFeedPage = useCallback(
    (next: number) => setNav((current) => ({ ...current, pages: { ...current.pages, 'home-feed': next } })),
    [],
  );
  const setDiscussedPage = useCallback(
    (next: number) => setNav((current) => ({ ...current, pages: { ...current.pages, 'home-discussed': next } })),
    [],
  );
  return { view, pages: nav.pages, setView, setFeedPage, setDiscussedPage };
}

/* ---------------------------------------------------------------------------
 * One paged list of pictures: every state it can be in
 * ------------------------------------------------------------------------ */

interface ListRead<T> {
  data: T | undefined;
  error: unknown;
  isLoading: boolean;
  isPrevious: boolean;
  refresh: () => void;
}

/**
 * Loading, failed, empty, a failed page turn, and a landed page — shared by the two views.
 *
 * **The placeholder**: a first paint that has nothing (no seed, or a seed that did not apply)
 * shows the grid skeleton at once — the server renders it too, so the first byte is the page's
 * geometry rather than a blank column with the footer under it (R4-021). A load the client
 * starts later waits the usual moment before its skeleton, so a warm answer never flashes one.
 *
 * **A page lands in the background.** The rows are rendered from a deferred copy of the read:
 * the store's synchronous publish re-renders only this cheap shell, and the fifty cards render
 * in an interruptible pass (R12-010). Until that pass commits the list stays dimmed, as it is
 * while the page is being fetched.
 */
function PagedImages<T>({
  listKey,
  read,
  images: pick,
  page,
  onPageChange,
  hasMore,
  totalPages,
  onPrefetchPage,
  sequenceFor,
  siteComments,
  notice,
  empty,
  failureTitle,
  onRetry,
}: {
  /** Which list this is (view, sort, fingerprint): pages of one list share it. */
  listKey: string;
  read: ListRead<T>;
  images: (data: T) => PonyImage[];
  page: number;
  onPageChange: (page: number) => void;
  hasMore?: (data: T) => boolean;
  totalPages?: (data: T) => number;
  onPrefetchPage: (page: number) => void;
  sequenceFor: (images: PonyImage[], dataPage: number, anchor: () => HTMLElement | null) => ReturnType<typeof createPagedSequence>;
  siteComments?: (data: T) => Record<number, number> | undefined;
  notice?: (data: T) => React.ReactNode;
  empty: (data: T) => React.ReactNode;
  failureTitle: string;
  onRetry: () => void;
}) {
  /* The list's element as state rather than a ref: `reveal` looks its cards up in it, and the
     sequence that carries `reveal` is built during render. */
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const mounted = useMounted();

  /* The page the rows on screen belong to: `read.data` is the previous page's while a turn is
     in flight or has failed (`isPrevious`), and 上一张 / 下一张 must know which page they walk. */
  const [dataPage, setDataPage] = useState(page);
  if (read.data !== undefined && !read.isPrevious && dataPage !== page) setDataPage(page);
  /* **Only a page of the same list is deferred.** Another list — a settings change, a cached
     fingerprint come back — renders at once: deferred, the previous fingerprint's rows stayed
     on screen for a render, which is exactly what retention scoped to the fingerprint forbids
     (the rows the user just asked not to see), and the grid then took the new list for a page
     turn and mounted it a chunk at a time. */
  const latest = useMemo(() => ({ data: read.data, page: dataPage, key: listKey }), [read.data, dataPage, listKey]);
  const deferred = useDeferredValue(latest);
  const shown = deferred.key === latest.key ? deferred : latest;
  const data = shown.data;
  const shownPage = shown.page;
  /* A landed page still rendering in the background. Keyed on the page, not on the object: a
     refresh of the page on screen is a new object with the same rows, and must not flash the dim. */
  const settling = shownPage !== dataPage;

  const noData = data === undefined && !read.error;
  const [firstPaint, setFirstPaint] = useState(() => !mounted && noData);
  if (firstPaint && !noData) setFirstPaint(false);
  const deferredSkeleton = useDeferredLoading(noData);

  const images = useMemo(() => (data === undefined ? [] : pick(data)), [data, pick]);
  const sequence = useMemo(
    () => sequenceFor(images, shownPage, () => anchor),
    [sequenceFor, images, shownPage, anchor],
  );

  /* A failed turn's message goes in above the rows: `FailedTurnHold` (below) keeps it in view
     at the list's top and keeps the rows still under a viewer inside the grid. */
  const failedTurn = read.isPrevious && Boolean(read.error);
  const failureRef = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<HTMLDivElement | null>(null);

  if (data === undefined) {
    if (read.error) {
      return (
        <ErrorRetry
          /* `pane`, not the default `page`: this renders inside a `TabPane` under the home
             route's floating tab pill, so a half-viewport block pushes the pill off a phone
             screen. */
          size="pane"
          title={failureTitle}
          message={apiErrorMessage(read.error)}
          onRetry={isRetryable(read.error) ? onRetry : undefined}
        />
      );
    }
    /* **The placeholder is laid out at once and shown a moment later.** A list with nothing yet
       still has the length of what it is about to show. At zero length for the deferral's 180ms
       the page shrank under the viewer, and a switch to a view still loading (本站讨论) measured
       the arriving pane at 0px, so the tab machinery clamped the page to that length and pulled
       it up — from 411 to 51 at 1440, to the very top on a phone. Hidden until the moment passes,
       so a warm answer still never flashes a skeleton; its fade starts when it is shown. */
    const visible = firstPaint || deferredSkeleton;
    return (
      <div className={visible ? undefined : 'invisible'}>
        <ImageGridSkeleton entrance={visible} />
      </div>
    );
  }

  const isEmpty = images.length === 0 && !read.isPrevious;
  if (isEmpty && page === 1 && (totalPages?.(data) ?? 1) <= 1 && !hasMore?.(data)) return <>{empty(data)}</>;

  const busy = read.isLoading || settling;
  return (
    /* Scroll target for <Pagination>: a page turn lands here, at the first row of
       results, rather than back above the featured banner. */
    <div ref={setAnchor} data-pagination-anchor aria-busy={busy || undefined}>
      {failedTurn && (
        /* The turn failed and the rows below are the page before it: say so, rather than leave
           the pager reading the new number over the old pictures. */
        <div ref={failureRef} className="mb-4">
          <ErrorRetry
            size="inline"
            title={`第 ${page} 页加载失败`}
            message={apiErrorMessage(read.error)}
            onRetry={isRetryable(read.error) ? onRetry : undefined}
          />
        </div>
      )}
      {notice?.(data)}
      <div
        ref={setRows}
        className={`transition-opacity duration-standard ease-[var(--ease-standard)] ${
          busy ? 'pointer-events-none opacity-50' : 'opacity-100'
        }`}
      >
        {/* No entrance of its own: both lists live in swapping panes (全部 / 本站讨论), and a grid
            that mounts while its pane slides in — 本站讨论 warmed on intent does — would cascade
            its cards on a second clock under the pane's own. */}
        {isEmpty ? empty(data) : <MasonryGrid images={images} sequence={sequence} siteComments={siteComments?.(data)} entrance={false} />}
      </div>
      <Pagination
        currentPage={page}
        hasMore={hasMore?.(data)}
        totalPages={totalPages?.(data)}
        onPageChange={onPageChange}
        /* Warmed when a pointer or the keyboard rests on a page control, so the commonest
           navigation in a gallery stops being the one with no head start. Never
           speculatively — see `Pagination`. */
        onPrefetchPage={onPrefetchPage}
        disabled={read.isLoading}
      />
      <FailedTurnHold failed={failedTurn} rows={rows} failure={failureRef} />
    </div>
  );
}

/**
 * **A failed turn's message must be seen, and must not move what is under the viewer.** It is
 * inserted above the rows, and what that does depends on where the viewer is.
 *
 * At the list's top — where the pager's glide lands — scroll anchoring holds the rows still and
 * so puts the message out of sight above them (measured: 138px above the scrollport, the pager
 * reading 2 over page 1 with nothing on screen saying why). There the message is what to see:
 * step back to it.
 *
 * Inside the grid, anchoring holds nothing — the cards are absolutely placed, and once the grid's
 * top has scrolled away the browser finds no anchor in it — so the insertion pushed every card
 * under the viewer down by its height. There the rows are what to keep: scroll by however far
 * they moved, which is zero wherever the browser did anchor.
 *
 * A class for `getSnapshotBeforeUpdate`, the one phase that runs before React inserts the
 * message: the rows are measured there once, and again in `componentDidUpdate`, where reading
 * layout has applied any anchoring adjustment — so the correction is exact and lands before the
 * frame is painted. It used to record the scroller's offset on every scroll event of a turn
 * instead, and each of those reads forced a style and layout pass in the middle of the pager's
 * glide (R12-010).
 */
class FailedTurnHold extends Component<{
  failed: boolean;
  rows: HTMLElement | null;
  failure: React.RefObject<HTMLDivElement | null>;
}> {
  getSnapshotBeforeUpdate(previous: { failed: boolean }): { before: number; view: DOMRect } | null {
    const { failed, rows } = this.props;
    if (previous.failed || !failed || !rows || heroOwnsScreen()) return null;
    const scroller = rows.closest<HTMLElement>('[data-app-scroll-container]') ?? getAppScroller();
    if (!scroller) return null;
    const view = scroller.getBoundingClientRect();
    return { before: rows.getBoundingClientRect().top - view.top, view };
  }

  componentDidUpdate(
    _previous: unknown,
    _state: unknown,
    snapshot: { before: number; view: DOMRect } | null,
  ) {
    const rows = this.props.rows;
    const failure = this.props.failure.current;
    if (!snapshot || !rows || !failure) return;
    const scroller = rows.closest<HTMLElement>('[data-app-scroll-container]') ?? getAppScroller();
    if (!scroller) return;
    const view = scroller.getBoundingClientRect();
    const { before } = snapshot;
    if (before > -24 && before < view.height) {
      /* The list's top was on screen: show the message, 8px under the edge like the glide. */
      const top = failure.getBoundingClientRect().top - view.top;
      if (top < 0) scroller.scrollTop -= 8 - top;
      return;
    }
    if (before > 0) return;
    const moved = rows.getBoundingClientRect().top - view.top - before;
    if (Math.abs(moved) > 1) scroller.scrollTop += moved;
  }

  render() {
    return null;
  }
}

/**
 * A list's `reveal` (`lib/imageSequence.ts`): turn to the card's page through the list's own
 * page-turn path, wait for the card to mount, and put it on screen.
 */
function useReveal(
  read: (page: number) => Promise<{ images: PonyImage[] }>,
  page: number,
  onPageChange: (page: number) => void,
) {
  const live = useRef({ page, read, onPageChange });
  useLayoutEffect(() => {
    live.current = { page, read, onPageChange };
  });
  return useCallback(async (id: number, targetPage: number, anchor: () => HTMLElement | null) => {
    const current = live.current;
    if (targetPage !== current.page) {
      const result = await current.read(targetPage).catch(() => null);
      if (!result?.images.some((image) => image.id === id)) return false;
      current.onPageChange(targetPage);
    }
    const card = await waitForCard(anchor, id);
    if (!card) return false;
    scrollCardIntoView(card);
    return true;
  }, []);
}

/* ---------------------------------------------------------------------------
 * 全部 — the feed
 * ------------------------------------------------------------------------ */

const feedImages = (data: { images: PonyImage[] }) => data.images;

function FeedList({
  seed,
  page,
  onPageChange,
  enabled,
  onRetry,
}: {
  seed: FeedSeed | null;
  page: number;
  onPageChange: (page: number) => void;
  enabled: boolean;
  /** Also re-requests the 近日推荐 banner: the feed's 重试 is the one pressed when Derpibooru
   *  was unreachable, and a retry that brought back only the grid left the banner's failure
   *  plate standing above it. */
  onRetry: () => void;
}) {
  /* First render uses exactly what the server used, so hydration matches the HTML — the
     whole reason these are `useState` seeded from the prop rather than direct
     `localStorage` reads. After mount the device's own settings take over.

     Agreement (the overwhelming case) means the seed applies and no request is sent.
     Disagreement means the key changes after mount and one request goes out. The server's
     rows are not held over it — they were filtered for other settings, and retention below
     is scoped to the fingerprint — and `syncBrowsingCookie` heals it for next time. */
  /* `DEFAULT_BROWSING_FINGERPRINT`, not `''`: a missing seed (server read timed out) left
     the first key on an fp no browser can compute — `browsingFingerprint()` always returns
     five `|`-joined fields — so the effect below always changed the key and `/` sent its
     content request twice. The default is what a device with no stored settings produces. */
  const [fp, setFp] = useState(seed?.fp ?? DEFAULT_BROWSING_FINGERPRINT);
  const [sort, setSort] = useState(seed?.sort ?? 'created_at');
  const [preferencesReady, setPreferencesReady] = useState(false);
  const lastPreferences = useRef<{ fp: string; sort: string } | null>(null);
  useEffect(() => {
    let active = true;
    const update = () => {
      if (!active) return;
      const ownFp = browsingFingerprint();
      const ownSort = getBrowsingSettings().homeSort;
      const previous = lastPreferences.current;
      /* A settings change is a different list: it starts at its first page. */
      if (previous && (previous.fp !== ownFp || previous.sort !== ownSort)) onPageChange(1);
      lastPreferences.current = { fp: ownFp, sort: ownSort };
      syncBrowsingCookie();
      setFp(ownFp);
      setSort(ownSort);
      setPreferencesReady(true);
    };
    queueMicrotask(update);
    window.addEventListener('settings_updated', update);
    window.addEventListener('storage', update);
    return () => {
      active = false;
      window.removeEventListener('settings_updated', update);
      window.removeEventListener('storage', update);
    };
  }, [onPageChange]);

  /* `keepPrevious`: turning a page must not unmount the grid — the scroller collapses,
     the browser clamps `scrollTop`, and the page snaps to the very top.
     Retention is scoped to the fingerprint: a page turn keeps its rows, but a hidden-tag or
     filter change must never keep the previous answer on screen — those rows are exactly
     what the user just asked not to see. The seed carries its own key, so it applies only
     to the page it was read for. */
  const read = useResource(
    homeFeed,
    enabled && (seed || preferencesReady) ? { page, sort, fp } : SKIP,
    { keepPrevious: fp, initial: seed ?? undefined },
  );

  const readPage = useCallback((target: number) => homeFeed.read({ page: target, sort, fp }), [sort, fp]);
  const reveal = useReveal(readPage, page, onPageChange);
  const sequenceFor = useCallback(
    (images: PonyImage[], dataPage: number, anchor: () => HTMLElement | null) =>
      createPagedSequence({
        key: `home:${sort}:${fp}`,
        page: dataPage,
        current: { ids: images.map((image) => image.id), previews: images },
        pageSize: FEED_PAGE_SIZE,
        fetchPage: async (target): Promise<SequencePage> => {
          const result = await readPage(target);
          return {
            ids: result.images.map((image) => image.id),
            previews: result.images,
            totalPages: result.total > 0 ? Math.ceil(result.total / FEED_PAGE_SIZE) : null,
          };
        },
        reveal: (id, target) => reveal(id, target, anchor),
      }),
    [sort, fp, readPage, reveal],
  );

  const router = useRouter();
  return (
    <PagedImages
      listKey={`home:${sort}:${fp}`}
      read={read}
      images={feedImages}
      page={page}
      onPageChange={onPageChange}
      /* `total`, not "a full page means more": a feed whose last page is exactly full offered a
         next page that was empty. */
      hasMore={(data) => (data.total > 0 ? page * FEED_PAGE_SIZE < data.total : data.images.length === FEED_PAGE_SIZE)}
      onPrefetchPage={(next) => homeFeed.prefetch({ page: next, sort, fp })}
      sequenceFor={sequenceFor}
      failureTitle="图片加载失败"
      onRetry={() => {
        read.refresh();
        onRetry();
      }}
      empty={() =>
        page > 1 ? (
          <EmptyState
            size="pane"
            title="这一页没有图片"
            action={<Button variant="tonal" onClick={() => onPageChange(1)}>回到第一页</Button>}
          />
        ) : (
          <EmptyState
            size="pane"
            title="暂无图片"
            description="当前的内容筛选设置下没有可显示的图片"
            action={
              <Button variant="tonal" icon={<MdTune />} onClick={() => router.push('/settings', { scroll: false })}>
                前往设置
              </Button>
            }
          />
        )
      }
    />
  );
}

/* ---------------------------------------------------------------------------
 * 本站讨论 — pictures PicPony users have discussed
 * ------------------------------------------------------------------------ */

const discussedImagesOf = (data: { images: PonyImage[] }) => data.images;

/** 本页有 3 张图片因当前的内容筛选设置未显示，2 张已被删除或无法访问 */
function withheldSentence(filtered: number, missing: number): string {
  if (filtered > 0 && missing > 0) {
    return `本页有 ${filtered} 张图片因当前的内容筛选设置未显示，${missing} 张已被删除或无法访问`;
  }
  if (filtered > 0) return `本页有 ${filtered} 张图片因当前的内容筛选设置未显示`;
  return `本页有 ${missing} 张图片已被删除或无法访问`;
}

function DiscussedList({
  page,
  onPageChange,
  enabled,
}: {
  page: number;
  onPageChange: (page: number) => void;
  enabled: boolean;
}) {
  const router = useRouter();
  /* No server seed for this view, so the read waits for the device's own fingerprint rather
     than starting on the server's default during hydration and being superseded a frame later. */
  const mounted = useMounted();
  const fp = useBrowsingFingerprint();
  const read = useResource(discussedImages, enabled && mounted ? { page, fp } : SKIP, { keepPrevious: fp });

  const readPage = useCallback((target: number) => discussedImages.read({ page: target, fp }), [fp]);
  const reveal = useReveal(readPage, page, onPageChange);
  const sequenceFor = useCallback(
    (images: PonyImage[], dataPage: number, anchor: () => HTMLElement | null) =>
      createPagedSequence({
        key: `home-discussed:${fp}`,
        page: dataPage,
        current: { ids: images.map((image) => image.id), previews: images, totalPages: read.data?.totalPages ?? null },
        /* Pages come back short (the device's settings withhold some), so the end is known only
           from `totalPages`, which every page carries. */
        pageSize: Number.MAX_SAFE_INTEGER,
        fetchPage: async (target): Promise<SequencePage> => {
          const result = await readPage(target);
          return { ids: result.images.map((image) => image.id), previews: result.images, totalPages: result.totalPages };
        },
        reveal: (id, target) => reveal(id, target, anchor),
      }),
    [fp, readPage, reveal, read.data?.totalPages],
  );

  const settings = (
    <Button variant="text" size="xs" icon={<MdTune />} onClick={() => router.push('/settings', { scroll: false })}>
      前往设置
    </Button>
  );

  return (
    <PagedImages
      listKey={`home-discussed:${fp}`}
      read={read}
      images={discussedImagesOf}
      page={page}
      onPageChange={onPageChange}
      totalPages={(data) => data.totalPages}
      onPrefetchPage={(next) => discussedImages.prefetch({ page: next, fp })}
      sequenceFor={sequenceFor}
      siteComments={(data) => data.comments}
      failureTitle="本站讨论加载失败"
      onRetry={read.refresh}
      notice={(data) =>
        data.filtered > 0 || data.missing > 0 ? (
          /* Nothing disappears silently (C11): a page that came back short says why. */
          <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-body-s text-on-surface-variant">
            <span>{withheldSentence(data.filtered, data.missing)}</span>
            {data.filtered > 0 && settings}
          </div>
        ) : null
      }
      empty={(data) =>
        data.filtered > 0 || data.missing > 0 ? (
          <EmptyState
            size="pane"
            title="本页没有可显示的图片"
            description={withheldSentence(data.filtered, data.missing)}
            action={data.filtered > 0 ? settings : undefined}
          />
        ) : page > 1 ? (
          <EmptyState
            size="pane"
            title="这一页没有图片"
            action={<Button variant="tonal" onClick={() => onPageChange(1)}>回到第一页</Button>}
          />
        ) : (
          <EmptyState size="pane" title="暂无本站用户讨论过的图片" />
        )
      }
    />
  );
}

/* ---------------------------------------------------------------------------
 * The gallery pane: the banner, the two views, their lists
 * ------------------------------------------------------------------------ */

function GalleryPane({
  seed,
  featured,
  enabled,
}: {
  seed: FeedSeed | null;
  featured: FeaturedSeed | null;
  enabled: boolean;
}) {
  const { view, pages, setView, setFeedPage, setDiscussedPage } = useGalleryNav();
  /* Bumped by a list's retry so the 近日推荐 banner re-requests alongside it — see
     `FeaturedBanner`'s `reloadKey` prop. */
  const [bannerReloadKey, setBannerReloadKey] = useState(0);
  const reloadBanner = useCallback(() => setBannerReloadKey((key) => key + 1), []);
  /* 本站讨论 mounts on first selection and then stays, like every tab pane. */
  const [discussedMounted, setDiscussedMounted] = useState(view === 'home-discussed');
  if (view === 'home-discussed' && !discussedMounted) setDiscussedMounted(true);

  /* **本站讨论 is read on intent** — a pointer resting on its tab, focus arriving on it, a press —
     so the tap usually lands on rows rather than on a placeholder: its read is two round trips
     (the discussed ids, then the pictures). `Tabs` takes no handlers per tab, so they are
     delegated from a wrapper with no box of its own. */
  const fp = useBrowsingFingerprint();
  const discussedPage = pages['home-discussed'];
  const discussedIntent = useIntentPrefetch(
    enabled ? () => discussedImages.prefetch({ page: discussedPage, fp }) : null,
  );
  const onDiscussedTab = (node: EventTarget | null) =>
    node instanceof Element && node.closest('[role="tab"]')?.id === tabId('home-discussed');

  return (
    <>
      <FeaturedBanner seed={featured} reloadKey={bannerReloadKey} enabled={enabled} />
      <div
        className="contents"
        onPointerOver={(event) => {
          if (onDiscussedTab(event.target) && !onDiscussedTab(event.relatedTarget)) discussedIntent.onPointerEnter();
        }}
        onPointerOut={(event) => {
          if (onDiscussedTab(event.target) && !onDiscussedTab(event.relatedTarget)) discussedIntent.onPointerLeave();
        }}
        onFocus={(event) => {
          if (onDiscussedTab(event.target)) discussedIntent.onFocus();
        }}
        onBlur={(event) => {
          if (onDiscussedTab(event.target)) discussedIntent.onBlur();
        }}
        onPointerDown={(event) => {
          if (onDiscussedTab(event.target)) discussedIntent.onPointerDown(event);
        }}
        onPointerCancel={(event) => {
          if (onDiscussedTab(event.target)) discussedIntent.onPointerCancel();
        }}
      >
        {/* M3 secondary tabs: two views of the same destination, under its header. */}
        <Tabs
          tabs={VIEW_TABS}
          value={view}
          onChange={setView}
          label="图库视图"
          className="mb-4 sm:mb-6"
        />
      </div>
      <TabPanes value={view} lean>
        <TabPane value="home-feed">
          <FeedList
            seed={seed}
            page={pages['home-feed']}
            onPageChange={setFeedPage}
            enabled={enabled}
            onRetry={reloadBanner}
          />
        </TabPane>
        {discussedMounted && (
          <TabPane value="home-discussed">
            <DiscussedList page={pages['home-discussed']} onPageChange={setDiscussedPage} enabled={enabled} />
          </TabPane>
        )}
      </TabPanes>
    </>
  );
}

/* ---------------------------------------------------------------------------
 * The shell: the home route's two destinations
 * ------------------------------------------------------------------------ */

function HomeContent({
  seed,
  featured,
  forumSeed,
}: {
  seed: FeedSeed | null;
  featured: FeaturedSeed | null;
  forumSeed: ForumSeed | null;
}) {
  const searchParams = useBackgroundSearchParams();
  const tabParam = searchParams.get('tab');
  const tab: HomeTab = tabParam === 'forum' ? 'forum' : 'gallery';

  /* The pill switches tabs with a history write, which re-runs no metadata; the title follows
     the tab here (the server's `generateMetadata` gives the first document the same answer). */
  useEffect(() => {
    document.title = tab === 'forum' ? '论坛 - PicPony' : '主页 - PicPony';
  }, [tab]);

  /* The forum is mounted once, then kept mounted and hidden alongside the gallery —
     the panel used to carry `key={tab}`, tearing down the subtree on every switch, so
     coming back re-fetched a page and threw away scroll position and page number.

     It is also mounted *before* you ask for it, once the browser is idle after the
     gallery settles — the first switch has data waiting instead of a spinner. Idle
     rather than immediate so it never competes with the gallery's images on load. */
  const [forumMounted, setForumMounted] = useState(tab === 'forum');
  useEffect(() => {
    if (forumMounted) return;
    return runWhenIdle(() => setForumMounted(true));
  }, [forumMounted]);

  /* The same courtesy the other way round (R12-006): arriving on `/?tab=forum`, the hidden
     gallery reads nothing until the forum is on screen and the browser is idle — it used to
     start its Derpibooru reads with the visible forum's. */
  const [galleryEnabled, setGalleryEnabled] = useState(tab === 'gallery');
  if (tab === 'gallery' && !galleryEnabled) setGalleryEnabled(true);
  useEffect(() => {
    if (galleryEnabled) return;
    return runWhenIdle(() => setGalleryEnabled(true));
  }, [galleryEnabled]);

  return (
    <div className="max-w-7xl mx-auto">
      {/* The route's heading, for the outline and for focus after a navigation: the pill and
          the pane headings are the visible labels (R3-042). */}
      <h1 className="sr-only">{tab === 'forum' ? '论坛' : '图库'}</h1>
      {/* `TabPanes`, not wiring by hand: this is the reactive path (a sidebar link,
          back/forward, the `/forum` redirect); the pill's tap starts the same run through
          `startTabTransition` in `AppLayout`, and both read `lean` off the panel — the layered
          departure, here and on /policy only. */}
      <TabPanes value={tab} lean>
        {/* Marked, not unmounted: state, scroll and fetched data survive a switch. */}
        <TabPane value="gallery">
          <GalleryPane seed={seed} featured={featured} enabled={galleryEnabled} />
        </TabPane>
        {/* `|| tab === 'forum'` so a deep link to /?tab=forum, or a tap that beats the
            idle callback, still produces the pane to fade into. Gating the *first* mount
            of an expensive pane is allowed; gating it on `active` is not. */}
        {(forumMounted || tab === 'forum') && (
          <TabPane value="forum">
            <ForumPane seed={forumSeed} />
          </TabPane>
        )}
      </TabPanes>
    </div>
  );
}

export default function HomeContentRoot({
  seed,
  featured,
  forumSeed = null,
}: {
  seed: FeedSeed | null;
  featured: FeaturedSeed | null;
  /** The forum's first page, when the server rendered `/?tab=forum` (`lib/forum.server.ts`). */
  forumSeed?: ForumSeed | null;
}) {
  return (
    /* The fallback mirrors `HomeContent`'s gallery pane — banner slot, then grid, inside
       the same page gutters. A bare `<ImageGridSkeleton />` was missing both, so the
       first paint put the grid at the top of the page against the viewport edge and
       everything jumped down and inwards when the real tree arrived. */
    <Suspense
      fallback={
        <div className="max-w-7xl mx-auto">
          <FeaturedBannerSkeleton />
          <ImageGridSkeleton />
        </div>
      }
    >
      <HomeContent seed={seed} featured={featured} forumSeed={forumSeed} />
    </Suspense>
  );
}
