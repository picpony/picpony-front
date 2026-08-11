'use client';

import { useRef } from 'react';
import { MdRefresh, MdChevronLeft, MdChevronRight, MdFirstPage, MdLastPage } from 'react-icons/md';
import { scrollAppToTop, scrollAppToElement } from '@/lib/motion';
import { cn } from '@/lib/utils';

interface PaginationProps {
  currentPage: number;
  /** Either give a known page count, or `hasMore` for cursor-style sources. */
  totalPages?: number;
  hasMore?: boolean;
  onPageChange: (page: number) => void;
  disabled?: boolean;
  /** Number of numbered buttons; trimmed automatically on narrow screens. */
  siblings?: number;
  /** Opt out of the automatic scroll reset (e.g. an inline widget mid-page). */
  scrollToTop?: boolean;
  className?: string;
}

/**
 * The one pager.
 *
 * There were three: this component, an inline copy inside `ForumPostList`, and
 * another inside the profile page repeated four times, each with different
 * button sizes and a different idea of how many numbers to show.
 *
 * It also owns the scroll reset. Every call site used to do
 * `window.scrollTo({ top: 0 })` by hand, which silently did nothing because the
 * scroll container is not the window (see `scrollAppToTop`). Putting it here
 * means a new call site cannot forget it or get it wrong.
 *
 * The target is the nearest `[data-pagination-anchor]` ancestor — i.e. the top
 * of the list this pager belongs to — rather than the top of the document, so
 * turning a page lands on the first new row instead of replaying the featured
 * banner. Pages with several independent pagers (the profile tabs) each get
 * their own anchor. With no anchor it falls back to the top.
 */
/** Matches a caller-supplied top margin (`mt-*`, `my-*`, or a breakpoint form). */
const HAS_TOP_MARGIN = /(?:^|\s|:)(?:mt|my)-/;

