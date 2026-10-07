'use client';

import { useId, useState, type ReactNode, type RefObject } from 'react';
import { MdExpandMore, MdSearchOff } from 'react-icons/md';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import Card from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import ImageGridSkeleton from '@/components/ImageGridSkeleton';
import MarkdownRenderer from '@/components/MarkdownRenderer';
import MasonryGrid from '@/components/MasonryGrid';
import Pagination from '@/components/Pagination';
import Skeleton from '@/components/Skeleton';
import { apiErrorMessage, isApiError, isRetryable } from '@/lib/api/errors';
import { formatCount } from '@/lib/format';
import type { ImageSequenceSource } from '@/lib/imageSequence';
import { ICON } from '@/lib/icons';
import { SKIP, useResource } from '@/lib/resource';
import { tagEntry } from '@/lib/resources';
import { tagCategory } from '@/lib/tagCategories';
import type { ApiResponse } from '@/lib/types/image';
import { cn } from '@/lib/utils';

export interface EmptyAdvice {
  title: string;
  description: ReactNode;
  action?: ReactNode;
}

interface SearchResultsProps {
  /** `waiting`: there is nothing to ask for yet (the semantic parse is still running). */
  waiting: boolean;
  data: ApiResponse | undefined;
  error: unknown;
  /** The rows on screen belong to another page of this search (a page turn in flight or failed). */
  isPrevious: boolean;
  refresh: () => void;
  /** The page the URL asks for, and the page whose pictures are on screen. */
  page: number;
  shownPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPrefetchPage: (page: number) => void;
  sequence?: ImageSequenceSource;
  gridRef: RefObject<HTMLDivElement | null>;
  /**
   * One per result set, handed to the grid as its `listKey`. The grid defers a page turn to a
   * background render (it keeps the page it had meanwhile); a *different search* must not wait
   * like that — on Back to a cached search the previous search's pictures stood under the
   * restored caption for a frame, and the scroll offset being restored was clamped against
   * their height. A new list key renders the new list at once and whole; a page turn keeps the
   * key and the deferral. It is not a React `key`: remounting the grid rendered a cached Back in
   * chunks instead of whole.
   */
  gridKey: string;
  /** The tag this search is for, when it is exactly one — described with the dictionary's entry. */
  singleTag: string | null;
  empty: EmptyAdvice;
  /** Shown under the results (or under the empty state): the semantic parse's feedback. */
  footer?: ReactNode;
  /** The caption row's trailing control, shown once there are pictures to act on. */
  captionAction?: ReactNode;
}

/**
 * The caption row: how many pictures, which page, and — for a one-tag search — the tag's Chinese
 * name and category from the dictionary. **One row whatever arrives**: the dictionary's answer
 * only fills text inside it, so it can never push the grid down after the grid has painted (it
 * was a block that did, twice: CLS 0.11 on a desktop, 0.18 on a phone). The description, which
 * is long, waits behind 标签简介 and opens on request.
 */
