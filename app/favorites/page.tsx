'use client';

import { Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { MdCollectionsBookmark, MdKey } from 'react-icons/md';
import { api, PonyImage } from '@/lib/api';
import { useAuth, useDeferredLoading } from '@/lib/hooks';
import { useAuthModal } from '@/components/AuthModal';
import MasonryGrid from '@/components/MasonryGrid';
import ImageGridSkeleton from '@/components/ImageGridSkeleton';
import ErrorRetry from '@/components/ErrorRetry';
import EmptyState from '@/components/EmptyState';
import Button from '@/components/Button';
import { LoadMoreButton } from '@/components/Pagination';
import TabBar from '@/components/TabBar';
import TabPanes, { TabPane } from '@/components/TabPanes';
import { useRouter } from 'next/navigation';
import { readJson } from '@/lib/api/client';
import PageHeader from '@/components/PageHeader';

const PAGE_SIZE = 50;
const DERPI_SEARCH = 'https://trixiebooru.org/api/v1/json/search/images';
const DERPI_FAVES_QUERY =
  '(my:faves), -explicit, -questionable, -suggestive, -grotesque, -grimdark, -spoiler, -anthro, -humanized, pony';

type FaveSource = 'picpony' | 'derpibooru';

/** Shared chrome, so the loading, error and content states cannot drift apart. */
function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="我的收藏" />
      {children}
    </div>
  );
}

/**
 * One tab's worth of favourites, with its own fetch state.
 *
 * It used to be a single component holding one `images` array and an `activeTab`
 * that decided which endpoint filled it. That made the shared-axis tab
 * transition impossible rather than merely absent: the slide needs the outgoing
 * pane to still be showing what it was showing, and with one shared list the
 * moment you switched tabs the old content was already gone — replaced by the
 * new tab's skeleton. There was nothing left to slide out.
 *
 * Parameterising by `source` and mounting it twice is the whole fix. Every piece
 * of the fetch machinery below — the generation counter, the abort controller,
 * the dedupe in `commit` — is unchanged; it simply now guards one tab's requests
 * instead of arbitrating between two tabs'. Each pane keeps its own images, page
 * number and error, which also means switching back no longer refetches a list
 * you already have, and no longer re-reads `/user` to get the API key.
 */
