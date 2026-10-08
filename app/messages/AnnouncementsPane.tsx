'use client';

import { useEffect } from 'react';
import { MdCampaign } from 'react-icons/md';
import Badge from '@/components/Badge';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import Pagination from '@/components/Pagination';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { formatDateTime, formatDayLabel, parseBackendTime } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { ICON } from '@/lib/icons';
import { useResource } from '@/lib/resource';
import { announcementHistory } from '@/lib/resources';
import { useScreenState } from '@/lib/screenState';
import { ListRowsSkeleton } from './Skeletons';

/** The backend's page of announcements. */
const PER_PAGE = 10;

/**
 * 公告: every release note, newest first, ten to a page. Public.
 *
 * The bodies are the backend's HTML, **sanitised by the adapter** (`readAnnouncementHistory`),
 * the same way the pop-up's are — this pane was the one unsanitised server-HTML sink in the app.
 * They render in the shared rich-text container, so a link looks like a link and a list has its
 * markers, in the app's paragraph rhythm.
 */
export default function AnnouncementsPane({ active }: { active: boolean }) {
  const [page, setPage] = useScreenState('messages:announcement-page', 1);
  const read = useResource(announcementHistory, { page }, { keepPrevious: true });
  const now = useNow();

  /* Shown again after a while away: re-read underneath if the answer has gone stale. */
  useEffect(() => {
    if (active) void announcementHistory.read({ page }).catch(() => {});
  }, [active, page]);

  const data = read.data;
  if (data === undefined) {
    if (read.error) {
      return (
        <ErrorRetry
          size="pane"
          title="公告加载失败"
          message={apiErrorMessage(read.error)}
          onRetry={isRetryable(read.error) ? read.refresh : undefined}
        />
      );
    }
    return <ListRowsSkeleton rows={PER_PAGE} badge />;
  }
  if (data.announcements.length === 0 && page === 1) {
    return <EmptyState size="pane" icon={<MdCampaign size={ICON.display} />} title="暂无公告" />;
  }

  return (
    <div data-pagination-anchor aria-busy={read.isLoading || undefined}>
      {read.isPrevious && read.error !== undefined && (
        <ErrorRetry
          size="inline"
          title="公告加载失败"
          message={apiErrorMessage(read.error)}
          onRetry={isRetryable(read.error) ? read.refresh : undefined}
        />
      )}
      <ul>
        {data.announcements.map((item) => {
          const stamp = parseBackendTime(item.date);
          return (
            <li key={item.id} className="m3-row bg-surface-container-low p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <div className="flex min-w-0 max-w-full items-center gap-3">
                  {item.version && (
                    <Badge tone="primary" size="md" className="shrink-0">
                      {item.version}
                    </Badge>
                  )}
                  <h2 className="text-title-m-emphasized text-on-surface min-w-0 wrap-anywhere">{item.title}</h2>
                </div>
                <time
                  dateTime={stamp?.toISOString()}
                  title={formatDateTime(item.date)}
                  className="text-body-s text-on-surface-variant shrink-0 tabular-nums"
                >
                  {now === null ? formatDateTime(item.date) : formatDayLabel(item.date, now)}
                </time>
              </div>
              <div
                className="rich-text-content text-body-m text-on-surface-variant wrap-anywhere"
                dangerouslySetInnerHTML={{ __html: item.content }}
              />
            </li>
          );
        })}
      </ul>
      {data.totalPages > 1 && (
        <Pagination
          currentPage={page}
          totalPages={data.totalPages}
          onPageChange={setPage}
          onPrefetchPage={(next) => announcementHistory.prefetch({ page: next })}
          className="mt-6"
        />
      )}
    </div>
  );
}
