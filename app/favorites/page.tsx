'use client';

import { Suspense, useState, useEffect } from "react";
import FadeInImage from "@/components/FadeInImage";
import { MdErrorOutline, MdRefresh, MdThumbUp, MdComment, MdCollectionsBookmark } from "react-icons/md";
import Link from "next/link";
import { api, PonyImage } from "@/lib/api";
import Tooltip from '@mui/material/Tooltip';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Box from '@mui/material/Box';
import { useRouter } from "next/navigation";

function FavoritesList() {
  const [images, setImages] = useState<PonyImage[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [cdnEnabled, setCdnEnabled] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [columns, setColumns] = useState(4);
  const [faveIds, setFaveIds] = useState<number[]>([]);
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'picpony' | 'derpibooru'>('picpony');
  const [apiKey, setApiKey] = useState<string | null>(null);

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
    const checkCdn = () => {
      const storedCdn = localStorage.getItem('cdn_enabled');
      setCdnEnabled(storedCdn === 'true');
    };

    checkCdn();
    window.addEventListener('cdn_settings_updated', checkCdn);
    return () => window.removeEventListener('cdn_settings_updated', checkCdn);
  }, []);

  useEffect(() => {
    const fetchFaves = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const storedUser = localStorage.getItem('user_info');
        if (!storedUser) {
          router.push('/login');
          return;
        }

        const userInfo = JSON.parse(storedUser);

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
  }, [retryCount, activeTab, router]);

  const loadDerpibooruFaves = async (key: string, targetPage: number) => {
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
  };

  const loadImages = async (ids: number[], targetPage: number) => {
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
  };

  const loadMore = async () => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    if (activeTab === 'picpony') {
      await loadImages(faveIds, page + 1);
    } else if (apiKey) {
      await loadDerpibooruFaves(apiKey, page + 1);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-2 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-8">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-6">我的收藏</h1>

        <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 4 }}>
          <Tabs 
            value={activeTab} 
            onChange={(_, newValue) => setActiveTab(newValue)} 
            sx={{
              '& .MuiTabs-indicator': {
                backgroundColor: 'var(--color-primary)',
              },
              '& .MuiTab-root': {
                textTransform: 'none',
                fontWeight: 500,
                fontSize: '0.875rem',
                minWidth: 100,
                '&.Mui-selected': {
                  color: 'var(--color-primary)',
                }
              }
            }}
          >
            <Tab label="PicPony" value="picpony" />
            <Tab label="Derpibooru" value="derpibooru" />
          </Tabs>
        </Box>
        <ImageSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-2 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-8">
        <div className="flex flex-col items-center justify-center min-h-[50vh] text-slate-500 animate-fade-in px-4 text-center">
          <MdErrorOutline size={48} className="mb-4 text-slate-400" />
          <h2 className="text-xl font-semibold mb-2 text-slate-700">加载失败</h2>
          <div className="mb-6 max-w-md">
            <p className="text-sm text-slate-500 mb-1">
              {error.message}
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
      </div>
    );
  }

  const columnData: PonyImage[][] = Array.from({ length: columns }, () => []);
  const columnHeights = new Array(columns).fill(0);

  const getCdnUrl = (url: string) => {
    if (!cdnEnabled || !url) return url;
    return `https://wsrv.nl/?url=${encodeURIComponent(url)}`;
  };

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
    <div className="max-w-7xl mx-auto px-2 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-8">
      <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-6">我的收藏</h1>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 4 }}>
        <Tabs 
          value={activeTab} 
          onChange={(_, newValue) => setActiveTab(newValue)} 
          sx={{
            '& .MuiTabs-indicator': {
              backgroundColor: 'var(--color-primary)',
            },
            '& .MuiTab-root': {
              textTransform: 'none',
              fontWeight: 500,
              fontSize: '0.875rem',
              minWidth: 100,
              '&.Mui-selected': {
                color: 'var(--color-primary)',
              }
            }
          }}
        >
          <Tab label="PicPony" value="picpony" />
          <Tab label="Derpibooru" value="derpibooru" />
        </Tabs>
      </Box>

      {activeTab === 'derpibooru' && !apiKey ? (
        <div className="flex flex-col items-center justify-center min-h-[40vh] text-slate-500 dark:text-slate-400 animate-fade-in px-4 text-center">
          <MdErrorOutline size={48} className="mb-4 text-slate-300 dark:text-slate-500" />
          <h2 className="text-xl font-medium mb-2 text-slate-600 dark:text-slate-300">未绑定 API Key</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
            您需要绑定 Derpibooru API Key 才能查看 Derpibooru 的收藏数据
          </p>
          <button
            onClick={() => router.push('/settings')}
            className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
          >
            去绑定
          </button>
        </div>
      ) : images.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[40vh] text-slate-500 dark:text-slate-400 animate-fade-in px-4 text-center">
          <MdCollectionsBookmark size={48} className="mb-4 text-slate-300 dark:text-slate-500" />
          <h2 className="text-xl font-medium mb-2 text-slate-600 dark:text-slate-300">滚木</h2>
        </div>
      ) : (
        <>
          <div className="flex gap-2 sm:gap-4 animate-fade-in items-start">
            {columnData.map((col, colIndex) => (
              <div key={colIndex} className="flex flex-col gap-2 sm:gap-4 flex-1 min-w-0">
                {col.map((image) => {
                  const isWebm = image.representations.full.endsWith('.webm');
                  const format = image.representations.full.split('.').pop()?.toUpperCase() || 'UNKNOWN';

                  return (
                    <div key={image.id} className="w-full">
                      <Link
                        href={`/pic/${image.id}`}
                        className="block relative rounded-lg overflow-hidden group bg-slate-100 w-full text-left cursor-pointer"
                      >
                        {isWebm ? (
                          <div
                            className="relative w-full overflow-hidden"
                            style={{ paddingBottom: `${(image.height / image.width) * 100}%` }}
                          >
                            <video
                              src={`${getCdnUrl(image.representations.full)}#t=0.1`}
                              preload="metadata"
                              className="absolute top-0 left-0 w-full h-full object-cover transition-all duration-500"
                            />
                          </div>
                        ) : (
                          <FadeInImage
                            src={getCdnUrl(image.representations.thumb)}
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

          {hasMore && (
            <div className="mt-12 flex justify-center">
              <button
                onClick={loadMore}
                disabled={isLoadingMore}
                className="px-8 py-3 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 font-medium rounded-full transition-all duration-200 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed group"
              >
                {isLoadingMore ? (
                  <div className="flex gap-1 items-center animate-pulse">
                    <div className="w-1.5 h-1.5 bg-primary rounded-full"></div>
                    <div className="w-1.5 h-1.5 bg-primary rounded-full"></div>
                    <div className="w-1.5 h-1.5 bg-primary rounded-full"></div>
                  </div>
                ) : (
                  <MdRefresh size={20} className="group-hover:rotate-180 transition-transform duration-500" />
                )}
                <span>{isLoadingMore ? '正在加载' : '加载更多'}</span>
              </button>
            </div>
          )}
        </>
      )}
    </div>
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
          className={`flex flex-col gap-2 sm:gap-4 flex-1 min-w-0 ${colIndex === 2 ? 'hidden md:flex' :
              colIndex === 3 ? 'hidden lg:flex' :
                colIndex >= 2 ? 'hidden' : 'flex'
            }`}
        >
          {colHeights.map((height, i) => (
            <div
              key={i}
              className="w-full bg-slate-100 rounded-lg animate-pulse"
              style={{ height: `${height}px` }}
            ></div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function Favorites() {
  return (
    <Suspense fallback={<ImageSkeleton />}>
      <FavoritesList />
    </Suspense>
  );
}
