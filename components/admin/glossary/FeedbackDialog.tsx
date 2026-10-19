'use client';

import { useState } from 'react';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import Modal from '@/components/Modal';
import Pagination from '@/components/Pagination';
import SearchInput from '@/components/SearchInput';
import Skeleton from '@/components/Skeleton';
import { showToast } from '@/components/Toast';
import { SKIP, useResource } from '@/lib/resource';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { formatDateTime } from '@/lib/format';
import * as adminApi from '@/lib/api/admin';
import { retryError } from '../queries';
import { useAdminMutation } from '../useAdminMutation';
import { useCursorPages } from '../paging';
import { useSettled } from '../useSettled';
import { tagFeedback, type Feedback, type FeedbackStatus } from './resources';

const STATUS_LABEL: Record<FeedbackStatus, string> = { pending: '待处理', processed: '已采纳', rejected: '已忽略' };
const STATUS_TONE: Record<FeedbackStatus, 'warning' | 'success' | 'neutral'> = {
  pending: 'warning',
  processed: 'success',
  rejected: 'neutral',
};
const FILTERS: (FeedbackStatus | 'all')[] = ['pending', 'processed', 'rejected', 'all'];

/**
 * 用户反馈 — the glossary's work queue. The dialog's own body is the one scroller (R9-037: a
 * second, 60vh one inside it gave the dialog two scrollbars); the pager finds it as the body's
 * `data-app-scroll-container`. 处理并编辑标签 hands the feedback to the panel, which opens that
 * tag's editor and closes the feedback when the tag is saved.
 *
 * **The read outlives `open` by the exit** (`live`, released by `Modal`'s `onExited`): gated on
 * `open`, the commit that closed the dialog dropped the page — `SKIP` clears the retained answer —
 * and five cards gave way to nine skeleton bars, the panel shrinking 208px and re-centring before
 * its fade had begun (M1-008).
 */
