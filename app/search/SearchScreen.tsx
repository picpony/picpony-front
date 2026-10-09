'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { usePathname, useRouter } from 'next/navigation';
import { MdImageSearch } from 'react-icons/md';
import Button from '@/components/Button';
import EmptyState from '@/components/EmptyState';
import LottieIcon from '@/components/LottieIcon';
import { showToast } from '@/components/Toast';
import { useBackgroundSearchParams } from '@/components/BackgroundLocation';
import type { ImageSearchOutcome } from '@/components/ImageSearchModal';
import { isApiError, isRetryable } from '@/lib/api/errors';
import { getAppScroller } from '@/lib/appScroller';
import { canGoBackInApp, useBackOrParent } from '@/lib/backNavigation';
import { currentBlockFilters } from '@/lib/blockFilters';
import { LS_KEYS, MEDIA } from '@/lib/constants';
import { useEscapeBack } from '@/lib/hooks';
import { ICON } from '@/lib/icons';
import { createPagedSequence, type ImageSequenceSource } from '@/lib/imageSequence';
import { loadSearchArtwork } from '@/lib/lottieAssets';
import { SKIP, useResource } from '@/lib/resource';
import { searchFeed, semanticQuery, syncBrowsingCookie, useBrowsingFingerprint } from '@/lib/resources';
import {
  NO_SEARCH_FILTERS,
  composeQuery,
  countSearchFilters,
  excludedTagsFrom,
  excludedTermsIn,
  isSemanticText,
  isSingleTagQuery,
  normalizeSearchText,
  parseBrowsingFingerprint,
  parseSearchFilters,
  splitQueryTerms,
  toggleQueryTerm,
  type SearchFilters,
} from '@/lib/searchQuery';
import {
  defaultSearchSort,
  effectiveSearchSort,
  imageSearchHref,
  queryHasRanking,
  readSearchLocation,
  searchHref,
  type SearchLocation,
} from '@/lib/searchState';
import { scrollAppToElement } from '@/lib/scrollTo';
import { readImageSearch, saveImageSearch } from './imageSearchStore';
import ImageSearchResults from './ImageSearchResults';
import QuickTags from './QuickTags';
import { rememberSearch } from './searchHistory';
import SearchField from './SearchField';
import SearchResults, { type EmptyAdvice } from './SearchResults';
import SearchToolbar from './SearchToolbar';
import SemanticFeedback from './SemanticFeedback';
import SemanticLine, { type SemanticLineState } from './SemanticLine';
import { ShareSearchButton, SharedByNotice } from './ShareSearch';
import type { SemanticSearchConfig } from './semantic.server';
import { useSemanticConfig } from '@/lib/useSiteStatus';

/**
 * Behind `dynamic()` and a one-way latch, like the captcha: the dialog (drop zone, slider, the
 * picture reader) is only needed once somebody asks for it. `loading` keeps a first open from
 * suspending to the route's boundary.
 */
const ImageSearchModal = dynamic(() => import('@/components/ImageSearchModal'), { ssr: false, loading: () => null });

/** Derpibooru's page size for a search — the request's own, which the skeleton matches. */
const PAGE_SIZE = 50;
/**
 * The deepest page Derpibooru serves: from page 1000 on it answers a bot challenge instead of
 * JSON (measured read-only, 2026-09-26: 999 is a page of results, 1000 and 1001 an HTML
 * "Attention Required!"). A pager offering page 5813 of a large tag would lead there.
 */
const MAX_REACHABLE_PAGE = 999;
/** How long a list turning its page for a return flight may take before the flight gives up. */
const REVEAL_TIMEOUT_MS = 4000;

const pagesFor = (total: number) => Math.max(1, Math.min(MAX_REACHABLE_PAGE, Math.ceil(total / PAGE_SIZE)));

/* ---------------------------------------------------------------------------------------------
 * History. /search's URL is its whole state (`readSearchLocation`), and the screen writes its own
 * entries with the native history API — Next folds `pushState` / `replaceState` into its router
 * and syncs `useSearchParams`, and nothing is started that could race another navigation. A new
 * query pushes; everything that refines the search on screen replaces (C1): sort, direction,
 * conditions, the tags a Chinese search runs with, and the page.
 * ------------------------------------------------------------------------------------------- */

