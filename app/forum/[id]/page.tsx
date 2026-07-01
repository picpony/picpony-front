'use client';

import { useState, useEffect } from 'react';
import { api, ForumPostDetail, ForumComment } from '@/lib/api';
import { MdErrorOutline, MdRefresh, MdArrowBack, MdThumbUp, MdOutlineThumbUp, MdComment, MdVisibility, MdSend } from 'react-icons/md';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
const RichTextEditor = dynamic(() => import('@/components/RichTextEditor'), { ssr: false });
import RichTextRenderer from '@/components/RichTextRenderer';
import Spinner from '@/components/Spinner';
import FadeInImage from '@/components/FadeInImage';

export default function ForumPostPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const pageParam = searchParams.get('page');
  const initialPage = pageParam ? parseInt(pageParam, 10) : 1;

  const [post, setPost] = useState<ForumPostDetail | null>(null);
  const [comments, setComments] = useState<ForumComment[]>([]);
  const [page, setPage] = useState(initialPage);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [newComment, setNewComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [isLikeLoading, setIsLikeLoading] = useState(false);

  useEffect(() => {
    const checkLoginStatus = () => {
      const userInfo = localStorage.getItem('user_info');
      setIsLoggedIn(!!userInfo);
    };
    
    checkLoginStatus();
    window.addEventListener('user_info_updated', checkLoginStatus);
    return () => window.removeEventListener('user_info_updated', checkLoginStatus);
  }, []);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setError(null);

    api.getForumPostDetail(id, page)
      .then((res) => {
        if (isMounted) {
          setPost(res.post);
          setComments(res.comments);
          setTotalPages(res.total_pages);
          setIsLiked(res.post.is_liked === 1);
          setLikeCount(res.post.like_count);
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
  }, [id, page, retryCount]);

  const handleToggleLike = async () => {
    const userInfoStr = localStorage.getItem('user_info');
    if (!userInfoStr) {
      setSubmitError('请先登录');
      return;
    }
    setIsLikeLoading(true);
    try {
      const userInfo = JSON.parse(userInfoStr);
      const res = await api.toggleForumPostLike(userInfo.token, parseInt(id));
      const data = await res.json();
      if (data.success) {
        setIsLiked(data.is_liked === 1);
        setLikeCount(data.like_count);
      }
    } catch (err) {
      console.error('Toggle like error:', err);
    } finally {
      setIsLikeLoading(false);
    }
  };

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setPage(newPage);
      router.push(`/forum/${id}?page=${newPage}`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleSubmitComment = async () => {
    if (!newComment.trim() || isSubmitting) return;

    const userInfoStr = localStorage.getItem('user_info');
    if (!userInfoStr) {
      setSubmitError('请先登录');
      return;
    }

    try {
      setIsSubmitting(true);
      setSubmitError(null);
      const userInfo = JSON.parse(userInfoStr);
      
      const res = await api.createForumComment(userInfo.token, parseInt(id), newComment);
      const data = await res.json();

      if (data.success) {
        setNewComment('');
        setRetryCount(c => c + 1); // Reload comments
      } else {
        setSubmitError(data.message || '发送评论失败');
      }
    } catch (err) {
      setSubmitError('发送评论失败，请稍后重试');
      console.error('Failed to submit comment:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-white dark:bg-transparent p-6 rounded-xl animate-pulse mb-6">
          <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded w-3/4 mb-4"></div>
          <div className="flex items-center gap-4 mb-6">
            <div className="w-10 h-10 bg-slate-200 dark:bg-slate-700 rounded-full"></div>
            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/4"></div>
          </div>
          <div className="space-y-3">
            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-full"></div>
            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-full"></div>
            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-5/6"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-slate-500 dark:text-slate-400 animate-fade-in px-4 text-center">
        <MdErrorOutline size={48} className="mb-4 text-slate-400 dark:text-slate-500" />
        <h2 className="text-xl font-semibold mb-2 text-slate-700 dark:text-slate-200">帖子加载失败</h2>
        <div className="mb-6 max-w-md">
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">{error?.message || '帖子不存在'}</p>
        </div>
        <div className="flex gap-4">
          <button 
            onClick={() => router.back()}
            className="flex items-center px-4 py-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-md hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors cursor-pointer"
          >
            <MdArrowBack size={20} className="mr-2" />
            <span>返回</span>
          </button>
          <button 
            onClick={() => setRetryCount(c => c + 1)}
            className="flex items-center px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90 transition-colors cursor-pointer"
          >
            <MdRefresh size={20} className="mr-2" />
            <span>重试</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6">
        <button 
          onClick={() => router.push('/forum')}
          className="flex items-center text-slate-500 hover:text-slate-700 transition-colors"
        >
          <MdArrowBack size={20} className="mr-1" />
          <span>返回论坛</span>
        </button>
      </div>

      <div className="bg-white dark:bg-transparent p-4 sm:p-6 rounded-xl mb-8">
        <h1 className="text-xl sm:text-2xl font-bold text-slate-800 dark:text-slate-100 mb-4">{post.title}</h1>
        
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-4 mb-6">
          <div className="flex items-center gap-3">
            <Link href={`/user/${post.user_id}`}>
              <FadeInImage 
                src={post.avatar ? `https://picpony.top/${post.avatar}` : '/img/default-avatar.png'} 
                alt={post.username}
                width={40}
                height={40}
                className="rounded-full object-cover border border-slate-200 dark:border-slate-600"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = '/img/default-avatar.png';
                }}
              />
            </Link>
            <div>
              <div className="flex items-center gap-2">
              <Link href={`/user/${post.user_id}`} className="font-medium text-slate-700 dark:text-slate-300 hover:text-primary transition-colors">
                  {post.username}
                </Link>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium uppercase tracking-wider">
                  {post.role}
                </span>
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                发布于 {new Date(post.created_at).toLocaleString()}
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-4 text-sm text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1" title="浏览量">
              <MdVisibility size={16} /> {post.views}
            </span>
            <span className="flex items-center gap-1" title="回复数">
              <MdComment size={16} /> {post.reply_count}
            </span>
            <button
              onClick={handleToggleLike}
              disabled={isLikeLoading}
              className={`flex items-center gap-1 transition-colors ${
                isLiked ? 'text-primary' : 'hover:text-primary'
              }`}
              title={isLiked ? '取消点赞' : '点赞'}
            >
              {isLikeLoading ? (
                <Spinner size="sm" />
              ) : isLiked ? (
                <MdThumbUp size={16} />
              ) : (
                <MdOutlineThumbUp size={16} />
              )}
              {likeCount}
            </button>
          </div>
        </div>

        <div className="prose max-w-none text-slate-700 dark:text-slate-300">
          <RichTextRenderer content={post.content} />
        </div>
      </div>

      <div className="mb-8">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-4">全部回复 ({post.reply_count})</h2>
        
        <div className="space-y-4">
          {comments.length === 0 ? (
            <div className="text-center py-8 text-slate-500 dark:text-slate-400 bg-white dark:bg-transparent rounded-xl">
              暂无回复，快来抢沙发吧！
            </div>
          ) : (
            comments.map((comment, index) => (
              <div key={comment.id} className="bg-white dark:bg-transparent p-4 rounded-xl flex gap-4">
                <div className="flex-shrink-0">
                  <Link href={`/user/${comment.user_id}`}>
                    <FadeInImage 
                      src={comment.avatar ? `https://picpony.top/${comment.avatar}` : '/img/default-avatar.png'} 
                      alt={comment.username}
                      width={40}
                      height={40}
                      className="rounded-full object-cover border border-slate-200 dark:border-slate-600"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = '/img/default-avatar.png';
                      }}
                    />
                  </Link>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Link href={`/user/${comment.user_id}`} className="font-medium text-slate-700 dark:text-slate-300 hover:text-primary transition-colors">
                        {comment.username}
                      </Link>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium uppercase tracking-wider">
                        {comment.role}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
                      <span>#{((page - 1) * 20) + index + 1}</span>
                      <span>{new Date(comment.created_at).toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="prose max-w-none text-slate-700 dark:text-slate-300 text-sm">
                    <RichTextRenderer content={comment.content} />
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Comment Input */}
      <div className="bg-white dark:bg-transparent p-4 sm:p-6 rounded-xl mb-8">
        <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-4">发表回复</h3>
        {!isLoggedIn ? (
          <div className="text-center py-8 bg-slate-50 dark:bg-background/50 rounded-lg border border-slate-200 dark:border-slate-700">
            <p className="text-slate-500 dark:text-slate-400 mb-4">登录后才能发表回复</p>
            <Link 
              href="/login"
              className="inline-flex items-center px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors font-medium"
            >
              去登录
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <RichTextEditor 
              value={newComment} 
              onChange={setNewComment} 
              placeholder="写下你的回复..."
            />
            {submitError && (
              <div className="text-red-500 text-sm flex items-center gap-1">
                <MdErrorOutline size={16} />
                {submitError}
              </div>
            )}
            <div className="flex justify-end">
              <button
                onClick={handleSubmitComment}
                disabled={isSubmitting || !newComment.trim()}
                className="flex items-center px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {isSubmitting ? (
                  <div className="flex items-center gap-1">
                    <Spinner size="sm" white />
                  </div>
                ) : (
                  <>
                    <MdSend size={18} className="mr-2" />
                    发送回复
                  </>
                )}
              </button>
            </div>
          </div>
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
