'use client';

import { Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { MdAdd } from 'react-icons/md';
import { useRouter } from 'next/navigation';
import { api, PonyImage, applyCdn, ForumPost } from '@/lib/api';
import FeaturedBanner, { FeaturedBannerSkeleton } from '@/components/FeaturedBanner';
import MasonryGrid from '@/components/MasonryGrid';
import ImageGridSkeleton from '@/components/ImageGridSkeleton';
import Pagination from '@/components/Pagination';
import ErrorRetry from '@/components/ErrorRetry';
import ForumPostList from '@/components/ForumPostList';
import { useBackgroundSearchParams } from '@/components/BackgroundLocation';
import { useDeferredLoading } from '@/lib/hooks';
import { useTabPanes } from '@/lib/motion';
import { readSnapshot, writeSnapshot } from '@/lib/pageCache';
import Button from '@/components/Button';

type HomeTab = 'gallery' | 'forum';

/** What each home tab had loaded last time, so coming back is not a reload.
 *  See `lib/pageCache.ts` for why this is a render snapshot and not a request
 *  cache — the page number has to survive too, or you land back on page 1. */
interface GallerySnapshot {
  page: number;
  images: PonyImage[];
  hasMore: boolean;
}
interface ForumSnapshot {
  page: number;
  posts: ForumPost[];
  totalPages: number;
}
const GALLERY_KEY = 'home:gallery';
const FORUM_KEY = 'home:forum';

function ImageList() {
  /* Seeded from whatever this tab was showing when it was last unmounted, so a
     trip to /search and back paints the same grid on the first frame instead of
     an empty page, a skeleton and a fresh request. A stale snapshot is still
     shown — the refetch below happens underneath it, with no loading state, so
     nothing flashes on the way in. */
  const snapshot = useState(() => readSnapshot<GallerySnapshot>(GALLERY_KEY))[0];
  const [images, setImages] = useState<PonyImage[]>(snapshot?.value.images ?? []);
  const [page, setPage] = useState(snapshot?.value.page ?? 1);
  const [hasMore, setHasMore] = useState(snapshot?.value.hasMore ?? true);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(!snapshot);
  const [retryCount, setRetryCount] = useState(0);

  /* The fetch this component has already *delivered*, so a remount that was
     seeded from a fresh snapshot does not immediately re-request the same page.
     A stale one deliberately does not match, which is what makes the background
     refresh happen exactly once.
     Recorded on delivery, never on dispatch. StrictMode mounts, tears down and
     remounts every component in development; a signature written when the
     request went out makes the second run bail while the first run's response
     is dropped for being unmounted, and the component then waits forever.
     Measured on the forum pane: `run 1:0 served=null` / `run 1:0 served=1:0` /
     `resolved 17 mounted=false`, and fifteen skeletons shimmering for as long
     as the page stayed open. */
  const served = useRef<string | null>(
    snapshot && !snapshot.stale ? `${snapshot.value.page}:0` : null,
  );

  useEffect(() => {
    const signature = `${page}:${retryCount}`;
    if (served.current === signature) return;
    const firstRun = served.current === null;
    let isMounted = true;
    // page/retry handlers set loading; first load starts true. Avoid sync setState in effect.
    queueMicrotask(() => {
      if (!isMounted) return;
      // A stale snapshot is refreshed underneath what is already on screen.
      // Dimming the grid for that would be the flash this exists to remove —
      // a page change or a retry still shows its loading state.
      if (!(firstRun && snapshot)) setIsLoading(true);
      setError(null);
    });

    api
      .getImages(undefined, page)
      .then((res) => {
        if (isMounted) {
          served.current = signature;
          let imgs = res.images;
          if (localStorage.getItem('trixie_use_cdn') === 'true') {
            imgs = imgs.map((img) => ({
              ...img,
              representations: Object.fromEntries(
                Object.entries(img.representations).map(([k, v]) => [k, applyCdn(v)]),
              ) as unknown as PonyImage['representations'],
              view_url: applyCdn(img.view_url),
            }));
          }
          setImages(imgs);
          setHasMore(imgs.length === 50);
          setIsLoading(false);
          writeSnapshot<GallerySnapshot>(GALLERY_KEY, {
            page,
            images: imgs,
            hasMore: imgs.length === 50,
          });
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err);
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [page, retryCount, snapshot]);

  const handleRetry = useCallback(() => setRetryCount((c) => c + 1), []);
  const handlePageChange = useCallback((newPage: number) => {
    if (newPage >= 1) {
      setIsLoading(true);
      setError(null);
      setPage(newPage);
      // Scrolling is handled by <Pagination>, which targets the list anchor
      // below. The manual window.scrollTo that used to live here never fired:
      // the scroll container is the app shell's <main>, not the window.
    }
  }, []);

  // Held back briefly so a warm response does not flash the placeholder, and
  // held on briefly once shown so it cannot appear for a single frame.
  const showSkeleton = useDeferredLoading(isLoading);
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
        title="图片加载失败"
        message={
          status == 429 ||
          error.message === 'Failed to fetch' ||
          error.message === 'Too Many Requests'
            ? '你的请求次数过快，超出原站限制'
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
      className={`transition-opacity duration-200 ease-[var(--ease-standard)] ${
        isLoading ? 'pointer-events-none opacity-50' : 'opacity-100'
      }`}
    >
      <MasonryGrid images={images} />
      <Pagination
        currentPage={page}
        hasMore={hasMore}
        onPageChange={handlePageChange}
        disabled={isLoading}
      />
    </div>
  );
}

function ForumTab() {
  const router = useRouter();
  /* Same snapshot treatment as the gallery above — and it matters more here,
     because the forum pane is also mounted lazily on idle, so without it a
     switch straight back to 论坛 could land on an empty list twice over. */
  const snapshot = useState(() => readSnapshot<ForumSnapshot>(FORUM_KEY))[0];
  const [posts, setPosts] = useState<ForumPost[]>(snapshot?.value.posts ?? []);
  const [page, setPage] = useState(snapshot?.value.page ?? 1);
  const [totalPages, setTotalPages] = useState(snapshot?.value.totalPages ?? 1);
  const [isLoading, setIsLoading] = useState(!snapshot);
  const [error, setError] = useState<Error | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const served = useRef<string | null>(
    snapshot && !snapshot.stale ? `${snapshot.value.page}:0` : null,
  );

  useEffect(() => {
    const signature = `${page}:${retryCount}`;
    if (served.current === signature) return;
    let isMounted = true;
    // `served` is recorded on delivery, not dispatch — see the gallery's note.
    api
      .getForumPosts(page)
      .then((res) => {
        if (isMounted) {
          served.current = signature;
          setPosts(res.posts);
          setTotalPages(res.total_pages);
          setIsLoading(false);
          writeSnapshot<ForumSnapshot>(FORUM_KEY, {
            page,
            posts: res.posts,
            totalPages: res.total_pages,
          });
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err);
          setIsLoading(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, [page, retryCount]);

  const handleRetry = useCallback(() => {
    setIsLoading(true);
    setError(null);
    setRetryCount((c) => c + 1);
  }, []);

  const handlePageChange = useCallback(
    (newPage: number) => {
      if (newPage >= 1 && newPage <= totalPages) {
        setIsLoading(true);
        setError(null);
        setPage(newPage);
      }
    },
    [totalPages],
  );

  const handlePostClick = useCallback(
    (postId: number) => {
      router.push(`/forum/${postId}`);
    },
    [router],
  );

  return (
    <div>
      <div data-tab-row className="flex justify-between items-center mb-4">
        <h2 className="text-title-m-emphasized text-on-surface">论坛</h2>
        <Button
          onClick={() => router.push('/forum/create')}
          variant="filled"
          size="sm"
          icon={<MdAdd size={16} />}
        >
          发帖
        </Button>
      </div>{' '}
      <ForumPostList
        posts={posts}
        page={page}
        totalPages={totalPages}
        isLoading={isLoading}
        error={error}
        onRetry={handleRetry}
        onPageChange={handlePageChange}
        onPostClick={handlePostClick}
      />{' '}
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

  /* Owns the pane flags and plays the shared-axis cross-fade. The tab bar
     starts the same transition optimistically on the tap; this adopts that one
     when it exists, and covers every other route into a tab (back/forward, a
     sidebar link, the /forum redirect, a deep link). */
  const panelRef = useTabPanes<HTMLDivElement>(tab);

  /* The forum is mounted once and then kept mounted, hidden, alongside the
     gallery — the panel used to carry `key={tab}`, which tore the whole subtree
     down on every switch, so coming back re-fetched a page you had already
     loaded and threw away your scroll position and page number.

     It is also mounted *before* you ask for it: once the browser is idle after
     the gallery has settled, so the first switch has data waiting instead of an
     empty list and a spinner. Idle rather than immediate so it never competes
     with the gallery's own images for bandwidth on the initial load. */
  const [forumMounted, setForumMounted] = useState(tab === 'forum');
  useEffect(() => {
    if (forumMounted) return;
    const w = window as typeof window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?: (h: number) => void;
    };
    if (!w.requestIdleCallback) {
      const t = window.setTimeout(() => setForumMounted(true), 1200);
      return () => window.clearTimeout(t);
    }
    const h = w.requestIdleCallback(() => setForumMounted(true), { timeout: 4000 });
    return () => w.cancelIdleCallback?.(h);
  }, [forumMounted]);

  return (
    <>
      <div className="max-w-7xl mx-auto px-2 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-8">
        {/* No `key` here: re-keying is what used to remount both tabs. */}
        <div ref={panelRef} data-tab-panel>
          {/* Marked, not unmounted, so state, scroll and fetched data all
              survive a switch. `data-tab-pane-active` is the resting state;
              CSS in globals.css also keeps a pane boxed while it carries the
              motion layer's `-leaving` / `-entering` flag, which is what lets
              both panes be on screen at once during the cross-fade. */}
          <div data-tab-pane="gallery" data-tab-pane-active={tab === 'gallery' ? '' : undefined}>
            <FeaturedBanner />
            <ImageList />
          </div>
          {/* `|| tab === 'forum'` so a deep link to /?tab=forum, or a tap that
              beats the idle callback, still produces the pane to fade into. */}
          {(forumMounted || tab === 'forum') && (
            <div data-tab-pane="forum" data-tab-pane-active={tab === 'forum' ? '' : undefined}>
              <ForumTab />
            </div>
          )}
        </div>
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
        <div className="max-w-7xl mx-auto px-2 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-8">
          <FeaturedBannerSkeleton />
          <ImageGridSkeleton />
        </div>
      }
    >
      <HomeContent />
    </Suspense>
  );
}
