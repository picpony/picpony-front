'use client';

import { useState, useEffect } from 'react';
import { api, ForumPost } from '@/lib/api';
import { MdAdd } from 'react-icons/md';
import { useSearchParams, useRouter } from 'next/navigation';
import ForumPostList from '@/components/ForumPostList';

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

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">论坛</h1>
        <button
          onClick={() => router.push('/forum/create')}
          data-ripple className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 hover:shadow-md hover:shadow-primary/25 active:scale-95 transition-all duration-200 text-sm font-medium"
        >
          <MdAdd size={18} />
          发帖
        </button>
      </div>

      <ForumPostList
        posts={posts}
        page={page}
        totalPages={totalPages}
        isLoading={isLoading}
        error={error}
        onRetry={() => { setIsLoading(true); setError(null); setRetryCount(c => c + 1); }}
        onPageChange={handlePageChange}
        onPostClick={(postId) => router.push(`/forum/${postId}`)}
      />
    </div>
  );
}
