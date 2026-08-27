'use client';

import { Suspense, useState, useEffect, useCallback } from 'react';
import { MdAdd } from 'react-icons/md';
import { useRouter } from 'next/navigation';
import { getBrowsingSettings } from '@/lib/api';
import { useResource } from '@/lib/resource';
import { useScreenState } from '@/lib/screenState';
import { forumPosts, homeFeed } from '@/lib/resources';
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

/* Notifies the caller when its 重试 is pressed. The home pane uses this to
   reload the 近日推荐 banner in the same retry, so a failed load does not
   come back with just the feed. */
function ImageList({ onRetry }: { onRetry?: () => void }) {
  /* The page number is the only thing this component now remembers for itself; the images come
     from the cache, keyed on the page. That split is the point — `lib/pageCache.ts` stored the
     whole render in one object precisely because it had nowhere to put the page number, and the
     `served` ref, the staleness branch and the delivery-vs-dispatch note that used to live here
     were all the machinery of hand-rolling one cache for one screen. See `lib/screenState.ts`. */
  const [page, setPage] = useScreenState('home:gallery:page', 1);
  const sort = getBrowsingSettings().homeSort;

  /* `keepPrevious`: turning a page must not unmount the grid. See the option's own note — the
     scroller collapses, the browser clamps `scrollTop`, and the page snaps to the very top. */
  const read = useResource(homeFeed, { page, sort }, { keepPrevious: true });
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
      // Scrolling is handled by <Pagination>, which targets the list anchor
      // below. The manual window.scrollTo that used to live here never fired:
      // the scroll container is the app shell's <main>, not the window.
    },
    [setPage],
  );

  /* `isLoading` covers a refresh of something already on screen too, so the dim below keys on it
     while the *placeholder* keys on having nothing at all. Getting that the wrong way round is how
     a cache stops being worth having. */
  const isLoading = read.isLoading;
  // Held back briefly so a warm response does not flash the placeholder, and
  // held on briefly once shown so it cannot appear for a single frame.
  const showSkeleton = useDeferredLoading(read.data === undefined && !error);
  const hasContent = images.length > 0;

  // Only the *first* load swaps in a placeholder. On a page change the previous
  // grid stays mounted and simply dims: unmounting it collapses the scroll
  // container, the browser then clamps scrollTop to the new (tiny) maximum, and
  // the page snaps to the top before the scroll animation has even started —
  // which is what made paging look like "jump to the top, then slide back down".
  if (!hasContent) {
    if (showSkeleton) return <ImageGridSkeleton />;
    // Loading, but fast enough that showing anything would just flicker.
    if (isLoading) return null;
  }

  if (error && !hasContent) {
    const status = (error as { status?: number }).status;
    return (
      <ErrorRetry
        /* `pane`, not the default `page`. This renders inside a `TabPane` under the
           home route's floating tab pill, so a half-viewport block pushes the pill
           off a phone screen — the same reason /favorites' two status blocks are
           `pane`. `StatusView` reserves `page` for a bare route. */
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
    /* The scroll target for <Pagination>: turning a page lands here, at the
       first row of results, rather than back above the featured banner. */
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
           navigation in a gallery stops being the one with no head start. Never speculatively —
           see `Pagination`. */
        onPrefetchPage={(next) => homeFeed.prefetch({ page: next, sort })}
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
      router.push(`/forum/${postId}`, { scroll: false });
    },
    [router],
  );

  return (
    /* The reading column. The gallery pane beside this one needs the full
       `max-w-7xl` because it is a masonry grid; a list of text rows does not, and
       at that width the same list was 1280px here and 896px on `/forum` — one
       list, two widths, which is the thing that reads as sloppy rather than as
       spacious. See the layout note in AGENTS.md. */
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
function HomeContent() {
  const searchParams = useBackgroundSearchParams();
  const tabParam = searchParams.get('tab');
  const tab: HomeTab = tabParam === 'forum' ? 'forum' : 'gallery';

  useEffect(() => {
    document.title = '主页 - PicPony';
  }, []);

  /* The forum is mounted once and then kept mounted, hidden, alongside the
     gallery — the panel used to carry `key={tab}`, which tore the whole subtree
     down on every switch, so coming back re-fetched a page you had already
     loaded and threw away your scroll position and page number.

     It is also mounted *before* you ask for it: once the browser is idle after
     the gallery has settled, so the first switch has data waiting instead of an
     empty list and a spinner. Idle rather than immediate so it never competes
     with the gallery's own images for bandwidth on the initial load. */
  const [forumMounted, setForumMounted] = useState(tab === 'forum');
  /* Bumped by the feed's retry so the 近日推荐 banner re-requests alongside
     the 信息流 — see `FeaturedBanner`'s `reloadKey` prop. */
  const [bannerReloadKey, setBannerReloadKey] = useState(0);
  const handleBannerReload = useCallback(() => setBannerReloadKey((k) => k + 1), []);
  useEffect(() => {
    if (forumMounted) return;
    return runWhenIdle(() => setForumMounted(true));
  }, [forumMounted]);

  return (
    <>
      <div className="max-w-7xl mx-auto">
        {/* `TabPanes`, not the wiring by hand. This screen used to spell out
            `useTabPanes` plus two `data-tab-pane` divs, which AGENTS.md names as the
            thing not to do.
            `lean` is **on here and nowhere else**, and it has to be stated at both call
            sites — this one for the reactive path (a sidebar link, back/forward, the
            `/forum` redirect) and `startTabTransition`'s argument in `AppLayout` for the
            tap path. It used to arrive by accident, through a parameter default that
            disagreed with this component's; unifying the defaults to `false` took the
            horizontal stagger off the home switch, which is the visible thing the lean
            exists for. Safe here because the forum pane is mounted ahead of the tap. */}
        <TabPanes value={tab} lean>
          {/* Marked, not unmounted, so state, scroll and fetched data all survive a
              switch — `TabPane` handles the flags. */}
          <TabPane value="gallery">
            <FeaturedBanner reloadKey={bannerReloadKey} />
            <ImageList onRetry={handleBannerReload} />
          </TabPane>
          {/* `|| tab === 'forum'` so a deep link to /?tab=forum, or a tap that
              beats the idle callback, still produces the pane to fade into. Gating
              the *first* mount of an expensive pane is allowed; gating it on
              `active` is not. */}
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

export default function Home() {
  return (
    /* The fallback mirrors `HomeContent`'s gallery pane — banner slot, then
       grid, inside the same page gutters. A bare `<ImageGridSkeleton />` was
       missing both, so the first paint put the grid at the top of the page and
       against the viewport edge, and everything jumped down and inwards when
       the real tree arrived. */
    <Suspense
      fallback={
        <div className="max-w-7xl mx-auto">
          <FeaturedBannerSkeleton />
          <ImageGridSkeleton />
        </div>
      }
    >
      <HomeContent />
    </Suspense>
  );
}
