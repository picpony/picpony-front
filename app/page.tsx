'use client';

import { Suspense, useState, useEffect, useRef } from "react";
import FadeInImage from "@/components/FadeInImage";
import { MdErrorOutline, MdRefresh, MdThumbUp, MdComment, MdArrowBack } from "react-icons/md";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, PonyImage } from "@/lib/api";
import FeaturedBanner from "@/components/FeaturedBanner";
import Tooltip from '@mui/material/Tooltip';

function ImageList({ search }: { search?: string }) {
  const [images, setImages] = useState<PonyImage[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [columns, setColumns] = useState(4);

  useEffect(() => {
    const updateColumns = () => {
      if (window.innerWidth < 640) setColumns(2);
      else if (window.innerWidth < 768) setColumns(2);
      else if (window.innerWidth < 1024) setColumns(3);
      else setColumns(4);
    };
    
    updateColumns();
    window.addEventListener('resize', updateColumns);
    return () => window.removeEventListener('resize', updateColumns);
  }, []);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setError(null);

    api.getImages(search, page)
      .then((res) => {
        if (isMounted) {
          setImages(res.images);
          setHasMore(res.images.length === 50);
          setIsLoading(false);
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
  }, [search, page, retryCount]);

  if (isLoading) {
    return <ImageSkeleton />;
  }

  if (error) {
    const status = (error as { status?: number }).status;
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-slate-500 dark:text-slate-400 animate-fade-in px-4 text-center">
        <MdErrorOutline size={48} className="mb-4 text-slate-400 dark:text-slate-500" />
        <h2 className="text-xl font-semibold mb-2 text-slate-700 dark:text-slate-200">图片加载失败</h2>
        <div className="mb-6 max-w-md">
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">
            {status == 429 || error.message === 'Failed to fetch' || error.message === 'Too Many Requests' ? '你的请求次数过快，超出原站限制' : (
              <>{status ? `HTTP Error ${status}: ` : ''}{error.message}</>
            )}
          </p>
        </div>
        <button 
          onClick={() => setRetryCount(c => c + 1)}
          className="flex items-center px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90 transition-colors cursor-pointer"
        >
          <MdRefresh size={20} className="mr-2" />
          <span>重试</span>
        </button>
      </div>
    );
  }

  const columnData: PonyImage[][] = Array.from({ length: columns }, () => []);
  const columnHeights = new Array(columns).fill(0);

  images.forEach((img) => {
    let shortestColIndex = 0;
    let minHeight = columnHeights[0];
    for (let i = 1; i < columns; i++) {
      if (columnHeights[i] < minHeight) {
        minHeight = columnHeights[i];
        shortestColIndex = i;
      }
    }

    columnData[shortestColIndex].push(img);
    
    const aspectRatio = (img.height || 1) / (img.width || 1);
    columnHeights[shortestColIndex] += aspectRatio;
  });

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1) {
      setPage(newPage);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <>
      <div className="flex gap-2 sm:gap-4 animate-fade-in items-start">
        {columnData.map((col, colIndex) => (
          <div key={colIndex} className="flex flex-col gap-2 sm:gap-4 flex-1 min-w-0">
            {col.map((image) => {
              const fullUrl = image.representations?.full || image.view_url || '';
              const thumbUrl = image.representations?.thumb || image.representations?.full || image.view_url || '';
              const isWebm = fullUrl.endsWith('.webm');
              const format = fullUrl.split('.').pop()?.toUpperCase() || 'UNKNOWN';
              
              return (
                <div key={image.id} className="w-full">
                  <Link 
                    href={`/pic/${image.id}`}
                    className="block relative rounded-lg overflow-hidden group bg-slate-100 dark:bg-slate-800 w-full text-left cursor-pointer"
                  >
                    {isWebm ? (
                      <div 
                        className="relative w-full overflow-hidden" 
                        style={{ paddingBottom: `${((image.height || 1) / (image.width || 1)) * 100}%` }}
                      >
                        <video
                          src={`${fullUrl}#t=0.1`}
                          preload="metadata"
                          className="absolute top-0 left-0 w-full h-full object-cover transition-all duration-500"
                        />
                      </div>
                    ) : (
                      <FadeInImage
                        src={thumbUrl}
                        alt={image.name || `Image ${image.id}`}
                        width={image.width || 0}
                        height={image.height || 0}
                        className="w-full h-auto object-cover transition-all duration-500"
                        sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
                      />
                    )}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300" />
                    <div className="absolute top-2 right-2 px-2 py-1 bg-black/50 text-white text-xs font-medium rounded backdrop-blur-sm pointer-events-none">
                      {format}
                    </div>
                    <Tooltip title="点赞数" placement="top" arrow>
                      <div className="absolute bottom-2 left-2 px-2 py-1 bg-black/50 text-white text-xs font-medium rounded backdrop-blur-sm flex items-center gap-1">
                        <MdThumbUp size={12} />
                        <span>{image.score}</span>
                      </div>
                    </Tooltip>
                    <Tooltip title="评论数" placement="top" arrow>
                      <div className="absolute bottom-2 right-2 px-2 py-1 bg-black/50 text-white text-xs font-medium rounded backdrop-blur-sm flex items-center gap-1">
                        <MdComment size={12} />
                        <span>{image.comment_count}</span>
                      </div>
                    </Tooltip>
                  </Link>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="mt-12 flex justify-center items-center gap-2">
        <button
          onClick={() => handlePageChange(page - 1)}
          disabled={page === 1 || isLoadingMore}
          className="px-4 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          上一页
        </button>
        
        <div className="flex items-center gap-2">
          {Array.from({ length: 5 }, (_, i) => {
            let pageNum;
            if (page <= 3) {
              pageNum = i + 1;
            } else {
              pageNum = page - 2 + i;
            }

            return (
              <button
                key={pageNum}
                onClick={() => handlePageChange(pageNum)}
                disabled={isLoadingMore}
                    className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
                      page === pageNum
                        ? 'bg-primary text-white font-medium'
                        : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {pageNum}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => handlePageChange(page + 1)}
          disabled={!hasMore || isLoadingMore}
          className="px-4 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          下一页
        </button>
      </div>
    </>
  );
}

function ImageSkeleton() {
  const skeletonHeights = [
    [280, 320, 240],
    [200, 380, 260],
    [340, 220, 300],
    [260, 280, 340]
  ];

  return (
    <div className="flex gap-2 sm:gap-4 animate-fade-in items-start">
      {skeletonHeights.map((colHeights, colIndex) => (
        <div 
          key={colIndex} 
          className={`flex flex-col gap-2 sm:gap-4 flex-1 min-w-0 ${
            colIndex === 2 ? 'hidden md:flex' : 
            colIndex === 3 ? 'hidden lg:flex' : 
            colIndex >= 2 ? 'hidden' : 'flex'
          }`}
        >
          {colHeights.map((height, i) => (
            <div 
              key={i} 
              className="w-full bg-slate-100 dark:bg-slate-700 rounded-lg animate-pulse"
              style={{ height: `${height}px` }}
            ></div>
          ))}
        </div>
      ))}
    </div>
  );
}

function HomeContent() {
  const searchParams = useSearchParams();
  const search = searchParams.get('search') || undefined;
  
  const [customResults, setCustomResults] = useState<PonyImage[] | null>(null);

  useEffect(() => {
    const handleImageSearchResults = (e: CustomEvent<PonyImage[]>) => {
      setCustomResults(e.detail);
    };

    window.addEventListener('image_search_results', handleImageSearchResults as EventListener);
    
    return () => window.removeEventListener('image_search_results', handleImageSearchResults as EventListener);
  }, []);

  useEffect(() => {
    const pendingResults = sessionStorage.getItem('pending_image_search_results');
    if (pendingResults) {
      try {
        const parsedResults = JSON.parse(pendingResults);
        setTimeout(() => {
          setCustomResults(parsedResults);
        }, 0);
        sessionStorage.removeItem('pending_image_search_results');
      } catch (e) {
        console.error('Failed to parse pending search results', e);
      }
    }
  }, []);

  const prevSearchRef = useRef(search);
  useEffect(() => {
    if (prevSearchRef.current !== search) {
      setTimeout(() => {
        setCustomResults(null);
      }, 0);
      prevSearchRef.current = search;
    }
  }, [search]);

  useEffect(() => {
    document.title = "主页 - PicPony";
  }, []);

  const clearCustomResults = () => {
    setCustomResults(null);
  };

  return (
    <div className="max-w-7xl mx-auto px-2 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-8">
      {customResults ? (
        <CustomImageList images={customResults} onBack={clearCustomResults} />
      ) : (
        <>
          <FeaturedBanner />
          <ImageList search={search} />
        </>
      )}
    </div>
  );
}

function CustomImageList({ images, onBack }: { images: PonyImage[], onBack: () => void }) {
  const [columns, setColumns] = useState(4);

  useEffect(() => {
    const updateColumns = () => {
      if (window.innerWidth < 640) setColumns(2);
      else if (window.innerWidth < 768) setColumns(2);
      else if (window.innerWidth < 1024) setColumns(3);
      else setColumns(4);
    };
    
    updateColumns();
    window.addEventListener('resize', updateColumns);
    return () => window.removeEventListener('resize', updateColumns);
  }, []);

  const columnData: PonyImage[][] = Array.from({ length: columns }, () => []);
  const columnHeights = new Array(columns).fill(0);

  images.forEach((img) => {
    let shortestColIndex = 0;
    let minHeight = columnHeights[0];
    for (let i = 1; i < columns; i++) {
      if (columnHeights[i] < minHeight) {
        minHeight = columnHeights[i];
        shortestColIndex = i;
      }
    }

    columnData[shortestColIndex].push(img);
    
    const aspectRatio = (img.height || 1) / (img.width || 1);
    columnHeights[shortestColIndex] += aspectRatio;
  });

  if (images.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-slate-500 dark:text-slate-400 animate-fade-in px-4 text-center">
        <MdErrorOutline size={48} className="mb-4 text-slate-400 dark:text-slate-500" />
        <h2 className="text-xl font-semibold mb-2 text-slate-700 dark:text-slate-200">没有找到匹配的图片</h2>
        <button
          onClick={onBack}
          className="mt-6 flex items-center px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 rounded-lg transition-colors cursor-pointer"
        >
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
          <button
            onClick={onBack}
            className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg transition-colors cursor-pointer flex items-center justify-center"
            title="返回主页"
          >
            <MdArrowBack size={20} />
          </button>
          <div>
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">以图搜图</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">找到 {images.length} 张相似图片</p>
          </div>
        </div>
      </div>

      <div className="flex gap-2 sm:gap-4 animate-fade-in items-start">
        {columnData.map((col, colIndex) => (
          <div key={colIndex} className="flex flex-col gap-2 sm:gap-4 flex-1 min-w-0">
            {col.map((image) => {
              const fullUrl = image.representations?.full || image.view_url || '';
              const thumbUrl = image.representations?.thumb || image.representations?.full || image.view_url || '';
              const isWebm = fullUrl.endsWith('.webm');
              const format = fullUrl.split('.').pop()?.toUpperCase() || 'UNKNOWN';
              
              return (
                <div key={image.id} className="w-full">
                  <Link 
                    href={`/pic/${image.id}`}
                    className="block relative rounded-lg overflow-hidden group bg-slate-100 dark:bg-slate-800 w-full text-left cursor-pointer"
                  >
                    {isWebm ? (
                      <div 
                        className="relative w-full overflow-hidden" 
                        style={{ paddingBottom: `${((image.height || 1) / (image.width || 1)) * 100}%` }}
                      >
                        <video
                          src={`${fullUrl}#t=0.1`}
                          preload="metadata"
                          className="absolute top-0 left-0 w-full h-full object-cover transition-all duration-500"
                        />
                      </div>
                    ) : (
                      <FadeInImage
                        src={thumbUrl}
                        alt={image.name || `Image ${image.id}`}
                        width={image.width || 0}
                        height={image.height || 0}
                        className="w-full h-auto object-cover transition-all duration-500"
                        sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
                      />
                    )}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300" />
                    <div className="absolute top-2 right-2 px-2 py-1 bg-black/50 text-white text-xs font-medium rounded backdrop-blur-sm pointer-events-none">
                      {format}
                    </div>
                    <Tooltip title="点赞数" placement="top" arrow>
                      <div className="absolute bottom-2 left-2 px-2 py-1 bg-black/50 text-white text-xs font-medium rounded backdrop-blur-sm flex items-center gap-1">
                        <MdThumbUp size={12} />
                        <span>{image.score}</span>
                      </div>
                    </Tooltip>
                    <Tooltip title="评论数" placement="top" arrow>
                      <div className="absolute bottom-2 right-2 px-2 py-1 bg-black/50 text-white text-xs font-medium rounded backdrop-blur-sm flex items-center gap-1">
                        <MdComment size={12} />
                        <span>{image.comment_count}</span>
                      </div>
                    </Tooltip>
                  </Link>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<ImageSkeleton />}>
      <HomeContent />
    </Suspense>
  );
}
