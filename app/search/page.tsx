'use client';

import { Suspense, useState, useEffect, useRef } from 'react';
import { MdSearch, MdImageSearch, MdErrorOutline, MdArrowBack } from 'react-icons/md';
import { useSearchParams, useRouter } from 'next/navigation';
import { api, PonyImage, applyCdn } from '@/lib/api';
import MasonryGrid from '@/components/MasonryGrid';
import ImageGridSkeleton from '@/components/ImageGridSkeleton';
import Pagination from '@/components/Pagination';
import ErrorRetry from '@/components/ErrorRetry';
import ImageSearchModal from '@/components/ImageSearchModal';
import { showToast } from '@/components/Toast';

function CustomImageList({ images, onBack }: { images: PonyImage[], onBack: () => void }) {
  if (images.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-slate-500 dark:text-slate-400 animate-fade-in px-4 text-center">
        <MdErrorOutline size={48} className="mb-4 text-slate-400 dark:text-slate-500" />
        <h2 className="text-xl font-semibold mb-2 text-slate-700 dark:text-slate-200">没有找到匹配的图片</h2>
        <button onClick={onBack}
          className="mt-6 flex items-center px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 rounded-lg transition-colors cursor-pointer">
          <MdArrowBack size={20} className="mr-2" />
          <span>返回</span>
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
            title="返回">
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

function SearchPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const q = searchParams.get('q') || '';

  const [inputValue, setInputValue] = useState(q);
  const [images, setImages] = useState<PonyImage[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isImageSearchOpen, setIsImageSearchOpen] = useState(false);
  const [customResults, setCustomResults] = useState<PonyImage[] | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    setInputValue(q);
  }, [q]);

  useEffect(() => {
    if (customResults) return;

    let isMounted = true;
    setIsLoading(true);
    setError(null);

    if (!q) {
      setIsLoading(false);
      setImages([]);
      return;
    }

    api.getImages(q, page)
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
        if (isMounted) { setError(err); setIsLoading(false); }
      });

    return () => { isMounted = false; };
  }, [q, page, retryCount, customResults]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim()) {
      const formattedQuery = inputValue.trim().replace(/，/g, ',');
      setCustomResults(null);
      setPage(1);
      router.push(`/search?q=${encodeURIComponent(formattedQuery)}`);
    } else {
      router.push('/');
    }
  };

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1) {
      setIsLoading(true);
      setError(null);
      setPage(newPage);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleImageSearchSuccess = (results: PonyImage[]) => {
    setCustomResults(results);
    showToast(`找到 ${results.length} 张相似图片`, 'success');
  };

  const clearCustomResults = () => {
    setCustomResults(null);
  };

  return (
    <div className="max-w-7xl mx-auto px-2 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-8 animate-fade-in">
      <div className="mb-6 max-w-3xl mx-auto">
        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <div className="flex-1 relative">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="搜索图片..."
              className="w-full px-4 py-3 pl-12 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none transition-all text-base"
            />
            <MdSearch size={22} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
          </div>
          <button
            type="submit"
            className="px-5 py-3 bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors font-medium whitespace-nowrap"
          >
            搜索
          </button>
          <button
            type="button"
            onClick={() => setIsImageSearchOpen(true)}
            className="p-3 text-slate-500 dark:text-slate-400 hover:text-primary hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all"
            title="以图搜图"
          >
            <MdImageSearch size={22} />
          </button>
        </form>
      </div>

      {customResults ? (
        <CustomImageList images={customResults} onBack={clearCustomResults} />
      ) : !q ? (
        <div className="flex flex-col items-center justify-center min-h-[40vh] text-slate-400 dark:text-slate-500 animate-fade-in">
          <MdSearch size={64} className="mb-4" />
          <p className="text-lg">输入关键词搜索图片</p>
        </div>
      ) : isLoading ? (
        <ImageGridSkeleton />
      ) : error ? (
        <ErrorRetry
          title="搜索失败"
          message={
            (error as { status?: number }).status == 429 || error.message === 'Failed to fetch' || error.message === 'Too Many Requests'
              ? '请求次数过快，超出原站限制'
              : `${(error as { status?: number }).status ? `HTTP Error ${(error as { status?: number }).status}: ` : ''}${error.message}`
          }
          onRetry={() => setRetryCount(c => c + 1)}
        />
      ) : images.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[40vh] text-slate-400 dark:text-slate-500 animate-fade-in">
          <MdErrorOutline size={48} className="mb-4" />
          <p className="text-lg">没有找到匹配的图片</p>
        </div>
      ) : (
        <>
          <div className="mb-3 text-sm text-slate-500 dark:text-slate-400">
            搜索：{q} — 第 {page} 页
          </div>
          <MasonryGrid images={images} />
          <Pagination
            currentPage={page}
            hasMore={hasMore}
            onPageChange={handlePageChange}
          />
        </>
      )}

      <ImageSearchModal
        isOpen={isImageSearchOpen}
        onClose={() => setIsImageSearchOpen(false)}
        onSearchSuccess={handleImageSearchSuccess}
      />
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<ImageGridSkeleton />}>
      <SearchPageContent />
    </Suspense>
  );
}
