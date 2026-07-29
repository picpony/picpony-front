'use client';

import { memo } from 'react';
import { MdComment, MdVisibility, MdThumbUp } from 'react-icons/md';
import { ForumPost } from '@/lib/api';
import FadeInImage from '@/components/FadeInImage';
import ErrorRetry from '@/components/ErrorRetry';

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
          <div key={i} className="bg-white dark:bg-transparent p-4 rounded-xl flex gap-4">
            <div
              className="skeleton w-12 h-12 bg-slate-200 dark:bg-slate-700 rounded-full flex-shrink-0"
              style={{ animationDelay: `${i * 80}ms` }}
            />
            <div className="flex-1 space-y-3">
              <div
                className="skeleton h-5 bg-slate-200 dark:bg-slate-700 rounded w-3/4"
                style={{ animationDelay: `${i * 80 + 40}ms` }}
              />
              <div
                className="skeleton h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/4"
                style={{ animationDelay: `${i * 80 + 80}ms` }}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <ErrorRetry
        title="帖子加载失败"
        message={error.message}
        onRetry={onRetry}
      />
    );
  }

  return (
    <div className={className}>
      <div className="space-y-4 mb-8">
        {posts.length === 0 ? (
          <div className="text-center py-12 text-slate-500 dark:text-slate-400 bg-white dark:bg-transparent rounded-xl animate-fade-in">
            暂无帖子
          </div>
        ) : (
          posts.map((post, index) => (
            <div
              key={post.id}
              onClick={() => onPostClick(post.id)}
              data-ripple
              style={{ animationDelay: `${Math.min(index, 8) * 45}ms`, animationFillMode: 'backwards' }}
              className="block bg-white dark:bg-transparent p-4 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:-translate-y-0.5 hover:shadow-sm active:scale-[0.995] transition-all duration-200 ease-[var(--ease-standard)] cursor-pointer animate-page-transition"
            >
              <div className="flex gap-4">
                <div className="flex-shrink-0">
                  <FadeInImage
                    src={post.avatar ? `https://picpony.top/${post.avatar}` : '/img/default-avatar.png'}
                    alt={post.username}
                    width={48}
                    height={48}
                    className="rounded-full object-cover border border-slate-200 dark:border-slate-600"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = '/img/default-avatar.png';
                    }}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {post.is_pinned === 1 && (
                      <span className="px-2 py-0.5 bg-red-100 text-red-600 text-xs font-medium rounded flex-shrink-0">置顶</span>
                    )}
                    <h2 className="text-base sm:text-lg font-semibold text-slate-800 dark:text-slate-100 truncate">{post.title}</h2>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                    <span className="font-medium text-slate-700 dark:text-slate-300">{post.username}</span>
                    <span>{new Date(post.created_at).toLocaleDateString()}</span>
                    <div className="flex items-center gap-2 sm:gap-3 ml-auto sm:ml-auto">
                      <span className="flex items-center gap-0.5 sm:gap-1 whitespace-nowrap" title="浏览量">
                        <MdVisibility size={14} className="sm:size-[16px]" /> {post.views}
                      </span>
                      <span className="flex items-center gap-0.5 sm:gap-1 whitespace-nowrap" title="回复数">
                        <MdComment size={14} className="sm:size-[16px]" /> {post.reply_count}
                      </span>
                      <span className="flex items-center gap-0.5 sm:gap-1 whitespace-nowrap" title="点赞数">
                        <MdThumbUp size={14} className="sm:size-[16px]" /> {post.like_count}
                      </span>
                    </div>
                  </div>
                </div>
                {post.cover_image && (
                  <div className="flex-shrink-0">
                    <FadeInImage
                      src={`https://picpony.top${post.cover_image}`}
                      alt="Cover"
                      width={80}
                      height={80}
                      className="object-cover rounded-lg w-12 h-12 sm:w-20 sm:h-20"
                    />
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex flex-wrap justify-center items-center gap-1.5 sm:gap-2">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page === 1}
            className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg bg-white dark:bg-transparent border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            上一页
          </button>

          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(page <= 3 || totalPages <= 5 ? 5 : totalPages >= 7 ? 3 : 5, totalPages) }, (_, i) => {
              let pageNum;
              if (totalPages <= 5) {
                pageNum = i + 1;
              } else if (page <= 3) {
                pageNum = i + 1;
              } else if (page >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else if (totalPages >= 7) {
                // 大页数：移动端只显示 3 个紧凑按钮
                pageNum = page - 1 + i;
              } else {
                pageNum = page - 2 + i;
              }

              return (
                <button
                  key={pageNum}
                  onClick={() => onPageChange(pageNum)}
                  className={`w-8 sm:w-10 h-8 sm:h-10 rounded-lg flex items-center justify-center transition-colors text-xs sm:text-sm ${
                    page === pageNum
                      ? 'bg-primary text-white font-medium'
                      : 'bg-white dark:bg-transparent border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page === totalPages}
            className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg bg-white dark:bg-transparent border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
});