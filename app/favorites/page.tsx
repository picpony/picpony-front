'use client';

import { Suspense, useState, useEffect, useCallback } from "react";
import { MdCollectionsBookmark } from "react-icons/md";
import { api, PonyImage } from "@/lib/api";
import { useAuth } from "@/lib/hooks";
import MasonryGrid from "@/components/MasonryGrid";
import ImageGridSkeleton from "@/components/ImageGridSkeleton";
import ErrorRetry from "@/components/ErrorRetry";
import { LoadMoreButton } from "@/components/Pagination";
import TabBar from "@/components/TabBar";
import { useRouter } from "next/navigation";

function FavoritesList() {
  const [images, setImages] = useState<PonyImage[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [faveIds, setFaveIds] = useState<number[]>([]);
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'picpony' | 'derpibooru'>('picpony');
  const [apiKey, setApiKey] = useState<string | null>(null);
  const { getUserInfo } = useAuth();

  const loadDerpibooruFaves = useCallback(async (key: string, targetPage: number) => {
    try {
      const query = encodeURIComponent('(my:faves), -explicit, -questionable, -suggestive, -grotesque, -grimdark, -spoiler, -anthro, -humanized, pony');
      const res = await fetch(`https://trixiebooru.org/api/v1/json/search/images?q=${query}&page=${targetPage}&per_page=50&sf=created_at&sd=desc&key=${key}`, {
        cache: 'no-store',
        headers: {
          'User-Agent': 'PicPony/1.0'
        }
      });

      if (!res.ok) throw new Error('Failed to load Derpibooru favorites');

      const data = await res.json();

      if (targetPage === 1) {
        setImages(data.images);
      } else {
        setImages(prev => {
          const existingIds = new Set(prev.map(img => img.id));
          const newImages = data.images.filter((img: PonyImage) => !existingIds.has(img.id));
          return [...prev, ...newImages];
        });
      }

      setPage(targetPage);
      setHasMore(data.images.length === 50);
    } catch (err) {
      console.error("Failed to load Derpibooru favorites:", err);
      if (targetPage === 1) setError(err as Error);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, []);

  const loadImages = useCallback(async (ids: number[], targetPage: number) => {
    try {
      const idsForPage = ids.slice((targetPage - 1) * 50, targetPage * 50);

      if (idsForPage.length === 0) {
        setHasMore(false);
        setIsLoading(false);
        return;
      }

      const query = idsForPage.map(id => `id:${id}`).join(' OR ');

      const res = await fetch(`https://trixiebooru.org/api/v1/json/search/images?q=${encodeURIComponent(query)}&page=1&per_page=50`, {
        cache: 'no-store',
        headers: {
          'User-Agent': 'PicPony/1.0'
        }
      });

      if (!res.ok) throw new Error('Failed to load image details');

      const data = await res.json();

      const sortedImages = data.images.sort((a: PonyImage, b: PonyImage) => {
        return idsForPage.indexOf(a.id) - idsForPage.indexOf(b.id);
      });

      if (targetPage === 1) {
        setImages(sortedImages);
      } else {
        setImages(prev => {
          const existingIds = new Set(prev.map(img => img.id));
          const newImages = sortedImages.filter((img: PonyImage) => !existingIds.has(img.id));
          return [...prev, ...newImages];
        });
      }

      setPage(targetPage);
      setHasMore(targetPage * 50 < ids.length);
    } catch (err) {
      console.error("Failed to load image details:", err);
      if (targetPage === 1) setError(err as Error);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    const fetchFaves = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const userInfo = getUserInfo();
        if (!userInfo) {
          router.push('/login');
          return;
        }

        const userRes = await api.getUser(userInfo.token);
        const userData = await userRes.json();
        const currentApiKey = userData.success && userData.user ? userData.user.api_key : null;
        setApiKey(currentApiKey);

        if (activeTab === 'picpony') {
          const res = await api.getFaves(userInfo.token);
          if (res.success && res.faves) {
            setFaveIds(res.faves);
            if (res.faves.length === 0) {
              setImages([]);
              setHasMore(false);
              setIsLoading(false);
            } else {
              loadImages(res.faves, 1);
            }
          } else {
            throw new Error(res.message || 'Failed to fetch favorites');
          }
        } else {
          if (!currentApiKey) {
            setImages([]);
            setHasMore(false);
            setIsLoading(false);
            return;
          }
          loadDerpibooruFaves(currentApiKey, 1);
        }
      } catch (err) {
        setError(err as Error);
        setIsLoading(false);
      }
    };

    fetchFaves();
  }, [retryCount, activeTab, router, getUserInfo, loadImages, loadDerpibooruFaves]);

  const loadMore = async () => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    if (activeTab === 'picpony') {
      await loadImages(faveIds, page + 1);
    } else if (apiKey) {
      await loadDerpibooruFaves(apiKey, page + 1);
    }
  };

  const tabsComponent = (
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

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-2 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-8">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-6">我的收藏</h1>
        {tabsComponent}
        <ImageGridSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-2 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-8">
        <ErrorRetry
          message={error.message}
          onRetry={() => setRetryCount(c => c + 1)}
        />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-2 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-8">
      <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-6">我的收藏</h1>
      {tabsComponent}

      {activeTab === 'derpibooru' && !apiKey ? (
        <div key="no-key" className="flex flex-col items-center justify-center min-h-[40vh] text-slate-500 dark:text-slate-400 animate-page-transition px-4 text-center">
          <MdCollectionsBookmark size={48} className="mb-4 text-slate-300 dark:text-slate-500" />
          <h2 className="text-xl font-medium mb-2 text-slate-600 dark:text-slate-300">未绑定 API Key</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
            您需要绑定 Derpibooru API Key 才能查看 Derpibooru 的收藏数据
          </p>
          <button
            onClick={() => router.push('/settings')}
            data-ripple
            className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 hover:shadow-md hover:shadow-primary/25 active:scale-95 transition-all duration-200"
          >
            去绑定
          </button>
        </div>
      ) : images.length === 0 ? (
        <div key="empty" className="flex flex-col items-center justify-center min-h-[40vh] text-slate-500 dark:text-slate-400 animate-page-transition px-4 text-center">
          <MdCollectionsBookmark size={48} className="mb-4 text-slate-300 dark:text-slate-500" />
          <h2 className="text-xl font-medium mb-2 text-slate-600 dark:text-slate-300">滚木</h2>
        </div>
      ) : (
        <div key={activeTab} className="animate-page-transition">
          <MasonryGrid images={images} />
          {hasMore && (
            <LoadMoreButton onClick={loadMore} isLoading={isLoadingMore} />
          )}
        </div>
      )}
    </div>
  );
}

export default function Favorites() {
  return (
    <Suspense fallback={<ImageGridSkeleton />}>
      <FavoritesList />
    </Suspense>
  );
}
