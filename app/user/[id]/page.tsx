'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, PonyImage, UserComment, UserPost } from '@/lib/api';
import FadeInImage from '@/components/FadeInImage';
import RichTextRenderer from '@/components/RichTextRenderer';
import { MdPerson, MdCake, MdAccessTime, MdInfoOutline, MdFavorite, MdChatBubbleOutline, MdForum, MdImage, MdArticle, MdSearch, MdMessage, MdVerified, MdCloudUpload } from 'react-icons/md';

type ProfileTab = 'uploads' | 'faves' | 'posts' | 'comments';

interface BadgeItem {
  badge_name: string;
  badge_color: string;
}

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
  experience?: number;
  equipped_badges?: BadgeItem[] | string;
  last_online?: string;
  has_api_key: boolean;
  settings: {
    videoPreview: boolean;
    showTagCounts: boolean;
    banAnthro: boolean;
    onlyPony: boolean;
    useCdn: boolean;
    contentFilter: string;
    theme: string;
  };
}

interface UploadItem {
  id: number;
  name: string;
  representations: PonyImage['representations'];
  view_url: string;
  width: number;
  height: number;
}

const PER_PAGE = 12;

function formatLastOnline(lastOnline: string): string {
  const lastTime = new Date(lastOnline.replace(/-/g, '/')).getTime();
  const now = Date.now();
  const diffMs = now - lastTime;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return '在线';
  if (diffMins < 5) return '刚刚';
  if (diffMins < 60) return `${diffMins}分钟前`;
  if (diffHours < 24) {
    const remainMins = diffMins % 60;
    return `${diffHours}小时${remainMins}分前`;
  }
  if (diffDays <= 5) {
    const remainHours = diffHours % 24;
    return `${diffDays}天${remainHours}小时前`;
  }
  if (diffDays <= 30) return `${diffDays}天前`;
  return lastOnline.split(' ')[0];
}

function getRoleLabel(role: string): string {
  const roleMap: Record<string, string> = {
    super_admin: '创始人',
    admin: '管理员',
    editor: '小编',
  };
  return roleMap[role.toLowerCase()] || '普通用户';
}

