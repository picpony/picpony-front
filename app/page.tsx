'use client';

import { Suspense, useState, useEffect, useCallback } from "react";
import {
  MdAdd,
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

function ImageList() {
  const [images, setImages] = useState<PonyImage[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let isMounted = true;

    api.getImages(undefined, page)
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
  }, [page, retryCount]);

  const handleRetry = useCallback(() => setRetryCount(c => c + 1), []);
  const handlePageChange = useCallback((newPage: number) => {
    if (newPage >= 1) {
      setIsLoading(true);
      setError(null);
      setPage(newPage);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

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
        onRetry={handleRetry}
      />
    );
  }

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

  const handleRetry = useCallback(() => {
    setIsLoading(true);
    setError(null);
    setRetryCount(c => c + 1);
  }, []);

  const handlePageChange = useCallback((newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setIsLoading(true);
      setError(null);
      setPage(newPage);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [totalPages]);

  const handlePostClick = useCallback((postId: number) => {
    router.push(`/forum/${postId}`);
  }, [router]);

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
        onRetry={handleRetry}
        onPageChange={handlePageChange}
        onPostClick={handlePostClick}
      />
    </div>
  );
}

function HomeContent() {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab: HomeTab = tabParam === 'forum' ? 'forum' : 'gallery';

  useEffect(() => { document.title = "主页 - PicPony"; }, []);

  return (
    <>
      <div className="max-w-7xl mx-auto px-2 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-8">
        <div key={tab} className="animate-fade-in">
          {tab === 'gallery' ? (
            <>
              <FeaturedBanner />
              <ImageList />
            </>
          ) : (
            <ForumTab />
          )}
        </div>
      </div>
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
