'use client';

import { useState, type ReactNode } from 'react';
import Pagination from '@/components/Pagination';
import { cn } from '@/lib/utils';

/** Rows per page for the console's lists that arrive whole (users, reports, the blacklist…). */
export const ADMIN_PAGE_SIZE = 50;

/**
 * Pages a list the backend returns whole (R9-014): `admin_get_users` answers every account in one
 * response, so thousands of rows used to render in one pass, three icon buttons each. The data is
 * already in memory, so paging is a slice; what it buys is the render.
 *
 * `resetKey` is whatever narrows the list (the search text, a status filter): a new filter starts
 * at page 1 rather than at a page the narrowed list no longer has. A page past the end — the last
 * row of the last page deleted — clamps to the last page.
 */
export function usePagedRows<T>(rows: readonly T[], resetKey: unknown, pageSize = ADMIN_PAGE_SIZE) {
  const [state, setState] = useState<{ page: number; key: unknown; filter: number }>({ page: 1, key: resetKey, filter: 0 });
  const current = Object.is(state.key, resetKey);
  if (!current) setState({ page: 1, key: resetKey, filter: state.filter + 1 });
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(current ? state.page : 1, totalPages);
  return {
    page,
    totalPages,
    total: rows.length,
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    /**
     * The shown list's identity for `DataTable`: it changes with the page and with the filter, so a
     * page turn or a narrowed search replaces the rows outright, while a row deleted or added on
     * the same page comes and goes with presence.
     */
    listKey: `${current ? state.filter : state.filter + 1}:${page}`,
    setPage: (next: number) => setState({ page: next, key: resetKey, filter: state.filter }),
  };
}

/**
 * `DataTable`'s `listKey` for a list read a page at a time with `keepPrevious`: the key of the read
 * whose rows are *shown* — the previous page's while the next one is on its way, the new one's from
 * the commit its rows land in. Keyed on the request instead, the table would replace the old rows
 * when the page was asked for and take the new page, a beat later, for an edit of them.
 */
export function useShownListKey(key: string, isPrevious: boolean): string {
  const [shown, setShown] = useState(key);
  if (!isPrevious && shown !== key) setShown(key);
  return isPrevious ? shown : key;
}

/**
 * The anchor a console list and its pager share. `Pagination` finds the list to scroll to with
 * `closest()`, so the marker has to be an *ancestor* of the pager — a marker on the table with the
 * pager beside it is one the pager cannot see.
 */
export function AdminListAnchor({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div data-pagination-anchor="" className={cn('space-y-4', className)}>
      {children}
    </div>
  );
}

/** The pager under a console list, with the list's size beside it. Nothing when one page holds everything. */
export function AdminPager({
  page,
  totalPages,
  onPageChange,
  summary,
  disabled,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /** 「共 N 条」 or the like, shown beside the pager. */
  summary?: ReactNode;
  disabled?: boolean;
}) {
  if (totalPages <= 1) {
    return summary ? <p className="text-center text-body-s text-on-surface-variant">{summary}</p> : null;
  }
  /* The pager is a query container with no intrinsic width of its own, so it takes the full row
     and the summary sits under it. */
  return (
    <div className="flex flex-col items-center gap-1">
      <Pagination
        currentPage={page}
        totalPages={totalPages}
        onPageChange={onPageChange}
        disabled={disabled}
        siblings={1}
        className="mt-0 w-full"
      />
      {summary && <span className="text-body-s text-on-surface-variant">{summary}</span>}
    </div>
  );
}
