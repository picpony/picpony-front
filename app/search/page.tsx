'use client';

import { Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { MdSearch, MdImageSearch, MdErrorOutline, MdArrowBack, MdExpandMore } from 'react-icons/md';
import { useRouter } from 'next/navigation';
import Spinner from '@/components/Spinner';
import { api, PonyImage, applyCdn } from '@/lib/api';
import MasonryGrid from '@/components/MasonryGrid';
import ImageGridSkeleton from '@/components/ImageGridSkeleton';
import MarkdownRenderer from '@/components/MarkdownRenderer';
import Pagination from '@/components/Pagination';
import ErrorRetry from '@/components/ErrorRetry';
import ImageSearchModal from '@/components/ImageSearchModal';
import LottieIcon from '@/components/LottieIcon';
import Select from '@/components/Select';
import { showToast } from '@/components/Toast';
import { useBackgroundSearchParams } from '@/components/BackgroundLocation';
import { tagCategoryDot } from '@/lib/tagCategories';
import Button from '@/components/Button';
import { Input } from '@/components/Input';
import PageBack from '@/components/PageBack';
import IconButton from '@/components/IconButton';
import { useEscapeBack } from '@/lib/hooks';

interface DictionaryEntry {
  id: number;
  en: string;
  cn: string;
  cat: string;
  count: number;
  description: string;
  aliases: string[];
}

function CustomImageList({ images, onBack }: { images: PonyImage[]; onBack: () => void }) {
  if (images.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-on-surface-variant animate-fade-in px-4 text-center">
        <MdErrorOutline size={48} className="mb-4 text-outline" />
        <h2 className="text-title-l mb-2 text-on-surface">没有找到匹配的图片</h2>
        <button
          onClick={onBack}
          className="mt-6 flex items-center px-4 py-2 bg-surface-container-high hover:bg-surface-container-highest text-on-surface rounded-full transition-ui cursor-pointer"
        >
          <MdArrowBack size={20} className="mr-2" />
          <span>返回</span>
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="mb-6 flex items-center justify-between p-4 rounded-md">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 hover:bg-surface-container-highest text-on-surface-variant rounded-md transition-ui cursor-pointer flex items-center justify-center"
            title="返回"
          >
            <MdArrowBack size={20} />
          </button>
          <div>
            <h2 className="text-title-m-emphasized text-on-surface">以图搜图</h2>
            <p className="text-body-m text-on-surface-variant">找到 {images.length} 张相似图片</p>
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
  const defaultSort =
    typeof window !== 'undefined'
      ? window.localStorage.getItem('picpony_default_search_sort') || 'created_at'
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

    let newQuery = inputValue
      .trim()
      .replace(/，/g, ',')
      .replace(/[,，]+$/g, '');
    if (filters.length > 0) {
      newQuery = newQuery ? `${newQuery}, ${filters.join(', ')}` : filters.join(', ');
    }
    setInputValue(newQuery);
    setCustomResults(null);
    setPage(1);
    router.push(`/search?q=${encodeURIComponent(newQuery)}`);
  }, [
    advUpvoteOp,
    advUpvoteVal,
    advScoreOp,
    advScoreVal,
    advAspect,
    advMedia,
    advTime,
    inputValue,
    router,
  ]);

  const tokenRef = useRef<string | null>(null);
  const [tagInfo, setTagInfo] = useState<{ data: DictionaryEntry | null; loading: boolean }>({
    data: null,
    loading: false,
  });

  const inputWrapRef = useRef<HTMLDivElement>(null);
  const [suggestions, setSuggestions] = useState<DictionaryEntry[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [acCursor, setAcCursor] = useState(0);
  const acChunkRef = useRef<{ start: number; end: number; prefix: string }>({
    start: 0,
    end: 0,
    prefix: '',
  });
  const acTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const acReqIdRef = useRef(0);

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

  const selectSuggestion = useCallback(
    (tag: DictionaryEntry) => {
      const { start, end, prefix } = acChunkRef.current;
      const before = inputValue.substring(0, start);
      const after = inputValue.substring(end);
      const replacement = prefix + tag.en;
      const insertComma = after.trim() === '' ? ',' : '';
      const newVal = before + replacement + insertComma + after;
      setInputValue(newVal);
      setShowSuggestions(false);
    },
    [inputValue],
  );

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (inputWrapRef.current && !inputWrapRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  /* Back leaves for the gallery, not for whatever page happened to be before
     this one.
     `history.back()` was the old answer and it contradicts the space the
     transitions describe: /search sits directly above / on the app's notional
     plane (see `ROUTE_CELL`), so leaving it is a move *down* to the gallery,
     wherever the user came in from. Reaching it from a forum post and stepping
     back onto that post played the down-move onto a screen that is not below it.
     Layered, though — a search result is state the user put there, and throwing
     it away and the screen with it in one keystroke is two undos in one. The
     first press clears the query and lands on the empty search; the second
     leaves. Which is also the shape the messages page already had for its
     conversation list. */
  const handleBack = useCallback(() => {
    if (customResults) {
      setCustomResults(null);
      return;
    }
    if (q || inputValue) {
      setInputValue('');
      setPage(1);
      router.push('/search');
      return;
    }
    router.push('/');
  }, [customResults, inputValue, q, router]);

  /* Escape leaves the page — but only once nothing nearer owns the key. The
     suggestion list closes on Escape first (below), and the image-search dialog
     handles its own, so both stand this down while they are open. */
  useEscapeBack(handleBack, !showSuggestions && !isImageSearchOpen);

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!showSuggestions || suggestions.length === 0) return;
      if (e.key === 'Escape') {
        /* The list owns Escape while it is open. Moved here from a document
           listener so the ordering against `useEscapeBack` is structural rather
           than a matter of which listener happened to be registered first. */
        e.preventDefault();
        setShowSuggestions(false);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAcCursor((prev) => Math.min(prev + 1, suggestions.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAcCursor((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (acCursor >= 0 && acCursor < suggestions.length) {
          e.preventDefault();
          selectSuggestion(suggestions[acCursor]);
        }
      }
    },
    [showSuggestions, suggestions, acCursor, selectSuggestion],
  );

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
      return () => {
        isMounted = false;
      };
    }

    api
      .getImages(q, page, sortBy === 'random' ? undefined : sortBy, sortDir)
      .then((res) => {
        if (isMounted) {
          let imgs = res.images;
          if (localStorage.getItem('trixie_use_cdn') === 'true') {
            imgs = imgs.map((img) => ({
              ...img,
              representations: Object.fromEntries(
                Object.entries(img.representations).map(([k, v]) => [k, applyCdn(v)]),
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

    return () => {
      isMounted = false;
    };
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

    api
      .getDictionary(token, { keyword: q, limit: 5 })
      .then((res) => {
        if (cancelled) return;
        if (res.success && res.tags) {
          const match = res.tags.find(
            (t: DictionaryEntry) => t.en.toLowerCase() === q.toLowerCase(),
          );
          setTagInfo({ data: match || null, loading: false });
        } else {
          setTagInfo({ data: null, loading: false });
        }
      })
      .catch(() => {
        if (!cancelled) setTagInfo({ data: null, loading: false });
      });

    return () => {
      cancelled = true;
    };
  }, [q]);

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (inputValue.trim()) {
        const formattedQuery = inputValue
          .trim()
          .replace(/，/g, ',')
          .replace(/[,，]+$/g, '');
        setCustomResults(null);
        setPage(1);
        const sortParam =
          sortBy !== 'created_at' || sortDir !== 'desc' ? `&sort=${sortBy}&dir=${sortDir}` : '';
        router.push(`/search?q=${encodeURIComponent(formattedQuery)}${sortParam}`);
      } else {
        router.push('/');
      }
    },
    [inputValue, router, sortBy, sortDir],
  );

  const handlePageChange = useCallback((newPage: number) => {
    if (newPage >= 1) {
      setIsLoading(true);
      setError(null);
      setPage(newPage);
      // <Pagination> scrolls the shell's real scroll container back to the top.
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
    setRetryCount((c) => c + 1);
  }, []);

  return (
    <>
      {/* Same affordance, same pixel, same key as every other full-screen view.
          Outside the centred wrapper on purpose — see `PageBack`. */}
      <PageBack onClick={handleBack} title="返回 (Esc)" />
      <div className="max-w-7xl mx-auto px-2 sm:px-4 md:px-6 lg:px-8 pt-14 pb-4 sm:pb-8 animate-fade-in">
        <div className="mb-6 max-w-3xl mx-auto">
          <form onSubmit={handleSearch} className="flex items-center gap-2">
            <div className="flex-1 relative" ref={inputWrapRef}>
              <Input
                type="text"
                icon={<MdSearch size={22} />}
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleInputKeyDown}
                placeholder="搜索图片..."
              />
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-surface-container border border-outline-variant rounded-sm shadow-e3 overflow-hidden">
                  <div className="popover-scrollbar max-h-64 overflow-y-auto">
                    {suggestions.map((tag, i) => (
                      <button
                        key={tag.id}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectSuggestion(tag);
                        }}
                        onMouseEnter={() => setAcCursor(i)}
                        className={`flex items-center justify-between w-full px-3 py-2 text-left transition-ui ${
                          i === acCursor
                            ? 'bg-primary-container text-on-primary-container'
                            : 'hover:bg-surface-container-high'
                        }`}
                      >
                        {' '}
                        <div className="flex items-center gap-2 min-w-0">
                          {' '}
                          <span
                            className={`w-2.5 h-2.5 rounded-full shrink-0 ${tagCategoryDot(tag.cat)}`}
                          />{' '}
                          <div className="min-w-0">
                            {' '}
                            {tag.cn ? (
                              <span className="text-body-m text-on-surface">
                                {' '}
                                <span className="text-primary ">{tag.cn}</span>{' '}
                                <span className="ml-1.5 opacity-50">{tag.en}</span>{' '}
                              </span>
                            ) : (
                              <span className="text-body-m text-on-surface">{tag.en}</span>
                            )}{' '}
                          </div>{' '}
                        </div>{' '}
                        <span className="text-body-s text-outline shrink-0 ml-2">
                          {' '}
                          {tag.count?.toLocaleString()}{' '}
                        </span>{' '}
                      </button>
                    ))}{' '}
                  </div>{' '}
                </div>
              )}{' '}
            </div>{' '}
            <Button type="submit" variant="filled" size="lg">
              搜索
            </Button>
            {/* Sits beside a `size="lg"` button, so it takes the matching 48dp
                box. It used to be a hand-rolled `p-3 rounded-md`, which made it
                the one square-cornered control in a row of pills. */}
            <IconButton
              size="lg"
              onClick={() => setIsImageSearchOpen(true)}
              title="以图搜图"
              aria-label="以图搜图"
              icon={<MdImageSearch size={22} />}
            />
          </form>{' '}
        </div>{' '}
        {tagInfo.loading ? (
          <div className="mb-6 flex items-center gap-2 text-body-m text-outline">
            {' '}
            <Spinner size="sm" /> <span>查询中...</span>{' '}
          </div>
        ) : tagInfo.data ? (
          <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-body-m text-on-surface-variant">
            {' '}
            {tagInfo.data.cn && (
              <div>
                {' '}
                <span className="text-body-s text-outline">中文翻译</span>{' '}
                <p className="text-on-surface ">{tagInfo.data.cn}</p>{' '}
              </div>
            )}{' '}
            {tagInfo.data.count > 0 && (
              <div>
                {' '}
                <span className="text-body-s text-outline">使用量</span>{' '}
                <p className="text-on-surface ">{tagInfo.data.count.toLocaleString()}</p>{' '}
              </div>
            )}{' '}
            {tagInfo.data.cat && (
              <div>
                {' '}
                <span className="text-body-s text-outline">分类</span>{' '}
                <p className="text-on-surface">{tagInfo.data.cat}</p>{' '}
              </div>
            )}{' '}
            {tagInfo.data.aliases && tagInfo.data.aliases.length > 0 && (
              <div>
                {' '}
                <span className="text-body-s text-outline">别名</span>{' '}
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {' '}
                  {tagInfo.data.aliases.map((alias, i) => (
                    <span
                      key={i}
                      className="px-1.5 py-0.5 bg-surface-container-high text-on-surface-variant text-label-m rounded"
                    >
                      {alias}
                    </span>
                  ))}{' '}
                </div>{' '}
              </div>
            )}{' '}
            {tagInfo.data.description && (
              <div className="sm:col-span-2">
                {' '}
                <span className="text-body-s text-outline">标签简介</span>{' '}
                <MarkdownRenderer content={tagInfo.data.description} />{' '}
              </div>
            )}{' '}
          </div>
        ) : null}{' '}
        {customResults ? (
          <CustomImageList images={customResults} onBack={clearCustomResults} />
        ) : !q ? (
          <div className="flex flex-col items-center justify-center min-h-[40vh] text-outline animate-fade-in">
            {' '}
            <LottieIcon
              /* The box is the artwork, not the canvas it was exported on.
                 That export was 3000x1553 for 1290x1178 of drawing, so `w-90`
                 reserved 360x186px to paint 155x141 — 98.7px of nothing on the
                 left, 106.6px on the right, and a caption pushed down by empty
                 space it could not see. The canvas is now cropped to the ink
                 with an even 65-unit margin (verified as the union over every
                 frame, not just the last, so nothing flies in from outside it),
                 which leaves the drawing centred by construction.

                 168px keeps the drawing the size it already was — 152.6px
                 against the previous 154.8 — because that size is itself
                 measured: it is where the magnifier *inside* the illustration
                 inks 46.6px, the ink of the `MdSearch size={64}` it replaces.
                 The artwork was rebalanced to make that possible, the magnifier
                 scaled up 2.14x and the other five elements down to 0.85 and
                 pulled the same amount toward centre, so the composition
                 tightens around it instead of leaving a ring of empty space. */
              className="mb-4 w-42 max-w-full"
              load={() => import('@/lib/lottie/search.json').then((m) => m.default)}
              fallback={<MdSearch size={64} />}
            />{' '}
            <p className="text-title-m">输入关键词搜索图片</p>{' '}
          </div>
        ) : isLoading ? (
          <ImageGridSkeleton />
        ) : error ? (
          <ErrorRetry
            title="搜索失败"
            message={
              (error as { status?: number }).status == 429 ||
              error.message === 'Failed to fetch' ||
              error.message === 'Too Many Requests'
                ? '请求次数过快，超出原站限制'
                : `${(error as { status?: number }).status ? `HTTP Error ${(error as { status?: number }).status}: ` : ''}${error.message}`
            }
            onRetry={handleRetry}
          />
        ) : images.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[40vh] text-outline animate-fade-in">
            <MdErrorOutline size={48} className="mb-4" />
            <p className="text-title-m">没有找到匹配的图片</p>
          </div>
        ) : (
          <>
            <div data-pagination-anchor>
              <div className="mb-3 text-body-m text-on-surface-variant">
                搜索：{q} — 第 {page} 页
              </div>
              <MasonryGrid images={images} />
              <Pagination currentPage={page} hasMore={hasMore} onPageChange={handlePageChange} />
            </div>
            {/* Bottom sort controls */}
            {q && (
              <div className="flex items-center justify-center gap-2 mt-6 flex-wrap">
                <Select
                  value={sortBy}
                  onChange={(v) => {
                    setSortBy(v);
                    setPage(1);
                  }}
                  size="sm"
                  aria-label="排序方式"
                  options={[
                    { value: 'created_at', label: '上传时间' },
                    { value: 'score', label: '评分高低' },
                    { value: 'relevance', label: '相关性' },
                    { value: 'wilson_score', label: 'Wilson 评分' },
                    { value: 'hotness', label: '热度' },
                    { value: 'width', label: '像素宽' },
                    { value: 'height', label: '像素高' },
                    { value: 'size', label: '文件大小' },
                    { value: 'random', label: '随机' },
                  ]}
                />
                {sortBy !== 'random' && (
                  <button
                    onClick={() => setSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
                    data-ripple
                    className="px-2.5 py-1.5 text-body-s bg-surface-container-high text-on-surface-variant rounded-full state-layer hover:text-primary transition-ui"
                  >
                    <span
                      key={sortDir}
                      className="inline-block animate-[icon-swap_0.3s_var(--ease-spring)]"
                    >
                      {sortDir === 'desc' ? '↓ 降序' : '↑ 升序'}
                    </span>
                  </button>
                )}
                {(sortParam || sortBy !== defaultSort || sortDir !== 'desc') && (
                  <button
                    onClick={() => {
                      setSortBy(defaultSort);
                      setSortDir('desc');
                      setPage(1);
                    }}
                    data-ripple
                    className="px-2.5 py-1.5 text-body-s bg-surface-container-high text-on-surface-variant rounded-full state-layer hover:text-primary transition-ui animate-pop-in"
                  >
                    重置排序
                  </button>
                )}
                <button
                  onClick={() => setShowAdvanced((prev) => !prev)}
                  data-ripple
                  aria-expanded={showAdvanced}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-body-s rounded-full transition-ui ${
                    showAdvanced
                      ? 'bg-primary-container text-on-primary-container'
                      : 'bg-surface-container-high text-on-surface-variant state-layer hover:text-primary'
                  }`}
                >
                  高级排序
                  <MdExpandMore
                    size={14}
                    className={`transition-transform duration-300 ease-[var(--ease-standard)] ${showAdvanced ? 'rotate-180' : ''}`}
                  />
                </button>
              </div>
            )}

            {/* Advanced search panel */}
            {q && (
              <div
                className={`grid transition-[grid-template-rows,opacity] duration-300 ease-[var(--ease-standard)] ${
                  showAdvanced ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                }`}
              >
                <div className="min-h-0 overflow-hidden">
                  <div className="mt-4 p-4 border border-outline-variant rounded-md bg-surface-container max-w-3xl mx-auto">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {/* Upvotes */}
                      <div>
                        <label className="block text-body-s text-on-surface-variant mb-1">
                          点赞数
                        </label>
                        <div className="flex gap-2">
                          <Select
                            value={advUpvoteOp}
                            onChange={setAdvUpvoteOp}
                            size="sm"
                            aria-label="点赞数比较符"
                            options={[
                              { value: 'gte', label: '≥' },
                              { value: 'lt', label: '<' },
                            ]}
                          />
                          <Input
                            type="number"
                            value={advUpvoteVal}
                            onChange={(e) => setAdvUpvoteVal(e.target.value)}
                            placeholder="例如 100"
                            fieldClassName="flex-1"
                          />
                        </div>
                      </div>
                      {/* Score */}
                      <div>
                        <label className="block text-body-s text-on-surface-variant mb-1">
                          净得分
                        </label>
                        <div className="flex gap-2">
                          <Select
                            value={advScoreOp}
                            onChange={setAdvScoreOp}
                            size="sm"
                            aria-label="净得分比较符"
                            options={[
                              { value: 'gte', label: '≥' },
                              { value: 'lt', label: '<' },
                            ]}
                          />
                          <Input
                            type="number"
                            value={advScoreVal}
                            onChange={(e) => setAdvScoreVal(e.target.value)}
                            placeholder="例如 50"
                            fieldClassName="flex-1"
                          />
                        </div>
                      </div>
                      {/* Aspect ratio */}
                      <div>
                        <label className="block text-body-s text-on-surface-variant mb-1">
                          宽高比
                        </label>
                        <Select
                          value={advAspect}
                          onChange={setAdvAspect}
                          size="sm"
                          className="w-full"
                          aria-label="宽高比"
                          options={[
                            { value: '', label: '不限比例' },
                            { value: 'aspect_ratio.lt:1', label: '竖图 (宽 < 高)' },
                            { value: 'aspect_ratio:1', label: '正方形 (宽 = 高)' },
                            { value: 'aspect_ratio.gt:1', label: '横图 (宽 > 高)' },
                            { value: 'aspect_ratio.gt:1.5', label: '超宽屏壁纸' },
                          ]}
                        />
                      </div>
                      {/* Media type */}
                      <div>
                        <label className="block text-body-s text-on-surface-variant mb-1">
                          媒体类型
                        </label>
                        <Select
                          value={advMedia}
                          onChange={setAdvMedia}
                          size="sm"
                          className="w-full"
                          aria-label="媒体类型"
                          options={[
                            { value: '', label: '所有类型' },
                            { value: 'animated:true', label: '动态内容 (GIF/视频)' },
                            { value: 'animated:false', label: '静态图片 (PNG/JPG)' },
                            {
                              value: '(mime_type:video/webm OR mime_type:video/mp4)',
                              label: '仅限视频',
                            },
                          ]}
                        />
                      </div>
                      {/* Upload time */}
                      <div>
                        <label className="block text-body-s text-on-surface-variant mb-1">
                          上传时间
                        </label>
                        <Select
                          value={advTime}
                          onChange={setAdvTime}
                          size="sm"
                          className="w-full"
                          aria-label="上传时间"
                          options={[
                            { value: '', label: '不限时间' },
                            { value: 'created_at.gte:1 days ago', label: '过去 24 小时' },
                            { value: 'created_at.gte:1 weeks ago', label: '过去 1 周' },
                            { value: 'created_at.gte:1 months ago', label: '过去 1 个月' },
                            { value: 'created_at.gte:1 years ago', label: '过去 1 年' },
                          ]}
                        />
                      </div>
                    </div>
                    <div className="flex justify-between items-center mt-4 pt-3 border-t border-outline-variant">
                      <span className="text-label-s text-outline">
                        点击&quot;应用&quot;后，筛选条件会拼接到搜索框并执行搜索。
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={clearAdvancedFilters}
                          data-ripple
                          className="px-3 py-1.5 text-body-s border border-outline-variant bg-surface-container text-on-surface-variant rounded-full hover:bg-surface-container-high transition-ui"
                        >
                          重置
                        </button>
                        <Button onClick={applyAdvancedFilters} variant="filled" size="sm">
                          应用并搜索
                        </Button>
                      </div>
                    </div>
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
    </>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<ImageGridSkeleton />}>
      <SearchPageContent />
    </Suspense>
  );
}
