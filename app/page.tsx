'use client';

import { Suspense, useState, useEffect, useRef } from "react";
import {
  MdErrorOutline, MdArrowBack, MdRefresh, MdComment, MdVisibility, MdThumbUp, MdAdd,
} from "react-icons/md";
import { useSearchParams, useRouter } from "next/navigation";
import { api, PonyImage, applyCdn, ForumPost } from "@/lib/api";
import FeaturedBanner from "@/components/FeaturedBanner";
import MasonryGrid from "@/components/MasonryGrid";
import ImageGridSkeleton from "@/components/ImageGridSkeleton";
import Pagination from "@/components/Pagination";
import ErrorRetry from "@/components/ErrorRetry";

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

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="bg-white dark:bg-transparent p-4 rounded-xl animate-pulse flex gap-4">
            <div className="w-12 h-12 bg-slate-200 dark:bg-slate-700 rounded-full flex-shrink-0"></div>
            <div className="flex-1 space-y-3">
              <div className="h-5 bg-slate-200 dark:bg-slate-700 rounded w-3/4"></div>
              <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/4"></div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[30vh] text-slate-500 dark:text-slate-400 px-4 text-center">
        <MdErrorOutline size={40} className="mb-3" />
        <p className="text-sm mb-4">{error.message}</p>
        <button onClick={() => { setIsLoading(true); setError(null); setRetryCount(c => c + 1); }}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90 transition-colors cursor-pointer text-sm">
          <MdRefresh size={18} /> 重试
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">论坛</h2>
        <button onClick={() => router.push('/forum/create')}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors text-sm font-medium">
          <MdAdd size={16} /> 发帖
        </button>
      </div>

      <div className="space-y-3 mb-6">
        {posts.length === 0 ? (
          <div className="text-center py-10 text-slate-500 dark:text-slate-400 bg-white dark:bg-transparent rounded-xl text-sm">暂无帖子</div>
        ) : (
          posts.map(post => (
            <div key={post.id}
              onClick={() => router.push(`/forum/${post.id}`)}
              className="bg-white dark:bg-transparent p-4 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors duration-200 cursor-pointer">
              <div className="flex gap-3">
                <img src={post.avatar ? `https://picpony.top/${post.avatar}` : '/img/default-avatar.png'}
                  alt={post.username} className="w-10 h-10 rounded-full object-cover border border-slate-200 dark:border-slate-600 flex-shrink-0 mt-0.5"
                  onError={(e) => { (e.target as HTMLImageElement).src = '/img/default-avatar.png'; }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    {post.is_pinned === 1 && <span className="px-1.5 py-0.5 bg-red-100 text-red-600 text-xs font-medium rounded">置顶</span>}
                    <h3 className="font-semibold text-slate-800 dark:text-slate-100 truncate text-sm">{post.title}</h3>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-medium text-slate-700 dark:text-slate-300">{post.username}</span>
                    <span>{new Date(post.created_at).toLocaleDateString()}</span>
                    <span className="flex items-center gap-0.5"><MdVisibility size={13} />{post.views}</span>
                    <span className="flex items-center gap-0.5"><MdComment size={13} />{post.reply_count}</span>
                    <span className="flex items-center gap-0.5"><MdThumbUp size={13} />{post.like_count}</span>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-2">
          <button onClick={() => { if (page > 1) { setIsLoading(true); setError(null); setPage(page - 1); window.scrollTo({ top: 0, behavior: 'smooth' }); } }}
            disabled={page === 1}
            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">上一页</button>
          <span className="text-sm text-slate-500 px-2">{page} / {totalPages}</span>
          <button onClick={() => { if (page < totalPages) { setIsLoading(true); setError(null); setPage(page + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); } }}
            disabled={page === totalPages}
            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">下一页</button>
        </div>
      )}
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