export default function FeedbackDialog({
  open,
  token,
  onClose,
  onHandle,
}: {
  open: boolean;
  token: string;
  onClose: () => void;
  onHandle: (feedback: Feedback) => void;
}) {
  const [status, setStatus] = useState<FeedbackStatus | 'all'>('pending');
  const [search, setSearch] = useState('');
  const keyword = useSettled(search.trim(), search.trim() ? 400 : 0);
  const scope = `${token}\n${status}\n${keyword}`;
  /* A cursor list: the pager offers the pages reached so far and the next one when there is one. */
  const pages = useCursorPages(scope);
  const current = pages.page;
  const [live, setLive] = useState(open);
  if (open && !live) setLive(true);
  const read = useResource(
    tagFeedback,
    live && token ? { token, status, before: pages.cursor, keyword } : SKIP,
    { keepPrevious: scope },
  );
  if (read.data && !read.isPrevious && !read.error) {
    /* A page emptied by handling its last feedback steps back to the one before it, rather than
       sitting on an empty page with its pager gone (review P6-F5). */
    if (read.data.rows.length === 0 && current > 1 && !read.isLoading) pages.setPage(current - 1);
    else pages.learn(current, read.data.next);
  }
  const mutation = useAdminMutation(token);

  /* `PUT /editor/dictionary/feedback/{id}` takes the status alone: the backend keeps no handling
     note, so 忽略 asks nothing more. */
  const setState = (feedback: Feedback, next: FeedbackStatus) =>
    void mutation.run(
      () => adminApi.handleTagFeedback(token, feedback.id, next),
      () => showToast(next === 'rejected' ? '已忽略该反馈' : '已标记为待处理', 'success'),
      '操作失败',
      { key: feedback.id, onCommitted: () => tagFeedback.invalidate() },
    );

  const rows = read.data?.rows ?? [];
  /* Handling the last feedback on a later page leaves a page the queue no longer has: move back one
     rather than show 暂无反馈 with the pager gone (review P6-F5). */
  if (read.data && !read.isPrevious && !read.isLoading && !read.error && !rows.length && current > 1) {
    pages.setPage(current - 1);
  }

  return (
    <>
    <Modal isOpen={open} onClose={onClose} onExited={() => setLive(false)} title="用户反馈与翻译申请" maxWidth="xl">
      <div className="space-y-4">
        <SearchInput value={search} onChange={setSearch} placeholder="搜索标签名或用户名…" />
        <div className="flex flex-wrap gap-2" role="group" aria-label="按处理状态筛选">
          {FILTERS.map((value) => (
            <Chip key={value} variant="filter" selected={status === value} onClick={() => setStatus(value)}>
              {value === 'all' ? '全部' : STATUS_LABEL[value]}
            </Chip>
          ))}
        </div>
        {read.data === undefined && read.error ? (
          <ErrorRetry
            size="inline"
            {...retryError('反馈加载失败', apiErrorMessage(read.error))}
            onRetry={isRetryable(read.error) ? read.refresh : undefined}
          />
        ) : read.data === undefined ? (
          <div className="space-y-3" aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <Card key={index} variant="filled" className="space-y-3">
                <Skeleton className="h-5 w-2/5" delay={index * 90} />
                <Skeleton className="h-4 w-1/3" delay={index * 90 + 40} />
                <Skeleton className="h-12 w-full rounded-sm" delay={index * 90 + 80} />
              </Card>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState size="inline" title={keyword ? '没有匹配的反馈' : '暂无反馈'} />
        ) : (
          <div data-pagination-anchor="" className="space-y-3">
            {read.isPrevious && Boolean(read.error) && (
              <ErrorRetry size="inline" title={`第 ${current} 页加载失败`} message={apiErrorMessage(read.error)} onRetry={read.refresh} />
            )}
            <ul className="space-y-3">
              {rows.map((feedback) => (
                <li key={feedback.id}>
                  <Card variant="filled" className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-mono text-label-l-emphasized text-on-surface wrap-anywhere">{feedback.tag}</p>
                        <p className="text-body-s text-on-surface-variant">
                          {`来自：${feedback.username || '游客'} · ${formatDateTime(feedback.created_at)}`}
                        </p>
                      </div>
                      <Badge tone={STATUS_TONE[feedback.status]} size="md">
                        {STATUS_LABEL[feedback.status]}
                      </Badge>
                    </div>
                    {/* The user's report, quoted in the app's one quote treatment (the brand rule, a
                        fill one container step from its host, `--rt-quote-surface`). The card is the
                        dialog's top step, so the step is the one below it; on the card's own tone the
                        block had no edge at all, 1.00:1 (G4-008). */}
                    <div className="rich-text-content text-body-m">
                      <blockquote className="whitespace-pre-wrap wrap-anywhere">{feedback.content}</blockquote>
                    </div>
                    {feedback.status !== 'pending' && (
                      <p className="text-body-s text-on-surface-variant">
                        {[
                          `由 ${feedback.handler_username || '管理员'} 处理`,
                          feedback.handled_at ? formatDateTime(feedback.handled_at) : null,
                        ].filter(Boolean).join(' · ')}
                      </p>
                    )}
                    <div className="flex flex-wrap justify-end gap-2">
                      {feedback.status === 'pending' ? (
                        <>
                          <Button
                            type="button"
                            variant="text"
                            size="xs"
                            loading={mutation.pendingKeys.has(feedback.id)}
                            onClick={() => setState(feedback, 'rejected')}
                          >
                            忽略
                          </Button>
                          <Button
                            type="button"
                            variant="filled"
                            size="xs"
                            disabled={mutation.pendingKeys.has(feedback.id)}
                            onClick={() => onHandle(feedback)}
                          >
                            处理并编辑标签
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          variant="text"
                          size="xs"
                          loading={mutation.pendingKeys.has(feedback.id)}
                          onClick={() => setState(feedback, 'pending')}
                        >
                          标记为待处理
                        </Button>
                      )}
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
            {pages.totalPages > 1 && (
              <Pagination
                currentPage={current}
                totalPages={pages.totalPages}
                onPageChange={pages.setPage}
                siblings={1}
                className="mt-0 w-full"
              />
            )}
          </div>
        )}
      </div>
    </Modal>
    </>
  );
}