function FavoritesPane({ source }: { source: FaveSource }) {
  const [images, setImages] = useState<PonyImage[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [faveIds, setFaveIds] = useState<number[]>([]);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const router = useRouter();
  const { getUserInfo } = useAuth();
  const { openAuth } = useAuthModal();

  /* Every request carries the generation it was issued in. A tab switch, a
     retry or an unmount bumps it, so a slow response from the previous
     generation is discarded rather than racing the current one on `setImages`.
     Both loaders used to write unconditionally, so switching tabs twice quickly
     could leave Derpibooru results under the PicPony tab. */
  const generation = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const isStale = useCallback((run: number) => generation.current !== run, []);

  const searchDerpi = useCallback(
    async (query: string, targetPage: number, key: string | null, signal: AbortSignal) => {
      const params = new URLSearchParams({
        q: query,
        page: String(targetPage),
        per_page: String(PAGE_SIZE),
      });
      if (key) {
        params.set('sf', 'created_at');
        params.set('sd', 'desc');
        params.set('key', key);
      }
      const res = await fetch(`${DERPI_SEARCH}?${params}`, { cache: 'no-store', signal });
      if (!res.ok) {
        const err = new Error(
          res.status === 429 ? '你的请求次数过快，超出原站限制' : `HTTP Error ${res.status}`,
        );
        throw err;
      }
      return (await res.json()) as { images: PonyImage[] };
    },
    [],
  );

  /** Appends without duplicating; page 1 replaces. */
  const commit = useCallback((next: PonyImage[], targetPage: number) => {
    if (targetPage === 1) {
      setImages(next);
      return;
    }
    setImages((prev) => {
      const seen = new Set(prev.map((img) => img.id));
      return [...prev, ...next.filter((img) => !seen.has(img.id))];
    });
  }, []);

  const loadDerpibooruFaves = useCallback(
    async (key: string, targetPage: number, run: number, signal: AbortSignal) => {
      try {
        const data = await searchDerpi(DERPI_FAVES_QUERY, targetPage, key, signal);
        if (isStale(run)) return;
        commit(data.images, targetPage);
        setPage(targetPage);
        setHasMore(data.images.length === PAGE_SIZE);
      } catch (err) {
        if (signal.aborted || isStale(run)) return;
        console.error('Failed to load Derpibooru favorites:', err);
        if (targetPage === 1) setError(err as Error);
      } finally {
        if (!isStale(run)) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      }
    },
    [searchDerpi, commit, isStale],
  );

  const loadImages = useCallback(
    async (ids: number[], targetPage: number, run: number, signal: AbortSignal) => {
      try {
        const idsForPage = ids.slice((targetPage - 1) * PAGE_SIZE, targetPage * PAGE_SIZE);
        if (idsForPage.length === 0) {
          if (!isStale(run)) setHasMore(false);
          return;
        }

        const data = await searchDerpi(
          idsForPage.map((id) => `id:${id}`).join(' OR '),
          1,
          null,
          signal,
        );
        if (isStale(run)) return;

        // The API returns them in its own order; restore the favourite order.
        const rank = new Map(idsForPage.map((id, index) => [id, index]));
        const sorted = [...data.images].sort(
          (a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0),
        );

        commit(sorted, targetPage);
        setPage(targetPage);
        setHasMore(targetPage * PAGE_SIZE < ids.length);
      } catch (err) {
        if (signal.aborted || isStale(run)) return;
        console.error('Failed to load image details:', err);
        if (targetPage === 1) setError(err as Error);
      } finally {
        if (!isStale(run)) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      }
    },
    [searchDerpi, commit, isStale],
  );

  useEffect(() => {
    const run = (generation.current += 1);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    const fetchFaves = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const userInfo = getUserInfo();
        if (!userInfo) {
          // Without this the flag stayed true and the page sat on a skeleton
          // for as long as the redirect took — or forever, if it was blocked.
          setIsLoading(false);
          openAuth('login');
          return;
        }

        const userRes = await api.getUser(userInfo.token);
        const userData = await readJson(userRes);
        if (isStale(run)) return;
        const currentApiKey = userData.success && userData.user ? userData.user.api_key : null;
        setApiKey(currentApiKey);

        if (source === 'picpony') {
          const res = await api.getFaves(userInfo.token);
          if (isStale(run)) return;
          if (!res.success || !res.faves) throw new Error(res.message || '收藏列表读取失败');
          setFaveIds(res.faves);
          if (res.faves.length === 0) {
            setImages([]);
            setHasMore(false);
            setIsLoading(false);
            return;
          }
          await loadImages(res.faves, 1, run, signal);
          return;
        }

        if (!currentApiKey) {
          setImages([]);
          setHasMore(false);
          setIsLoading(false);
          return;
        }
        await loadDerpibooruFaves(currentApiKey, 1, run, signal);
      } catch (err) {
        if (signal.aborted || isStale(run)) return;
        setError(err as Error);
        setIsLoading(false);
      }
    };

    void fetchFaves();

    return () => {
      // Bumping the generation is what actually silences in-flight writes; the
      // abort only saves the network round trip.
      generation.current += 1;
      controller.abort();
    };
  }, [retryCount, source, router, getUserInfo, openAuth, isStale, loadImages, loadDerpibooruFaves]);

  const loadMore = () => {
    if (isLoadingMore || !hasMore) return;
    const controller = abortRef.current;
    if (!controller || controller.signal.aborted) return;
    setIsLoadingMore(true);
    if (source === 'picpony') {
      void loadImages(faveIds, page + 1, generation.current, controller.signal);
    } else if (apiKey) {
      void loadDerpibooruFaves(apiKey, page + 1, generation.current, controller.signal);
    }
  };

  const hasContent = images.length > 0;
  // Held back so a warm response never flashes the placeholder, and held on so
  // it cannot appear for a single frame.
  const showSkeleton = useDeferredLoading(isLoading);

  /* Every branch below returns pane content only — no `PageShell`, no tab bar.
     Those are the parent's, and they have to be, because both panes are mounted
     at once: rendering the shell per branch would have put two page headings and
     two tab bars on screen for the length of a switch.
     `size="pane"` on the two status blocks for the same reason — a `page`-sized
     block sits under a heading and a tab row here, not on a bare route. */
  if (error && !hasContent) {
    return (
      <ErrorRetry
        size="pane"
        title="收藏加载失败"
        message={error.message}
        onRetry={() => setRetryCount((c) => c + 1)}
      />
    );
  }

  // Only a first load swaps in the placeholder. Once there is content it stays
  // mounted and dims, so the grid never unmounts mid-session — unmounting it
  // collapses the scroll container and the browser clamps scrollTop.
  if (!hasContent && isLoading) {
    return showSkeleton ? <ImageGridSkeleton /> : null;
  }

  if (source === 'derpibooru' && !apiKey) {
    return (
      <EmptyState
        size="pane"
        icon={<MdKey size={48} />}
        title="未绑定 API Key"
        description="您需要绑定 Derpibooru API Key 才能查看 Derpibooru 的收藏数据"
        action={
          <Button variant="filled" onClick={() => router.push('/settings')}>
            去绑定
          </Button>
        }
      />
    );
  }

  if (!hasContent) {
    return (
      <EmptyState
        size="pane"
        icon={<MdCollectionsBookmark size={48} />}
        title="还没有收藏任何图片"
        description="在图片详情页点一下收藏，就会出现在这里"
      />
    );
  }

  return (
    <div
      aria-busy={isLoading || undefined}
      className={`transition-opacity duration-200 ease-[var(--ease-standard)] ${
        isLoading ? 'pointer-events-none opacity-50' : 'opacity-100'
      }`}
    >
      <MasonryGrid images={images} />
      {hasMore && <LoadMoreButton onClick={loadMore} isLoading={isLoadingMore} />}
    </div>
  );
}

