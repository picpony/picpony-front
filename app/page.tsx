'use client';

import { Suspense, useState, useEffect, useRef } from "react";
import {
  MdErrorOutline, MdArrowBack, MdAdd,
} from "react-icons/md";
import { useSearchParams, useRouter } from "next/navigation";
import { api, PonyImage, applyCdn, ForumPost } from "@/lib/api";
import FeaturedBanner from "@/components/FeaturedBanner";
import MasonryGrid from "@/components/MasonryGrid";
import ImageGridSkeleton from "@/components/ImageGridSkeleton";
import Pagination from "@/components/Pagination";
import ErrorRetry from "@/components/ErrorRetry";
import ForumPostList from "@/components/ForumPostList";

type HomeTab = 'gallery' | 'forum';

function ImageList({ search }: { search?: string }) {
  const [images, setImages] = useState<PonyImage[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let isMounted = true;

    api.getImages(search, page)
      .then((res) => {
        if (isMounted) {
          let imgs = res.images;
          if (localStorage.getItem('trixie_use_cdn') === 'true') {
            imgs = imgs.map(img => ({
              ...img,
              representations: Object.fromEntries(
                Object.entries(img.representations).map(([k, v]) => [k, applyCdn(v)])
              ) as unknown as PonyImage['representations'],
              view_url: applyCdn(img.view_url),
            }));
          }
          setImages(imgs);
          setHasMore(imgs.length === 50);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err);
          setIsLoading(false);
        }
      });

    return () => { isMounted = false; };
  }, [search, page, retryCount]);

  if (isLoading) return <ImageGridSkeleton />;

  if (error) {
    const status = (error as { status?: number }).status;
    return (
      <ErrorRetry
        title="图片加载失败"
        message={
          status == 429 || error.message === 'Failed to fetch' || error.message === 'Too Many Requests'
            ? '你的请求次数过快，超出原站限制'
            : `${status ? `HTTP Error ${status}: ` : ''}${error.message}`
        }
        onRetry={() => setRetryCount(c => c + 1)}
      />
    );
  }

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1) {
      setIsLoading(true);
      setError(null);
      setPage(newPage);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <>
      <MasonryGrid images={images} />
      <Pagination
        currentPage={page}
        hasMore={hasMore}
        onPageChange={handlePageChange}
        disabled={isLoadingMore}
      />
    </>
  );
}

function ForumTab() {
  const router = useRouter();
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let isMounted = true;
    api.getForumPosts(page)
      .then((res) => {
        if (isMounted) {
          setPosts(res.posts);
          setTotalPages(res.total_pages);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) { setError(err); setIsLoading(false); }
      });
    return () => { isMounted = false; };
  }, [page, retryCount]);

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">论坛</h2>
        <button onClick={() => router.push('/forum/create')}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors text-sm font-medium">
          <MdAdd size={16} /> 发帖
        </button>
      </div>
      <ForumPostList
        posts={posts}
        page={page}
        totalPages={totalPages}
        isLoading={isLoading}
        error={error}
        onRetry={() => { setIsLoading(true); setError(null); setRetryCount(c => c + 1); }}
        onPageChange={(newPage) => {
          if (newPage >= 1 && newPage <= totalPages) {
            setIsLoading(true);
            setError(null);
            setPage(newPage);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
        }}
        onPostClick={(postId) => router.push(`/forum/${postId}`)}
      />
    </div>
  );
}

function HomeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const search = searchParams.get('search') || undefined;
  const tabParam = searchParams.get('tab');
  const tab: HomeTab = tabParam === 'forum' ? 'forum' : 'gallery';
  const [customResults, setCustomResults] = useState<PonyImage[] | null>(null);

  useEffect(() => {
    const handleImageSearchResults = (e: CustomEvent<PonyImage[]>) => setCustomResults(e.detail);
    window.addEventListener('image_search_results', handleImageSearchResults as EventListener);
    return () => window.removeEventListener('image_search_results', handleImageSearchResults as EventListener);
  }, []);

  useEffect(() => {
    const pendingResults = sessionStorage.getItem('pending_image_search_results');
    if (pendingResults) {
      try {
        const parsedResults = JSON.parse(pendingResults);
        setTimeout(() => setCustomResults(parsedResults), 0);
        sessionStorage.removeItem('pending_image_search_results');
      } catch (e) { console.error('Failed to parse pending search results', e); }
    }
  }, []);

  const prevSearchRef = useRef(search);
  useEffect(() => {
    if (prevSearchRef.current !== search) {
      setTimeout(() => setCustomResults(null), 0);
      prevSearchRef.current = search;
    }
  }, [search]);

  useEffect(() => { document.title = "主页 - PicPony"; }, []);

  const clearCustomResults = () => setCustomResults(null);

  return (
    <>
      <div className="max-w-7xl mx-auto px-2 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-8">
        {customResults ? (
          <CustomImageList images={customResults} onBack={clearCustomResults} />
        ) : (
          <div key={tab} className="animate-fade-in">
            {tab === 'gallery' ? (
              <>
                <FeaturedBanner />
                <ImageList search={search} />
              </>
            ) : (
              <ForumTab />
            )}
          </div>
        )}
      </div>
    </>
  );
}

function CustomImageList({ images, onBack }: { images: PonyImage[], onBack: () => void }) {
  if (images.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-slate-500 dark:text-slate-400 animate-fade-in px-4 text-center">
        <MdErrorOutline size={48} className="mb-4 text-slate-400 dark:text-slate-500" />
        <h2 className="text-xl font-semibold mb-2 text-slate-700 dark:text-slate-200">没有找到匹配的图片</h2>
        <button onClick={onBack}
          className="mt-6 flex items-center px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 rounded-lg transition-colors cursor-pointer">
          <MdArrowBack size={20} className="mr-2" />
          <span>返回主页</span>
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="mb-6 flex items-center justify-between p-4 rounded-xl">
        <div className="flex items-center gap-3">
          <button onClick={onBack}
            className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg transition-colors cursor-pointer flex items-center justify-center"
            title="返回主页">
            <MdArrowBack size={20} />
          </button>
          <div>
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">以图搜图</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">找到 {images.length} 张相似图片</p>
          </div>
        </div>
      </div>
      <MasonryGrid images={images} />
    </>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<ImageGridSkeleton />}>
      <HomeContent />
    </Suspense>
  );
}
