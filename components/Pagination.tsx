'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useIntentPrefetch } from '@/lib/useIntentPrefetch';
import { MdRefresh, MdChevronLeft, MdChevronRight, MdFirstPage, MdLastPage } from 'react-icons/md';
import Button from './Button';
import { scrollAppToTop, scrollAppToElement } from '@/lib/scrollTo';
import { cn } from '@/lib/utils';
import { ICON } from '@/lib/icons';

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
  /**
   * Warm a page's data before it is asked for.
   *
   * The pager calls this for whichever page a pointer, focus or press is resting on — never
   * speculatively; see the note on `pageIntent` below. It is a prop rather than something the pager
   * derives, because only the call site knows which resource a page number means, and the pager
   * must not grow an opinion about the thirteen different lists it serves.
   *
   * Everything it starts goes out at `background` priority, so a guessed page can never take a
   * slot from the page somebody is waiting for; see `lib/resource.ts`.
   */
  onPrefetchPage?: (page: number) => void;
  className?: string;
}

/**
 * The one pager.
 *
 * It owns the scroll reset (the scroll container is not the window, so a hand-rolled
 * `window.scrollTo` silently does nothing). The target is the nearest
 * `[data-pagination-anchor]` **ancestor** — `closest()` walks up; a marker with the
 * pager as its *sibling* is invisible to it and the failure is silent. Several
 * pagers may share one enclosing anchor, and a pager passed into a list component
 * as `children` is inside its anchor by construction.
 *
 * With no anchor it falls back to the top of the scroll container — unless the
 * container is a dialog's, where it does nothing rather than scrolling a surface
 * the user is not looking at.
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
  onPrefetchPage,
  className = '',
}: PaginationProps) {
  const rootRef = useRef<HTMLElement>(null);
  const known = typeof totalPages === 'number' && totalPages > 0;
  const canPrev = currentPage > 1;
  const canNext = known ? currentPage < totalPages : Boolean(hasMore);

  /**
   * Whichever page the pointer or the keyboard is resting on, through the same
   * intent ladder every link in the app uses — 70ms for a hover, 120ms for focus,
   * immediate on press.
   *
   * **On intent only, never on idle**, and that is a decision: warming the next
   * page on settle is a request for a page that may never be looked at, and the
   * rule is that speculation may move a request *earlier*, never add one (asserted
   * by `npm run net:audit`). The head start survives on hover and (on touch,
   * 100ms+ before click) on `onPointerDown`; the unasked-for request does not.
   */
  const warmRef = useRef<((page: number) => void) | undefined>(undefined);
  useEffect(() => {
    warmRef.current = onPrefetchPage;
  }, [onPrefetchPage]);
  const [intentPage, setIntentPage] = useState<number | null>(null);
  const intent = useIntentPrefetch(
    useCallback(() => {
      if (intentPage !== null) warmRef.current?.(intentPage);
    }, [intentPage]),
  );
  const pageIntent = (page: number) => ({
    onPointerEnter: () => {
      setIntentPage(page);
      intent.onPointerEnter();
    },
    onPointerLeave: intent.onPointerLeave,
    onFocus: () => {
      setIntentPage(page);
      intent.onFocus();
    },
    onBlur: intent.onBlur,
    onPointerDown: intent.onPointerDown,
  });

  const go = (page: number) => {
    if (disabled) return;
    if (page < 1 || (known && page > totalPages)) return;
    if (page === currentPage) return;
    onPageChange(page);
    if (!scrollToTop) return;
    /* Which *container* to scroll, before deciding where in it. A pager inside a
       modal was scrolling the page behind the dialog while its own list stayed
       put — the app scroller is not the only thing that scrolls. With a nearer
       scroll container, an anchorless pager does nothing rather than moving a
       surface the user is not looking at. */
    const scroller =
      rootRef.current?.closest<HTMLElement>('[data-app-scroll-container]') ?? undefined;
    /* The distance law, `scrollAppToElement`'s default — no duration override.
       The law scales the length with the square root of the travel, so the *rate*
       is non-linear in the distance: a short hop is brisk, a long one takes its
       time. A fixed length makes the speed rise with however far you happen to be
       scrolled — a whip-pan from the bottom of a long gallery, a crawl from near
       the top. When the glide looked wrong, the fault was blank cards underneath
       it, not the duration; with the placeholder fixed, the honest glide passes
       over skeletons in the row's own geometry. */
    const anchor = rootRef.current?.closest('[data-pagination-anchor]');
    if (anchor) scrollAppToElement(anchor, { scroller });
    else if (!scroller) scrollAppToTop();
  };

  // Centre the window on the current page and clamp it to the known range.
  const span = siblings * 2 + 1;
  let start = Math.max(1, currentPage - siblings);
  if (known) start = Math.min(start, Math.max(1, totalPages - span + 1));
  const count = known ? Math.min(span, totalPages) : span;
  const pages = Array.from({ length: count }, (_, i) => start + i);
  // Keep a consecutive three-page window when the *container* is narrow.
  // At either end, centre-on-current alone would leave holes in that window.
  const compactCount = Math.min(count, 3);
  const compactStart = Math.max(start, Math.min(currentPage - 1, start + count - compactCount));

  const navBtn = cn(
    /* **40dp, with `touch-size` for the floor.** The 40 is the button step; the
       floor is `--touch-floor` (48 under a coarse pointer, 24 under a fine one).
       `touch-size` rather than `touch-target` because `data-ripple` sets
       `overflow: hidden` and would clip a hit-area pseudo-element out of
       hit-testing with it — this control's floor has to be a real box. */
    'inline-flex h-10 w-10 touch-size cursor-pointer items-center justify-center rounded-full px-2',
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
        /* The default top margin stands down when the call site names its own,
           same guard as `Skeleton`'s radius: `cn` is a plain join, so both would
           be emitted and the stylesheet's order — not the caller — would pick. */
        !HAS_TOP_MARGIN.test(className) && 'mt-12',
        '@container/pagination flex items-center justify-center gap-1',
        className,
      )}
    >
      {known && (
        <button
          onClick={() => go(1)}
          disabled={!canPrev || disabled}
          aria-label="第一页"
          data-ripple
          className={cn(navBtn, '@max-xl/pagination:hidden')}
        >
          <MdFirstPage size={ICON.control} />
        </button>
      )}

      <button
        onClick={() => go(currentPage - 1)}
        {...pageIntent(currentPage - 1)}
        disabled={!canPrev || disabled}
        aria-label="上一页"
        data-ripple
        className={cn(navBtn, '@xl/pagination:w-auto')}
      >
        <MdChevronLeft size={ICON.control} />
        <span className="@max-xl/pagination:hidden text-label-l pr-1">上一页</span>
      </button>

      <div className="flex items-center gap-1">
        {pages.map((page) => {
          const active = page === currentPage;
          return (
            <button
              key={page}
              onClick={() => go(page)}
              {...pageIntent(page)}
              disabled={disabled}
              aria-label={`第 ${page} 页`}
              aria-current={active ? 'page' : undefined}
              data-ripple
              className={cn(
                /* 40dp with `touch-size`, for the reason on `navBtn` above:
                   most-tapped chrome in the app, and `data-ripple` rules out a
                   hit-area pseudo-element. */
                'inline-flex h-10 w-10 touch-size cursor-pointer items-center justify-center rounded-full outline-none',
                'transition-ui',
                'focus-visible:ring-2 focus-ring',
                'disabled:pointer-events-none disabled:disabled-content',
                /* One type role per branch, so the active page gets weight
                   contrast and not colour alone. `state-layer` on both branches —
                   the current page is still a button. No elevation: M3 gives a
                   pagination item level 0. */
                active
                  ? 'bg-primary text-on-primary text-label-l-emphasized state-layer'
                  : 'text-label-l text-on-surface-variant state-layer',
                // A dialog and a column beside the app drawer can both be
                // narrow on a wide viewport. The pager owns this breakpoint.
                (page < compactStart || page >= compactStart + compactCount) && '@max-xl/pagination:hidden',
                // Three numbers plus two 48dp touch targets need 256px.
                // Below that, keep the current page between the two arrows.
                !active && '@max-3xs/pagination:hidden',
              )}
            >
              {page}
            </button>
          );
        })}
      </div>

      <button
        onClick={() => go(currentPage + 1)}
        {...pageIntent(currentPage + 1)}
        disabled={!canNext || disabled}
        aria-label="下一页"
        data-ripple
        className={cn(navBtn, '@xl/pagination:w-auto')}
      >
        <span className="@max-xl/pagination:hidden text-label-l pl-1">下一页</span>
        <MdChevronRight size={ICON.control} />
      </button>

      {known && (
        <button
          onClick={() => go(totalPages)}
          disabled={!canNext || disabled}
          aria-label="最后一页"
          data-ripple
          className={cn(navBtn, '@max-xl/pagination:hidden')}
        >
          <MdLastPage size={ICON.control} />
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

/**
 * The "load more" affordance under a cursor-paged list.
 *
 * `Button`, not a hand-rolled one — `variant="tonal" size="lg"` (the M3 medium
 * step), the size this button's job asks for: it is the only control on its row.
 *
 * The three bouncing dots stay. They are not a `Spinner` and should not be one —
 * `loading` on `Button` swaps in the circular indicator, which is right for a
 * submit that blocks and wrong for appending to a list you are still reading.
 * They ride in the `icon` slot so the label keeps its place instead of being
 * replaced.
 */
export function LoadMoreButton({ onClick, isLoading, disabled }: LoadMoreButtonProps) {
  return (
    <div className="mt-12 flex justify-center">
      <Button
        variant="tonal"
        size="lg"
        onClick={onClick}
        disabled={isLoading || disabled}
        className="group"
        icon={
          isLoading ? (
            <span className="flex items-center gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="bg-primary-ink animate-dot-bounce h-1.5 w-1.5 rounded-full"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </span>
          ) : (
            <MdRefresh
              className="transition-transform duration-standard ease-[var(--ease-standard)] group-hover:rotate-180 no-motion:group-hover:rotate-0"
            />
          )
        }
      >
        {isLoading ? '正在加载' : '加载更多'}
      </Button>
    </div>
  );
}
