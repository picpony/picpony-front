'use client';

import { useRef } from 'react';
import { MdRefresh, MdChevronLeft, MdChevronRight, MdFirstPage, MdLastPage } from 'react-icons/md';
import Button from './Button';
import { scrollAppToTop, scrollAppToElement } from '@/lib/motion';
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
    /* **40dp, with `touch-size` for the floor.** The 40 is the button step; the floor
       is `--touch-floor`, which is 48 under a coarse pointer and 24 under a fine one.
       `touch-size` rather than `touch-target` because `data-ripple` sets
       `overflow: hidden` to clip the wave and would clip a pseudo-element out of
       hit-testing with it, so this control's floor has to be a real box.

       It was 56 below `sm` and 40 above, keyed on the viewport — which had the right
       idea and the wrong axis. A viewport width is not a pointer: a 1024px tablet is a
       finger and a 600px desktop window is not, so the phone branch was reaching a
       mouse and the desktop branch was reaching a thumb. (The four classes that
       expressed it are described rather than named: the extractor lifts a class out of
       a comment, and two of them have no other call site.)
       The height itself has been 44 (Apple's figure), then 48, then 56, all three
       chosen to *be* the floor rather than to be a step with a floor under it. */
    'inline-flex h-10 min-w-10 touch-size cursor-pointer items-center justify-center rounded-full px-2',
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
          <MdFirstPage size={ICON.control} />
        </button>
      )}

      <button
        onClick={() => go(currentPage - 1)}
        disabled={!canPrev || disabled}
        aria-label="上一页"
        data-ripple
        className={navBtn}
      >
        <MdChevronLeft size={ICON.control} />
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
                /* 40dp with `touch-size`, for the reason spelled out on `navBtn`
                   above: this is the most-tapped chrome in the app, `data-ripple`
                   rules out `touch-target`'s pseudo-element, and the floor belongs on
                   the pointer rather than on the viewport width. */
                'inline-flex h-10 w-10 touch-size cursor-pointer items-center justify-center rounded-full outline-none',
                'transition-ui',
                'focus-visible:ring-2 focus-ring',
                'disabled:pointer-events-none disabled:disabled-content',
                /* One type role per branch — the active page used to add a bare
                   medium-weight utility over `text-label-l`, which is already
                   500, so the current page was distinguished by colour alone.
                   `state-layer` on both branches: the current page is still a
                   button, and it was the one control in this row with no hover
                   feedback. No elevation either — M3 gives a pagination item
                   level 0, and this was the app's only shadow on something that
                   does not float. */
                active
                  ? 'bg-primary text-on-primary text-label-l-emphasized state-layer'
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
        <MdChevronRight size={ICON.control} />
      </button>

      {known && (
        <button
          onClick={() => go(totalPages)}
          disabled={!canNext || disabled}
          aria-label="最后一页"
          data-ripple
          className={cn(navBtn, 'max-sm:hidden')}
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
 * `Button`, not a hand-rolled one. This was the last button in the app still
 * spelling out its own container, its own state layer, its own focus ring and
 * its own geometry — `rounded-full px-8 py-3` on the secondary-container pair,
 * which is `variant="tonal"` at a size that was on no scale (about 44dp tall
 * with 32dp of padding). It is `lg` now, the M3 medium step, which is the size
 * this button's job actually asks for: it is the only control on its row and the
 * one thing you are meant to press.
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
                  className="bg-primary animate-dot-bounce h-1.5 w-1.5 rounded-full"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </span>
          ) : (
            <MdRefresh
              size={ICON.control}
              className="transition-transform duration-200 ease-[var(--ease-standard)] group-hover:rotate-180 motion-reduce:group-hover:rotate-0"
            />
          )
        }
      >
        {isLoading ? '正在加载' : '加载更多'}
      </Button>
    </div>
  );
}
