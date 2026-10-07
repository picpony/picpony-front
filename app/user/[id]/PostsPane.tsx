'use client';

import Link from 'next/link';
import { MdArticle, MdComment, MdThumbUp } from 'react-icons/md';
import { SKIP, useResource } from '@/lib/resource';
import { userPosts } from '@/lib/resources';
import { useScreenStateFor } from '@/lib/screenState';
import { hiddenFromVisitors, tabVisible } from '@/lib/profiles';
import { rememberForumOrigin } from '@/lib/forumTransition';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { formatCompactDateTime } from '@/lib/format';
import { getAssetUrl } from '@/lib/utils';
import { ICON } from '@/lib/icons';
import FadeInImage from '@/components/FadeInImage';
import Pagination from '@/components/Pagination';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import { ListRowsSkeleton, OwnerHiddenNote, PaneFailure, PaneHidden, useVisited, type ProfilePaneProps } from './ProfilePaneStates';

/**
 * 发布的帖子 — the grouped rows the forum and history lists use. A row is the post's link, and a
 * press hands the row's rectangle to the thread's container transform (`rememberForumOrigin`),
 * so a post opened from a profile grows out of its row as it does from the forum.
 */
export default function PostsPane({ profile, id, own, ready, active, now }: ProfilePaneProps) {
  const visited = useVisited(active);
  const [page, setPage] = useScreenStateFor('profile:posts', id, 1);
  const visible = tabVisible(profile, 'posts', own);
  const read = useResource(userPosts, ready && visited && visible ? { id, page } : SKIP, { keepPrevious: id });

  if (!ready) return <ListRowsSkeleton />;
  if (!visible) return <PaneHidden />;
  const data = read.data;
  if (data === undefined) {
    return read.error ? <PaneFailure error={read.error} title="帖子加载失败" onRetry={read.refresh} /> : <ListRowsSkeleton />;
  }
  if (data.posts.length === 0 && !read.isPrevious) {
    return (
      <EmptyState
        size="pane"
        icon={<MdArticle size={ICON.display} />}
        title="暂无帖子"
        description={own ? '你还没有发表过帖子' : '该用户还没有发表过任何帖子'}
      />
    );
  }

  const failedTurn = read.isPrevious && Boolean(read.error);
  return (
    <div aria-busy={read.isLoading || undefined}>
      {own && hiddenFromVisitors(profile, 'posts') && <OwnerHiddenNote tab="posts" />}
      {/* In-flow rows, so scroll anchoring does what the masonry's needs `FailedTurnHold` for:
          at the list's top the tab row is the anchor and the message shows under it; deeper in,
          the row under the viewer is, and nothing moves. */}
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
        {data.posts.map((post) => (
          <Link
            scroll={false}
            key={post.id}
            href={`/forum/${post.id}`}
            onClick={(event) => rememberForumOrigin(post.id, event.currentTarget)}
            data-ripple
            className="m3-row state-layer block bg-surface-container-low p-4 transition-ui focus-visible:outline-hidden focus-visible:inset-ring-2 focus-visible:focus-ring-inset"
          >
            <div className="flex items-start gap-3">
              {post.cover_image ? (
                <div className="relative size-14 shrink-0 overflow-hidden rounded-sm bg-surface-container-highest">
                  <FadeInImage src={getAssetUrl(post.cover_image)} alt="" fill sizes="56px" className="object-cover" />
                </div>
              ) : null}
              <div className="min-w-0 flex-1">
                <h3 className="mb-1.5 line-clamp-2 wrap-anywhere text-title-m-emphasized text-on-surface">{post.title}</h3>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-label-m text-on-surface-variant">
                  <span>{formatCompactDateTime(post.created_at, now)}</span>
                  <span className="flex items-center gap-1 whitespace-nowrap tabular-nums">
                    <MdComment size={ICON.dense} aria-hidden="true" />
                    <span className="sr-only">回复数</span>
                    {post.reply_count}
                  </span>
                  <span className="flex items-center gap-1 whitespace-nowrap tabular-nums">
                    <MdThumbUp size={ICON.dense} aria-hidden="true" />
                    <span className="sr-only">点赞数</span>
                    {post.like_count}
                  </span>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
      {data.totalPages > 1 && (
        <Pagination
          currentPage={page}
          totalPages={data.totalPages}
          onPageChange={setPage}
          onPrefetchPage={(next) => userPosts.prefetch({ id, page: next })}
          disabled={read.isLoading}
          className="mt-8 mb-4"
        />
      )}
    </div>
  );
}
