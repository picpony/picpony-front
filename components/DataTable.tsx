'use client';

import { Fragment, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import Skeleton from './Skeleton';
import EmptyState from './EmptyState';
import ErrorRetry from './ErrorRetry';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T, index: number) => ReactNode;
  /** Promotes this cell to the row heading (largest text in the row). */
  primary?: boolean;
  /** Renders the cell as a bare control at the row's leading edge, with no
   *  label — the select-all checkbox column is the only user. */
  hideOnMobile?: boolean;
  /** Renders the cell as a button group, pushed to the row's trailing edge. */
  actions?: boolean;
  /** Extra classes for the cell's value element (e.g. truncation). */
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string | number;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  /**
   * Shown when `rows` is empty and not loading. A `string` is the common case
   * and is wrapped in `EmptyState` — it is not rendered raw. Pass a node only
   * when the empty body genuinely needs custom content.
   */
  empty?: string | ReactNode;
  skeletonRows?: number;
  className?: string;
  /** Renders an optional editor/details row immediately below its data row. */
  expandedRow?: (row: T, index: number) => ReactNode;
}

/**
 * Admin data table: a `.m3-row` grouped list that keeps the table's header row.
 * A `primary` column becomes the row heading, an `actions` column renders as a
 * trailing button group, and `hideOnMobile` columns render as bare leading
 * controls (the select-all checkbox is the only user).
 *
 * Owns the loading state as row-shaped skeletons (a `{loading ? <Spinner/> : rows}`
 * ternary collapses the list to nothing and snaps it back).
 *
 * Call sites build their `columns` array as a plain `const` in the component body
 * rather than a module-level factory taking the row handlers: passing a handler
 * staged in a ref as an argument to a function invoked during render trips
 * `react-hooks/refs`; referencing it from inside a `render` closure does not.
 *
 * There is deliberately no `onRowClick`: it made the row a `<div onClick>` — a
 * control no keyboard could reach, inside rows that already carry real buttons.
 * A row that needs to do something puts a button in the `actions` column; a row
 * that needs to expand uses `expandedRow`.
 */
export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  error,
  onRetry,
  empty,
  skeletonRows = 6,
  className = '',
  expandedRow,
}: DataTableProps<T>) {
  const leading = columns.filter((c) => c.hideOnMobile);
  const heading = columns.find((c) => c.primary) ?? null;
  const details = columns.filter((c) => !c.primary && !c.actions && !c.hideOnMobile);
  const actions = columns.filter((c) => c.actions);

  const isEmpty = !loading && !error && rows.length === 0;

  return (
    <div className={cn('w-full', className)}>
      {/* ---- Header: column names, first row of the cut block ---- */}
      <div className="m3-row flex flex-wrap items-center gap-x-4 gap-y-2 bg-surface-container-high px-4 py-3">
        {leading.length > 0 && (
          <div className="flex shrink-0 items-center gap-2">
            {leading.map((col) => (
              <div key={col.key}>{col.header}</div>
            ))}
          </div>
        )}
        {heading && (
          <span className="text-label-l text-on-surface-variant shrink-0">{heading.header}</span>
        )}
        {details.map((col) => (
          <span key={col.key} className="text-label-l text-on-surface-variant shrink-0">
            {col.header}
          </span>
        ))}
        {actions.length > 0 && (
          <span className="ml-auto text-label-l text-on-surface-variant shrink-0">
            {actions[0].header}
          </span>
        )}
      </div>

      {/* ---- Loading: a run of row-shaped skeletons ----
           Skeleton rows sit directly in the container — wrapping them in a
           <div> would break the `.m3-row` sibling chain and give the header
           row the "last row" bottom corner radius while the list was loading. */}
      {loading &&
        Array.from({ length: skeletonRows }, (_, i) => (
          <div
            key={i}
            className="m3-row flex flex-col gap-2 bg-surface-container-low p-4"
          >
            <Skeleton className="h-4 w-2/5" delay={i * 80} />
            <Skeleton className="h-3.5 w-full" delay={i * 80 + 60} />
            <Skeleton className="h-3.5 w-3/4" delay={i * 80 + 120} />
          </div>
        ))}

      {error && (
        <div className="m3-row bg-surface-container-low">
          <ErrorRetry size="inline" title={error} onRetry={onRetry} />
        </div>
      )}

      {/* ---- Empty: `EmptyState`, like every other "nothing here" in the app.
           `inline` because it sits in a table body that already has a header row
           above it. A string `empty` is wrapped rather than spliced. */}
      {isEmpty && (
        <div className="m3-row bg-surface-container-low">
          {typeof empty === 'string' || empty == null ? (
            <EmptyState size="inline" title={empty ?? '暂无数据'} />
          ) : (
            empty
          )}
        </div>
      )}

      {/* ---- Rows: one continuous cut block, like a settings list ---- */}
      {!loading &&
        rows.map((row, i) => (
          <Fragment key={rowKey(row, i)}>
            <div
              className={cn(
                'm3-row flex flex-wrap items-center gap-x-4 gap-y-2 p-4',
                /* The tone is flat and stays flat: this row is not a control.
                   Nothing hovers here except the buttons in the `actions`
                   column, which carry their own state layer. */
                'bg-surface-container-low',
              )}
            >
              {leading.length > 0 && (
                <div className="flex shrink-0 items-center gap-2">
                  {leading.map((col) => (
                    <div key={col.key}>{col.render(row, i)}</div>
                  ))}
                </div>
              )}

              {heading && (
                <div className="text-title-s text-on-surface min-w-0 break-words">
                  {heading.render(row, i)}
                </div>
              )}

              {details.map((col) => (
                <span
                  key={col.key}
                  className={cn('text-body-m text-on-surface min-w-0 break-words', col.className)}
                >
                  {col.render(row, i)}
                </span>
              ))}

              {actions.length > 0 && (
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {actions.map((col) => (
                    <div key={col.key} className="flex flex-wrap items-center gap-2">
                      {col.render(row, i)}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {expandedRow?.(row, i)}
          </Fragment>
        ))}
    </div>
  );
}
