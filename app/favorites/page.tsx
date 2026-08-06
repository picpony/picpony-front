'use client';

import { Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { MdCollectionsBookmark } from 'react-icons/md';
import { api, PonyImage } from '@/lib/api';
import { useAuth, useDeferredLoading } from '@/lib/hooks';
import MasonryGrid from '@/components/MasonryGrid';
import ImageGridSkeleton from '@/components/ImageGridSkeleton';
import ErrorRetry from '@/components/ErrorRetry';
import Button from '@/components/Button';
import { LoadMoreButton } from '@/components/Pagination';
import TabBar from '@/components/TabBar';
import { useRouter } from 'next/navigation';
import { readJson } from '@/lib/api/client';

const PAGE_SIZE = 50;
const DERPI_SEARCH = 'https://trixiebooru.org/api/v1/json/search/images';
const DERPI_FAVES_QUERY =
  '(my:faves), -explicit, -questionable, -suggestive, -grotesque, -grimdark, -spoiler, -anthro, -humanized, pony';

/** Shared chrome, so the loading, error and content states cannot drift apart. */
function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl px-2 py-4 sm:px-4 sm:py-8 md:px-6 lg:px-8">
      <h1 className="text-headline-s text-on-surface mb-6">我的收藏</h1>
      {children}
    </div>
  );
}

function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="text-on-surface-variant flex min-h-[40vh] flex-col items-center justify-center px-4 text-center">
      <MdCollectionsBookmark size={48} className="text-outline mb-4" />
      <h2 className="text-title-l text-on-surface-variant mb-2">{title}</h2>
      {children}
    </div>
  );
}

function FavoritesList() {
  const [images, setImages] = useState<PonyImage[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [faveIds, setFaveIds] = useState<number[]>([]);
  const [activeTab, setActiveTab] = useState<'picpony' | 'derpibooru'>('picpony');
  const [apiKey, setApiKey] = useState<string | null>(null);
  const router = useRouter();
  const { getUserInfo } = useAuth();

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
          router.push('/login');
          return;
        }

        const userRes = await api.getUser(userInfo.token);
        const userData = await readJson(userRes);
        if (isStale(run)) return;
        const currentApiKey = userData.success && userData.user ? userData.user.api_key : null;
        setApiKey(currentApiKey);

        if (activeTab === 'picpony') {
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
  }, [retryCount, activeTab, router, getUserInfo, isStale, loadImages, loadDerpibooruFaves]);

  const loadMore = () => {
    if (isLoadingMore || !hasMore) return;
    const controller = abortRef.current;
    if (!controller || controller.signal.aborted) return;
    setIsLoadingMore(true);
    if (activeTab === 'picpony') {
      void loadImages(faveIds, page + 1, generation.current, controller.signal);
    } else if (apiKey) {
      void loadDerpibooruFaves(apiKey, page + 1, generation.current, controller.signal);
    }
  };

  const hasContent = images.length > 0;
  // Held back so a warm response never flashes the placeholder, and held on so
  // it cannot appear for a single frame.
  const showSkeleton = useDeferredLoading(isLoading);

  const tabs = (
    <TabBar
      className="mb-4"
      value={activeTab}
      onChange={setActiveTab}
      tabs={[
        { value: 'picpony' as const, label: 'PicPony' },
        { value: 'derpibooru' as const, label: 'Derpibooru' },
      ]}
    />
  );

  if (error && !hasContent) {
    return (
      <PageShell>
        {tabs}
        <ErrorRetry
          title="收藏加载失败"
          message={error.message}
          onRetry={() => setRetryCount((c) => c + 1)}
        />
      </PageShell>
    );
  }

  // Only a first load swaps in the placeholder. Once there is content it stays
  // mounted and dims, so the grid never unmounts mid-session — unmounting it
  // collapses the scroll container and the browser clamps scrollTop.
  //
  // The tabs render above it either way: they are the control you just used to
  // get here, and having them vanish under the placeholder made the page look
  // like it had navigated somewhere else.
  if (!hasContent && isLoading) {
    return (
      <PageShell>
        {tabs}
        {showSkeleton && <ImageGridSkeleton />}
      </PageShell>
    );
  }

  return (
    <PageShell>
      {tabs}
      {activeTab === 'derpibooru' && !apiKey ? (
        <EmptyState title="未绑定 API Key">
          <p className="text-body-m text-on-surface-variant mb-6">
            您需要绑定 Derpibooru API Key 才能查看 Derpibooru 的收藏数据
          </p>
          <Button variant="filled" onClick={() => router.push('/settings')}>
            去绑定
          </Button>
        </EmptyState>
      ) : !hasContent ? (
        <EmptyState title="还没有收藏任何图片" />
      ) : (
        <div
          aria-busy={isLoading || undefined}
          className={`transition-opacity duration-200 ease-[var(--ease-standard)] ${
            isLoading ? 'pointer-events-none opacity-50' : 'opacity-100'
          }`}
        >
          <MasonryGrid images={images} />
          {hasMore && <LoadMoreButton onClick={loadMore} isLoading={isLoadingMore} />}
        </div>
      )}
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
      <FavoritesList />
    </Suspense>
  );
}
