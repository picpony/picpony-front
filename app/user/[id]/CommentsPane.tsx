'use client';

import Link from 'next/link';
import { MdChatBubbleOutline, MdForum, MdImage } from 'react-icons/md';
import { SKIP, useResource } from '@/lib/resource';
import { userComments } from '@/lib/resources';
import { useScreenStateFor } from '@/lib/screenState';
import { hiddenFromVisitors, tabVisible } from '@/lib/profiles';
import { rememberForumOrigin } from '@/lib/forumTransition';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { formatCompactDateTime } from '@/lib/format';
import { getAssetUrl } from '@/lib/utils';
import { ICON } from '@/lib/icons';
import type { UserComment } from '@/lib/types/user';
import Badge from '@/components/Badge';
import FadeInImage from '@/components/FadeInImage';
import Pagination from '@/components/Pagination';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import RichTextRenderer from '@/components/RichTextRenderer';
import { ListRowsSkeleton, OwnerHiddenNote, PaneFailure, PaneHidden, useVisited, type ProfilePaneProps } from './ProfilePaneStates';

function target(comment: UserComment): { href: string; label: string; icon: React.ReactNode } {
  return comment.type === 'post'
    ? { href: `/forum/${comment.target_id}`, label: '论坛帖子', icon: <MdForum /> }
    : { href: `/pic/${comment.target_id}`, label: '图片', icon: <MdImage /> };
}

/**
 * 历史评论 — each row is the comment and a link to where it was written, and **the whole row is
 * the target** (R7-036: the only link was the small badge and date). The row cannot *be* the link:
 * the comment is rich text, whose own links would then be nested inside it, which is invalid and
 * fails invisibly (AGENTS: an interactive element may not be nested inside another). So the link
 * is a sibling laid under the row's content — the `DropZone` arrangement: the content lets the
 * pointer through to it, except on a link of the comment's own.
 */
export default function CommentsPane({ profile, id, own, ready, active, now }: ProfilePaneProps) {
  const visited = useVisited(active);
  const [page, setPage] = useScreenStateFor('profile:comments', id, 1);
  const visible = tabVisible(profile, 'comments', own);
  const read = useResource(userComments, ready && visited && visible ? { id, page } : SKIP, { keepPrevious: id });

  if (!ready) return <ListRowsSkeleton badge />;
  if (!visible) return <PaneHidden />;
  const data = read.data;
  if (data === undefined) {
    return read.error ? <PaneFailure error={read.error} title="评论加载失败" onRetry={read.refresh} /> : <ListRowsSkeleton badge />;
  }
  if (data.comments.length === 0 && !read.isPrevious) {
    return (
      <EmptyState
        size="pane"
        icon={<MdChatBubbleOutline size={ICON.display} />}
        title="暂无评论"
        description={own ? '你还没有发表过评论' : '该用户还没有发表过任何评论'}
      />
    );
  }

  const failedTurn = read.isPrevious && Boolean(read.error);
  return (
    <div aria-busy={read.isLoading || undefined}>
      {own && hiddenFromVisitors(profile, 'comments') && <OwnerHiddenNote tab="comments" />}
      {failedTurn && (
        <div className="mb-4">
          <ErrorRetry
            size="inline"
            title={`第 ${page} 页加载失败`}
            message={apiErrorMessage(read.error)}
            onRetry={isRetryable(read.error) ? read.refresh : undefined}
          />
        </div>
      )}
      <div>
        {data.comments.map((comment, index) => {
          const where = target(comment);
          const when = formatCompactDateTime(comment.created_at, now);
          return (
            <article key={`${comment.type}-${comment.id}-${index}`} className="m3-row relative bg-surface-container-low p-4">
              <Link
                scroll={false}
                href={where.href}
                aria-label={`查看原${where.label}：${when}`}
                onClick={(event) => {
                  if (comment.type === 'post') {
                    const row = event.currentTarget.parentElement;
                    if (row) rememberForumOrigin(comment.target_id, row);
                  }
                }}
                data-ripple
                /* Under the content, the row's whole box: its corner is the row's own (the
                   grouped list's), so the state layer and the ripple follow it. Inset ring: the
                   run of rows sits flush, and an outset one would lie on the neighbours. */
                className="absolute inset-0 rounded-[inherit] state-layer transition-ui focus-visible:outline-hidden focus-visible:inset-ring-2 focus-visible:focus-ring-inset"
              />
              <div className="pointer-events-none relative flex items-start gap-3 [&_a]:pointer-events-auto [&_button]:pointer-events-auto">
                {comment.cover_image ? (
                  <div className="relative size-14 shrink-0 overflow-hidden rounded-sm bg-surface-container-highest">
                    <FadeInImage src={getAssetUrl(comment.cover_image)} alt="" fill sizes="56px" className="object-cover" />
                  </div>
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">
                    <Badge tone="primary" icon={where.icon}>
                      {where.label}
                    </Badge>
                    <span className="text-body-s text-on-surface-variant">{when}</span>
                  </div>
                  <div className="line-clamp-3 text-body-m text-on-surface wrap-anywhere">
                    <RichTextRenderer content={comment.body} />
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {data.totalPages > 1 && (
        <Pagination
          currentPage={page}
          totalPages={data.totalPages}
          onPageChange={setPage}
          onPrefetchPage={(next) => userComments.prefetch({ id, page: next })}
          disabled={read.isLoading}
          className="mt-8 mb-4"
        />
      )}
    </div>
  );
}
