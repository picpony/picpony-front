'use client';

import { Suspense, useState, useEffect, useCallback } from 'react';
import { MdAdd } from 'react-icons/md';
import { useRouter } from 'next/navigation';
import { getBrowsingSettings } from '@/lib/api';
import { useResource } from '@/lib/resource';
import { useScreenState } from '@/lib/screenState';
import { DEFAULT_BROWSING_FINGERPRINT } from '@/lib/searchQuery';
import { browsingFingerprint, forumPosts, homeFeed, syncBrowsingCookie } from '@/lib/resources';
import type { FeedSeed } from '@/lib/feed.server';
import { runWhenIdle } from '@/lib/utils';
import FeaturedBanner, { FeaturedBannerSkeleton } from '@/components/FeaturedBanner';
import MasonryGrid from '@/components/MasonryGrid';
import ImageGridSkeleton from '@/components/ImageGridSkeleton';
import Pagination from '@/components/Pagination';
import ErrorRetry from '@/components/ErrorRetry';
import ForumPostList from '@/components/ForumPostList';
import { useBackgroundSearchParams } from '@/components/BackgroundLocation';
import { useDeferredLoading } from '@/lib/hooks';
import TabPanes, { TabPane } from '@/components/TabPanes';
import Button from '@/components/Button';
import SectionHeading from '@/components/SectionHeading';
import { ICON } from '@/lib/icons';

type HomeTab = 'gallery' | 'forum';

/* Notifies the caller when its 重试 is pressed: the home pane reloads the 近日推荐
   banner in the same retry, so a failed load does not come back with just the feed. */
function ImageList({ onRetry, seed }: { onRetry?: () => void; seed: FeedSeed | null }) {
  /* The page number is the only thing this component remembers for itself; the images come
     from the cache, keyed on the page. See `lib/screenState.ts`. */
  const [page, setPage] = useScreenState('home:gallery:page', 1);

  /* First render uses exactly what the server used, so hydration matches the HTML — the
     whole reason these are `useState` seeded from the prop rather than direct
     `localStorage` reads. After mount the device's own settings take over.

     Agreement (the overwhelming case) means the seed applies and no request is sent.
     Disagreement means the key changes after mount, one request goes out with
     `keepPrevious` holding the server's rows on screen — a refresh rather than an empty
     list — and `syncBrowsingCookie` heals it for next time. */
  /* `DEFAULT_BROWSING_FINGERPRINT`, not `''`: a missing seed (server read timed out) left
     the first key on an fp no browser can compute — `browsingFingerprint()` always returns
     five `|`-joined fields — so the effect below always changed the key and `/` sent its
     content request twice. The default is what a device with no stored settings produces. */
  const [fp, setFp] = useState(seed?.fp ?? DEFAULT_BROWSING_FINGERPRINT);
  const [sort, setSort] = useState(seed?.sort ?? 'created_at');
  useEffect(() => {
    const ownFp = browsingFingerprint();
    const ownSort = getBrowsingSettings().homeSort;
    /* Out of the effect body: `react-hooks/set-state-in-effect` rejects a synchronous
       setState here — same reason `AppLayout`'s drawer-restore effect defers. */
    queueMicrotask(() => {
      syncBrowsingCookie();
      setFp(ownFp);
      setSort(ownSort);
    });
  }, []);

  /* `keepPrevious`: turning a page must not unmount the grid — the scroller collapses,
     the browser clamps `scrollTop`, and the page snaps to the very top. */
  const read = useResource(
    homeFeed,
    { page, sort, fp },
    /* The seed is only ever offered for page 1 — it is what the server rendered. Page 2
       has no seed and `initial.key` would not match anyway; `undefined` says so directly. */
    { keepPrevious: true, initial: page === 1 ? (seed ?? undefined) : undefined },
  );
  const images = read.data?.images ?? [];
  const hasMore = images.length === 50;
  const error = read.error as Error | null;

  const handleRetry = useCallback(() => {
    read.refresh();
    onRetry?.();
  }, [read, onRetry]);
  const handlePageChange = useCallback(
    (newPage: number) => {
      if (newPage >= 1) setPage(newPage);
      // Scrolling is handled by <Pagination>, which targets the list anchor below;
      // the scroll container is the app shell's <main>, not the window.
    },
    [setPage],
  );

  /* `isLoading` covers a refresh of something already on screen too, so the dim below keys
     on it while the *placeholder* keys on having nothing at all. Getting that the wrong
     way round is how a cache stops being worth having. */
  const isLoading = read.isLoading;
  // Held back briefly so a warm response does not flash the placeholder, and held on
  // briefly once shown so it cannot appear for a single frame.
  const showSkeleton = useDeferredLoading(read.data === undefined && !error);
  const hasContent = images.length > 0;

  // Only the *first* load swaps in a placeholder. On a page change the previous grid stays
  // mounted and simply dims: unmounting it collapses the scroll container, the browser
  // clamps scrollTop, and the page snaps to the top — "jump to the top, then slide back".
  if (!hasContent) {
    if (showSkeleton) return <ImageGridSkeleton />;
    // Loading, but fast enough that showing anything would just flicker.
    if (isLoading) return null;
  }

  if (error && !hasContent) {
    const status = (error as { status?: number }).status;
    return (
      <ErrorRetry
        /* `pane`, not the default `page`: this renders inside a `TabPane` under the home
           route's floating tab pill, so a half-viewport block pushes the pill off a phone
           screen (same reason /favorites' status blocks are `pane`). `StatusView` reserves
           `page` for a bare route. */
        size="pane"
        title="图片加载失败"
        message={
          status == 429 ||
          error.message === 'Failed to fetch' ||
          error.message === 'Too Many Requests'
            ? '您的请求次数过快，超出原站限制'
            : `${status ? `HTTP Error ${status}: ` : ''}${error.message}`
        }
        onRetry={handleRetry}
      />
    );
  }

  return (
    /* Scroll target for <Pagination>: a page turn lands here, at the first row of
       results, rather than back above the featured banner. */
    <div
      data-pagination-anchor
      aria-busy={isLoading || undefined}
      className={`transition-opacity duration-standard ease-[var(--ease-standard)] ${
        isLoading ? 'pointer-events-none opacity-50' : 'opacity-100'
      }`}
    >
      <MasonryGrid images={images} />
      <Pagination
        currentPage={page}
        hasMore={hasMore}
        onPageChange={handlePageChange}
        /* Warmed when a pointer or the keyboard rests on a page control, so the commonest
           navigation in a gallery stops being the one with no head start. Never
           speculatively — see `Pagination`. */
        onPrefetchPage={(next) => homeFeed.prefetch({ page: next, sort, fp })}
        disabled={isLoading}
      />
    </div>
  );
}