function writeHistory(href: string, mode: 'push' | 'replace'): boolean {
  if (typeof window === 'undefined') return false;
  /* The screen can be the background of an open picture; its entry is not the current one then,
     and a write would replace the picture's. */
  if (window.location.pathname !== '/search') return false;
  const target = new URL(href, window.location.origin);
  if (target.search === window.location.search) return false;
  if (mode === 'push') window.history.pushState(null, '', href);
  else window.history.replaceState(null, '', href);
  return true;
}

/** The live URL's search, as a state — for writes made after a render, which must not use a stale one. */
function liveLocation(): SearchLocation {
  return readSearchLocation(new URLSearchParams(window.location.search));
}

function hrefOf(state: SearchLocation, fallbackSort: string): string {
  return searchHref(state.query, state.sort || fallbackSort, state.direction, state.page, {
    literal: state.literal,
    tags: state.tags,
    sharedBy: state.sharedBy,
  });
}

/** The Navigation API's entry key — stable for one history slot — or the URL where it is missing. */
function entryKey(): string {
  const nav = (window as unknown as { navigation?: { currentEntry?: { key?: string } | null } }).navigation;
  return nav?.currentEntry?.key ?? `url:${window.location.pathname}${window.location.search}`;
}

/**
 * Scroll offsets by history entry, for Back and Forward *within* /search: the route-level owner
 * (`lib/scrollMemory.ts`) acts only when the pathname changes, and every search is one pathname.
 * Module scope, like that owner's map: a reload is a legitimate reset.
 */
const offsets = new Map<string, number>();

/**
 * Each list's reveal, by its sequence key — the detail's return flight calls it through the
 * source (`lib/imageSequence.ts`), and the screen re-registers it on every commit so it always
 * acts on what is on screen.
 */
const revealers = new Map<string, (id: number, page: number) => Promise<boolean>>();

function findCard(grid: HTMLElement | null, id: number): Element | null {
  return grid?.querySelector(`[data-image-hero-id="${id}"]`)?.closest('.image-card') ?? null;
}

function bringIntoView(element: Element) {
  const scroller = getAppScroller();
  if (!scroller) return;
  const view = scroller.getBoundingClientRect();
  const box = element.getBoundingClientRect();
  if (box.top >= view.top && box.bottom <= view.bottom) return;
  /* Centred, instantly: this runs under the detail overlay, for a return flight to land on. */
  const room = Math.max(0, view.height - box.height) / 2;
  scroller.scrollTop = Math.max(0, scroller.scrollTop + (box.top - view.top) - room);
}

/** What the words of a Chinese / natural-language search became, and so what runs. */
type Interpretation =
  | { kind: 'plain' }
  | { kind: 'pending' }
  | { kind: 'converted'; tags: string[]; included: string[]; fromParse: boolean }
  | { kind: 'literal' }
  | { kind: 'failed'; timedOut: boolean; retryable: boolean }
  | { kind: 'untagged' }
  | { kind: 'disabled' };

function unionTags(first: readonly string[], second: readonly string[]): string[] {
  const seen = new Set(first.map((tag) => tag.toLowerCase()));
  return [...first, ...second.filter((tag) => !seen.has(tag.toLowerCase()))];
}

/**
 * /search. The URL is the state; this component reads it, derives what to ask for, and writes
 * the next entry. Reads go through resources — the semantic parse, the result pages, the
 * dictionary — so coming back to a search costs nothing.
 */