function ResultCaption({
  total,
  shownPage,
  singleTag,
  action,
}: {
  total: number | null;
  shownPage: number;
  singleTag: string | null;
  /** A control for the whole result set (分享), at the row's trailing end. */
  action?: ReactNode;
}) {
  const entryRead = useResource(tagEntry, singleTag ? { tag: singleTag.toLowerCase() } : SKIP);
  const entry = entryRead.data ?? null;
  const [openFor, setOpenFor] = useState<string | null>(null);
  const detailsId = useId();
  const hasDetails = Boolean(entry && (entry.description || entry.aliases.length > 0));
  const open = hasDetails && openFor === singleTag;

  return (
    <>
      <div className="mb-3 flex min-h-10 items-center gap-3">
        <div className="min-w-0 flex-1 truncate text-body-m text-on-surface-variant" role="status">
          {entry && entry.cn && (
            <>
              <span className="text-body-m-emphasized text-on-surface">{entry.cn}</span>
              {' · '}
              {tagCategory(entry.category).label}
              {' · '}
            </>
          )}
          {total === null ? (
            /* The count's own box while the answer is on its way. */
            <Skeleton className="inline-block h-4 w-24 align-middle" />
          ) : (
            <>
              共 {formatCount(total)} 张
              {shownPage > 1 ? ` · 第 ${shownPage} 页` : ''}
            </>
          )}
        </div>
        {hasDetails && (
          <Button
            variant="text"
            className="shrink-0"
            aria-expanded={open}
            aria-controls={detailsId}
            onClick={() => setOpenFor(open ? null : singleTag)}
            trailingIcon={
              <MdExpandMore
                className={`transition-transform ${open ? 'spring-default-spatial rotate-180' : 'spring-fast-effects rotate-0'}`}
              />
            }
          >
            标签简介
          </Button>
        )}
        {action}
      </div>
      {open && entry && (
        <Card id={detailsId} variant="filled" className="mb-4 max-w-2xl">
          {entry.aliases.length > 0 && (
            <div className={entry.description ? 'mb-3' : undefined}>
              <p className="mb-1 text-label-m text-on-surface-variant">别名</p>
              <div className="flex flex-wrap gap-1">
                {entry.aliases.map((alias) => (
                  <Badge key={alias}>{alias}</Badge>
                ))}
              </div>
            </div>
          )}
          {entry.description && (
            <div className="text-body-m text-on-surface">
              <MarkdownRenderer content={entry.description} />
            </div>
          )}
        </Card>
      )}
    </>
  );
}

/**
 * The result area of a text search. Loading is the destination's shape — a caption row and a
 * grid skeleton, never the previous search's pictures under the new caption: retention is
 * scoped to one result set (`keepPrevious` in the screen), so only a page turn keeps its rows,
 * dimmed and busy until the new page lands.
 */
export default function SearchResults({
  waiting,
  data,
  error,
  isPrevious,
  refresh,
  page,
  shownPage,
  totalPages,
  onPageChange,
  onPrefetchPage,
  sequence,
  gridRef,
  gridKey,
  singleTag,
  empty,
  footer,
  captionAction,
}: SearchResultsProps) {
  if (waiting || (data === undefined && !error)) {
    return (
      <div aria-busy="true">
        <ResultCaption total={null} shownPage={page} singleTag={waiting ? null : singleTag} />
        <ImageGridSkeleton />
      </div>
    );
  }

  if (data === undefined) {
    const syntax = isApiError(error) && error.kind === 'syntax';
    return (
      <>
        <ErrorRetry
          size="pane"
          title={syntax ? '搜索语法有误' : '搜索结果加载失败'}
          message={syntax ? '请检查括号和运算符，或去掉特殊符号后再试。' : apiErrorMessage(error)}
          onRetry={isRetryable(error) ? refresh : undefined}
        />
        {footer}
      </>
    );
  }

  if (data.images.length === 0) {
    return (
      <>
        <EmptyState
          size="pane"
          icon={<MdSearchOff size={ICON.display} />}
          title={empty.title}
          description={empty.description}
          action={empty.action}
        />
        {footer}
      </>
    );
  }

  const turning = isPrevious && !error;
  return (
    /* Scroll target for <Pagination>: a page turn lands on the caption, not above the field. */
    <div data-pagination-anchor>
      <ResultCaption total={data.total} shownPage={shownPage} singleTag={singleTag} action={captionAction} />
      {isPrevious && error ? (
        /* The page turn failed: the pictures below are the last page that loaded, and the
           screen says so rather than leaving the pager on a page it is not showing. */
        <div className="mb-4">
          <ErrorRetry
            size="inline"
            title={`第 ${page} 页加载失败`}
            message={apiErrorMessage(error)}
            onRetry={isRetryable(error) ? refresh : undefined}
          />
        </div>
      ) : null}
      <div
        ref={gridRef}
        aria-busy={turning || undefined}
        className={cn(
          'transition-opacity duration-standard ease-[var(--ease-standard)]',
          turning ? 'pointer-events-none opacity-50' : 'opacity-100',
        )}
      >
        <MasonryGrid listKey={gridKey} images={data.images} sequence={sequence} />
      </div>
      {totalPages > 1 && (
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          onPageChange={onPageChange}
          onPrefetchPage={onPrefetchPage}
          disabled={turning}
        />
      )}
      {footer}
    </div>
  );
}
