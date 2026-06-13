'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, PonyImage, UserComment, UserPost } from '@/lib/api';
import FadeInImage from '@/components/FadeInImage';
import RichTextRenderer from '@/components/RichTextRenderer';
import { MdPerson, MdCake, MdAccessTime, MdInfoOutline, MdFavorite, MdChatBubbleOutline, MdForum, MdImage, MdArticle } from 'react-icons/md';

interface UserProfile {
  id: number;
  username: string;
  avatar: string;
  banner: string;
  role: string;
  bio: string;
  gender: string;
  birthday: string;
  created_at: string;
  derpi_username: string;
  derpi_user_id: string;
  settings: {
    videoPreview: boolean;
    showTagCounts: boolean;
    banAnthro: boolean;
    onlyPony: boolean;
    useCdn: boolean;
    contentFilter: string;
    theme: string;
  };
  has_api_key: boolean;
}

const PER_PAGE = 12;

export default function UserProfilePage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tabValue, setTabValue] = useState(0);

  const [faveIds, setFaveIds] = useState<number[]>([]);
  const [faveImages, setFaveImages] = useState<PonyImage[]>([]);
  const [isFavesLoading, setIsFavesLoading] = useState(false);
  const [favesPage, setFavesPage] = useState(1);
  const [totalFavePages, setTotalFavePages] = useState(1);

  const [comments, setComments] = useState<UserComment[]>([]);
  const [isCommentsLoading, setIsCommentsLoading] = useState(false);
  const [commentsPage, setCommentsPage] = useState(1);
  const [totalCommentPages, setTotalCommentPages] = useState(1);

  const [posts, setPosts] = useState<UserPost[]>([]);
  const [isPostsLoading, setIsPostsLoading] = useState(false);
  const [postsPage, setPostsPage] = useState(1);
  const [totalPostPages, setTotalPostPages] = useState(1);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);

    if (id) {
      api.getUserProfile(id)
        .then((res) => {
          if (isMounted) {
            if (res.success && res.user) {
              setProfile(res.user);
            } else {
              setError(res.message || '获取用户资料失败');
            }
            setIsLoading(false);
          }
        })
        .catch((err) => {
          if (isMounted) {
            setError(err.message || '获取用户资料失败');
            setIsLoading(false);
          }
        });
    }

    return () => {
      isMounted = false;
    };
  }, [id]);

  useEffect(() => {
    if (!profile) return;

    let isMounted = true;
    setIsFavesLoading(true);

    api.getSharedFaves(profile.username)
      .then((res) => {
        if (isMounted && res.success) {
          setFaveIds(res.faves);
          setTotalFavePages(Math.max(1, Math.ceil(res.faves.length / PER_PAGE)));
          setFavesPage(1);
        }
      })
      .catch((err) => {
        console.error('获取收藏夹失败', err);
      })
      .finally(() => {
        if (isMounted) {
          setIsFavesLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [profile]);

  useEffect(() => {
    if (faveIds.length === 0) return;

    let isMounted = true;
    setIsFavesLoading(true);

    api.searchImagesByIds(faveIds, favesPage, PER_PAGE)
      .then((res) => {
        if (isMounted) {
          setFaveImages(res.images || []);
        }
      })
      .catch((err) => {
        console.error('获取收藏图片失败', err);
        if (isMounted) {
          setFaveImages([]);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsFavesLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [faveIds, favesPage]);

  useEffect(() => {
    if (!profile || tabValue !== 1) return;

    let isMounted = true;
    setIsPostsLoading(true);

    api.getUserPosts(id, postsPage)
      .then((res) => {
        if (isMounted) {
          if (res.success) {
            setPosts(res.posts || []);
            setTotalPostPages(res.total_pages || 1);
          } else {
            setPosts([]);
            setTotalPostPages(1);
          }
        }
      })
      .catch((err) => {
        console.error('获取用户帖子失败', err);
        if (isMounted) {
          setPosts([]);
          setTotalPostPages(1);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsPostsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [profile, id, tabValue, postsPage]);

  useEffect(() => {
    if (!profile || tabValue !== 2) return;

    let isMounted = true;
    setIsCommentsLoading(true);

    api.getUserComments(id, commentsPage)
      .then((res) => {
        if (isMounted) {
          if (res.success) {
            setComments(res.comments || []);
            setTotalCommentPages(res.total_pages || 1);
          } else {
            setComments([]);
            setTotalCommentPages(1);
          }
        }
      })
      .catch((err) => {
        console.error('获取用户评论失败', err);
        if (isMounted) {
          setComments([]);
          setTotalCommentPages(1);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsCommentsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [profile, id, tabValue, commentsPage]);

  const getCommentTargetLink = (comment: UserComment): string => {
    if (comment.type === 'post') {
      return `/forum/${comment.target_id}`;
    }
    return `/pic/${comment.target_id}`;
  };

  const getCommentTypeLabel = (type: 'post' | 'image'): { label: string; icon: React.ReactNode } => {
    if (type === 'post') {
      return { label: '论坛帖子', icon: <MdForum size={16} /> };
    }
    return { label: '图片', icon: <MdImage size={16} /> };
  };

  if (isLoading) {
    return (
      <div className="animate-pulse bg-white dark:bg-slate-950 min-h-screen">
        <div className="bg-slate-200 dark:bg-slate-700 h-48 sm:h-64 md:h-80 w-full rounded-2xl sm:rounded-3xl mt-4 sm:mt-6 mx-auto max-w-[96%] sm:max-w-[98%]"></div>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <div className="pb-8 relative pt-12 sm:pt-16">
            <div className="absolute -top-12 sm:-top-16 left-0 w-24 h-24 sm:w-32 sm:h-32 bg-slate-300 dark:bg-slate-600 rounded-full border-4 border-white dark:border-slate-800"></div>
            <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded w-1/3 mb-4 mt-2 sm:mt-4"></div>
            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/4 mb-6"></div>
            <div className="space-y-4">
              <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-full"></div>
              <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-5/6"></div>
              <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-4/6"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-4">加载失败</h2>
        <p className="text-slate-600 dark:text-slate-400 mb-6">{error || '用户可能不存在'}</p>
        <button
          onClick={() => router.back()}
          className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
        >
          返回上一页
        </button>
      </div>
    );
  }

  const roleColors: Record<string, string> = {
    admin: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800',
    moderator: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800',
    user: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700',
  };

  const getRoleBadge = (role: string) => {
    const defaultColor = 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700';
    const colorClass = roleColors[role.toLowerCase()] || defaultColor;
    const displayRole = role.charAt(0).toUpperCase() + role.slice(1);

    return (
      <span className={`px-2 py-1 text-xs font-semibold rounded-md border ${colorClass}`}>
        {displayRole}
      </span>
    );
  };

  return (
    <div className="animate-fade-in bg-white dark:bg-slate-950 min-h-screen">
      <div className="h-48 sm:h-64 md:h-80 relative bg-slate-100 dark:bg-slate-800 rounded-2xl sm:rounded-3xl overflow-hidden mt-4 sm:mt-6 mx-auto max-w-[96%] sm:max-w-[98%]">
        {profile.banner ? (
          <img
            src={`https://picpony.top/${profile.banner}`}
            alt={`${profile.username}'s banner`}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-r from-primary/20 to-primary/40 flex items-center justify-center">
            <MdPerson size={64} className="text-white/50" />
          </div>
        )}
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 relative">
        <div className="pb-8 relative pt-12 sm:pt-16">
          <div className="absolute -top-12 sm:-top-16 left-0">
            <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-full border-4 border-white dark:border-slate-800 overflow-hidden bg-white dark:bg-slate-800">
              {profile.avatar ? (
                <img
                  src={`https://picpony.top/${profile.avatar}`}
                  alt={`${profile.username}'s avatar`}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-primary/10 flex items-center justify-center">
                  <span className="text-3xl sm:text-4xl text-primary font-bold">
                    {profile.username.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6 mt-2 sm:mt-4">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-2xl sm:text-3xl font-bold text-slate-800 dark:text-slate-100 break-all">
                  {profile.username}
                </h1>
                {getRoleBadge(profile.role)}
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-500 dark:text-slate-400 mt-3">
                {profile.gender && profile.gender !== '保密' && (
                  <div className="flex items-center gap-1.5">
                    <MdPerson size={18} />
                    <span>{profile.gender}</span>
                  </div>
                )}
                {profile.birthday && (
                  <div className="flex items-center gap-1.5">
                    <MdCake size={18} />
                    <span>{profile.birthday}</span>
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <MdInfoOutline size={18} />
                  <span>
                    {profile.bio ? (
                      <p className="text-slate-400 dark:text-slate-500 whitespace-pre-wrap leading-relaxed text-sm sm:text-base">
                        {profile.bio}
                      </p>
                    ) : (
                      <p className="text-slate-400 dark:text-slate-500 italic text-sm">滚木</p>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <MdAccessTime size={18} />
                  <span>加入于 {new Date(profile.created_at).toLocaleDateString('zh-CN')}</span>
                </div>
              </div>
            </div>
          </div>

          {(profile.derpi_username || profile.derpi_user_id) && (
            <div className="mb-8">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-3 flex items-center gap-2 border-b border-slate-100 dark:border-slate-700 pb-2">
                连接的账号
              </h3>
              <div className="flex flex-wrap gap-4">
                <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3 flex flex-col gap-1 min-w-[200px]">
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Derpibooru</span>
                  {profile.derpi_username ? (
                    <span className="text-slate-800 dark:text-slate-200 font-medium">{profile.derpi_username}</span>
                  ) : (
                    <span className="text-slate-800 dark:text-slate-200 font-medium">ID: {profile.derpi_user_id}</span>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="border-b border-slate-200 dark:border-slate-700 mb-4">
            <div className="flex gap-0">
              {[
                { label: '收藏', value: 0 },
                { label: '帖子', value: 1 },
                { label: '评论', value: 2 },
              ].map(tab => (
                <button
                  key={tab.value}
                  onClick={() => setTabValue(tab.value)}
                  className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
                    tabValue === tab.value
                      ? 'text-primary'
                      : 'text-[var(--sidebar-text)] hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                  {tabValue === tab.value && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {tabValue === 0 && (
            <div>
              {isFavesLoading && faveImages.length === 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="aspect-square bg-slate-200 dark:bg-slate-700 rounded-lg animate-pulse" />
                  ))}
                </div>
              ) : faveImages.length > 0 ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {faveImages.map((img) => (
                      <Link
                        key={img.id}
                        href={`/pic/${img.id}`}
                        className="block relative aspect-square rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800 hover:ring-2 hover:ring-primary transition-all duration-200"
                      >
                        <FadeInImage
                          src={img.representations.thumb_small || img.representations.thumb || img.representations.small}
                          alt={img.name || `Image #${img.id}`}
                          fill
                          className="object-cover"
                          sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, 25vw"
                        />
                      </Link>
                    ))}
                  </div>
                  {totalFavePages > 1 && (
                    <div className="flex justify-center items-center gap-2 mt-8 mb-4">
                      <button
                        onClick={() => { setFavesPage(1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                        disabled={favesPage === 1}
                        className="px-3 py-2 rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        首页
                      </button>
                      <button
                        onClick={() => { setFavesPage(p => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                        disabled={favesPage === 1}
                        className="px-3 py-2 rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        上一页
                      </button>
                      <span className="px-3 py-2 text-sm text-slate-600 dark:text-slate-300">
                        {favesPage} / {totalFavePages}
                      </span>
                      <button
                        onClick={() => { setFavesPage(p => Math.min(totalFavePages, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                        disabled={favesPage === totalFavePages}
                        className="px-3 py-2 rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        下一页
                      </button>
                      <button
                        onClick={() => { setFavesPage(totalFavePages); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                        disabled={favesPage === totalFavePages}
                        className="px-3 py-2 rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        末页
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-16">
                  <MdFavorite size={48} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
                  <p className="text-slate-500 dark:text-slate-400 text-lg">暂无收藏</p>
                  <p className="text-slate-400 dark:text-slate-500 text-sm mt-1">该用户还没有添加任何收藏</p>
                </div>
              )}
            </div>
          )}

          {tabValue === 1 && (
            <div>
              {isPostsLoading ? (
                <div className="space-y-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 animate-pulse">
                      <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/4 mb-3"></div>
                      <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-full mb-2"></div>
                      <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-3/4"></div>
                    </div>
                  ))}
                </div>
              ) : posts.length > 0 ? (
                <>
                  <div className="space-y-3">
                    {posts.map((post) => (
                      <Link
                        key={post.id}
                        href={`/forum/${post.id}`}
                        className="block bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      >
                        <div className="flex items-start gap-3">
                          {post.cover_image && (
                            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg overflow-hidden bg-slate-200 dark:bg-slate-700 flex-shrink-0">
                              <img
                                src={`https://picpony.top/${post.cover_image}`}
                                alt=""
                                className="w-full h-full object-cover"
                              />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200 mb-1.5 line-clamp-2">
                              {post.title}
                            </h3>
                            <div className="flex items-center gap-4 text-xs text-slate-400 dark:text-slate-500">
                              <span>
                                {new Date(post.created_at).toLocaleString('zh-CN', {
                                  year: 'numeric',
                                  month: '2-digit',
                                  day: '2-digit',
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}
                              </span>
                              <span className="flex items-center gap-1">
                                <MdChatBubbleOutline size={14} />
                                {post.reply_count}
                              </span>
                              <span className="flex items-center gap-1">
                                <MdFavorite size={14} />
                                {post.like_count}
                              </span>
                            </div>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                  {totalPostPages > 1 && (
                    <div className="flex justify-center items-center gap-2 mt-8 mb-4">
                      <button
                        onClick={() => { setPostsPage(1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                        disabled={postsPage === 1}
                        className="px-3 py-2 rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        首页
                      </button>
                      <button
                        onClick={() => { setPostsPage(p => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                        disabled={postsPage === 1}
                        className="px-3 py-2 rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        上一页
                      </button>
                      <span className="px-3 py-2 text-sm text-slate-600 dark:text-slate-300">
                        {postsPage} / {totalPostPages}
                      </span>
                      <button
                        onClick={() => { setPostsPage(p => Math.min(totalPostPages, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                        disabled={postsPage === totalPostPages}
                        className="px-3 py-2 rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        下一页
                      </button>
                      <button
                        onClick={() => { setPostsPage(totalPostPages); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                        disabled={postsPage === totalPostPages}
                        className="px-3 py-2 rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        末页
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-16">
                  <MdArticle size={48} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
                  <p className="text-slate-500 dark:text-slate-400 text-lg">暂无帖子</p>
                  <p className="text-slate-400 dark:text-slate-500 text-sm mt-1">该用户还没有发表过任何帖子</p>
                </div>
              )}
            </div>
          )}

          {tabValue === 2 && (
            <div>
              {isCommentsLoading ? (
                <div className="space-y-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 animate-pulse">
                      <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/4 mb-3"></div>
                      <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-full mb-2"></div>
                      <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-3/4"></div>
                    </div>
                  ))}
                </div>
              ) : comments.length > 0 ? (
                <>
                  <div className="space-y-3">
                    {comments.map((comment, index) => {
                      const typeInfo = getCommentTypeLabel(comment.type);
                      return (
                        <Link
                          key={`${comment.type}-${comment.id}-${index}`}
                          href={getCommentTargetLink(comment)}
                          className="block bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        >
                          <div className="flex items-start gap-3">
                            {comment.cover_image && (
                              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg overflow-hidden bg-slate-200 dark:bg-slate-700 flex-shrink-0">
                                <img
                                  src={`https://picpony.top/${comment.cover_image}`}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1.5">
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                                  {typeInfo.icon}
                                  {typeInfo.label}
                                </span>
                                <span className="text-xs text-slate-400 dark:text-slate-500">
                                  {new Date(comment.created_at).toLocaleString('zh-CN', {
                                    year: 'numeric',
                                    month: '2-digit',
                                    day: '2-digit',
                                    hour: '2-digit',
                                    minute: '2-digit'
                                  })}
                                </span>
                              </div>
                              <div className="text-sm text-slate-700 dark:text-slate-300 line-clamp-3 leading-relaxed">
                                <RichTextRenderer content={comment.body} />
                              </div>
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                  {totalCommentPages > 1 && (
                    <div className="flex justify-center items-center gap-2 mt-8 mb-4">
                      <button
                        onClick={() => { setCommentsPage(1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                        disabled={commentsPage === 1}
                        className="px-3 py-2 rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        首页
                      </button>
                      <button
                        onClick={() => { setCommentsPage(p => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                        disabled={commentsPage === 1}
                        className="px-3 py-2 rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        上一页
                      </button>
                      <span className="px-3 py-2 text-sm text-slate-600 dark:text-slate-300">
                        {commentsPage} / {totalCommentPages}
                      </span>
                      <button
                        onClick={() => { setCommentsPage(p => Math.min(totalCommentPages, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                        disabled={commentsPage === totalCommentPages}
                        className="px-3 py-2 rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        下一页
                      </button>
                      <button
                        onClick={() => { setCommentsPage(totalCommentPages); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                        disabled={commentsPage === totalCommentPages}
                        className="px-3 py-2 rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        末页
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-16">
                  <MdChatBubbleOutline size={48} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
                  <p className="text-slate-500 dark:text-slate-400 text-lg">暂无评论</p>
                  <p className="text-slate-400 dark:text-slate-500 text-sm mt-1">该用户还没有发表过任何评论</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
