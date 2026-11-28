'use client';

import { useEffect } from 'react';
import { MdReceiptLong } from 'react-icons/md';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import { PageLoadingIndicator } from '@/components/LoadingIndicator';
import PageBack from '@/components/PageBack';
import PageHeader from '@/components/PageHeader';
import Pagination from '@/components/Pagination';
import SignInRequired from '@/components/SignInRequired';
import SectionHeading from '@/components/SectionHeading';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import type { CoinTransaction } from '@/lib/api/tasks';
import { useBackOrParent } from '@/lib/backNavigation';
import { beijingDateKey, formatClock, formatDate, formatDateTime, formatDayLabel, formatExactCount, formatSignedCount } from '@/lib/format';
import { useEscapeBack, useNow, useSession } from '@/lib/hooks';
import { ICON } from '@/lib/icons';
import { SKIP, useResource } from '@/lib/resource';
import { coinTransactions } from '@/lib/resources';
import { useScreenState } from '@/lib/screenState';
import { cn } from '@/lib/utils';

/**
 * One page's rows under their Beijing calendar days, in the order each day first appears. Keyed
 * and grouped by the date, never by the printed label (G4-001): equal labels merged only when
 * adjacent gave a page whose days were not contiguous two groups with one React key.
 */
function byDay(rows: readonly CoinTransaction[], now: number | null) {
  const days = new Map<string, { key: string; label: string; rows: CoinTransaction[] }>();
  for (const row of rows) {
    const key = beijingDateKey(row.createdAt) ?? 'unknown';
    let day = days.get(key);
    if (!day) {
      const label = key === 'unknown'
        ? '时间未知'
        : now !== null ? formatDayLabel(row.createdAt, now, { clock: false }) : formatDate(row.createdAt);
      day = { key, label, rows: [] };
      days.set(key, day);
    }
    day.rows.push(row);
  }
  return [...days.values()];
}

function LedgerSkeleton() {
  return <PageLoadingIndicator size="page" indicatorSize="lg" holdFooter label="正在加载金币明细…" />;
}

/**
 * 金币明细 — every coin the account earned or spent: the reason, the amount (signed), and when,
 * in Beijing time, under its day. The original front end showed it as a dialog on the shop page;
 * it is a page here, reached from the coin figure on /tasks (and the shop), because a ledger is a
 * list that wants the whole column and a pager.
 *
 * **Paged by the backend**, thirty to a page, newest first. The backend pages by cursor and
 * reports no total, so the pager offers the pages known to exist (`getCoinTransactions`).
 */
export default function CoinLedger() {
  const { user, token, ready } = useSession();
  const handleBack = useBackOrParent('/tasks');
  useEscapeBack(handleBack);
  const now = useNow();

  const [page, setPage] = useScreenState('coins:page', 1);
  const read = useResource(coinTransactions, token ? { token, page } : SKIP, { keepPrevious: token ?? false });
  const data = read.data;
  const totalPages = data ? data.totalPages : 1;
  const rows = data?.transactions ?? [];

  /* A page past the end — the ledger shrank, or a remembered page from another account's — steps
     back to the last one. */
  useEffect(() => {
    if (data && !read.isLoading && page > totalPages) setPage(totalPages);
  }, [data, read.isLoading, page, totalPages, setPage]);

  /* The session's figure (the shop and a claim keep it current); absent, the subtitle is too. */
  const stored = user?.coins;
  const balance = typeof stored === 'number' || (typeof stored === 'string' && stored.trim() !== '') ? Number(stored) : NaN;
  const header = (
    <PageHeader
      title="金币明细"
      subtitle={
        ready && token && Number.isFinite(balance)
          ? `当前余额 ${formatExactCount(Math.max(0, balance))} 金币`
          : undefined
      }
    />
  );

  let body;
  if (!ready) {
    body = <PageLoadingIndicator size="page" holdFooter delay={160} label="正在读取登录状态…" />;
  } else if (token && data === undefined && read.error === undefined) {
    body = <LedgerSkeleton />;
  } else if (!token) {
    body = <SignInRequired description="登录后可查看金币收支明细" />;
  } else if (!data) {
    body = (
      <ErrorRetry
        title="金币明细加载失败"
        message={apiErrorMessage(read.error)}
        onRetry={isRetryable(read.error) ? read.refresh : undefined}
      />
    );
  } else if (data.transactions.length === 0) {
    body = (
      <EmptyState
        icon={<MdReceiptLong size={ICON.display} />}
        title="暂无金币记录"
      />
    );
  } else {
    body = (
      <div data-pagination-anchor>
        {read.isPrevious && read.error !== undefined && (
          <ErrorRetry
            size="inline"
            className="mb-4"
            title={`第 ${page} 页加载失败`}
            message={apiErrorMessage(read.error)}
            onRetry={isRetryable(read.error) ? read.refresh : undefined}
          />
        )}
        <div
          className={cn(
            'flex flex-col gap-6 transition-opacity spring-default-effects',
            read.isPrevious && read.isLoading ? 'paging-dim' : 'opacity-100',
          )}
          aria-busy={read.isLoading || undefined}
        >
          {byDay(rows, now).map((day) => (
            <div key={day.key}>
              <SectionHeading level="group" id={`ledger-day-${day.key}`}>{day.label}</SectionHeading>
              <div role="list" aria-labelledby={`ledger-day-${day.key}`}>
                {day.rows.map((row) => (
                  <div role="listitem" key={row.key} className="m3-row flex items-center gap-4 bg-surface-container-low px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-label-l text-on-surface wrap-anywhere">{row.reason || '金币变动'}</p>
                      <p className="mt-0.5 text-body-s tabular-nums text-on-surface-variant">
                        <time dateTime={row.createdAt} title={formatDateTime(row.createdAt)}>
                          {formatClock(row.createdAt)}
                        </time>
                      </p>
                    </div>
                    <span
                      className={cn(
                        'shrink-0 text-title-m tabular-nums',
                        row.amount > 0 ? 'text-success' : 'text-on-surface',
                      )}
                    >
                      <span className="sr-only">{row.amount > 0 ? '收入' : row.amount < 0 ? '支出' : ''}</span>
                      {formatSignedCount(row.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {totalPages > 1 && (
          <Pagination
            currentPage={Math.min(page, totalPages)}
            totalPages={totalPages}
            onPageChange={setPage}
            onPrefetchPage={(next) => token && coinTransactions.prefetch({ token, page: next })}
            className="mt-8"
          />
        )}
      </div>
    );
  }

  return (
    <>
      <PageBack onClick={handleBack} label="返回" />
      <div className="page-back-room mx-auto max-w-4xl">
        {header}
        {body}
      </div>
    </>
  );
}
