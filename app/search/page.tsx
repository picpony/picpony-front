'use client';

import { Suspense, useState, useEffect, useRef, useCallback, useId, useMemo } from 'react';
import { MdSearch, MdImageSearch, MdSearchOff, MdArrowBack, MdExpandMore, MdArrowDownward } from 'react-icons/md';
import { useRouter } from 'next/navigation';
import Spinner from '@/components/Spinner';
import Badge from '@/components/Badge';
import { api, type PonyImage } from '@/lib/api';
import MasonryGrid from '@/components/MasonryGrid';
import ImageGridSkeleton from '@/components/ImageGridSkeleton';
import MarkdownRenderer from '@/components/MarkdownRenderer';
import Pagination from '@/components/Pagination';
import ErrorRetry from '@/components/ErrorRetry';
import EmptyState from '@/components/EmptyState';
import ImageSearchModal from '@/components/ImageSearchModal';
import LottieIcon from '@/components/LottieIcon';
import { loadSearchArtwork } from '@/lib/lottieAssets';
import Select from '@/components/Select';
import { showToast } from '@/components/Toast';
import { useBackgroundSearchParams } from '@/components/BackgroundLocation';
import { tagCategoryDot } from '@/lib/tagCategories';
import Button from '@/components/Button';
import Card from '@/components/Card';
import { Input } from '@/components/Input';
import IconButton from '@/components/IconButton';
import { readToken, useEscapeBack, useSession } from '@/lib/hooks';
import SectionHeading from '@/components/SectionHeading';
import Popover, { estimateMenuHeight } from '@/components/Popover';
import { ICON } from '@/lib/icons';
import { useResource, SKIP } from '@/lib/resource';
import { browsingFingerprint, searchFeed, syncBrowsingCookie } from '@/lib/resources';
import { LS_KEYS } from '@/lib/constants';
import { searchHref, searchPage, searchSort } from '@/lib/searchState';

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
      <EmptyState
        icon={<MdImageSearch size={ICON.display} />}
        title="没有找到匹配的图片"
        description="换一张图，或者放宽一点相似度再试。"
        action={
          <Button variant="tonal" onClick={onBack} icon={<MdArrowBack />}>
            返回
          </Button>
        }
      />
    );
  }

  return (
    <>
      <div className="mb-6 flex items-center">
        <div className="flex items-center gap-3">
          <IconButton
            onClick={onBack}
            aria-label="返回"
            icon={<MdArrowBack size={ICON.control} />}
          />
          <div>
            <SectionHeading className="mb-0" subtitle={`找到 ${images.length} 张相似图片`}>
              以图搜图
            </SectionHeading>
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
  const { token } = useSession();
  const [defaultSort, setDefaultSort] = useState('created_at');
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [, updatePreferences] = useState(0);
  const lastPreferences = useRef<{ fp: string; sort: string } | null>(null);
  const [inputValue, setInputValue] = useState(q);
  const page = searchPage(searchParams.get('page'));
  const [isImageSearchOpen, setIsImageSearchOpen] = useState(false);
  const [customResults, setCustomResults] = useState<PonyImage[] | null>(null);
  const sortBy = searchSort(sortParam, defaultSort);
  const sortDir: 'asc' | 'desc' = dirParam === 'asc' ? 'asc' : 'desc';
  useEffect(() => {
    let current = true;
    const update = () => {
      if (!current) return;
      let nextSort = 'created_at';
      try {
        nextSort = searchSort(localStorage.getItem(LS_KEYS.searchSort));
      } catch {
        // Storage can be disabled; searching still works with the default order.
      }
      const nextFp = browsingFingerprint();
      const previous = lastPreferences.current;
      const changed = previous !== null && (previous.fp !== nextFp || previous.sort !== nextSort);
      lastPreferences.current = { fp: nextFp, sort: nextSort };
      if (changed) {
        updatePreferences((version) => version + 1);
        // A background search cannot rewrite an open picture's history entry.
        if (window.location.pathname === '/search') {
          const params = new URLSearchParams(window.location.search);
          if (params.has('page')) {
            params.delete('page');
            window.history.replaceState(null, '', `/search?${params.toString()}`);
          }
        }
      }
      setDefaultSort(nextSort);
      syncBrowsingCookie();
      setPreferencesReady(true);
    };
    queueMicrotask(update);
    window.addEventListener('settings_updated', update);
    window.addEventListener('storage', update);
    return () => {
      current = false;
      window.removeEventListener('settings_updated', update);
      window.removeEventListener('storage', update);
    };
  }, []);
  const commitSearch = useCallback((query: string, sort: string, direction: 'asc' | 'desc', nextPage = 1) => {
    window.history.pushState(null, '', searchHref(query, sort, direction, nextPage));
  }, []);

  /* `SKIP` covers the two states with nothing to ask for: an empty query, and a 以图搜图
     result already on screen (from a different endpoint entirely, held in
     `customResults`). Skipping rather than guarding inside a fetch is the mechanism that
     stops a screen paying for content nobody asked for.

     `keepPrevious`, same as the home feed: the page number is in the key, so without it
     a page turn unmounts the grid for a round trip and the browser clamps the scroll
     position to the collapsed height. */
  const read = useResource(
    searchFeed,
    preferencesReady && q && !customResults
      ? { query: q, page, sortField: sortBy, sortDir }
      : SKIP,
    { keepPrevious: true },
  );
  const images = useMemo(() => read.data?.images ?? [], [read.data]);
  const hasMore = images.length === 50;
  const error = (read.error as Error | null) ?? null;
  /* Nothing yet, rather than `isLoading` — which is also true while a warm result
     revalidates underneath, and swapping that for a skeleton undoes the point of the
     cache. */
  const isLoading = Boolean(q) && !customResults && read.data === undefined && !read.error;

  // Advanced search panel state
  const [showAdvanced, setShowAdvanced] = useState(false);
  const advancedId = useId();
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
    commitSearch(newQuery, sortBy, sortDir);
  }, [
    advUpvoteOp,
    advUpvoteVal,
    advScoreOp,
    advScoreVal,
    advAspect,
    advMedia,
    advTime,
    inputValue,
    commitSearch,
    sortBy,
    sortDir,
    setInputValue,
    setCustomResults,
  ]);
  const [tagInfo, setTagInfo] = useState<{ data: DictionaryEntry | null; loading: boolean }>({
    data: null,
    loading: false,
  });

  const inputWrapRef = useRef<HTMLDivElement>(null);
  const [suggestions, setSuggestions] = useState<DictionaryEntry[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [acCursor, setAcCursor] = useState(0);
  /* The combobox contract needs stable ids: one for the listbox so the field can point
     `aria-controls` at it, one per row so `aria-activedescendant` can name the cursor.
     Without them the field declared no relationship to the list at all — rows carried
     `role="option"` and `aria-selected` inside a listbox nobody had been told about,
     and the keyboard cursor was announced to nothing. */
  const acId = useId();
  const acListboxId = `${acId}-listbox`;
  const acOptionId = (i: number) => `${acId}-option-${i}`;
  const acChunkRef = useRef<{ start: number; end: number; prefix: string }>({
    start: 0,
    end: 0,
    prefix: '',
  });
  const acTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const acReqIdRef = useRef(0);
  const closeSuggestions = useCallback(() => {
    clearTimeout(acTimerRef.current);
    acReqIdRef.current += 1;
    setShowSuggestions(false);
  }, []);
  useEffect(() => () => {
    clearTimeout(acTimerRef.current);
    acReqIdRef.current += 1;
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    closeSuggestions();
    const reqId = acReqIdRef.current;

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

    acTimerRef.current = setTimeout(async () => {
      const cleanTag = currentTag.replace(/["()[\]{}*]/g, '');
      const token = readToken();
      if (!token) return;

      try {
        const res = await api.getDictionary(token, { keyword: cleanTag, limit: 10 });
        if (reqId !== acReqIdRef.current || readToken() !== token) return;
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
  }, [closeSuggestions, setInputValue]);

  const selectSuggestion = useCallback(
    (tag: DictionaryEntry) => {
      const { start, end, prefix } = acChunkRef.current;
      const before = inputValue.substring(0, start);
      const after = inputValue.substring(end);
      const replacement = prefix + tag.en;
      const insertComma = after.trim() === '' ? ',' : '';
      const newVal = before + replacement + insertComma + after;
      setInputValue(newVal);
      closeSuggestions();
    },
    [inputValue, closeSuggestions, setInputValue],
  );

  /* Back leaves for the gallery, not for whatever page happened to be before this one.
     `history.back()` contradicts the space the transitions describe: /search sits
     directly above / on the app's notional plane (see `ROUTE_CELL`), so leaving it is a
     move *down* to the gallery wherever the user came in from.
     Layered, though — a search result is state the user put there, and throwing it away
     and the screen with it in one keystroke is two undos in one. The first press clears
     the query and lands on the empty search; the second leaves. */
  const handleBack = useCallback(() => {
    if (customResults) {
      setCustomResults(null);
      return;
    }
    if (q || inputValue) {
      setInputValue('');
      router.push('/search', { scroll: false });
      return;
    }
    router.push('/', { scroll: false });
  }, [customResults, inputValue, q, router, setCustomResults, setInputValue]);

  /* Escape leaves the page — but only once nothing nearer owns the key. The suggestion
     list closes on Escape first (below), and the image-search dialog handles its own,
     so both stand this down while they are open. */
  useEscapeBack(handleBack, !showSuggestions && !isImageSearchOpen);

  /* One expression for "the popup is showing", because three things have to agree: the
     `Popover`'s own `open`, `aria-expanded`, and whether `aria-controls` /
     `aria-activedescendant` should be present at all. Spelling the condition out at
     each of them is how they drift. */
  const acOpen = showSuggestions && suggestions.length > 0;

  useEffect(() => {
    if (!acOpen) return;
    const panel = document.getElementById(acListboxId);
    const option = document.getElementById(`${acId}-option-${acCursor}`);
    if (!panel || !option) return;
    // Move only the suggestion viewport. Keyboard navigation must not move
    // the page or leave the active descendant hidden below the search view.
    const bounds = panel.getBoundingClientRect();
    const row = option.getBoundingClientRect();
    if (row.top < bounds.top + 8) panel.scrollTop += row.top - bounds.top - 8;
    else if (row.bottom > bounds.bottom - 8) panel.scrollTop += row.bottom - bounds.bottom + 8;
  }, [acOpen, acCursor, acId, acListboxId]);

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.nativeEvent.isComposing) return;
      if (!showSuggestions || suggestions.length === 0) return;
      if (e.key === 'Escape') {
        /* The list owns Escape while it is open. Moved here from a document listener so
           the ordering against `useEscapeBack` is structural rather than a matter of
           which listener registered first. */
        e.preventDefault();
        closeSuggestions();
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
    [showSuggestions, suggestions, acCursor, selectSuggestion, closeSuggestions],
  );

  useEffect(() => {
    queueMicrotask(() => {
      setInputValue(q);
      setCustomResults(null);
      closeSuggestions();
    });
  }, [q, closeSuggestions]);

  /* The fetch, the `isMounted` flag and the four `setState`s that used to live here are
     `useResource`'s now — see `read` above. Wiring `searchFeed` (previously unreferenced)
     is what makes going back to a search cost nothing. `applyImageLine` is not re-applied
     either: `lib/api/derpi.ts` applies it centrally to every image-bearing response, so
     the map here was a second, idempotent pass over 50 images on every render. */

  useEffect(() => {
    const isSingleTag = !!q && !/[ ,:*?]/.test(q) && !q.startsWith('-');

    if (!isSingleTag) {
      queueMicrotask(() => setTagInfo({ data: null, loading: false }));
      return;
    }

    queueMicrotask(() => setTagInfo({ data: null, loading: true }));

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
  }, [q, token]);

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (inputValue.trim()) {
        const formattedQuery = inputValue
          .trim()
          .replace(/，/g, ',')
          .replace(/[,，]+$/g, '');
        setCustomResults(null);
        closeSuggestions();
        commitSearch(formattedQuery, sortBy, sortDir);
      } else {
        router.push('/', { scroll: false });
      }
    },
    [inputValue, router, sortBy, sortDir, closeSuggestions, commitSearch, setCustomResults],
  );

  const handlePageChange = useCallback((newPage: number) => {
    if (newPage >= 1) {
      /* Only the page number: changing it changes the key, which is the signal
         `useResource` reads — the loading/error clearing is the resource's now. */
      commitSearch(q, sortBy, sortDir, newPage);
      // <Pagination> scrolls the shell's real scroll container back to the top.
    }
  }, [q, sortBy, sortDir, commitSearch]);

  const handleImageSearchSuccess = (results: PonyImage[]) => {
    setCustomResults(results);
    showToast(`找到 ${results.length} 张相似图片`, 'success');
  };

  const clearCustomResults = () => {
    setCustomResults(null);
  };

  const handleRetry = useCallback(() => {
    void read.refresh();
  }, [read]);

  return (
    <>
      <div className="max-w-7xl mx-auto">
        {/* `2xl`, the form column, not a sixth page width. The page itself is `7xl`
            because what fills it is a grid of pictures; the field and the advanced panel
            below are a *form* inside that column, and a form column is `2xl` here (see
            /upload). Both blocks carry the same value so the panel lines up with the
            field that opens it. */}
        <div className="mb-6 max-w-2xl mx-auto">
          <form onSubmit={handleSearch} className="flex items-center gap-2">
            <div className="flex-1 relative" ref={inputWrapRef}>
              <Input
                type="text"
                size="lg"
                icon={<MdSearch size={ICON.standard} />}
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleInputKeyDown}
                placeholder="搜索图片…"
                aria-label="搜索图片"
                /* The field is the combobox, so the whole contract sits on it:
                   `aria-controls` names the popup, `aria-expanded` whether it is showing,
                   `aria-activedescendant` the row the arrow keys are on. It had none of
                   these, so a screen reader was told there were options but never that
                   this field owned them. `aria-autocomplete="list"` because typing
                   filters a list rather than completing inline. */
                role="combobox"
                aria-autocomplete="list"
                aria-controls={acOpen ? acListboxId : undefined}
                aria-expanded={acOpen}
                aria-activedescendant={
                  acOpen && acCursor >= 0 && acCursor < suggestions.length
                    ? acOptionId(acCursor)
                    : undefined
                }
                /* The two actions live *inside* the box. Outside, a search box, a submit
                   button and an image-search button were three objects in a row the eye
                   had to associate — and on a phone most of the screen wide. Inside, it
                   is one control that does one job; the slot is in flow, so no width
                   needs reserving. Both stay pills: a centred pill inside a pill is
                   concentric without anyone doing arithmetic. */
                /* Two controls that read as a pair. Both are 40dp pills in a 56dp pill
                   field, concentric for free — but only one had a container: a bare glyph
                   beside a solid brand pill, so the image-search action was easy to miss.
                   `tonal` gives it the secondary container — visible, clearly a sibling of
                   the submit, and quieter than it, which is the ranking these two actions
                   have. The glyph drops to 20dp to match a 40dp button's own icon slot. */
                trailing={
                  <>
                    <IconButton
                      variant="standard"
                      onClick={() => setIsImageSearchOpen(true)}
                      aria-label="以图搜图"
                      icon={<MdImageSearch size={ICON.control} />}
                    />
                    <Button type="submit" variant="filled">
                      搜索
                    </Button>
                  </>
                }
              />
              {/* `Popover`, so the suggestion list wears the app's one floating surface
                  instead of a fourth hand-rolled recipe, and escapes any clipping ancestor
                  by portalling rather than relying on this wrapper. */}
              <Popover
                open={acOpen}
                onClose={closeSuggestions}
                anchorRef={inputWrapRef}
                variant="search"
                id={acListboxId}
                role="listbox"
                aria-label="搜索建议"
                estimatedHeight={estimateMenuHeight(suggestions.length, 56)}
              >
                {suggestions.map((tag, i) => (
                  <button
                    key={tag.id}
                    type="button"
                    tabIndex={-1}
                    id={acOptionId(i)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectSuggestion(tag)}
                    onMouseEnter={() => setAcCursor(i)}
                    role="option"
                    aria-selected={i === acCursor}
                    className={`flex min-h-14 w-full items-center gap-4 rounded-xl px-2 py-1 text-left outline-none focus-visible:inset-ring-2 focus-visible:focus-ring-inset ${
                      i === acCursor ? 'state-layer-active' : 'state-layer'
                    }`}
                  >
                    {/* 24dp leading slot and a 16dp gap align the label with
                        the search field. 20dp corners sit 8dp inside its 28dp view. */}
                    <span className="grid size-6 shrink-0 place-items-center" aria-hidden="true">
                      <span className={`size-2.5 rounded-full ${tagCategoryDot(tag.cat)}`} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-body-l text-on-surface block truncate">{tag.cn || tag.en}</span>
                      {tag.cn && <span className="text-body-s text-on-surface-variant block truncate">{tag.en}</span>}
                    </span>
                    <span className="text-label-m text-on-surface-variant shrink-0 tabular-nums">
                      {tag.count?.toLocaleString()}
                    </span>
                  </button>
                ))}
              </Popover>
            </div>
          </form>
        </div>{' '}
        {tagInfo.loading ? (
          <div className="mb-6 flex items-center gap-2 text-body-m text-on-surface-variant">
            
            <Spinner size="sm" /> <span>查询中…</span>
          </div>
        ) : tagInfo.data ? (
          <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-body-m text-on-surface-variant">
            
            {tagInfo.data.cn && (
              <div>
                {' '}
                <span className="text-body-s text-on-surface-variant">中文翻译</span>
                <p className="text-body-m text-on-surface">{tagInfo.data.cn}</p>
              </div>
            )}
            {tagInfo.data.count > 0 && (
              <div>
                {' '}
                <span className="text-body-s text-on-surface-variant">使用量</span>
                <p className="text-body-m text-on-surface">{tagInfo.data.count.toLocaleString()}</p>
              </div>
            )}
            {tagInfo.data.cat && (
              <div>
                {' '}
                <span className="text-body-s text-on-surface-variant">分类</span>
                <p className="text-body-m text-on-surface">{tagInfo.data.cat}</p>
              </div>
            )}
            {tagInfo.data.aliases && tagInfo.data.aliases.length > 0 && (
              <div>
                {' '}
                <span className="text-body-s text-on-surface-variant">别名</span>
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {tagInfo.data.aliases.map((alias) => (
                    <Badge key={alias}>{alias}</Badge>
                  ))}
                </div>
              </div>
            )}
            {tagInfo.data.description && (
              <div className="sm:col-span-2">
                {' '}
                <span className="text-body-s text-on-surface-variant">标签简介</span>
                <MarkdownRenderer content={tagInfo.data.description} />
              </div>
            )}
          </div>
        ) : null}{' '}
        {customResults ? (
          <CustomImageList images={customResults} onBack={clearCustomResults} />
        ) : !q ? (
          /* The Lottie rides in `StatusView`'s glyph slot rather than being its own
             centred column, so the resting search screen has the same geometry and
             entrance as every empty list in the app. */
          <EmptyState
            icon={
              <LottieIcon
                /* The status slot owns a real content width, including the
                   space consumed by the app drawer on tablets. */
                className="w-156 max-w-full"
                load={loadSearchArtwork}
                /* 3000×1553, the composition's own box. */
                aspect={3000 / 1553}
                /* The reduced-motion fallback: a `null` fallback meant no illustration at
                   all under `prefers-reduced-motion`. The glyph is `display` (48dp), the
                   app's size for an illustration over an empty state, and it inherits
                   `StatusView`'s own icon colour like every other empty state's glyph. */
                fallback={<MdImageSearch size={ICON.display} />}
              />
            }
            title="输入关键词搜索图片"
            description="支持标签、角色名与英文原名；也可以用右侧的相机按钮以图搜图。"
          />
        ) : isLoading ? (
          <ImageGridSkeleton />
        ) : error ? (
          <ErrorRetry
            title="搜索失败"
            message={
              (error as { status?: number }).status == 429 ||
              error.message === 'Too Many Requests'
                ? '您的请求次数过快，超出原站限制'
                : `${(error as { status?: number }).status ? `HTTP Error ${(error as { status?: number }).status}: ` : ''}${error.message}`
            }
            onRetry={handleRetry}
          />
        ) : images.length === 0 ? (
          <EmptyState
            icon={<MdSearchOff size={ICON.display} />}
            title="没有找到匹配的图片"
            description={<>没有与「{q}」相关的结果，换个关键词或检查一下拼写。</>}
          />
        ) : (
          <>
            <div data-pagination-anchor>
              <div className="mb-3 text-body-m text-on-surface-variant">
                搜索：{q} — 第 {page} 页
              </div>
              <MasonryGrid images={images} />
              <Pagination
                currentPage={page}
                hasMore={hasMore}
                onPageChange={handlePageChange}
                /* Warmed on hover/focus/press of a page control, like the home feed's —
                   this pager had no warmer because the screen had no resource to warm. */
                onPrefetchPage={(next) =>
                  q &&
                  searchFeed.prefetch({
                    query: q,
                    page: next,
                    sortField: sortBy,
                    sortDir,
                  })
                }
              />
            </div>
            {/* One quiet toolbar: matching materials, silhouettes and heights. */}
            {q && (
              <div className="@container mx-auto mt-6 max-w-2xl">
              <div className="flex flex-wrap items-center justify-center gap-2">
                <div className="flex min-w-0 max-w-full items-center gap-2">
                <Select
                  value={sortBy}
                  onChange={(v) => {
                    commitSearch(q, v, sortDir);
                  }}
                  size="sm"
                  shape="pill"
                  aria-label="排序方式"
                  options={[
                     { value: 'created_at', label: '上传时间' },
                     { value: 'updated_at', label: '更新时间' },
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
                  <Button
                    variant="surface"
                    onClick={() => commitSearch(q, sortBy, sortDir === 'desc' ? 'asc' : 'desc')}
                    aria-label={sortDir === 'desc' ? '当前降序，切换为升序' : '当前升序，切换为降序'}
                    icon={
                      <MdArrowDownward
                        className={`transition-transform spring-fast-spatial ${sortDir === 'asc' ? 'rotate-180' : ''}`}
                      />
                    }
                  >
                    {sortDir === 'desc' ? '降序' : '升序'}
                  </Button>
                )}
                </div>
                <div className="flex max-w-full flex-wrap items-center justify-center gap-2">
                {/* This discloses a panel; it does not select a filter value. */}
                <Button
                  variant="surface"
                  onClick={() => setShowAdvanced((prev) => !prev)}
                  aria-expanded={showAdvanced}
                  aria-controls={advancedId}
                  trailingIcon={
                    <MdExpandMore
                      className={`transition-transform ${showAdvanced ? 'spring-default-spatial rotate-180' : 'spring-fast-effects rotate-0'}`}
                    />
                  }
                >
                  高级筛选
                </Button>
                {(sortBy !== defaultSort || sortDir !== 'desc') && (
                  <Button variant="surface" onClick={() => commitSearch(q, defaultSort, 'desc')}>
                    重置排序
                  </Button>
                )}
                </div>
              </div>

              {/* The form expands from the toolbar's own surface. */}
              <div
                id={advancedId}
                role="region"
                aria-label="高级筛选条件"
                inert={!showAdvanced}
                /* The drawer's springs, per direction — `DefaultSpatial` opening,
                   `FastEffects` closing, per `NavigationDrawer.kt`. The last of the app's
                   collapsible panels still on a one-sided 200/300ms curve, which dropped
                   then crept.
                   `grid-template-rows` stays as the mechanism. It is a layout property,
                   which the guillotine note in AGENTS.md warns about — but the failure
                   there is a box resizing *past* fixed-width contents, and here the inner
                   `min-h-0 overflow-hidden` track carries the whole subtree, so the
                   contents are clipped rather than left behind. A translate would need a
                   measured height; `0fr → 1fr` does not. */
                className={`grid transition-[grid-template-rows,opacity] ${
                  showAdvanced
                    ? 'spring-default-spatial grid-rows-[1fr] opacity-100'
                    : 'spring-fast-effects grid-rows-[0fr] opacity-0'
                }`}
              >
                <div className="min-h-0 overflow-hidden">
                  <Card variant="elevated" className="mt-4">
                    <div className="grid grid-cols-1 gap-4 @md:grid-cols-2">
                      {/* Upvotes */}
                      <div>
                        <p className="block text-body-s text-on-surface-variant mb-1">
                          点赞数
                        </p>
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
                            aria-label="点赞数"
                            size="sm"
                            value={advUpvoteVal}
                            onChange={(e) => setAdvUpvoteVal(e.target.value)}
                            placeholder="例如 100"
                            fieldClassName="flex-1"
                          />
                        </div>
                      </div>
                      {/* Score */}
                      <div>
                        <p className="block text-body-s text-on-surface-variant mb-1">
                          净得分
                        </p>
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
                            aria-label="净得分"
                            size="sm"
                            value={advScoreVal}
                            onChange={(e) => setAdvScoreVal(e.target.value)}
                            placeholder="例如 50"
                            fieldClassName="flex-1"
                          />
                        </div>
                      </div>
                      {/* Aspect ratio */}
                    </div>
                    <div className="mt-4 grid grid-cols-1 gap-4 @xl:grid-cols-3">
                      <div>
                        <p className="block text-body-s text-on-surface-variant mb-1">
                          宽高比
                        </p>
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
                        <p className="block text-body-s text-on-surface-variant mb-1">
                          媒体类型
                        </p>
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
                        <p className="block text-body-s text-on-surface-variant mb-1">
                          上传时间
                        </p>
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
                    <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                      <span className="text-body-s text-on-surface-variant">
                        组合条件，进一步缩小搜索范围。
                      </span>
                      <div className="ml-auto flex flex-wrap gap-2">
                        <Button variant="surface" onClick={clearAdvancedFilters}>
                          重置
                        </Button>
                        <Button onClick={applyAdvancedFilters} variant="filled">
                          应用并搜索
                        </Button>
                      </div>
                    </div>
                  </Card>
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
