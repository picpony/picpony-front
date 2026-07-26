'use client';

import { Suspense, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { MdSearch, MdImageSearch, MdErrorOutline, MdArrowBack } from 'react-icons/md';
import { useRouter } from 'next/navigation';
import Spinner from '@/components/Spinner';
import { api, PonyImage, applyCdn } from '@/lib/api';
import MasonryGrid from '@/components/MasonryGrid';
import ImageGridSkeleton from '@/components/ImageGridSkeleton';
import MarkdownRenderer from '@/components/MarkdownRenderer';
import Pagination from '@/components/Pagination';
import ErrorRetry from '@/components/ErrorRetry';
import ImageSearchModal from '@/components/ImageSearchModal';
import { showToast } from '@/components/Toast';
import { useBackgroundSearchParams } from '@/components/BackgroundLocation';

interface DictionaryEntry {
  id: number;
  en: string;
  cn: string;
  cat: string;
  count: number;
  description: string;
  aliases: string[];
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
  const searchParams = useBackgroundSearchParams();
  const router = useRouter();
  const q = searchParams.get('q') || '';
  const sortParam = searchParams.get('sort') || '';
  const dirParam = searchParams.get('dir') || '';
  const defaultSort = typeof window !== 'undefined'
    ? (window.localStorage.getItem('picpony_default_search_sort') || 'created_at')
    : 'created_at';

  const [inputValue, setInputValue] = useState(q);
  const [images, setImages] = useState<PonyImage[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isImageSearchOpen, setIsImageSearchOpen] = useState(false);
  const [customResults, setCustomResults] = useState<PonyImage[] | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [sortBy, setSortBy] = useState(sortParam || defaultSort);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>((dirParam as 'asc' | 'desc') || 'desc');

  // Advanced search panel state
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advUpvoteOp, setAdvUpvoteOp] = useState('gte');
  const [advUpvoteVal, setAdvUpvoteVal] = useState('');
  const [advScoreOp, setAdvScoreOp] = useState('gte');
  const [advScoreVal, setAdvScoreVal] = useState('');
  const [advAspect, setAdvAspect] = useState('');
  const [advMedia, setAdvMedia] = useState('');
  const [advTime, setAdvTime] = useState('');

  const clearAdvancedFilters = useCallback(() => {
    setAdvUpvoteOp('gte');
    setAdvUpvoteVal('');
    setAdvScoreOp('gte');
    setAdvScoreVal('');
    setAdvAspect('');
    setAdvMedia('');
    setAdvTime('');
  }, []);

  const applyAdvancedFilters = useCallback(() => {
    const filters: string[] = [];
    if (advUpvoteVal) filters.push(`upvotes.${advUpvoteOp}:${advUpvoteVal}`);
    if (advScoreVal) filters.push(`score.${advScoreOp}:${advScoreVal}`);
    if (advAspect) filters.push(advAspect);
    if (advMedia) filters.push(advMedia);
    if (advTime) filters.push(advTime);

    let newQuery = inputValue.trim().replace(/，/g, ',').replace(/[,，]+$/g, '');
    if (filters.length > 0) {
      newQuery = newQuery ? `${newQuery}, ${filters.join(', ')}` : filters.join(', ');
    }
    setInputValue(newQuery);
    setCustomResults(null);
    setPage(1);
    router.push(`/search?q=${encodeURIComponent(newQuery)}`);
  }, [advUpvoteOp, advUpvoteVal, advScoreOp, advScoreVal, advAspect, advMedia, advTime, inputValue, router]);

  const tokenRef = useRef<string | null>(null);
  const [tagInfo, setTagInfo] = useState<{ data: DictionaryEntry | null; loading: boolean }>({
    data: null, loading: false
  });

  const inputWrapRef = useRef<HTMLDivElement>(null);
  const [suggestions, setSuggestions] = useState<DictionaryEntry[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [acCursor, setAcCursor] = useState(0);
  const acChunkRef = useRef<{ start: number; end: number; prefix: string }>({ start: 0, end: 0, prefix: '' });
  const acTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const acReqIdRef = useRef(0);

  const catColors: Record<string, string> = useMemo(() => ({
    default: 'bg-slate-400',
    artist: 'bg-red-500',
    oc: 'bg-orange-400',
    character: 'bg-purple-500',
    species: 'bg-green-500',
    rating: 'bg-pink-400',
    content_official: 'bg-yellow-500',
  }), []);

  const getCatColor = useCallback((cat: string) => {
    return catColors[cat] || catColors.default;
  }, [catColors]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);

    const cursorPos = e.target.selectionStart || 0;
    const separators = /(?:,|，| OR | AND |\|\||&&|\n)/gi;
    let match;
    let start = 0;
    separators.lastIndex = 0;
    while ((match = separators.exec(val)) !== null) {
      if (match.index < cursorPos) {
        start = match.index + match[0].length;
      } else break;
    }
    separators.lastIndex = cursorPos;
    const afterMatch = separators.exec(val);
    const end = afterMatch ? afterMatch.index : val.length;
    const rawChunk = val.substring(start, end);
    const prefixMatch = rawChunk.match(/^([\s\-!~]*)(.*)$/);
    const prefix = prefixMatch ? prefixMatch[1] : '';
    const currentTag = prefixMatch ? prefixMatch[2].trim() : rawChunk.trim();
    acChunkRef.current = { start, end, prefix };

    if (currentTag.length < 2 && !/[\u4e00-\u9fff]/.test(currentTag)) {
      setShowSuggestions(false);
      return;
    }

    clearTimeout(acTimerRef.current);
    acTimerRef.current = setTimeout(async () => {
      const reqId = Date.now();
      acReqIdRef.current = reqId;
      const cleanTag = currentTag.replace(/["()[\]{}*]/g, '');
      const token = tokenRef.current;
      if (!token) return;

      try {
        const res = await api.getDictionary(token, { keyword: cleanTag, limit: 10 });
        if (reqId !== acReqIdRef.current) return;
        if (res.success && res.tags) {
          setSuggestions(res.tags);
          setShowSuggestions(res.tags.length > 0);
          setAcCursor(0);
        } else {
          setShowSuggestions(false);
        }
      } catch {
        if (reqId === acReqIdRef.current) setShowSuggestions(false);
      }
    }, 300);
  }, []);

  const selectSuggestion = useCallback((tag: DictionaryEntry) => {
    const { start, end, prefix } = acChunkRef.current;
    const before = inputValue.substring(0, start);
    const after = inputValue.substring(end);
    const replacement = prefix + tag.en;
    const insertComma = after.trim() === '' ? ',' : '';
    const newVal = before + replacement + insertComma + after;
    setInputValue(newVal);
    setShowSuggestions(false);
  }, [inputValue]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (inputWrapRef.current && !inputWrapRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowSuggestions(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, []);

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAcCursor(prev => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAcCursor(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (acCursor >= 0 && acCursor < suggestions.length) {
        e.preventDefault();
        selectSuggestion(suggestions[acCursor]);
      }
    }
  }, [showSuggestions, suggestions, acCursor, selectSuggestion]);

  useEffect(() => {
    queueMicrotask(() => {
      setInputValue(q);
    });
  }, [q]);

  useEffect(() => {
    try {
      const userInfoStr = localStorage.getItem('user_info');
      if (userInfoStr) {
        const userInfo = JSON.parse(userInfoStr);
        tokenRef.current = userInfo.token || null;
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (customResults) return;

    let isMounted = true;
    queueMicrotask(() => {
      if (!isMounted) return;
      setIsLoading(true);
      setError(null);

      if (!q) {
        setIsLoading(false);
        setImages([]);
      }
    });

    if (!q) {
      return () => { isMounted = false; };
    }

    api.getImages(q, page, sortBy === 'random' ? undefined : sortBy, sortDir)
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
  }, [q, page, retryCount, customResults, sortBy, sortDir]);

  useEffect(() => {
    const isSingleTag = !!q && !/[ ,:*?]/.test(q) && !q.startsWith('-');

    if (!isSingleTag) {
      queueMicrotask(() => setTagInfo({ data: null, loading: false }));
      return;
    }

    queueMicrotask(() => setTagInfo({ data: null, loading: true }));

    const token = tokenRef.current;
    if (!token) {
      queueMicrotask(() => setTagInfo({ data: null, loading: false }));
      return;
    }

    let cancelled = false;

    api.getDictionary(token, { keyword: q, limit: 5 })
      .then(res => {
        if (cancelled) return;
        if (res.success && res.tags) {
          const match = res.tags.find((t: DictionaryEntry) => t.en.toLowerCase() === q.toLowerCase());
          setTagInfo({ data: match || null, loading: false });
        } else {
          setTagInfo({ data: null, loading: false });
        }
      })
      .catch(() => {
        if (!cancelled) setTagInfo({ data: null, loading: false });
      });

    return () => { cancelled = true; };
  }, [q]);

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim()) {
      const formattedQuery = inputValue.trim().replace(/，/g, ',').replace(/[,，]+$/g, '');
      setCustomResults(null);
      setPage(1);
      const sortParam = sortBy !== 'created_at' || sortDir !== 'desc' ? `&sort=${sortBy}&dir=${sortDir}` : '';
      router.push(`/search?q=${encodeURIComponent(formattedQuery)}${sortParam}`);
    } else {
      router.push('/');
    }
  }, [inputValue, router, sortBy, sortDir]);

  const handlePageChange = useCallback((newPage: number) => {
    if (newPage >= 1) {
      setIsLoading(true);
      setError(null);
      setPage(newPage);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  const handleImageSearchSuccess = (results: PonyImage[]) => {
    setCustomResults(results);
    showToast(`找到 ${results.length} 张相似图片`, 'success');
  };

  const clearCustomResults = () => {
    setCustomResults(null);
  };

  const handleRetry = useCallback(() => {
    setRetryCount(c => c + 1);
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-2 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-8 animate-fade-in">
      <div className="mb-6 max-w-3xl mx-auto">
        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <div className="flex-1 relative" ref={inputWrapRef}>
            <input
              type="text"
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleInputKeyDown}
              placeholder="搜索图片..."
              className="w-full px-4 py-3 pl-12 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none transition-all text-base"
            />
            <MdSearch size={22} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg overflow-hidden">
                <div className="max-h-64 overflow-y-auto">
                  {suggestions.map((tag, i) => (
                    <button
                      key={tag.id}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); selectSuggestion(tag); }}
                      onMouseEnter={() => setAcCursor(i)}
                      className={`flex items-center justify-between w-full px-3 py-2 text-left transition-colors ${
                        i === acCursor
                          ? 'bg-primary/10 dark:bg-primary/20'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${getCatColor(tag.cat)}`} />
                        <div className="min-w-0">
                          {tag.cn ? (
                            <span className="text-sm text-slate-800 dark:text-slate-200">
                              <span className="text-primary font-medium">{tag.cn}</span>
                              <span className="ml-1.5 opacity-50">{tag.en}</span>
                            </span>
                          ) : (
                            <span className="text-sm text-slate-800 dark:text-slate-200">{tag.en}</span>
                          )}
                        </div>
                      </div>
                      <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0 ml-2">
                        {tag.count?.toLocaleString()}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
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

      {tagInfo.loading ? (
        <div className="mb-6 flex items-center gap-2 text-sm text-slate-400">
          <Spinner size="sm" />
          <span>查询中...</span>
        </div>
      ) : tagInfo.data ? (
        <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm text-slate-600 dark:text-slate-400">
          {tagInfo.data.cn && (
            <div>
              <span className="text-xs text-slate-400">中文翻译</span>
              <p className="text-slate-700 dark:text-slate-300 font-medium">{tagInfo.data.cn}</p>
            </div>
          )}
          {tagInfo.data.count > 0 && (
            <div>
              <span className="text-xs text-slate-400">使用量</span>
              <p className="text-slate-700 dark:text-slate-300 font-medium">{tagInfo.data.count.toLocaleString()}</p>
            </div>
          )}
          {tagInfo.data.cat && (
            <div>
              <span className="text-xs text-slate-400">分类</span>
              <p className="text-slate-700 dark:text-slate-300">{tagInfo.data.cat}</p>
            </div>
          )}
          {tagInfo.data.aliases && tagInfo.data.aliases.length > 0 && (
            <div>
              <span className="text-xs text-slate-400">别名</span>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {tagInfo.data.aliases.map((alias, i) => (
                  <span key={i} className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 text-xs rounded">{alias}</span>
                ))}
              </div>
            </div>
          )}
          {tagInfo.data.description && (
            <div className="sm:col-span-2">
              <span className="text-xs text-slate-400">标签简介</span>
              <MarkdownRenderer content={tagInfo.data.description} />
            </div>
          )}
        </div>
      ) : null}

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
          onRetry={handleRetry}
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
          {/* Bottom sort controls */}
          {q && (
            <div className="flex items-center justify-center gap-2 mt-6 flex-wrap">
              <select
                value={sortBy}
                onChange={(e) => { setSortBy(e.target.value); setPage(1); }}
                className="px-2.5 py-1.5 text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg outline-none focus:ring-1 focus:ring-primary/30"
              >
                <option value="created_at">上传时间</option>
                <option value="score">评分高低</option>
                <option value="relevance">相关性</option>
                <option value="wilson_score">Wilson 评分</option>
                <option value="hotness">热度</option>
                <option value="width">像素宽</option>
                <option value="height">像素高</option>
                <option value="size">文件大小</option>
                <option value="random">随机</option>
              </select>
              {sortBy !== 'random' && (
                <button
                  onClick={() => setSortDir(prev => prev === 'desc' ? 'asc' : 'desc')}
                  className="px-2.5 py-1.5 text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  {sortDir === 'desc' ? '↓ 降序' : '↑ 升序'}
                </button>
              )}
              {(sortParam || sortBy !== defaultSort || sortDir !== 'desc') && (
                <button
                  onClick={() => { setSortBy(defaultSort); setSortDir('desc'); setPage(1); }}
                  className="px-2.5 py-1.5 text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  重置排序
                </button>
              )}
              <button
                onClick={() => setShowAdvanced(prev => !prev)}
                className={`px-2.5 py-1.5 text-xs border rounded-lg transition-colors ${
                  showAdvanced
                    ? 'border-primary text-primary bg-primary/10'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
              >
                高级排序
              </button>
            </div>
          )}

          {/* Advanced search panel */}
          {q && showAdvanced && (
            <div className="mt-4 p-4 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 max-w-3xl mx-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Upvotes */}
                <div>
                  <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">点赞数</label>
                  <div className="flex gap-2">
                    <select
                      value={advUpvoteOp}
                      onChange={(e) => setAdvUpvoteOp(e.target.value)}
                      className="px-2 py-1.5 text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg outline-none"
                    >
                      <option value="gte">≥</option>
                      <option value="lt">&lt;</option>
                    </select>
                    <input
                      type="number"
                      value={advUpvoteVal}
                      onChange={(e) => setAdvUpvoteVal(e.target.value)}
                      placeholder="例如 100"
                      className="flex-1 px-2 py-1.5 text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg outline-none w-20"
                    />
                  </div>
                </div>
                {/* Score */}
                <div>
                  <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">净得分</label>
                  <div className="flex gap-2">
                    <select
                      value={advScoreOp}
                      onChange={(e) => setAdvScoreOp(e.target.value)}
                      className="px-2 py-1.5 text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg outline-none"
                    >
                      <option value="gte">≥</option>
                      <option value="lt">&lt;</option>
                    </select>
                    <input
                      type="number"
                      value={advScoreVal}
                      onChange={(e) => setAdvScoreVal(e.target.value)}
                      placeholder="例如 50"
                      className="flex-1 px-2 py-1.5 text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg outline-none w-20"
                    />
                  </div>
                </div>
                {/* Aspect ratio */}
                <div>
                  <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">宽高比</label>
                  <select
                    value={advAspect}
                    onChange={(e) => setAdvAspect(e.target.value)}
                    className="w-full px-2 py-1.5 text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg outline-none"
                  >
                    <option value="">不限比例</option>
                    <option value="aspect_ratio.lt:1">竖图 (宽 &lt; 高)</option>
                    <option value="aspect_ratio:1">正方形 (宽 = 高)</option>
                    <option value="aspect_ratio.gt:1">横图 (宽 &gt; 高)</option>
                    <option value="aspect_ratio.gt:1.5">超宽屏壁纸</option>
                  </select>
                </div>
                {/* Media type */}
                <div>
                  <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">媒体类型</label>
                  <select
                    value={advMedia}
                    onChange={(e) => setAdvMedia(e.target.value)}
                    className="w-full px-2 py-1.5 text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg outline-none"
                  >
                    <option value="">所有类型</option>
                    <option value="animated:true">动态内容 (GIF/视频)</option>
                    <option value="animated:false">静态图片 (PNG/JPG)</option>
                    <option value="(mime_type:video/webm OR mime_type:video/mp4)">仅限视频</option>
                  </select>
                </div>
                {/* Upload time */}
                <div>
                  <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">上传时间</label>
                  <select
                    value={advTime}
                    onChange={(e) => setAdvTime(e.target.value)}
                    className="w-full px-2 py-1.5 text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg outline-none"
                  >
                    <option value="">不限时间</option>
                    <option value="created_at.gte:1 days ago">过去 24 小时</option>
                    <option value="created_at.gte:1 weeks ago">过去 1 周</option>
                    <option value="created_at.gte:1 months ago">过去 1 个月</option>
                    <option value="created_at.gte:1 years ago">过去 1 年</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-between items-center mt-4 pt-3 border-t border-slate-200 dark:border-slate-700">
                <span className="text-[11px] text-slate-400 dark:text-slate-500">
                  点击&quot;应用&quot;后，筛选条件会拼接到搜索框并执行搜索。
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={clearAdvancedFilters}
                    className="px-3 py-1.5 text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                  >
                    重置
                  </button>
                  <button
                    onClick={applyAdvancedFilters}
                    className="px-3 py-1.5 text-xs bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
                  >
                    应用并搜索
                  </button>
                </div>
              </div>
            </div>
          )}
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
