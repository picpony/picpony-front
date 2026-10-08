'use client';

import { useEffect, useRef } from 'react';
import { MdNotificationsNone } from 'react-icons/md';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import Pagination from '@/components/Pagination';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { formatDateTime, formatRelativeTime, parseBackendTime } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { ICON } from '@/lib/icons';
import { useResource } from '@/lib/resource';
import { notificationPage } from '@/lib/resources';
import { useScreenState } from '@/lib/screenState';
import { cn } from '@/lib/utils';
import type { Notification } from '@/lib/types/message';
import { NotificationBody } from './MessageBody';
import { ListRowsSkeleton } from './Skeletons';
import { markRead } from './unread';

const COPY = {
  system: { failed: '系统消息加载失败', empty: '暂无系统消息' },
  interaction: { failed: '互动消息加载失败', empty: '暂无互动消息' },
} as const;

type NotificationsPaneProps = {
  active: boolean;
  /** This tab's unread count, as the badge has it. */
  unread: number;
} & (
  | { type: 'system'; token: string | null }
  /* 互动 is somebody's own: the screen offers it only signed in (decision 22). */
  | { type: 'interaction'; token: string }
);

/**
 * 系统 or 互动: a paged list of notices, newest first.
 *
 * **系统 is public.** A signed-out visitor reads the site-wide notices without a token, as the
 * original front end let them. 互动 is somebody's own and is not offered until there is a
 * somebody (decision 22), so its props take no missing token — it used to show a sign-in pane,
 * and before that 「消息加载失败 / 请先登录 / 重试」, a retry that could never succeed.
 *
 * **Reading page 1 marks the list read** on the server, so the tab's count and the app bar's
 * badge are corrected the moment it is shown (`markRead`) instead of a minute later.
 *
 * Page turns keep the rows on screen (`keepPrevious`) and say so when one fails; the page is
 * remembered for the session. A sign-in keeps them too: the screen survives it, and 系统's rows
 * stay until the account's own list replaces them rather than blinking to a skeleton — they are
 * the site's public notices, nobody's private ones. A page past the end (the list shrank, or
 * became the account's) is the last page there is.
 */
export default function NotificationsPane({ token, type, active, unread }: NotificationsPaneProps) {
  const [page, setPage] = useScreenState(`messages:${type}-page`, 1);
  const read = useResource(notificationPage, { token, type, page }, { keepPrevious: true });
  const now = useNow();
  const copy = COPY[type];

  /* Shown again after a while away: re-read underneath if the answer has gone stale. */
  useEffect(() => {
    if (!active) return;
    void notificationPage.read({ token, type, page }).catch(() => {});
  }, [active, token, type, page]);

  /* Page 1 on screen is page 1 read. Once per answer, or a server that does not mark would
     be asked again on every re-read. */
  const markedFor = useRef<unknown>(null);
  const data = read.data;
  useEffect(() => {
    if (!token || !active || page !== 1 || !data || read.isPrevious || unread <= 0) return;
    if (markedFor.current === data) return;
    markedFor.current = data;
    markRead(token, type === 'system' ? 'notification' : 'interaction');
  }, [token, active, page, data, read.isPrevious, unread, type]);

  const lastPage = data && !read.isPrevious ? Math.max(1, data.totalPages) : null;
  useEffect(() => {
    if (lastPage !== null && page > lastPage) setPage(lastPage);
  }, [lastPage, page, setPage]);

  if (data === undefined) {
    if (read.error) {
      return (
        <ErrorRetry
          size="pane"
          title={copy.failed}
          message={apiErrorMessage(read.error)}
          onRetry={isRetryable(read.error) ? read.refresh : undefined}
        />
      );
    }
    return <ListRowsSkeleton />;
  }
  if (data.notifications.length === 0 && page === 1) {
    return <EmptyState size="pane" icon={<MdNotificationsNone size={ICON.display} />} title={copy.empty} />;
  }

  return (
    <div data-pagination-anchor aria-busy={read.isLoading || undefined}>
      {read.isPrevious && read.error !== undefined && (
        <ErrorRetry
          size="inline"
          title={copy.failed}
          message={apiErrorMessage(read.error)}
          onRetry={isRetryable(read.error) ? read.refresh : undefined}
        />
      )}
      <ul>
        {data.notifications.map((item) => (
          <NotificationRow key={item.id} item={item} now={now} />
        ))}
      </ul>
      {data.totalPages > 1 && (
        <Pagination
          currentPage={page}
          totalPages={data.totalPages}
          onPageChange={setPage}
          onPrefetchPage={(next) => notificationPage.prefetch({ token, type, page: next })}
          className="mt-6"
        />
      )}
    </div>
  );
}

function NotificationRow({ item, now }: { item: Notification; now: number | null }) {
  const unread = item.is_read === 0;
  const stamp = parseBackendTime(item.created_at);
  return (
    <li
      /* Unread is carried by the row's own container pair, and by nothing else — the pair this
         app means "this one" with (the sidebar's route, a selected chip, the current contact).
         The heading and the body name no ink of their own: they inherit the row's, which is the
         container's `on-` role while unread and `on-surface-variant` once read. */
      className={cn(
        'm3-row p-4',
        unread ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container-low text-on-surface-variant',
      )}
    >
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        {/* The pane's first level under the page's heading: the tab is the section. */}
        <h2 className="text-title-m-emphasized min-w-0 wrap-anywhere">
          {unread && <span className="sr-only">未读：</span>}
          {item.title}
        </h2>
        <time
          dateTime={stamp?.toISOString()}
          title={formatDateTime(item.created_at)}
          className="text-body-s shrink-0 tabular-nums"
        >
          {now === null ? formatDateTime(item.created_at) : formatRelativeTime(item.created_at, now)}
        </time>
      </div>
      {/* The body is plain text with the backend's link markers: its line breaks are kept. */}
      <p className="text-body-m whitespace-pre-wrap wrap-anywhere">
        <NotificationBody content={item.content} />
      </p>
    </li>
  );
}