export default function Pagination({
  currentPage,
  totalPages,
  hasMore,
  onPageChange,
  disabled,
  siblings = 2,
  scrollToTop = true,
  className = '',
}: PaginationProps) {
  const rootRef = useRef<HTMLElement>(null);
  const known = typeof totalPages === 'number' && totalPages > 0;
  const canPrev = currentPage > 1;
  const canNext = known ? currentPage < totalPages : Boolean(hasMore);

  const go = (page: number) => {
    if (disabled) return;
    if (page < 1 || (known && page > totalPages)) return;
    if (page === currentPage) return;
    onPageChange(page);
    if (!scrollToTop) return;
    const anchor = rootRef.current?.closest('[data-pagination-anchor]');
    if (anchor) scrollAppToElement(anchor);
    else scrollAppToTop();
  };

  // Centre the window on the current page and clamp it to the known range.
  const span = siblings * 2 + 1;
  let start = Math.max(1, currentPage - siblings);
  if (known) start = Math.min(start, Math.max(1, totalPages - span + 1));
  const count = known ? Math.min(span, totalPages) : span;
  const pages = Array.from({ length: count }, (_, i) => start + i);

  const navBtn = cn(
    // 44px below `sm` for the same reason as the number buttons above.
    'inline-flex h-11 min-w-11 sm:h-10 sm:min-w-10 cursor-pointer items-center justify-center rounded-full px-2',
    'text-on-surface-variant state-layer outline-none',
    'transition-ui',
    'focus-visible:ring-2 focus-ring',
    'disabled:pointer-events-none disabled:disabled-content',
  );

  return (
    <nav
      ref={rootRef}
      aria-label="分页"
      /* Takes part in the tab shared-axis cascade; see `paneRows`. Harmless
         outside a tab pane, which is the only place that attribute is read. */
      data-tab-row
      className={cn(
        /* The default gap stands down when the call site names its own, the same
           guard `Skeleton` uses for its radius and for the same reason: `cn` is a
           plain join, so `mt-12` plus a caller's `mt-8` emitted both and let the
           stylesheet's order pick the winner — which is `mt-12`, so every
           override silently lost. `ForumPostList` asks for `mt-8` and
           `GlossaryTab` for `mt-0`; both were being ignored. */
        !HAS_TOP_MARGIN.test(className) && 'mt-12',
        'flex items-center justify-center gap-1',
        className,
      )}
    >
      {known && (
        <button
          onClick={() => go(1)}
          disabled={!canPrev || disabled}
          aria-label="第一页"
          data-ripple
          className={cn(navBtn, 'max-sm:hidden')}
        >
          <MdFirstPage size={20} />
        </button>
      )}

      <button
        onClick={() => go(currentPage - 1)}
        disabled={!canPrev || disabled}
        aria-label="上一页"
        data-ripple
        className={navBtn}
      >
        <MdChevronLeft size={20} />
        <span className="max-sm:hidden text-label-l pr-1">上一页</span>
      </button>

      <div className="flex items-center gap-1">
        {pages.map((page) => {
          const active = page === currentPage;
          return (
            <button
              key={page}
              onClick={() => go(page)}
              disabled={disabled}
              aria-label={`第 ${page} 页`}
              aria-current={active ? 'page' : undefined}
              data-ripple
              className={cn(
                /* `h-11 w-11` below `sm`: this is the most-tapped chrome in the
                   app and 40px is under the 44px minimum. `touch-target` cannot
                   help here — `data-ripple` sets `overflow: hidden`, which clips
                   the utility's pseudo-element out of hit-testing — so the box
                   itself has to grow. It returns to 40px from `sm` up, where a
                   pointer is doing the aiming. */
                'inline-flex h-11 w-11 sm:h-10 sm:w-10 cursor-pointer items-center justify-center rounded-full outline-none',
                'transition-ui',
                'focus-visible:ring-2 focus-ring',
                'disabled:pointer-events-none disabled:disabled-content',
                /* One type role per branch — the active page used to add a bare
                   `font-medium` over `text-label-l`, which is already weight 500,
                   so the current page was distinguished by colour alone. */
                active
                  ? 'bg-primary text-on-primary text-label-l-emphasized shadow-e1'
                  : 'text-label-l text-on-surface-variant state-layer',
                // Beyond five numbers the row overflows a 390px viewport, so
                // the outer two collapse instead of wrapping to a second line.
                Math.abs(page - currentPage) === siblings && 'max-sm:hidden',
              )}
            >
              {page}
            </button>
          );
        })}
      </div>

      <button
        onClick={() => go(currentPage + 1)}
        disabled={!canNext || disabled}
        aria-label="下一页"
        data-ripple
        className={navBtn}
      >
        <span className="max-sm:hidden text-label-l pl-1">下一页</span>
        <MdChevronRight size={20} />
      </button>

      {known && (
        <button
          onClick={() => go(totalPages)}
          disabled={!canNext || disabled}
          aria-label="最后一页"
          data-ripple
          className={cn(navBtn, 'max-sm:hidden')}
        >
          <MdLastPage size={20} />
        </button>
      )}
    </nav>
  );
}

interface LoadMoreButtonProps {
  onClick: () => void;
  isLoading: boolean;
  disabled?: boolean;
}

export function LoadMoreButton({ onClick, isLoading, disabled }: LoadMoreButtonProps) {
  return (
    <div className="mt-12 flex justify-center">
      <button
        onClick={onClick}
        disabled={isLoading || disabled}
        data-ripple
        className={cn(
          'group flex cursor-pointer items-center gap-2 rounded-full px-8 py-3',
          'bg-secondary-container text-on-secondary-container text-label-l',
          'state-layer outline-none transition-ui',
          'focus-visible:ring-2 focus-ring',
          'disabled:cursor-not-allowed disabled:disabled-content',
          '',
        )}
      >
        {isLoading ? (
          <div className="flex items-center gap-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="bg-primary h-1.5 w-1.5 rounded-full animate-[dot-bounce_1s_var(--ease-loop)_infinite]"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </div>
        ) : (
          <MdRefresh
            size={20}
            className="transition-transform duration-300 ease-[var(--ease-standard)] group-hover:rotate-180 motion-reduce:group-hover:rotate-0"
          />
        )}
        <span>{isLoading ? '正在加载' : '加载更多'}</span>
      </button>
    </div>
  );
}
