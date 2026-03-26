'use client';

import { Suspense, useState, useEffect } from "react";
import FadeInImage from "@/components/FadeInImage";
import { MdErrorOutline, MdRefresh } from "react-icons/md";
import { useSearchParams } from "next/navigation";
import ImageModal from "@/components/ImageModal";

interface ImageRepresentation {
  full: string;
  small: string;
  thumb_tiny: string;
  thumb_small: string;
  thumb: string;
  medium: string;
  large: string;
  tall: string;
}

export interface PonyImage {
  id: number;
  width: number;
  height: number;
  aspect_ratio: number;
  representations: ImageRepresentation;
  name: string;
  view_url: string;
  uploader: string;
  created_at: string;
  size: number;
  score: number;
  tags: string[];
  description: string;
}

interface ApiResponse {
  total: number;
  images: PonyImage[];
}

async function getImages(search?: string, page: number = 1): Promise<ApiResponse> {
  let query = "-explicit%2C%20-questionable%2C%20-suggestive%2C%20-grotesque%2C%20-grimdark%2C%20-spoiler%2C%20pony";
  if (search) {
    query = `${encodeURIComponent(search)}%2C%20${query}`;
  }

  const res = await fetch(
    `https://derpibooru.org/api/v1/json/search/images?q=${query}&page=${page}&per_page=50&sf=created_at&sd=desc`,
    { 
      cache: 'no-store',
      headers: {
        'User-Agent': 'PicPony/1.0'
      }
    }
  );

  if (!res.ok) {
    const errorText = await res.text().catch(() => 'No error text');
    console.error(`API Error: ${res.status} ${res.statusText}`, errorText);
    const error = new Error(errorText || res.statusText);
    (error as any).status = res.status;
    throw error;
  }

  return res.json();
}

function ImageList({ search }: { search?: string }) {
  const [images, setImages] = useState<PonyImage[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [selectedImage, setSelectedImage] = useState<PonyImage | null>(null);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setError(null);
    setPage(1);

    getImages(search, 1)
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
      const res = await getImages(search, nextPage);
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

  return (
    <>
      <div className="columns-1 sm:columns-2 md:columns-3 lg:columns-4 gap-4 space-y-4 animate-fade-in">
        {images.map((image) => (
          <div key={image.id} className="break-inside-avoid">
            <button 
              onClick={() => setSelectedImage(image)}
              className="block relative rounded-lg overflow-hidden group bg-slate-100 w-full text-left cursor-pointer"
            >
              <FadeInImage
                src={image.representations.thumb}
                alt={image.name || `Image ${image.id}`}
                width={image.width}
                height={image.height}
                className="w-full h-auto object-cover transition-all duration-500"
                sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300" />
            </button>
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
