'use client';

import { memo } from 'react';
import { MdDeleteOutline, MdReply } from 'react-icons/md';
import IconButton from '@/components/IconButton';
import Pagination from '@/components/Pagination';
import SectionHeading from '@/components/SectionHeading';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import RichTextRenderer from '@/components/RichTextRenderer';
import Skeleton, { SkeletonCircle } from '@/components/Skeleton';
import ForumAuthor from '@/components/forum/ForumAuthor';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { formatCompactDateTime, formatDate, formatDateTime } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import type { ForumComment } from '@/lib/types/forum';

/** The id a reply's row carries, for landing on it after it is sent. */
export const replyElementId = (id: number) => `reply-${id}`;

/**
 * A reply's floor number, from the page it is on: a page before the last is full, so its length
 * is the page size; the last page ends at the total. Nothing assumes the backend's page size
 * (R6-038) — it has never been observed past one page.
 */
export function floorOf(index: number, page: number, totalPages: number, pageLength: number, total: number): number {
  if (page < totalPages) return (page - 1) * pageLength + index + 1;
  return Math.max(0, total - pageLength) + index + 1;
}

const ReplyRow = memo(function ReplyRow({
  comment,
  floor,
  now,
  canDelete,
  deleting,
  onReply,
  onDelete,
}: {
  comment: ForumComment;
  floor: number;
  now: number | null;
  canDelete: boolean;
  deleting: boolean;
  onReply: (comment: ForumComment) => void;
  onDelete: (comment: ForumComment) => void;
}) {
  return (
    <article
      id={replyElementId(comment.id)}
      /* Focus lands here after a reply is sent, so a keyboard user arrives where the eye does. */
      tabIndex={-1}
      aria-label={`${comment.username} 的回复`}
      /* The same grouped-list row as the image detail's comments. */
      className="m3-row scroll-mt-20 bg-surface-container-low p-3 focus-visible:outline-hidden focus-visible:inset-ring-2 focus-visible:focus-ring-inset sm:p-4"
    >
      <ForumAuthor
        userId={comment.user_id}
        username={comment.username}
        avatar={comment.avatar}
        role={comment.role}
        experience={comment.experience}
        badges={comment.badges}
        meta={
          <>
            <time dateTime={comment.created_at} title={formatDateTime(comment.created_at)} className="tabular-nums">
              {now === null ? formatDate(comment.created_at) : formatCompactDateTime(comment.created_at, now)}
            </time>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">#{floor}</span>
          </>
        }
        actions={
          <>
            <IconButton size="sm" aria-label="回复" icon={<MdReply />} onClick={() => onReply(comment)} />
            {canDelete && (
              <IconButton
                size="sm"
                variant="danger-text"
                loading={deleting}
                aria-label="删除"
                icon={<MdDeleteOutline />}
                onClick={() => onDelete(comment)}
              />
            )}
          </>
        }
      >
        {/* A reply is a remark, not an article: `body-m`, and the rhythm follows in `em`. */}
        <div className="mt-1 min-w-0 text-body-m text-on-surface wrap-anywhere">
          <RichTextRenderer content={comment.content} format="bbcode" />
        </div>
      </ForumAuthor>
    </article>
  );
});

/** The replies' first-load placeholder, in the row's own geometry. */
function RepliesSkeleton({ rows }: { rows: number }) {
  return (
    <div data-page-loading="" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="m3-row flex gap-3 bg-surface-container-low p-3 sm:p-4">
          <SkeletonCircle size={40} delay={i * 80} />
          <div className="min-w-0 flex-1">
            <div className="flex h-8 items-center">
              <Skeleton className="h-4 w-28" delay={i * 80 + 40} />
            </div>
            <Skeleton className="h-3 w-20" delay={i * 80 + 60} />
            <Skeleton className="mt-3 h-4 w-11/12" delay={i * 80 + 80} />
          </div>
        </div>
      ))}
    </div>
  );
}

interface ThreadCommentsProps {
  headingId: string;
  /** `undefined` while the first page is on its way. */
  comments: ForumComment[] | undefined;
  total: number;
  page: number;
  totalPages: number;
  /** A failed read: the first (with the post already on screen) or a page turn's. */
  error: unknown;
  onRetry: () => void;
  onPageChange: (page: number) => void;
  canDelete: (comment: ForumComment) => boolean;
  deletingId: number | null;
  onReply: (comment: ForumComment) => void;
  onDelete: (comment: ForumComment) => void;
  /** How many rows the placeholder draws — the count the list said, capped. */
  expected: number;
}

/**
 * The thread's replies: a heading with the count, the rows, and the pager under them — it is the
 * pager's anchor, so a page turn lands on the heading rather than on the post above.
 */
export default function ThreadComments({
  headingId,
  comments,
  total,
  page,
  totalPages,
  error,
  onRetry,
  onPageChange,
  canDelete,
  deletingId,
  onReply,
  onDelete,
  expected,
}: ThreadCommentsProps) {
  const now = useNow();
  const failed = error !== undefined && error !== null;
  return (
    <section data-pagination-anchor aria-labelledby={headingId} className="mb-8 scroll-mt-20">
      <SectionHeading id={headingId}>全部回复（{total}）</SectionHeading>
      {failed && (
        <ErrorRetry
          size="inline"
          title={comments ? '这一页回复加载失败' : '回复加载失败'}
          message={apiErrorMessage(error)}
          onRetry={isRetryable(error) ? onRetry : undefined}
        />
      )}
      {comments === undefined ? (
        !failed && <RepliesSkeleton rows={Math.min(Math.max(expected, 1), 5)} />
      ) : comments.length === 0 ? (
        <EmptyState size="inline" title="暂无回复" />
      ) : (
        <div>
          {comments.map((comment, index) => (
            <ReplyRow
              key={comment.id}
              comment={comment}
              floor={floorOf(index, page, totalPages, comments.length, total)}
              now={now}
              canDelete={canDelete(comment)}
              deleting={deletingId === comment.id}
              onReply={onReply}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
      {totalPages > 1 && comments !== undefined && (
        <Pagination currentPage={page} totalPages={totalPages} onPageChange={onPageChange} className="mt-6" />
      )}
    </section>
  );
}
