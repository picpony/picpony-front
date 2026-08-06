'use client';

import { memo } from 'react';
import { MdComment, MdVisibility, MdThumbUp } from 'react-icons/md';
import { ForumPost } from '@/lib/api';
import FadeInImage from '@/components/FadeInImage';
import Pagination from '@/components/Pagination';
import ErrorRetry from '@/components/ErrorRetry';
import { rememberForumOrigin } from '@/lib/forumTransition';

interface ForumPostListProps {
  posts: ForumPost[];
  page: number;
  totalPages: number;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  onPageChange: (newPage: number) => void;
  onPostClick: (postId: number) => void;
  className?: string;
}

export default memo(function ForumPostList({
  posts,
  page,
  totalPages,
  isLoading,
  error,
  onRetry,
  onPageChange,
  onPostClick,
  className = '',
}: ForumPostListProps) {
  if (isLoading) {
    return (
      <div className={`space-y-4 ${className}`}>
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="bg-surface-container-lowest p-4 rounded-md flex gap-4">
            <div
              className="skeleton w-12 h-12 bg-surface-container-highest rounded-full flex-shrink-0"
              style={{ animationDelay: `${i * 80}ms` }}
            />
            <div className="flex-1 space-y-3">
              <div
                className="skeleton h-5 bg-surface-container-highest rounded w-3/4"
                style={{ animationDelay: `${i * 80 + 40}ms` }}
              />
              <div
                className="skeleton h-4 bg-surface-container-highest rounded w-1/4"
                style={{ animationDelay: `${i * 80 + 80}ms` }}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return <ErrorRetry title="帖子加载失败" message={error.message} onRetry={onRetry} />;
  }

  return (
    <div className={className}>
      <div className="space-y-4 mb-8">
        {posts.length === 0 ? (
          <div className="text-center py-12 text-on-surface-variant bg-surface-container-lowest rounded-md animate-fade-in">
            暂无帖子
          </div>
        ) : (
          posts.map((post, index) => {
            const stats = (
              <>
                <span
                  className="flex items-center gap-1 whitespace-nowrap tabular-nums"
                  title="浏览量"
                >
                  <MdVisibility size={14} className="sm:size-[16px]" /> {post.views}
                </span>
                <span
                  className="flex items-center gap-1 whitespace-nowrap tabular-nums"
                  title="回复数"
                >
                  <MdComment size={14} className="sm:size-[16px]" /> {post.reply_count}
                </span>
                <span
                  className="flex items-center gap-1 whitespace-nowrap tabular-nums"
                  title="点赞数"
                >
                  <MdThumbUp size={14} className="sm:size-[16px]" /> {post.like_count}
                </span>
              </>
            );
            return (
              <div
                key={post.id}
                onClick={(e) => {
                  // The card on the detail page grows out of this rectangle.
                  rememberForumOrigin(post.id, e.currentTarget);
                  onPostClick(post.id);
                }}
                data-ripple
                data-tab-row
                style={{
                  animationDelay: `${Math.min(index, 8) * 45}ms`,
                  animationFillMode: 'backwards',
                }}
                /* M3 filled card: no container at rest, one elevation step and a
                 state layer on hover. The tint used to be `hover:bg-…/50`,
                 which is the alpha hack `state-layer` exists to replace — it
                 has to be written once per scheme and drifts. Properties are
                 named rather than left to `transition-ui`'s catch-all list, so
                 it is obvious what moves. */
                className="block bg-surface-container-lowest p-4 rounded-md cursor-pointer state-layer transition-[box-shadow,translate] duration-200 ease-[var(--ease-standard)] hover:-translate-y-0.5 hover:shadow-e1"
              >
                <div className="flex gap-4">
                  <div className="flex-shrink-0">
                    <FadeInImage
                      src={
                        post.avatar
                          ? `https://picpony.top/${post.avatar}`
                          : '/img/default-avatar.png'
                      }
                      alt={post.username}
                      width={48}
                      height={48}
                      className="rounded-full object-cover border border-outline-variant"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = '/img/default-avatar.png';
                      }}
                    />
                  </div>
                  {/* One shape, cover or no cover.
                      Three rows: the title, the author under it, and a baseline
                      carrying the date on the left and the counts on the right.
                      The middle column stretches to whatever the row is tall,
                      so `mt-auto` drops that baseline to the bottom edge of the
                      thumbnail when there is one and changes nothing when there
                      is not — which is the point. Branching on the cover gave
                      the two kinds of post visibly different anatomy; here the
                      picture only decides how tall the row is.
                      Date and counts share the baseline rather than each owning
                      a row of their own: it keeps the card to three lines, and
                      the two ends anchor the bottom the way the avatar and the
                      thumbnail anchor the top. */}
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-center gap-2">
                      {post.is_pinned === 1 && (
                        <span className="px-2 py-0.5 bg-error-container text-error text-label-m rounded-sm flex-shrink-0">
                          置顶
                        </span>
                      )}
                      <h2 className="text-body-l sm:text-title-m-emphasized text-on-surface truncate">
                        {post.title}
                      </h2>
                    </div>
                    <span className="block truncate text-body-s text-on-surface sm:text-body-m">
                      {post.username}
                    </span>
                    <div className="mt-auto flex items-center justify-between gap-3 pt-1.5 text-body-s text-on-surface-variant sm:text-body-m">
                      <span className="truncate">
                        {new Date(post.created_at).toLocaleDateString()}
                      </span>
                      <div className="flex shrink-0 items-center gap-3 sm:gap-4">{stats}</div>
                    </div>
                  </div>
                  {post.cover_image && (
                    <div className="flex-shrink-0">
                      <FadeInImage
                        src={`https://picpony.top${post.cover_image}`}
                        alt="Cover"
                        width={80}
                        height={80}
                        className="object-cover rounded-md w-12 h-12 sm:w-20 sm:h-20"
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {totalPages > 1 && (
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          onPageChange={onPageChange}
          className="mt-8"
        />
      )}
    </div>
  );
});
