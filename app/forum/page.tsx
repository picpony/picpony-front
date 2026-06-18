'use client';

import { useState, useEffect } from 'react';
import { api, ForumPost } from '@/lib/api';
import { MdErrorOutline, MdRefresh, MdComment, MdVisibility, MdThumbUp, MdAdd } from 'react-icons/md';
import { useSearchParams, useRouter } from 'next/navigation';

export default function ForumPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pageParam = searchParams.get('page');
  const initialPage = pageParam ? parseInt(pageParam, 10) : 1;

  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [page, setPage] = useState(initialPage);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let isMounted = true;

    api.getForumPosts(page)
      .then((res) => {
        if (isMounted) {
          setPosts(res.posts);
          setTotalPages(res.total_pages);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err);
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [page, retryCount]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setIsLoading(true);
      setError(null);
      setPage(newPage);
      router.push(`/forum?page=${newPage}`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  if (isLoading) {
    return (
    <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="bg-white dark:bg-transparent p-4 rounded-xl animate-pulse flex gap-4">
              <div className="w-12 h-12 bg-slate-200 dark:bg-slate-700 rounded-full flex-shrink-0"></div>
              <div className="flex-1 space-y-3">
                <div className="h-5 bg-slate-200 dark:bg-slate-700 rounded w-3/4"></div>
                <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/4"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-slate-500 dark:text-slate-400 animate-fade-in px-4 text-center">
        <MdErrorOutline size={48} className="mb-4 text-slate-400 dark:text-slate-500" />
        <h2 className="text-xl font-semibold mb-2 text-slate-700 dark:text-slate-200">帖子加载失败</h2>
        <div className="mb-6 max-w-md">
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">{error.message}</p>
        </div>
        <button 
          onClick={() => { setIsLoading(true); setError(null); setRetryCount(c => c + 1); }}
          className="flex items-center px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90 transition-colors cursor-pointer"
        >
          <MdRefresh size={20} className="mr-2" />
          <span>重试</span>
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">论坛</h1>
        <button
          onClick={() => router.push('/forum/create')}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors text-sm font-medium"
        >
          <MdAdd size={18} />
          发帖
        </button>
      </div>

      <div className="space-y-4 mb-8">
        {posts.length === 0 ? (
          <div className="text-center py-12 text-slate-500 dark:text-slate-400 bg-white dark:bg-transparent rounded-xl">
            暂无帖子
          </div>
        ) : (
          posts.map((post) => (
            <div 
              key={post.id}
              onClick={() => router.push(`/forum/${post.id}`)}
              className="block bg-white dark:bg-transparent p-4 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors duration-200 cursor-pointer"
            >
              <div className="flex gap-4">
                <div className="flex-shrink-0">
                  <img 
                    src={post.avatar ? `https://picpony.top/${post.avatar}` : '/img/default-avatar.png'} 
                    alt={post.username}
                    className="w-12 h-12 rounded-full object-cover border border-slate-200 dark:border-slate-600"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = '/img/default-avatar.png';
                    }}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {post.is_pinned === 1 && (
                      <span className="px-2 py-0.5 bg-red-100 text-red-600 text-xs font-medium rounded">置顶</span>
                    )}
                    <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 truncate">{post.title}</h2>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-slate-500 dark:text-slate-400">
                    <span className="font-medium text-slate-700 dark:text-slate-300">{post.username}</span>
                    <span>{new Date(post.created_at).toLocaleDateString()}</span>
                    <div className="flex items-center gap-3 ml-auto">
                      <span className="flex items-center gap-1" title="浏览量">
                        <MdVisibility size={16} /> {post.views}
                      </span>
                      <span className="flex items-center gap-1" title="回复数">
                        <MdComment size={16} /> {post.reply_count}
                      </span>
                      <span className="flex items-center gap-1" title="点赞数">
                        <MdThumbUp size={16} /> {post.like_count}
                      </span>
                    </div>
                  </div>
                </div>
                {post.cover_image && (
                  <div className="flex-shrink-0 hidden sm:block">
                    <img 
                      src={`https://picpony.top${post.cover_image}`} 
                      alt="Cover" 
                      className="w-20 h-20 object-cover rounded-lg"
                    />
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-2 mt-8">
          <button
            onClick={() => handlePageChange(page - 1)}
            disabled={page === 1}
            className="px-4 py-2 rounded-lg bg-white dark:bg-transparent border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            上一页
          </button>
          
          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum;
              if (totalPages <= 5) {
                pageNum = i + 1;
              } else if (page <= 3) {
                pageNum = i + 1;
              } else if (page >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else {
                pageNum = page - 2 + i;
              }

              return (
                <button
                  key={pageNum}
                  onClick={() => handlePageChange(pageNum)}
                    className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
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
            onClick={() => handlePageChange(page + 1)}
            disabled={page === totalPages}
            className="px-4 py-2 rounded-lg bg-white dark:bg-transparent border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