export default function UserProfilePage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);

  const [tabValue, setTabValue] = useState<ProfileTab>('uploads');

  const [faveIds, setFaveIds] = useState<number[]>([]);
  const [faveImages, setFaveImages] = useState<PonyImage[]>([]);
  const [isFavesLoading, setIsFavesLoading] = useState(true);
  const [favesPage, setFavesPage] = useState(1);
  const [totalFavePages, setTotalFavePages] = useState(1);

  const [comments, setComments] = useState<UserComment[]>([]);
  const [isCommentsLoading, setIsCommentsLoading] = useState(true);
  const [commentsPage, setCommentsPage] = useState(1);
  const [totalCommentPages, setTotalCommentPages] = useState(1);

  const [posts, setPosts] = useState<UserPost[]>([]);
  const [isPostsLoading, setIsPostsLoading] = useState(true);
  const [postsPage, setPostsPage] = useState(1);
  const [totalPostPages, setTotalPostPages] = useState(1);

  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [isUploadsLoading, setIsUploadsLoading] = useState(true);
  const [uploadsPage, setUploadsPage] = useState(1);
  const [totalUploadPages, setTotalUploadPages] = useState(1);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('user_info');
      if (stored) {
        const user = JSON.parse(stored);
        setCurrentUserId(user.id);
      }
    } catch {}
  }, []);

  useEffect(() => {
    let isMounted = true;
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
    return () => { isMounted = false; };
  }, [id]);

  useEffect(() => {
    if (!profile) return;
    let isMounted = true;
    api.getSharedFaves(profile.username)
      .then((res) => {
        if (isMounted && res.success) {
          setFaveIds(res.faves);
          setTotalFavePages(Math.max(1, Math.ceil(res.faves.length / PER_PAGE)));
          setFavesPage(1);
        }
      })
      .catch(() => { if (isMounted) setIsFavesLoading(false); });
    return () => { isMounted = false; };
  }, [profile]);

  useEffect(() => {
    if (faveIds.length === 0) return;
    let isMounted = true;
    api.searchImagesByIds(faveIds, favesPage, PER_PAGE)
      .then((res) => { if (isMounted) setFaveImages(res.images || []); })
      .catch(() => { if (isMounted) setFaveImages([]); })
      .finally(() => { if (isMounted) setIsFavesLoading(false); });
    return () => { isMounted = false; };
  }, [faveIds, favesPage]);

  useEffect(() => {
    if (!profile || tabValue !== 'posts') return;
    let isMounted = true;
    api.getUserPosts(id, postsPage)
      .then((res) => {
        if (isMounted) {
          setPosts(res.posts || []);
          setTotalPostPages(res.total_pages || 1);
        }
      })
      .catch(() => { if (isMounted) { setPosts([]); setTotalPostPages(1); } })
      .finally(() => { if (isMounted) setIsPostsLoading(false); });
    return () => { isMounted = false; };
  }, [profile, id, tabValue, postsPage]);

  useEffect(() => {
    if (!profile || tabValue !== 'comments') return;
    let isMounted = true;
    api.getUserComments(id, commentsPage)
      .then((res) => {
        if (isMounted) {
          setComments(res.comments || []);
          setTotalCommentPages(res.total_pages || 1);
        }
      })
      .catch(() => { if (isMounted) { setComments([]); setTotalCommentPages(1); } })
      .finally(() => { if (isMounted) setIsCommentsLoading(false); });
    return () => { isMounted = false; };
  }, [profile, id, tabValue, commentsPage]);

  useEffect(() => {
    if (!profile || tabValue !== 'uploads') return;
    let isMounted = true;

    const fetchUploads = async () => {
      try {
        const storedUser = localStorage.getItem('user_info');
        const token = storedUser ? JSON.parse(storedUser).token : null;

        const res = await fetch(
          `https://picpony.top/api.php?action=get_user_uploads&user_id=${id}&page=${uploadsPage}&per_page=${PER_PAGE}${token ? `&token=${encodeURIComponent(token)}` : ''}`
        );
        const data = await res.json();
        if (isMounted) {
          if (data.success) {
            setUploads(data.uploads || []);
            setTotalUploadPages(Math.max(1, data.total_pages || 1));
          } else {
            setUploads([]);
          }
        }
      } catch {
        if (isMounted) setUploads([]);
      } finally {
        if (isMounted) setIsUploadsLoading(false);
      }
    };

    fetchUploads();
    return () => { isMounted = false; };
  }, [profile, id, tabValue, uploadsPage]);

  const getCommentTargetLink = (comment: UserComment): string => {
    return comment.type === 'post' ? `/forum/${comment.target_id}` : `/pic/${comment.target_id}`;
  };

  const getCommentTypeLabel = (type: 'post' | 'image'): { label: string; icon: React.ReactNode } => {
    if (type === 'post') return { label: '论坛帖子', icon: <MdForum size={16} /> };
    return { label: '图片', icon: <MdImage size={16} /> };
  };

  const isOwnProfile = currentUserId !== null && profile && currentUserId === profile.id;

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

  const level = profile.experience !== undefined ? Math.floor((profile.experience || 0) / 100) + 1 : null;
  const xpInLevel = profile.experience !== undefined ? (profile.experience || 0) % 100 : 0;
  const xpProgress = profile.experience !== undefined ? xpInLevel / 100 : 0;

  let badges: BadgeItem[] = [];
  if (profile.equipped_badges) {
    try {
      badges = typeof profile.equipped_badges === 'string' ? JSON.parse(profile.equipped_badges) : profile.equipped_badges;
    } catch {}
  }

  const navTabs: { key: ProfileTab; label: string }[] = [
    { key: 'uploads', label: '上传记录' },
    { key: 'faves', label: '收藏夹' },
    { key: 'posts', label: '发布的帖子' },
    { key: 'comments', label: '历史评论' },
  ];

  return (
    <div className="animate-fade-in bg-white dark:bg-slate-950 min-h-screen">
      <div className="h-48 sm:h-64 md:h-80 relative bg-slate-100 dark:bg-slate-800 rounded-2xl sm:rounded-3xl overflow-hidden mt-4 sm:mt-6 mx-auto max-w-[96%] sm:max-w-[98%]">
        {profile.banner ? (
          <FadeInImage
            src={`https://picpony.top/${profile.banner}`}
            alt={`${profile.username}'s banner`}
            fill
            className="object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-r from-primary/20 to-primary/40 flex items-center justify-center">
            <MdPerson size={64} className="text-white/50" />
          </div>
        )}

        {level !== null && (
          <div className="absolute bottom-3 left-0 bg-black/60 text-amber-400 px-2 py-1 rounded-r-lg text-xs font-bold backdrop-blur-sm border border-amber-400/30 border-l-0 shadow-lg">
            Lv.{level}
          </div>
        )}

        {profile.experience !== undefined && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/30">
            <div
              className="h-full bg-amber-400 transition-width duration-300"
              style={{ width: `${xpProgress * 100}%` }}
            />
          </div>
        )}
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 relative">
        <div className="pb-8 relative pt-12 sm:pt-16">
          <div className="absolute -top-12 sm:-top-16 left-0">
            <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-full border-4 border-white dark:border-slate-800 overflow-hidden bg-white dark:bg-slate-800 shadow-lg">
              {profile.avatar ? (
                <FadeInImage
                  src={`https://picpony.top/${profile.avatar}`}
                  alt={`${profile.username}'s avatar`}
                  fill
                  className="object-cover"
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
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-1 flex-wrap">
                <h1 className="text-2xl sm:text-3xl font-bold text-slate-800 dark:text-slate-100 break-all">
                  {profile.username}
                </h1>
                <span className={`px-2 py-1 text-xs font-semibold rounded-md border ${
                  profile.role === 'super_admin' || profile.role === 'admin'
                    ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800'
                    : profile.role === 'editor'
                    ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                }`}>
                  {getRoleLabel(profile.role)}
                </span>
                {profile.has_api_key && profile.derpi_username && (
                  <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded-md border border-green-200 dark:border-green-800">
                    <MdVerified size={12} />
                    已核验
                  </span>
                )}
              </div>

              {badges.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {badges.map((b, i) => (
                    <span
                      key={i}
                      className="inline-block px-2 py-0.5 rounded-full text-xs font-bold text-white"
                      style={{ backgroundColor: b.badge_color }}
                    >
                      {b.badge_name}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-500 dark:text-slate-400 mt-4">
                {profile.gender && profile.gender !== '保密' && (
                  <span className="flex items-center gap-1.5">
                    <MdPerson size={18} />
                    {profile.gender}
                  </span>
                )}
                {profile.birthday && (
                  <span className="flex items-center gap-1.5">
                    <MdCake size={18} />
                    {profile.birthday}
                  </span>
                )}
                <span className="flex items-center gap-1.5">
                  <MdAccessTime size={18} />
                  注册于 {new Date(profile.created_at).toLocaleDateString('zh-CN')}
                </span>
                {profile.last_online && (
                  <span className="flex items-center gap-1.5 text-slate-400 dark:text-slate-500">
                    <MdAccessTime size={18} />
                    上次在线：{formatLastOnline(profile.last_online)}
                  </span>
                )}
              </div>

              <div className="mt-4">
                {profile.bio ? (
                  <p className="text-slate-600 dark:text-slate-400 whitespace-pre-wrap leading-relaxed text-sm">
                    {profile.bio}
                  </p>
                ) : (
                  <p className="text-slate-400 dark:text-slate-500 italic text-sm">该用户很懒，什么都没有留下。</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 mt-2 sm:mt-0">
              {!isOwnProfile && currentUserId !== null && (
                <Link
                  href={`/messages?to=${profile.id}`}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors text-sm font-medium"
                >
                  <MdMessage size={16} />
                  发送私信
                </Link>
              )}
            </div>
          </div>

          {profile.derpi_username ? (
            <div className="mb-8">
              <div
                className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-4 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                onClick={() => {
                  if (profile.derpi_user_id) {
                    window.open(`https://derpibooru.org/profiles/${profile.derpi_user_id}`, '_blank');
                  } else {
                    window.open(`https://derpibooru.org/profiles/${profile.derpi_username}`, '_blank');
                  }
                }}
                title="点击查看 Derpibooru 个人主页"
              >
                <div className="flex items-center gap-2 mb-2">
                  <MdCloudUpload size={16} className="text-primary" />
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Derpibooru 账户</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full overflow-hidden bg-slate-200 dark:bg-slate-700 flex-shrink-0">
                    <img
                      src={`https://derpicdn.net/img/${profile.derpi_user_id}/avatar.png`}
                      alt=""
                      className="w-full h-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-slate-800 dark:text-slate-200 text-sm truncate">
                      {profile.has_api_key ? profile.derpi_username : '该用户暂未核验账户'}
                    </div>
                    <div className="text-xs text-slate-400 dark:text-slate-500">
                      {profile.has_api_key ? '点击查看 Derpibooru 个人主页' : '请在设置中绑定 API Key 以核验身份'}
                    </div>
                  </div>
                  <MdSearch size={18} className="text-slate-400 shrink-0" />
                </div>
              </div>
            </div>
          ) : null}

          {profile.derpi_username && (
            <div className="mb-6">
              <a
                href={`https://derpibooru.org/search?q=uploader:${encodeURIComponent(profile.derpi_username)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-primary bg-primary/5 rounded-lg hover:bg-primary/10 transition-colors"
              >
                <MdSearch size={16} />
                搜索 TA 在 Derpibooru 的所有作品
              </a>
            </div>
          )}

          <div className="border-b border-slate-200 dark:border-slate-700 mb-6">
            <div className="flex gap-0 overflow-x-auto">
              {navTabs.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setTabValue(tab.key)}
                  className={`px-4 py-2.5 text-sm font-medium transition-colors relative whitespace-nowrap ${
                    tabValue === tab.key
                      ? 'text-primary'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                  {tabValue === tab.key && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {tabValue === 'uploads' && (
            <div>
              {isUploadsLoading ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="aspect-square bg-slate-200 dark:bg-slate-700 rounded-lg animate-pulse" />
                  ))}
                </div>
              ) : uploads.length > 0 ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {uploads.map((item) => (
                      <Link
                        key={item.id}
                        href={`/pic/${item.id}`}
                        className="block relative aspect-square rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800 hover:ring-2 hover:ring-primary transition-all duration-200 group"
                      >
                        <FadeInImage
                          src={item.representations?.thumb_small || item.representations?.small || item.view_url}
                          alt={item.name || `Upload #${item.id}`}
                          fill
                          className="object-cover"
                        />
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <p className="text-white text-xs truncate">{item.name || `#${item.id}`}</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                  {totalUploadPages > 1 && (
                    <div className="flex justify-center items-center gap-2 mt-8 mb-4">
                      <button
                        onClick={() => { setIsUploadsLoading(true); setUploadsPage(1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                        disabled={uploadsPage === 1}
                        className="px-3 py-2 rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        首页
                      </button>
                      <button
                        onClick={() => { setIsUploadsLoading(true); setUploadsPage(p => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                        disabled={uploadsPage === 1}
                        className="px-3 py-2 rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        上一页
                      </button>
                      <span className="px-3 py-2 text-sm text-slate-600 dark:text-slate-300">
                        {uploadsPage} / {totalUploadPages}
                      </span>
                      <button
                        onClick={() => { setIsUploadsLoading(true); setUploadsPage(p => Math.min(totalUploadPages, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                        disabled={uploadsPage === totalUploadPages}
                        className="px-3 py-2 rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        下一页
                      </button>
                      <button
                        onClick={() => { setIsUploadsLoading(true); setUploadsPage(totalUploadPages); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                        disabled={uploadsPage === totalUploadPages}
                        className="px-3 py-2 rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        末页
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-16">
                  <MdCloudUpload size={48} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
                  <p className="text-slate-500 dark:text-slate-400 text-lg">暂无上传记录</p>
                  <p className="text-slate-400 dark:text-slate-500 text-sm mt-1">该用户还没有上传过任何作品</p>
                </div>
              )}
            </div>
          )}

          {tabValue === 'faves' && (
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
                      <button onClick={() => { setIsFavesLoading(true); setFavesPage(1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                        disabled={favesPage === 1}
                        className="px-3 py-2 rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">首页</button>
                      <button onClick={() => { setIsFavesLoading(true); setFavesPage(p => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                        disabled={favesPage === 1}
                        className="px-3 py-2 rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">上一页</button>
                      <span className="px-3 py-2 text-sm text-slate-600 dark:text-slate-300">{favesPage} / {totalFavePages}</span>
                      <button onClick={() => { setIsFavesLoading(true); setFavesPage(p => Math.min(totalFavePages, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                        disabled={favesPage === totalFavePages}
                        className="px-3 py-2 rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">下一页</button>
                      <button onClick={() => { setIsFavesLoading(true); setFavesPage(totalFavePages); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                        disabled={favesPage === totalFavePages}
                        className="px-3 py-2 rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">末页</button>
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

          {tabValue === 'posts' && (
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
                          {post.cover_image ? (
                            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg overflow-hidden bg-slate-200 dark:bg-slate-700 flex-shrink-0">
                              <FadeInImage src={`https://picpony.top/${post.cover_image}`} alt="" fill className="object-cover" />
                            </div>
                          ) : null}
                          <div className="flex-1 min-w-0">
                            <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200 mb-1.5 line-clamp-2">
                              {post.title}
                            </h3>
                            <div className="flex items-center gap-4 text-xs text-slate-400 dark:text-slate-500">
                              <span>{new Date(post.created_at).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                              <span className="flex items-center gap-1"><MdChatBubbleOutline size={14} />{post.reply_count}</span>
                              <span className="flex items-center gap-1"><MdFavorite size={14} />{post.like_count}</span>
                            </div>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                  {totalPostPages > 1 && (
                    <div className="flex justify-center items-center gap-2 mt-8 mb-4">
                      <button onClick={() => { setIsPostsLoading(true); setPostsPage(1); window.scrollTo({ top: 0, behavior: 'smooth' }); }} disabled={postsPage === 1}
                        className="px-3 py-2 rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">首页</button>
                      <button onClick={() => { setIsPostsLoading(true); setPostsPage(p => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }} disabled={postsPage === 1}
                        className="px-3 py-2 rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">上一页</button>
                      <span className="px-3 py-2 text-sm text-slate-600 dark:text-slate-300">{postsPage} / {totalPostPages}</span>
                      <button onClick={() => { setIsPostsLoading(true); setPostsPage(p => Math.min(totalPostPages, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }} disabled={postsPage === totalPostPages}
                        className="px-3 py-2 rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">下一页</button>
                      <button onClick={() => { setIsPostsLoading(true); setPostsPage(totalPostPages); window.scrollTo({ top: 0, behavior: 'smooth' }); }} disabled={postsPage === totalPostPages}
                        className="px-3 py-2 rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">末页</button>
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

          {tabValue === 'comments' && (
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
                            {comment.cover_image ? (
                              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg overflow-hidden bg-slate-200 dark:bg-slate-700 flex-shrink-0">
                                <FadeInImage src={`https://picpony.top/${comment.cover_image}`} alt="" fill className="object-cover" />
                              </div>
                            ) : null}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1.5">
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                                  {typeInfo.icon}
                                  {typeInfo.label}
                                </span>
                                <span className="text-xs text-slate-400 dark:text-slate-500">
                                  {new Date(comment.created_at).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
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
                      <button onClick={() => { setIsCommentsLoading(true); setCommentsPage(1); window.scrollTo({ top: 0, behavior: 'smooth' }); }} disabled={commentsPage === 1}
                        className="px-3 py-2 rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">首页</button>
                      <button onClick={() => { setIsCommentsLoading(true); setCommentsPage(p => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }} disabled={commentsPage === 1}
                        className="px-3 py-2 rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">上一页</button>
                      <span className="px-3 py-2 text-sm text-slate-600 dark:text-slate-300">{commentsPage} / {totalCommentPages}</span>
                      <button onClick={() => { setIsCommentsLoading(true); setCommentsPage(p => Math.min(totalCommentPages, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }} disabled={commentsPage === totalCommentPages}
                        className="px-3 py-2 rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">下一页</button>
                      <button onClick={() => { setIsCommentsLoading(true); setCommentsPage(totalCommentPages); window.scrollTo({ top: 0, behavior: 'smooth' }); }} disabled={commentsPage === totalCommentPages}
                        className="px-3 py-2 rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">末页</button>
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