function ForumTab() {
  const router = useRouter();
  const [page, setPage] = useScreenState('home:forum:page', 1);
  const read = useResource(forumPosts, { page }, { keepPrevious: true });
  const posts = read.data?.posts ?? [];
  const totalPages = read.data?.totalPages ?? 1;
  const isLoading = read.data === undefined && read.error === undefined;
  const error = read.error as Error | null;

  const handleRetry = useCallback(() => read.refresh(), [read]);

  const handlePageChange = useCallback(
    (newPage: number) => {
      if (newPage >= 1 && newPage <= totalPages) setPage(newPage);
    },
    [totalPages, setPage],
  );

  const handlePostClick = useCallback(
    (postId: number) => {
      /* No need to flush anything first: the tab bar writes its URL synchronously on the tap
         (`switchTab` in AppLayout), so `/?tab=forum` is already the current entry by the time
         a row can be pressed — which is what makes back from a thread return to the list. */
      router.push(`/forum/${postId}`, { scroll: false });
    },
    [router],
  );

  return (
    /* The reading column. The gallery pane beside it needs the full `max-w-7xl`
       because it is a masonry grid; a list of text rows does not — at that width the
       same list was 1280px here and 896px on `/forum`, one list two widths. See the
       layout note in AGENTS.md. */
    <div className="mx-auto max-w-4xl">
      <SectionHeading
        data-tab-row
        actions={
          <Button
            onClick={() => router.push('/forum/create', { scroll: false })}
            variant="filled"
            size="xs"
            icon={<MdAdd size={ICON.dense} />}
          >
            发帖
          </Button>
        }
      >
        论坛
      </SectionHeading>
      <ForumPostList
        posts={posts}
        page={page}
        totalPages={totalPages}
        isLoading={isLoading}
        error={error}
        onRetry={handleRetry}
        onPageChange={handlePageChange}
        onPostClick={handlePostClick}
      />
    </div>
  );
}
function HomeContent({ seed }: { seed: FeedSeed | null }) {
  const searchParams = useBackgroundSearchParams();
  const tabParam = searchParams.get('tab');
  const tab: HomeTab = tabParam === 'forum' ? 'forum' : 'gallery';

  useEffect(() => {
    document.title = '主页 - PicPony';
  }, []);

  /* The forum is mounted once, then kept mounted and hidden alongside the gallery —
     the panel used to carry `key={tab}`, tearing down the subtree on every switch, so
     coming back re-fetched a page and threw away scroll position and page number.

     It is also mounted *before* you ask for it, once the browser is idle after the
     gallery settles — the first switch has data waiting instead of a spinner. Idle
     rather than immediate so it never competes with the gallery's images on load. */
  const [forumMounted, setForumMounted] = useState(tab === 'forum');
  /* Bumped by the feed's retry so the 近日推荐 banner re-requests alongside the
     信息流 — see `FeaturedBanner`'s `reloadKey` prop. */
  const [bannerReloadKey, setBannerReloadKey] = useState(0);
  const handleBannerReload = useCallback(() => setBannerReloadKey((k) => k + 1), []);
  useEffect(() => {
    if (forumMounted) return;
    return runWhenIdle(() => setForumMounted(true));
  }, [forumMounted]);

  return (
    <>
      <div className="max-w-7xl mx-auto">
        {/* `TabPanes`, not wiring by hand. `lean` is **on here and nowhere else**, stated at
            both call sites — this one for the reactive path (sidebar link, back/forward, the
            `/forum` redirect) and `startTabTransition`'s argument in `AppLayout` for the tap
            path. Safe here because the forum pane is mounted ahead of the tap. */}
        <TabPanes value={tab} lean>
          {/* Marked, not unmounted: state, scroll and fetched data survive a switch. */}
          <TabPane value="gallery">
            <FeaturedBanner reloadKey={bannerReloadKey} />
            <ImageList onRetry={handleBannerReload} seed={seed} />
          </TabPane>
          {/* `|| tab === 'forum'` so a deep link to /?tab=forum, or a tap that beats the
              idle callback, still produces the pane to fade into. Gating the *first* mount
              of an expensive pane is allowed; gating it on `active` is not. */}
          {(forumMounted || tab === 'forum') && (
            <TabPane value="forum">
              <ForumTab />
            </TabPane>
          )}
        </TabPanes>
      </div>
    </>
  );
}

export default function HomeContentRoot({ seed }: { seed: FeedSeed | null }) {
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
      <HomeContent seed={seed} />
    </Suspense>
  );
}