export default function SearchScreen({ semantic: initialSemantic }: { semantic: SemanticSearchConfig }) {
  const semantic = useSemanticConfig(initialSemantic);
  const router = useRouter();
  const pathname = usePathname();
  const params = useBackgroundSearchParams();
  const search = params.toString();
  const location = useMemo(() => readSearchLocation(new URLSearchParams(search)), [search]);
  const fp = useBrowsingFingerprint();
  const settings = useMemo(() => parseBrowsingFingerprint(fp), [fp]);
  const excluded = useMemo(() => excludedTagsFrom(settings, currentBlockFilters()), [settings]);

  /* ----- device preferences: the default sort lives in localStorage, read after mount ----- */
  const [prefs, setPrefs] = useState({ ready: false, defaultSort: 'created_at' });
  useEffect(() => {
    let current = true;
    const update = () => {
      if (!current) return;
      let defaultSort = 'created_at';
      try {
        defaultSort = defaultSearchSort(localStorage.getItem(LS_KEYS.searchSort));
      } catch {
        // Storage can be disabled; searching still works with the default order.
      }
      setPrefs((previous) =>
        previous.ready && previous.defaultSort === defaultSort ? previous : { ready: true, defaultSort },
      );
      syncBrowsingCookie();
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

  /* ----- what the query means ----- */
  const { terms: baseTerms, filters } = useMemo(() => parseSearchFilters(location.query), [location.query]);
  const baseText = baseTerms.join(', ');
  const semanticCandidate = !location.image && semantic.availability !== 'off' && isSemanticText(baseText);
  const parse = useResource(
    semanticQuery,
    semanticCandidate && !location.literal ? { text: baseText, timeoutMs: semantic.timeoutMs } : SKIP,
  );

  let interpretation: Interpretation = { kind: 'plain' };
  if (semanticCandidate) {
    const parsed = parse.data?.enabled ? parse.data.tags : [];
    if (location.literal) interpretation = { kind: 'literal' };
    else if (location.tags) {
      /* The parse's order first, so a chip left out stays where it was rather than moving to
         the end of the row under the pointer that just tapped it. */
      interpretation = { kind: 'converted', included: location.tags, tags: unionTags(parsed, location.tags), fromParse: false };
    } else if (parse.data === undefined && !parse.error) interpretation = { kind: 'pending' };
    else if (parse.data === undefined) {
      interpretation = {
        kind: 'failed',
        timedOut: isApiError(parse.error) && parse.error.kind === 'timeout',
        retryable: isRetryable(parse.error),
      };
    } else if (!parse.data.enabled) interpretation = { kind: 'disabled' };
    else if (parsed.length === 0) interpretation = { kind: 'untagged' };
    else interpretation = { kind: 'converted', included: parsed, tags: parsed, fromParse: true };
  }
  const effectiveQuery = interpretation.kind === 'pending'
    ? null
    : interpretation.kind === 'converted'
      ? composeQuery(interpretation.included, filters)
      : location.query;
  const rankingText = interpretation.kind === 'converted' ? interpretation.included.join(', ') : baseText;

  /* ----- the read ----- */
  const sortBy = effectiveSearchSort(location.sort, prefs.defaultSort, rankingText);
  const sortDir = location.direction;
  const resultSet = effectiveQuery ? `${effectiveQuery}\n${sortBy}:${sortDir}\n${fp}` : '';
  /* The page lives in the URL; an override holds a page the list turned to while it was the
     background of an open picture, until its own entry is current again and can say so. */
  const [pageOverride, setPageOverride] = useState<{ set: string; page: number } | null>(null);
  if (pageOverride && (pageOverride.set !== resultSet || (pathname === '/search' && location.page === pageOverride.page))) {
    setPageOverride(null);
  }
  const page = pageOverride && pageOverride.set === resultSet ? pageOverride.page : location.page;
  /* The default sort only matters when the URL names none; waiting for it otherwise would put a
     skeleton over a cached search for a frame. */
  const sortKnown = prefs.ready || location.sort !== '';
  const read = useResource(
    searchFeed,
    effectiveQuery && sortKnown ? { query: effectiveQuery, page, sortField: sortBy, sortDir, fp } : SKIP,
    /* Retention scoped to one result set: a page turn keeps its rows (dimmed) so the scroller
       keeps its height; a new query, sort or content setting never shows the previous answer
       as if it were the new one. */
    { keepPrevious: resultSet || false },
  );
  const [shown, setShown] = useState<{ set: string; page: number } | null>(null);
  if (read.data && !read.isPrevious && (shown?.set !== resultSet || shown.page !== page)) {
    setShown({ set: resultSet, page });
  }
  const shownPage = read.isPrevious && shown?.set === resultSet ? shown.page : page;
  const totalPages = pagesFor(read.data?.total ?? 0);

  /* ----- the field follows the committed query; edits stay local until submitted ----- */
  const viewKey = location.image ? `image:${location.image}` : `q:${location.query}`;
  const [fieldFor, setFieldFor] = useState(viewKey);
  const [inputValue, setInputValue] = useState(location.image ? '' : location.query);
  if (fieldFor !== viewKey) {
    setFieldFor(viewKey);
    setInputValue(location.image ? '' : location.query);
  }
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const hrefFor = (patch: Partial<SearchLocation>) => hrefOf({ ...location, ...patch }, sortBy);

  /** After a refinement: if the results' top has scrolled out above, bring it back. */
  const revealResultsTop = () => {
    requestAnimationFrame(() => {
      const anchor = resultsRef.current;
      const scroller = getAppScroller();
      if (!anchor || !scroller) return;
      if (anchor.getBoundingClientRect().top < scroller.getBoundingClientRect().top) scrollAppToElement(anchor);
    });
  };

  const refine = (patch: Partial<SearchLocation>) => {
    if (writeHistory(hrefFor({ page: 1, ...patch }), 'replace')) revealResultsTop();
  };

  const runQuery = (text: string) => {
    const query = normalizeSearchText(text);
    if (!query) return;
    setInputValue(query);
    if (query === location.query && !location.image) {
      /* The same words again are not a new search; a failed one is worth another go. */
      if (read.error && isRetryable(read.error)) read.refresh();
      if (parse.error && isRetryable(parse.error)) parse.refresh();
      return;
    }
    rememberSearch(query);
    if (!writeHistory(searchHref(query, sortBy, sortDir, 1), 'push')) return;
    /* A phone's keyboard covers the results it just asked for. */
    if (window.matchMedia(MEDIA.pointerCoarse).matches) inputRef.current?.blur();
    const scroller = getAppScroller();
    if (scroller && scroller.scrollTop > 0) scroller.scrollTop = 0;
  };

  /* ----- pin the tags a parse produced, so reload and share run the same search at once ----- */
  const pinned = interpretation.kind === 'converted' && interpretation.fromParse ? interpretation.included.join(',') : '';
  useEffect(() => {
    if (!pinned) return;
    /* A task of its own: this can land in the commit that answers a history traversal, and a
       history write inside that task confuses the router's own bookkeeping. */
    const timer = setTimeout(() => {
      if (window.location.pathname !== '/search') return;
      const live = liveLocation();
      if (live.query !== location.query || live.literal || live.tags) return;
      writeHistory(hrefOf({ ...live, tags: pinned.split(',') }, sortBy), 'replace');
    }, 0);
    return () => clearTimeout(timer);
  }, [pinned, location.query, sortBy]);

  /* ----- changed browsing rules: an open search's later pages no longer mean what they did ----- */
  const rulesKey = `${fp}\n${prefs.defaultSort}`;
  const lastRules = useRef<string | null>(null);
  useEffect(() => {
    if (!prefs.ready) return;
    const previous = lastRules.current;
    lastRules.current = rulesKey;
    if (previous === null || previous === rulesKey) return;
    if (window.location.pathname !== '/search') return;
    const live = liveLocation();
    if (live.page > 1) writeHistory(hrefOf({ ...live, page: 1 }, prefs.defaultSort), 'replace');
  }, [prefs.ready, prefs.defaultSort, rulesKey]);

  /* ----- the list's side of 上一张 / 下一张 (decision 19) ----- */
  const gridRef = useRef<HTMLDivElement>(null);
  const pendingReveal = useRef<{ id: number; resolve: (ok: boolean) => void; frame: number } | null>(null);
  /* A screen leaving mid-reveal answers "no card" rather than leaving the flight waiting. */
  useEffect(() => () => {
    const pending = pendingReveal.current;
    pendingReveal.current = null;
    if (pending) {
      cancelAnimationFrame(pending.frame);
      pending.resolve(false);
    }
  }, []);
  const sequenceKeyOf = (set: string) => `search:${set}`;

  /* The reveal, registered for this result set on every commit so it acts on what is on screen:
     the page it holds, the grid it rendered. */
  useLayoutEffect(() => {
    if (!resultSet) return;
    const key = sequenceKeyOf(resultSet);
    const reveal = (id: number, targetPage: number) => new Promise<boolean>((resolve) => {
      const previous = pendingReveal.current;
      if (previous) {
        cancelAnimationFrame(previous.frame);
        previous.resolve(false);
      }
      pendingReveal.current = null;
      if (targetPage === shownPage) {
        const card = findCard(gridRef.current, id);
        if (card) bringIntoView(card);
        resolve(Boolean(card));
        return;
      }
      /* Watched for frame by frame rather than on this screen's own commits: the grid renders a
         new page in a deferred pass of its own (it keeps the page it had meanwhile), so the card
         arrives in a commit this screen never sees. */
      const deadline = performance.now() + REVEAL_TIMEOUT_MS;
      const pending = { id, resolve, frame: 0 };
      const watch = () => {
        if (pendingReveal.current !== pending) return;
        const card = findCard(gridRef.current, id);
        if (card || performance.now() > deadline) {
          pendingReveal.current = null;
          if (card) bringIntoView(card);
          resolve(Boolean(card));
          return;
        }
        pending.frame = requestAnimationFrame(watch);
      };
      pendingReveal.current = pending;
      pending.frame = requestAnimationFrame(watch);
      /* The page-turn path when the list is on screen; under an open picture its entry is not
         current, so the page changes through state and the URL catches up once it is. */
      if (window.location.pathname === '/search') {
        writeHistory(hrefOf({ ...liveLocation(), page: targetPage }, sortBy), 'replace');
      } else {
        setPageOverride({ set: resultSet, page: targetPage });
      }
    });
    revealers.set(key, reveal);
    return () => {
      if (revealers.get(key) === reveal) revealers.delete(key);
    };
  });

  /* Once the list's own entry is current again, the URL takes the page the override held. */
  useEffect(() => {
    if (!pageOverride || pathname !== '/search') return;
    const timer = setTimeout(() => {
      if (window.location.pathname !== '/search') return;
      const live = liveLocation();
      if (live.page !== pageOverride.page) writeHistory(hrefOf({ ...live, page: pageOverride.page }, sortBy), 'replace');
    }, 0);
    return () => clearTimeout(timer);
  }, [pageOverride, pathname, sortBy]);

  /* The source for the detail, made once per result set, page and set of ids — so opening a second
     card keeps the pages the detail already loaded (decision 19). Adjusted during render, the
     documented pattern for state that follows other state. */
  const data = read.data;
  const sequenceKey = effectiveQuery && data && data.images.length > 0
    ? [resultSet, shownPage, data.images.map((image) => image.id).join(',')].join('|')
    : '';
  const [sequenceState, setSequenceState] = useState<{ key: string; source?: ImageSequenceSource }>({ key: '' });
  if (sequenceState.key !== sequenceKey) {
    let source: ImageSequenceSource | undefined;
    if (sequenceKey && effectiveQuery && data) {
      const query = effectiveQuery;
      const key = sequenceKeyOf(resultSet);
      source = createPagedSequence({
        key,
        page: shownPage,
        current: { ids: data.images.map((image) => image.id), previews: data.images, totalPages: pagesFor(data.total) },
        pageSize: PAGE_SIZE,
        fetchPage: async (next) => {
          const result = await searchFeed.read({ query, page: next, sortField: sortBy, sortDir, fp });
          return { ids: result.images.map((image) => image.id), previews: result.images, totalPages: pagesFor(result.total) };
        },
        reveal: (id, targetPage) => revealers.get(key)?.(id, targetPage) ?? Promise.resolve(false),
      });
    }
    setSequenceState({ key: sequenceKey, source });
  }
  const sequence = sequenceState.key === sequenceKey ? sequenceState.source : undefined;

  /* ----- Back and Forward between searches land where each one was left (R5-014) -----
   *
   * Detected from the entry the screen renders, not from `popstate`: which listener hears that
   * event first is not this screen's to decide — React renders a transition started inside it
   * synchronously, and the router's traversal could commit before a bubbling listener ran, or
   * even before a capturing one, so the screen had already rendered the entry it was about to
   * restore. A change of entry *and* of search, both on /search, with an offset recorded for
   * the new entry, is a traversal between searches: a push mints a key nothing has recorded,
   * and a picture closing returns to the search it was opened from (the hero owns that scroll).
   */
  const shownEntry = useRef<{ key: string; search: string } | null>(null);
  const pendingRestore = useRef<{ key: string; offset: number } | null>(null);
  /* The entry's own content is on screen: the restore waits for it, or the browser clamps the
     offset to a skeleton's height. */
  const settled = location.image !== null || !location.query ||
    (read.data !== undefined && !read.isPrevious) || (read.data === undefined && Boolean(read.error));
  useLayoutEffect(() => {
    if (pathname !== '/search') {
      shownEntry.current = null;
      pendingRestore.current = null;
      return;
    }
    const key = entryKey();
    const previous = shownEntry.current;
    shownEntry.current = { key, search: window.location.search };
    if (previous && previous.key !== key && previous.search !== window.location.search) {
      const offset = offsets.get(key);
      pendingRestore.current = offset === undefined ? null : { key, offset };
    }
    const pending = pendingRestore.current;
    /* An entry nobody has scrolled yet is where it was first shown — the top, for a new
       search — so coming back to it is not left to wherever the previous one was. */
    if (!pending && !offsets.has(key)) {
      const scroller = getAppScroller();
      if (scroller) offsets.set(key, scroller.scrollTop);
    }
    if (!pending || !settled) return;
    pendingRestore.current = null;
    if (pending.key !== key) return;
    const scroller = getAppScroller();
    if (scroller) scroller.scrollTop = pending.offset;
  });
  useEffect(() => {
    const scroller = getAppScroller();
    if (!scroller) return;
    let frame = 0;
    /* Recorded against the entry on screen, and only while it is the current one: between a
       traversal and the render that answers it, a scroll belongs to neither. */
    const record = () => {
      frame = 0;
      const shown = shownEntry.current;
      if (shown && !pendingRestore.current && shown.key === entryKey()) offsets.set(shown.key, scroller.scrollTop);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(record);
    };
    /* The reader took over before the entry's content arrived: their scroll wins. */
    const cancel = () => {
      pendingRestore.current = null;
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    scroller.addEventListener('wheel', cancel, { passive: true });
    scroller.addEventListener('touchstart', cancel, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', onScroll);
      scroller.removeEventListener('wheel', cancel);
      scroller.removeEventListener('touchstart', cancel);
    };
  }, []);

  /* ----- the document title follows the search (the server's metadata named the first one) ----- */
  useEffect(() => {
    if (pathname !== '/search') return;
    document.title = location.image
      ? '以图搜图结果 - PicPony'
      : location.query ? `搜索：${location.query.slice(0, 40)} - PicPony` : '搜索 - PicPony';
  }, [location.image, location.query, pathname]);

  /* ----- 以图搜图 ----- */
  const [imageSearchMounted, setImageSearchMounted] = useState(false);
  const [imageSearchOpen, setImageSearchOpen] = useState(false);
  const openImageSearch = () => {
    setImageSearchMounted(true);
    setImageSearchOpen(true);
  };
  const handleImageSearch = (outcome: ImageSearchOutcome) => {
    if (outcome.kind === 'query') {
      runQuery(outcome.query);
      return;
    }
    /* Stored as the service answered: the results screen applies this device's content settings
       as it draws (`imageFilterFor`), so a setting changed afterwards — looser or stricter — is
       honoured (review P4-O9) rather than the set being fixed at the settings it was saved under. */
    const key = saveImageSearch({
      images: outcome.images,
      found: outcome.images.length,
      preview: outcome.preview,
    });
    if (writeHistory(imageSearchHref(key), 'push')) {
      const scroller = getAppScroller();
      if (scroller && scroller.scrollTop > 0) scroller.scrollTop = 0;
    }
  };

  /* ----- Escape and Back ----- */
  const back = useBackOrParent('/');
  useEscapeBack(back, !imageSearchOpen);
  /** Leaving a 以图搜图 result set: back to the search before it, or to the empty search. */
  const closeImageResults = () => {
    if (canGoBackInApp()) window.history.back();
    else writeHistory('/search', 'replace');
  };

  /* ----- the semantic row ----- */
  const toggleTag = (tag: string) => {
    if (interpretation.kind !== 'converted') return;
    const lower = tag.toLowerCase();
    const has = interpretation.included.some((kept) => kept.toLowerCase() === lower);
    const next = has
      ? interpretation.included.filter((kept) => kept.toLowerCase() !== lower)
      : [...interpretation.included, tag];
    if (next.length === 0) {
      showToast('至少保留一个标签', 'info');
      return;
    }
    refine({ tags: next, literal: false });
  };

  let semanticState: SemanticLineState | null = null;
  switch (interpretation.kind) {
    case 'pending':
      semanticState = { kind: 'pending', text: baseText, estimateMs: semantic.estimateMs };
      break;
    case 'converted':
      semanticState = { kind: 'converted', text: baseText, tags: interpretation.tags, included: interpretation.included };
      break;
    case 'literal':
    case 'untagged':
    case 'disabled':
      semanticState = { kind: interpretation.kind, text: baseText };
      break;
    case 'failed':
      semanticState = { kind: 'failed', text: baseText, timedOut: interpretation.timedOut, retryable: interpretation.retryable };
      break;
  }

  /* ----- conditions ----- */
  const applyFilters = (next: SearchFilters, from: 'panel' | 'chip') => {
    /* The panel applies to what is in the field — words typed and not yet searched included —
       and so is a new search when those words differ; a chip only ever edits the search on
       screen. */
    const fieldTerms = from === 'panel' ? parseSearchFilters(normalizeSearchText(inputValue)).terms : baseTerms;
    const query = composeQuery(fieldTerms, next);
    if (!query) {
      showToast('请输入关键词或设置筛选条件', 'info');
      return;
    }
    if (fieldTerms.join('\n') === baseTerms.join('\n')) refine({ query });
    else runQuery(query);
  };

  /* ----- what an empty result says ----- */
  const emptyAdvice = (): EmptyAdvice => {
    const total = read.data?.total ?? 0;
    if (page > 1 && total > 0) {
      return {
        title: '这一页没有图片',
        description: `这次搜索共 ${pagesFor(total)} 页。`,
        action: <Button variant="tonal" onClick={() => refine({})}>回到第一页</Button>,
      };
    }
    const blocked = effectiveQuery ? excludedTermsIn(effectiveQuery, excluded) : [];
    if (blocked.length > 0) {
      return {
        title: '没有可显示的图片',
        description: `「${blocked.join('」「')}」属于当前内容筛选设置排除的内容。`,
        action: <Button variant="tonal" onClick={() => router.push('/settings', { scroll: false })}>前往设置</Button>,
      };
    }
    if (countSearchFilters(filters) > 0) {
      return {
        title: '没有找到匹配的图片',
        description: baseTerms.length === 0 ? '放宽筛选条件再试。' : '放宽筛选条件，或换个关键词再试。',
        action: <Button variant="tonal" onClick={() => applyFilters(NO_SEARCH_FILTERS, 'chip')}>清除筛选条件</Button>,
      };
    }
    if (interpretation.kind === 'converted') {
      return {
        title: '没有找到匹配的图片',
        description: '可以去掉部分标签，或改为搜索原文。',
        action: <Button variant="tonal" onClick={() => refine({ literal: true, tags: null })}>搜索原文</Button>,
      };
    }
    return {
      title: '没有找到匹配的图片',
      description: <>没有与「{location.query}」相关的结果，换个关键词或检查一下拼写。</>,
    };
  };

  const singleTag = effectiveQuery && isSingleTagQuery(effectiveQuery) ? splitQueryTerms(effectiveQuery)[0] : null;
  const feedback = semanticCandidate && parse.data?.modelUsed
    ? <SemanticFeedback query={baseText} tags={parse.data.tags} engines={parse.data.engines} />
    : null;

  const placeholder = semantic.availability === 'off' ? '搜索图片…' : '搜索图片，也可以直接用中文描述…';

  return (
    <div className="mx-auto max-w-7xl">
      <h1 className="sr-only">搜索图片</h1>
      {/* `2xl`, the form column: the page is `7xl` because what fills it is a grid of pictures,
          and the field, what its words became and the toolbar are a form inside that column. */}
      <div className="mx-auto mb-6 max-w-2xl">
        <SearchField
          value={inputValue}
          onValueChange={setInputValue}
          onSubmit={runQuery}
          onRecentPick={runQuery}
          onImageSearch={openImageSearch}
          safeMode={settings.contentFilter === 'safe'}
          placeholder={placeholder}
          inputRef={inputRef}
        />
        {location.sharedBy && !location.image && (
          <div className="mt-2">
            <SharedByNotice
              name={location.sharedBy}
              onDismiss={() => {
                writeHistory(hrefFor({ sharedBy: null }), 'replace');
                inputRef.current?.focus({ preventScroll: true });
              }}
            />
          </div>
        )}
        {semanticState && (
          <div className="mt-2">
            <SemanticLine
              state={semanticState}
              onSearchOriginal={() => refine({ literal: true, tags: null })}
              onUseTags={() => refine({ literal: false, tags: null })}
              onToggleTag={toggleTag}
              onRetry={() => parse.refresh()}
            />
          </div>
        )}
        {location.query && !location.image && (
          <div className="mt-4">
            <SearchToolbar
              sortBy={sortBy}
              sortDir={sortDir}
              defaultSort={prefs.defaultSort}
              canRank={queryHasRanking(rankingText)}
              onSort={(sort) => refine({ sort })}
              onDirection={(direction) => refine({ direction })}
              onResetSort={() => refine({ sort: prefs.defaultSort, direction: 'desc' })}
              filters={filters}
              onApplyFilters={applyFilters}
            />
          </div>
        )}
      </div>

      <div ref={resultsRef} data-search-results>
        {location.image ? (
          <ImageSearchResults
            result={readImageSearch(location.image)}
            onSearchAgain={openImageSearch}
            onClose={closeImageResults}
          />
        ) : !location.query ? (
          <div className="mx-auto max-w-2xl">
            <QuickTags
              value={inputValue}
              onToggle={(tag) => setInputValue((text) => toggleQueryTerm(text, tag))}
              excluded={excluded}
            />
            {/* The Lottie rides in `StatusView`'s glyph slot, so the resting screen has the
                geometry and entrance of every other empty list. */}
            <EmptyState
              size="pane"
              icon={
                <LottieIcon
                  className="w-156 max-w-full"
                  load={loadSearchArtwork}
                  /* 3000×1553, the composition's own box. */
                  aspect={3000 / 1553}
                  fallback={<MdImageSearch size={ICON.display} />}
                />
              }
              title="输入关键词搜索图片"
              description={
                semantic.availability === 'off'
                  ? '支持标签、角色名与英文原名；也可以用搜索框右侧的以图搜图按钮。'
                  : '支持中文描述、标签、角色名与英文原名；也可以用搜索框右侧的以图搜图按钮。'
              }
            />
          </div>
        ) : (
          <SearchResults
            waiting={effectiveQuery === null || !sortKnown}
            data={read.data}
            error={read.error}
            isPrevious={read.isPrevious}
            refresh={read.refresh}
            page={page}
            shownPage={shownPage}
            totalPages={totalPages}
            onPageChange={(next) => {
              if (next >= 1) writeHistory(hrefFor({ page: next }), 'replace');
            }}
            onPrefetchPage={(next) => {
              if (effectiveQuery) searchFeed.prefetch({ query: effectiveQuery, page: next, sortField: sortBy, sortDir, fp });
            }}
            sequence={sequence}
            gridRef={gridRef}
            gridKey={resultSet}
            singleTag={singleTag}
            empty={emptyAdvice()}
            footer={feedback}
            captionAction={
              <ShareSearchButton
                /* The search as it runs: the tags a Chinese search became, so the recipient
                   runs the same search at once rather than asking the model again. */
                href={hrefFor({
                  page: 1,
                  sharedBy: null,
                  tags: interpretation.kind === 'converted' ? interpretation.included : location.tags,
                })}
                query={location.query}
              />
            }
          />
        )}
      </div>

      {imageSearchMounted && (
        <ImageSearchModal isOpen={imageSearchOpen} onClose={() => setImageSearchOpen(false)} onResult={handleImageSearch} />
      )}
    </div>
  );
}
