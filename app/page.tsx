'use client';

import { Suspense, useState, useEffect } from "react";
import FadeInImage from "@/components/FadeInImage";
import { MdErrorOutline, MdRefresh, MdThumbUp, MdComment } from "react-icons/md";
import { useSearchParams } from "next/navigation";
import ImageModal from "@/components/ImageModal";
import { api, PonyImage } from "@/lib/api";

function ImageList({ search }: { search?: string }) {
  const [images, setImages] = useState<PonyImage[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [selectedImage, setSelectedImage] = useState<PonyImage | null>(null);
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
    setPage(1);

    api.getImages(search, 1)
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
  }, [search, retryCount]);

  const loadMore = async () => {
    if (isLoadingMore || !hasMore) return;
    
    setIsLoadingMore(true);
    const nextPage = page + 1;
    
    try {
      const res = await api.getImages(search, nextPage);
      setImages(prev => {
        const existingIds = new Set(prev.map(img => img.id));
        const newImages = res.images.filter(img => !existingIds.has(img.id));
        return [...prev, ...newImages];
      });
      setPage(nextPage);
      setHasMore(res.images.length === 50);
    } catch (err) {
      console.error("Failed to load more images:", err);
    } finally {
      setIsLoadingMore(false);
    }
  };

  if (isLoading) {
    return <ImageSkeleton />;
  }

  if (error) {
    const status = (error as any).status;
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-slate-500 animate-fade-in px-4 text-center">
        <MdErrorOutline size={48} className="mb-4 text-slate-400" />
        <h2 className="text-xl font-semibold mb-2 text-slate-700">图片加载失败</h2>
        <div className="mb-6 max-w-md">
          <p className="text-sm text-slate-500 mb-1">
            {status ? `HTTP Error ${status}: ` : ''}{error.message}
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
    
    const aspectRatio = img.height / img.width;
    columnHeights[shortestColIndex] += aspectRatio;
  });

  return (
    <>
      <div className="flex gap-2 sm:gap-4 animate-fade-in items-start">
        {columnData.map((col, colIndex) => (
          <div key={colIndex} className="flex flex-col gap-2 sm:gap-4 flex-1 min-w-0">
            {col.map((image) => {
              const isWebm = image.representations.full.endsWith('.webm');
              const format = image.representations.full.split('.').pop()?.toUpperCase() || 'UNKNOWN';
              
              return (
                <div key={image.id} className="w-full">
                  <button 
                    onClick={() => setSelectedImage(image)}
                    className="block relative rounded-lg overflow-hidden group bg-slate-100 w-full text-left cursor-pointer"
                  >
                    {isWebm ? (
                      <div 
                        className="relative w-full overflow-hidden" 
                        style={{ paddingBottom: `${(image.height / image.width) * 100}%` }}
                      >
                        <video
                          src={`${image.representations.full}#t=0.1`}
                          preload="metadata"
                          className="absolute top-0 left-0 w-full h-full object-cover transition-all duration-500"
                        />
                      </div>
                    ) : (
                      <FadeInImage
                        src={image.representations.thumb}
                        alt={image.name || `Image ${image.id}`}
                        width={image.width}
                        height={image.height}
                        className="w-full h-auto object-cover transition-all duration-500"
                        sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
                      />
                    )}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300" />
                    <div className="absolute top-2 right-2 px-2 py-1 bg-black/50 text-white text-xs font-medium rounded backdrop-blur-sm pointer-events-none">
                      {format}
                    </div>
                    <div className="absolute bottom-2 left-2 px-2 py-1 bg-black/50 text-white text-xs font-medium rounded backdrop-blur-sm pointer-events-none flex items-center gap-1">
                      <MdThumbUp size={12} />
                      <span>{image.score}</span>
                    </div>
                    <div className="absolute bottom-2 right-2 px-2 py-1 bg-black/50 text-white text-xs font-medium rounded backdrop-blur-sm pointer-events-none flex items-center gap-1">
                      <MdComment size={12} />
                      <span>{image.comment_count}</span>
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {hasMore && (
        <div className="mt-12 flex justify-center">
          <button
            onClick={loadMore}
            disabled={isLoadingMore}
            className="px-8 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-full transition-all duration-200 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed group"
          >
            {isLoadingMore ? (
              <div className="w-5 h-5 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
            ) : (
              <MdRefresh size={20} className="group-hover:rotate-180 transition-transform duration-500" />
            )}
            <span>加载更多</span>
          </button>
        </div>
      )}

      <ImageModal 
        image={selectedImage} 
        onClose={() => setSelectedImage(null)} 
      />
    </>
  );
}

function ImageSkeleton() {
  return (
    <div className="flex justify-center items-center min-h-[50vh]">
      <div className="w-8 h-8 border-[4px] border-transparent border-t-primary rounded-full animate-[spin_0.5s_linear_infinite]"></div>
    </div>
  );
}

function HomeContent() {
  const searchParams = useSearchParams();
  const search = searchParams.get('search') || undefined;

  return (
    <div className="max-w-7xl mx-auto px-2 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-8">
      <ImageList search={search} />
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<ImageSkeleton />}>
      <HomeContent />
    </Suspense>
  );
}
