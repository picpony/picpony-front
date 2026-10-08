'use client';

import { useEffect, useMemo } from 'react';
import { MdReceiptLong } from 'react-icons/md';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import PageBack from '@/components/PageBack';
import PageHeader from '@/components/PageHeader';
import Pagination from '@/components/Pagination';
import SignInRequired from '@/components/SignInRequired';
import Skeleton from '@/components/Skeleton';
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

/** Rows per page when the backend sends the whole ledger at once, as the original's did. */
const LOCAL_PAGE = 30;

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
  return (
    <div data-page-loading aria-hidden="true">
      <Skeleton className="mb-2 ml-1 h-5 w-12" />
      {Array.from({ length: 12 }, (_, i) => (
        <div key={i} className="m3-row flex items-center gap-4 bg-surface-container-low px-4 py-3">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-40" delay={Math.min(i, 8) * 70} />
            <Skeleton className="h-3 w-12" delay={Math.min(i, 8) * 70 + 40} />
          </div>
          <Skeleton className="h-5 w-12" delay={Math.min(i, 8) * 70 + 80} />
        </div>
      ))}
    </div>
  );
}

/**
 * 金币明细 — every coin the account earned or spent: the reason, the amount (signed), and when,
 * in Beijing time, under its day. The original front end showed it as a dialog on the shop page;
 * it is a page here, reached from the coin figure on /tasks (and the shop), because a ledger is a
 * list that wants the whole column and a pager.
 *
 * **Paged the way the backend pages.** An answer with `total_pages` is a server page; one without
 * is the whole ledger, the original's only shape — then it is paged here, thirty to a page, and
 * only page 1 is ever asked for.
 */
export default function CoinLedger() {
  const { user, token, ready } = useSession();
  const handleBack = useBackOrParent('/tasks');
  useEscapeBack(handleBack);
  const now = useNow();

  const [page, setPage] = useScreenState('coins:page', 1);
  /* Learned from the first answer: whether the backend pages the ledger at all. Until it is
     known only page 1 is asked for, whatever page is remembered (G4-027): on the original's
     backend that answer is the whole ledger, which the remembered page then slices — asking for
     that page first cost a second read of the same rows once the answer said so. */
  const [unpaged, setUnpaged] = useScreenState<boolean | null>('coins:unpaged', null);
  const requested = unpaged === false ? page : 1;
  const read = useResource(coinTransactions, token ? { token, page: requested } : SKIP, { keepPrevious: token ?? false });
  const data = read.data;

  useEffect(() => {
    if (data && !read.isPrevious) setUnpaged(data.totalPages === null);
  }, [data, read.isPrevious, setUnpaged]);

  const local = data?.totalPages === null;
  const totalPages = data ? (data.totalPages ?? Math.max(1, Math.ceil(data.transactions.length / LOCAL_PAGE))) : 1;
  const rows = useMemo(() => {
    if (!data) return [];
    return local ? data.transactions.slice((page - 1) * LOCAL_PAGE, page * LOCAL_PAGE) : data.transactions;
  }, [data, local, page]);

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
      subtitle={token && Number.isFinite(balance) ? `当前余额 ${formatExactCount(Math.max(0, balance))} 金币` : undefined}
    />
  );

  let body;
  if (!ready || (token && data === undefined && read.error === undefined)) {
    body = <LedgerSkeleton />;
  } else if (!token) {
    body = <SignInRequired description="登录后即可查看金币的每一笔收支。" />;
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
        description="完成任务、领取奖励或在商店消费后，每一笔收支都会记在这里。"
      />
    );
  } else {
    body = (
      <div data-pagination-anchor>
        {read.isPrevious && read.error !== undefined && (
          <ErrorRetry
            size="inline"
            title="这一页加载失败"
            message={apiErrorMessage(read.error)}
            onRetry={isRetryable(read.error) ? read.refresh : undefined}
          />
        )}
        <div
          className={cn(
            'space-y-6 transition-opacity duration-standard ease-[var(--ease-standard)]',
            read.isPrevious && read.isLoading ? 'pointer-events-none opacity-50' : 'opacity-100',
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
                        {row.createdAt ? (
                          <time dateTime={row.createdAt} title={formatDateTime(row.createdAt)}>
                            {formatClock(row.createdAt)}
                          </time>
                        ) : (
                          '时间未知'
                        )}
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
            onPrefetchPage={(next) => token && !local && coinTransactions.prefetch({ token, page: next })}
            className="mt-8"
          />
        )}
      </div>
    );
  }

  return (
    <>
      <PageBack onClick={handleBack} label="返回等级与任务" />
      <div className="page-back-room mx-auto max-w-4xl">
        {header}
        {body}
      </div>
    </>
  );
}