function FavoritesTabs() {
  const [activeTab, setActiveTab] = useState<FaveSource>('picpony');
  /* The Derpibooru pane is mounted on first use rather than up front, so a page
     load costs one list request instead of two — and then stays mounted, which
     is what keeps its results and scroll position across later switches. Its
     place in the sequence is fixed either way: `useTabPanes` derives the slide's
     direction from pane order in the DOM. */
  const [derpiMounted, setDerpiMounted] = useState(false);

  return (
    <PageShell>
      <TabBar
        className="mb-4"
        value={activeTab}
        onChange={(next) => {
          if (next === 'derpibooru') setDerpiMounted(true);
          setActiveTab(next);
        }}
        label="收藏来源"
        tabs={[
          { value: 'picpony' as const, label: 'PicPony' },
          { value: 'derpibooru' as const, label: 'Derpibooru' },
        ]}
      />
      <TabPanes value={activeTab}>
        <TabPane value="picpony">
          <FavoritesPane source="picpony" />
        </TabPane>
        {(derpiMounted || activeTab === 'derpibooru') && (
          <TabPane value="derpibooru">
            <FavoritesPane source="derpibooru" />
          </TabPane>
        )}
      </TabPanes>
    </PageShell>
  );
}

export default function Favorites() {
  return (
    <Suspense
      fallback={
        <PageShell>
          <ImageGridSkeleton />
        </PageShell>
      }
    >
      <FavoritesTabs />
    </Suspense>
  );
}
