'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import Skeleton, { SkeletonRows } from './Skeleton';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T, index: number) => ReactNode;
  /** Promotes this cell to the card heading in the stacked mobile view. */
  primary?: boolean;
  /** Drop this column from the mobile cards (usually row-index or filler columns). */
  hideOnMobile?: boolean;
  /** Render the cell full-width under the label pairs — for action buttons. */
  actions?: boolean;
  align?: 'left' | 'center' | 'right';
  className?: string;
  headerClassName?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string | number;
  loading?: boolean;
  /** Shown when `rows` is empty and not loading. */
  empty?: ReactNode;
  skeletonRows?: number;
  className?: string;
  onRowClick?: (row: T) => void;
}

const ALIGN = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
} as const;

/**
 * Admin table with a built-in phone layout.
 *
 * The 12 admin tables were raw `<table>` elements wrapped in `overflow-x-auto`,
 * which on a phone means a 900px-wide grid you scrub sideways to read one cell
 * at a time. Below `sm` this renders each row as a card of label/value pairs
 * instead, so the same column config serves both.
 *
 * It also owns the loading state: the tables previously did
 * `{loading ? <Spinner/> : rows}`, which collapsed the table to nothing and
 * then snapped the full grid back in.
 *
 * Call sites build their `columns` array as a plain `const` in the component
 * body rather than a module-level factory taking the row handlers. Several of
 * those handlers stage a confirm action in a ref, and passing one as an
 * argument to a function invoked during render trips `react-hooks/refs` —
 * referencing it from inside a `render` closure does not.
 */
export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  empty,
  skeletonRows = 6,
  className = '',
  onRowClick,
}: DataTableProps<T>) {
  const mobileColumns = columns.filter((c) => !c.hideOnMobile);
  const heading = mobileColumns.find((c) => c.primary) ?? mobileColumns[0];
  const details = mobileColumns.filter((c) => c !== heading && !c.actions);
  const actions = mobileColumns.filter((c) => c.actions);

  const isEmpty = !loading && rows.length === 0;

  return (
    <div className={cn('w-full', className)}>
      {/* ---- Desktop / tablet: a real table ---- */}
      <div className="border-outline-variant hidden overflow-x-auto rounded-md border sm:block">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-surface-container-high">
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={cn(
                    'text-label-l text-on-surface-variant px-4 py-3 whitespace-nowrap',
                    ALIGN[col.align ?? 'left'],
                    col.headerClassName,
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-outline-variant divide-y">
            {loading && <SkeletonRows rows={skeletonRows} cols={columns.length} />}

            {isEmpty && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center">
                  {empty ?? <span className="text-on-surface-variant">暂无数据</span>}
                </td>
              </tr>
            )}

            {!loading &&
              rows.map((row, i) => (
                <tr
                  key={rowKey(row, i)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    'bg-surface-container-lowest transition-ui',
                    onRowClick && 'hover:bg-surface-container cursor-pointer',
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        'text-body-m text-on-surface px-4 py-3 align-middle',
                        ALIGN[col.align ?? 'left'],
                        col.className,
                      )}
                    >
                      {col.render(row, i)}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* ---- Phone: one card per row ---- */}
      <div className="flex flex-col gap-3 sm:hidden">
        {loading &&
          Array.from({ length: Math.min(skeletonRows, 4) }, (_, i) => (
            <div
              key={i}
              className="border-outline-variant bg-surface-container-lowest flex flex-col gap-2 rounded-md border p-4"
            >
              <Skeleton className="h-4 w-2/5" delay={i * 80} />
              <Skeleton className="h-3.5 w-full" delay={i * 80 + 60} />
              <Skeleton className="h-3.5 w-3/4" delay={i * 80 + 120} />
            </div>
          ))}

        {isEmpty && (
          <div className="border-outline-variant rounded-md border px-4 py-10 text-center">
            {empty ?? <span className="text-on-surface-variant">暂无数据</span>}
          </div>
        )}

        {!loading &&
          rows.map((row, i) => (
            <div
              key={rowKey(row, i)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                'border-outline-variant bg-surface-container-lowest rounded-md border p-4',
                onRowClick && 'cursor-pointer',
              )}
            >
              {heading && (
                <div className="text-title-s text-on-surface mb-2 min-w-0 break-words">
                  {heading.render(row, i)}
                </div>
              )}

              {details.length > 0 && (
                <dl className="flex flex-col gap-1.5">
                  {details.map((col) => (
                    <div key={col.key} className="flex items-start justify-between gap-3">
                      <dt className="text-body-s text-on-surface-variant shrink-0">{col.header}</dt>
                      <dd className="text-body-s text-on-surface min-w-0 text-right break-words">
                        {col.render(row, i)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}

              {actions.length > 0 && (
                <div className="border-outline-variant mt-3 flex flex-wrap gap-2 border-t pt-3">
                  {actions.map((col) => (
                    <div key={col.key} className="flex flex-wrap gap-2">
                      {col.render(row, i)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}
