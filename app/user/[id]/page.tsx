'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { api, PonyImage, UserComment, UserPost } from '@/lib/api';
import FadeInImage from '@/components/FadeInImage';
import RichTextRenderer from '@/components/RichTextRenderer';
import Card from '@/components/Card';
import {
  MdPerson,
  MdCake,
  MdAccessTime,
  MdFavorite,
  MdChatBubbleOutline,
  MdForum,
  MdImage,
  MdArticle,
  MdSearch,
  MdOpenInNew,
  MdMessage,
  MdVerified,
  MdCloudUpload,
} from 'react-icons/md';
import UserBadge from '@/components/UserBadge';
import Avatar from '@/components/Avatar';
import Badge from '@/components/Badge';
import RoleBadge from '@/components/RoleBadge';
import Pagination from '@/components/Pagination';
import TabBar from '@/components/TabBar';
import PageBack from '@/components/PageBack';
import { useEscapeBack } from '@/lib/hooks';
import Skeleton from '@/components/Skeleton';
import TabPanes, { TabPane } from '@/components/TabPanes';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import { buttonClasses } from '@/components/Button';

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

export default function UserProfilePage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const stored = localStorage.getItem('user_info');
      if (stored) {
        const user = JSON.parse(stored);
        return user.id ?? null;
      }
    } catch {}
    return null;
  });

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
        queueMicrotask(() => setCurrentUserId(user.id));
      }
    } catch {}
  }, []);

  useEffect(() => {
    let isMounted = true;
    if (id) {
      api
        .getUserProfile(id)
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
    api
      .getSharedFaves(profile.username)
      .then((res) => {
        if (isMounted && res.success) {
          setFaveIds(res.faves);
          setTotalFavePages(Math.max(1, Math.ceil(res.faves.length / PER_PAGE)));
          setFavesPage(1);
        }
      })
      .catch(() => {
        if (isMounted) setIsFavesLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [profile]);

  useEffect(() => {
    if (faveIds.length === 0) return;
    let isMounted = true;
    api
      .searchImagesByIds(faveIds, favesPage, PER_PAGE)
      .then((res) => {
        if (isMounted) setFaveImages(res.images || []);
      })
      .catch(() => {
        if (isMounted) setFaveImages([]);
      })
      .finally(() => {
        if (isMounted) setIsFavesLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [faveIds, favesPage]);

  useEffect(() => {
    if (!profile || tabValue !== 'posts') return;
    let isMounted = true;
    api
      .getUserPosts(id, postsPage)
      .then((res) => {
        if (isMounted) {
          setPosts(res.posts || []);
          setTotalPostPages(res.total_pages || 1);
        }
      })
      .catch(() => {
        if (isMounted) {
          setPosts([]);
          setTotalPostPages(1);
        }
      })
      .finally(() => {
        if (isMounted) setIsPostsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [profile, id, tabValue, postsPage]);

  useEffect(() => {
    if (!profile || tabValue !== 'comments') return;
    let isMounted = true;
    api
      .getUserComments(id, commentsPage)
      .then((res) => {
        if (isMounted) {
          setComments(res.comments || []);
          setTotalCommentPages(res.total_pages || 1);
        }
      })
      .catch(() => {
        if (isMounted) {
          setComments([]);
          setTotalCommentPages(1);
        }
      })
      .finally(() => {
        if (isMounted) setIsCommentsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [profile, id, tabValue, commentsPage]);

  useEffect(() => {
    if (!profile || tabValue !== 'uploads') return;
    let isMounted = true;

    const fetchUploads = async () => {
      try {
        const storedUser = localStorage.getItem('user_info');
        const token = storedUser ? JSON.parse(storedUser).token : null;

        const res = await fetch(
          `https://picpony.top/api.php?action=get_user_uploads&user_id=${id}&page=${uploadsPage}&per_page=${PER_PAGE}${token ? `&token=${encodeURIComponent(token)}` : ''}`,
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
    return () => {
      isMounted = false;
    };
  }, [profile, id, tabValue, uploadsPage]);

  const getCommentTargetLink = (comment: UserComment): string => {
    return comment.type === 'post' ? `/forum/${comment.target_id}` : `/pic/${comment.target_id}`;
  };

  const getCommentTypeLabel = (
    type: 'post' | 'image',
  ): { label: string; icon: React.ReactNode } => {
    if (type === 'post') return { label: '论坛帖子', icon: <MdForum size={16} /> };
    return { label: '图片', icon: <MdImage size={16} /> };
  };

  const isOwnProfile = currentUserId !== null && profile && currentUserId === profile.id;

  /* Not a sidebar destination, so it carries the shared back affordance — see
     the rule in AGENTS.md. Drawn in all three states for the same reason the
     forum thread draws it in all three: an affordance that disappears when a
     request fails is worse than one that was never there. No `pt-14`, because
     what is at the top of this page is the banner, not text. */
  const handleBack = useCallback(() => router.back(), [router]);
  useEscapeBack(handleBack);

  if (isLoading) {
    return (
      <>
      <PageBack onClick={handleBack} title="返回 (Esc)" />
      <div className="bg-surface">
        <Skeleton className="h-48 sm:h-64 md:h-80 w-full rounded-2xl sm:rounded-3xl mt-4 sm:mt-6 mx-auto max-w-[96%] sm:max-w-[98%]" />
        <div className="max-w-5xl mx-auto relative">
          <div className="pb-8 relative pt-12 sm:pt-16">
            <Skeleton className="absolute -top-12 sm:-top-16 left-0 w-24 h-24 sm:w-32 sm:h-32 rounded-full border-4 border-surface" />
            <Skeleton className="h-8 w-1/3 mb-4 mt-2 sm:mt-4" />
            <Skeleton className="h-4 w-1/4 mb-6" />
            <div className="space-y-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-4/6" />
            </div>
          </div>
        </div>
      </div>
      </>
    );
  }

  if (error || !profile) {
    /* `ErrorRetry`, so a profile that fails to load looks like every other
       failure in the app — 48px glyph over `title-l` — instead of announcing
       itself in `headline-s`, which is the page-title role. */
    return (
      <>
        <PageBack onClick={handleBack} title="返回 (Esc)" />
        <ErrorRetry title="加载失败" message={error || '用户可能不存在'} />
      </>
    );
  }

  const level =
    profile.experience !== undefined ? Math.floor((profile.experience || 0) / 100) + 1 : null;
  const xpInLevel = profile.experience !== undefined ? (profile.experience || 0) % 100 : 0;
  const xpProgress = profile.experience !== undefined ? xpInLevel / 100 : 0;

  let badges: BadgeItem[] = [];
  if (profile.equipped_badges) {
    try {
      badges =
        typeof profile.equipped_badges === 'string'
          ? JSON.parse(profile.equipped_badges)
          : profile.equipped_badges;
    } catch {}
  }

  const navTabs: { value: ProfileTab; label: string }[] = [
    { value: 'uploads', label: '上传记录' },
    { value: 'faves', label: '收藏夹' },
    { value: 'posts', label: '发布的帖子' },
    { value: 'comments', label: '历史评论' },
  ];

  return (
    <>
      <PageBack onClick={handleBack} title="返回 (Esc)" />
      <div className="animate-fade-in bg-surface">
      <div className="h-48 sm:h-64 md:h-80 relative bg-surface-container-high rounded-2xl sm:rounded-3xl overflow-hidden mt-4 sm:mt-6 mx-auto max-w-full sm:max-w-[98%] px-2 sm:px-0">
        {profile.banner ? (
          <FadeInImage
            src={`https://picpony.top/${profile.banner}`}
            alt={`${profile.username}'s banner`}
            fill
            className="object-cover"
          />
        ) : (
          <div className="w-full h-full bg-surface-container-highest flex items-center justify-center">
            {' '}
            <MdPerson size={64} className="text-outline" />{' '}
          </div>
        )}{' '}
        {level !== null && (
          <div className="bg-media-plate text-warning-fill text-label-m-emphasized absolute bottom-3 left-0 rounded-r-lg px-2 py-1 backdrop-blur-sm">
            {' '}
            Lv.{level}{' '}
          </div>
        )}{' '}
        {profile.experience !== undefined && (
          <div className="bg-media-outline absolute inset-x-0 bottom-0 h-1">
            {' '}
            <div
              className="h-full bg-warning-fill transition-[width] duration-300 ease-[var(--ease-standard)]"
              style={{ width: `${xpProgress * 100}%` }}
            />{' '}
          </div>
        )}{' '}
      </div>{' '}
      <div className="max-w-5xl mx-auto relative">
        {' '}
        <div className="pb-8 relative pt-12 sm:pt-16">
          {' '}
          <div className="absolute -top-12 sm:-top-16 left-0">
            {' '}
            {/* `Avatar`, not a fourth hand-rolled copy of it. The URL was
                built inline as `https://picpony.top/${avatar}` rather than
                through `getAvatarUrl`, which is the rule that module exists to
                hold. */}
            <Avatar
              src={profile.avatar}
              name={profile.username}
              size="w-24 h-24 sm:w-32 sm:h-32"
              className="border-4 border-surface shadow-e3"
            />
          </div>
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6 mt-2 sm:mt-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-1 flex-wrap">
                <h1 className="text-headline-s sm:text-headline-m text-on-surface break-words">
                  {profile.username}
                </h1>
                {/* Three marks used to sit in this row in three shapes: the
                    role and 已核验 as `rounded-sm px-2 py-1 text-label-m`, and
                    the earned badges below as round `text-label-s-emphasized`
                    pills — so the header read square, square, round. `Badge`
                    owns the silhouette for all three now. */}
                <RoleBadge role={profile.role} showUser size="md" />
                {profile.has_api_key && profile.derpi_username && (
                  <Badge tone="success" size="md" icon={<MdVerified size={12} />}>
                    已核验
                  </Badge>
                )}
              </div>
              {badges.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {badges.map((b) => (
                    <UserBadge key={b.badge_name} name={b.badge_name} color={b.badge_color} />
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-body-m text-on-surface-variant mt-4">
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
                  注册于 {new Date(profile.created_at).toLocaleDateString('zh-CN')}{' '}
                </span>{' '}
                {profile.last_online && (
                  <span className="flex items-center gap-1.5 text-on-surface-variant">
                    {' '}
                    <MdAccessTime size={18} /> 上次在线：
                    {formatLastOnline(profile.last_online)}{' '}
                  </span>
                )}{' '}
              </div>{' '}
              <div className="mt-4">
                {' '}
                {profile.bio ? (
                  <p className="text-on-surface-variant whitespace-pre-wrap text-body-m">
                    {' '}
                    {profile.bio}{' '}
                  </p>
                ) : (
                  <p className="text-on-surface-variant italic text-body-m">该用户很懒，什么都没有留下。</p>
                )}{' '}
              </div>{' '}
            </div>{' '}
            <div className="flex items-center gap-2 shrink-0 mt-2 sm:mt-0">
              {' '}
              {!isOwnProfile && currentUserId !== null && (
                <Link
                  href={`/messages?to=${profile.id}`}
                  className={buttonClasses({ variant: 'filled' })}
                >
                  <MdMessage size={16} aria-hidden="true" /> 发送私信
                </Link>
              )}{' '}
            </div>{' '}
          </div>{' '}
          {profile.derpi_username ? (
            <div className="mb-8">
              {/* An anchor, not a click-handled container. The card opens an
                  external profile, so it is a link and always was: as a plain
                  div it could not be tabbed to, middle-clicked, copied, or
                  previewed in the status bar, and the `window.open` behind it is
                  what a popup blocker stops. The trailing glyph is `MdOpenInNew`
                  for the same reason — the magnifier promised a search this card
                  never performed. */}
              <a
                href={`https://derpibooru.org/profiles/${encodeURIComponent(
                  profile.derpi_user_id ? String(profile.derpi_user_id) : profile.derpi_username,
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="state-layer transition-ui block rounded-md border border-outline-variant bg-surface-container-low p-4 outline-none focus-visible:ring-2 focus-ring"
                title="在 Derpibooru 查看个人主页"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Image
                    src="/img/derpi.svg"
                    alt=""
                    width={16}
                    height={16}
                    aria-hidden="true"
                    className="shrink-0"
                  />
                  <span className="text-label-m-emphasized text-on-surface-variant">
                    Derpibooru 账户
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {/* `Avatar`, not a bare `<img>` whose `onError` set
                      `style.display = 'none'` — an imperative DOM edit React
                      does not know about, and one that left a blank circle
                      rather than a fallback. */}
                  <Avatar
                    src={
                      profile.derpi_user_id
                        ? `https://derpicdn.net/img/${profile.derpi_user_id}/avatar.png`
                        : undefined
                    }
                    name={profile.derpi_username}
                    size="w-10 h-10"
                    className="shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-on-surface text-label-l truncate">
                      {profile.has_api_key ? profile.derpi_username : '该用户暂未核验账户'}
                    </div>
                    <div className="text-body-s text-on-surface-variant">
                      {profile.has_api_key
                        ? '在 Derpibooru 查看个人主页'
                        : '请在设置中绑定 API Key 以核验身份'}
                    </div>
                  </div>
                  <MdOpenInNew size={18} className="text-outline shrink-0" />
                </div>
              </a>
            </div>
          ) : null}
          {profile.derpi_username && (
            <div className="mb-6">
              <a
                href={`https://derpibooru.org/search?q=uploader:${encodeURIComponent(profile.derpi_username)}`}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClasses({
                  variant: 'text',
                  size: 'sm',
                  className: 'text-primary',
                })}
              >
                <MdSearch size={16} />
                搜索 TA 在 Derpibooru 的所有作品
              </a>
            </div>
          )}
          {/* The anchor is here rather than at the top of the page: turning a
              page inside any tab should land on the first new row, not replay
              the banner and the whole profile header. */}
          <div data-pagination-anchor>
            <TabBar<ProfileTab>
              tabs={navTabs}
              value={tabValue}
              onChange={setTabValue}
              label="用户资料标签页"
              className="mb-6"
            />
          </div>
          {/* `TabPanes`, not the `data-tab-panel` / `data-tab-pane` trio written
              out by hand — and the difference is not only tidiness. Written out,
              this was passing `lean` by default, and `lean` requires the blocks
              inside a pane to survive the run. Every tab here fetches when it is
              *selected* (`if (tabValue !== 'posts') return`), so within a few
              frames of a switch starting the incoming pane's subtree has been
              replaced by a skeleton and GSAP is shearing detached nodes while
              the visible ones sit still. The primitive defaults it off, which is
              the correct setting for this screen. */}
          <TabPanes value={tabValue}>
            <TabPane value="uploads">
              {isUploadsLoading ? (
                /* `PER_PAGE`, which is the number the request actually asks
                    for — not the 8 that was here. A full page is 12, so the
                    placeholder was a row short on every desktop width and the
                    pane grew by one row the moment the pictures landed, after
                    the tab switch had visibly finished. */
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {Array.from({ length: PER_PAGE }).map((_, i) => (
                    <Skeleton key={i} className="aspect-square rounded-lg" />
                  ))}
                </div>
              ) : uploads.length > 0 ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {uploads.map((item) => (
                      <Link
                        key={item.id}
                        href={`/pic/${item.id}`}
                        className="block relative aspect-square rounded-lg overflow-hidden bg-surface-container-high transition-ui group"
                      >
                        <FadeInImage
                          src={
                            item.representations?.small ||
                            item.representations?.thumb ||
                            item.representations?.thumb_small ||
                            item.view_url
                          }
                          alt={item.name || `Upload #${item.id}`}
                          fill
                          quality={82}
                          className="object-cover"
                          sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, 25vw"
                        />
                        <div className="media-caption-gradient absolute inset-x-0 bottom-0 p-2 opacity-0 transition-opacity duration-300 ease-[var(--ease-standard)] group-hover:opacity-100">
                          <p className="text-on-media text-body-s truncate">
                            {item.name || `#${item.id}`}
                          </p>
                        </div>
                      </Link>
                    ))}
                  </div>
                  {totalUploadPages > 1 && (
                    <Pagination
                      currentPage={uploadsPage}
                      totalPages={totalUploadPages}
                      onPageChange={(next) => {
                        setIsUploadsLoading(true);
                        setUploadsPage(next);
                      }}
                      className="mt-8 mb-4"
                    />
                  )}
                </>
              ) : (
                <EmptyState
                  size="pane"
                  icon={<MdCloudUpload size={48} />}
                  title="暂无上传记录"
                  description="该用户还没有上传过任何作品"
                />
              )}
            </TabPane>

            <TabPane value="faves">
              {isFavesLoading && faveImages.length === 0 ? (
                /* Same page size as the request — see the uploads pane. */
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {Array.from({ length: PER_PAGE }).map((_, i) => (
                    <Skeleton key={i} className="aspect-square rounded-lg" />
                  ))}
                </div>
              ) : faveImages.length > 0 ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {faveImages.map((img) => (
                      <Link
                        key={img.id}
                        href={`/pic/${img.id}`}
                        className="block relative aspect-square rounded-lg overflow-hidden bg-surface-container-high transition-ui group"
                      >
                        <FadeInImage
                          src={
                            img.representations.small ||
                            img.representations.thumb ||
                            img.representations.thumb_small
                          }
                          alt={img.name || `Image #${img.id}`}
                          fill
                          quality={82}
                          className="object-cover"
                          sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, 25vw"
                        />
                      </Link>
                    ))}
                  </div>
                  {totalFavePages > 1 && (
                    <Pagination
                      currentPage={favesPage}
                      totalPages={totalFavePages}
                      onPageChange={(next) => {
                        setIsFavesLoading(true);
                        setFavesPage(next);
                      }}
                      className="mt-8 mb-4"
                    />
                  )}
                </>
              ) : (
                <EmptyState
                  size="pane"
                  icon={<MdFavorite size={48} />}
                  title="暂无收藏"
                  description="该用户还没有添加任何收藏"
                />
              )}
            </TabPane>

            <TabPane value="posts">
              {' '}
              {isPostsLoading ? (
                /* The card these stand in for is `space-y-3`, opens with an
                   80px cover thumbnail and puts a two-line title beside it. The
                   placeholder was `space-y-4` with no thumbnail at all, so the
                   list re-spaced vertically *and* shifted sideways the moment
                   the posts landed — which is the one thing a skeleton exists to
                   prevent. */
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Card key={i} variant="filled">
                      <div className="flex items-start gap-3">
                        <Skeleton className="h-16 w-16 shrink-0 rounded-md sm:h-20 sm:w-20" delay={i * 80} />
                        <div className="min-w-0 flex-1">
                          <Skeleton className="mb-2 h-5 w-3/5" delay={i * 80 + 40} />
                          <Skeleton className="h-3.5 w-2/5" delay={i * 80 + 80} />
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              ) : posts.length > 0 ? (
                <>
                  {' '}
                  <div className="space-y-3">
                    {' '}
                    {posts.map((post) => (
                      <Link
                        key={post.id}
                        href={`/forum/${post.id}`}
                        className="state-layer block rounded-md bg-surface-container-low p-4 transition-ui"
                      >
                        {' '}
                        <div className="flex items-start gap-3">
                          {' '}
                          {post.cover_image ? (
                            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-md overflow-hidden bg-surface-container-highest shrink-0">
                              {' '}
                              <FadeInImage
                                src={`https://picpony.top/${post.cover_image}`}
                                alt=""
                                fill
                                className="object-cover"
                              />{' '}
                            </div>
                          ) : null}{' '}
                          <div className="flex-1 min-w-0">
                            {' '}
                            <h3 className="text-title-m-emphasized text-on-surface mb-1.5 line-clamp-2">
                              {' '}
                              {post.title}{' '}
                            </h3>{' '}
                            <div className="flex items-center gap-4 text-label-m text-on-surface-variant">
                              {' '}
                              <span>
                                {new Date(post.created_at).toLocaleString('zh-CN', {
                                  year: 'numeric',
                                  month: '2-digit',
                                  day: '2-digit',
                                  hour: '2-digit',
                                  minute: '2-digit',
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
                    <Pagination
                      currentPage={postsPage}
                      totalPages={totalPostPages}
                      onPageChange={(next) => {
                        setIsPostsLoading(true);
                        setPostsPage(next);
                      }}
                      className="mt-8 mb-4"
                    />
                  )}
                </>
              ) : (
                <EmptyState
                  size="pane"
                  icon={<MdArticle size={48} />}
                  title="暂无帖子"
                  description="该用户还没有发表过任何帖子"
                />
              )}
            </TabPane>

            <TabPane value="comments">
              {' '}
              {isCommentsLoading ? (
                /* The card these stand in for is `space-y-3`, opens with an
                   80px cover thumbnail and puts a two-line title beside it. The
                   placeholder was `space-y-4` with no thumbnail at all, so the
                   list re-spaced vertically *and* shifted sideways the moment
                   the posts landed — which is the one thing a skeleton exists to
                   prevent. */
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Card key={i} variant="filled">
                      <div className="flex items-start gap-3">
                        <Skeleton className="h-16 w-16 shrink-0 rounded-md sm:h-20 sm:w-20" delay={i * 80} />
                        <div className="min-w-0 flex-1">
                          <Skeleton className="mb-2 h-5 w-3/5" delay={i * 80 + 40} />
                          <Skeleton className="h-3.5 w-2/5" delay={i * 80 + 80} />
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              ) : comments.length > 0 ? (
                <>
                  {' '}
                  <div className="space-y-3">
                    {' '}
                    {comments.map((comment, index) => {
                      const typeInfo = getCommentTypeLabel(comment.type);
                      return (
                        <Link
                          key={`${comment.type}-${comment.id}-${index}`}
                          href={getCommentTargetLink(comment)}
                          className="state-layer block rounded-md bg-surface-container-low p-4 transition-ui"
                        >
                          {' '}
                          <div className="flex items-start gap-3">
                            {' '}
                            {comment.cover_image ? (
                              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-md overflow-hidden bg-surface-container-highest shrink-0">
                                {' '}
                                <FadeInImage
                                  src={`https://picpony.top/${comment.cover_image}`}
                                  alt=""
                                  fill
                                  className="object-cover"
                                />{' '}
                              </div>
                            ) : null}{' '}
                            <div className="flex-1 min-w-0">
                              {' '}
                              <div className="flex items-center gap-2 mb-1.5">
                                {' '}
                                <Badge tone="primary">
                                  {' '}
                                  {typeInfo.icon} {typeInfo.label}{' '}
                                </Badge>{' '}
                                <span className="text-body-s text-on-surface-variant">
                                  {' '}
                                  {new Date(comment.created_at).toLocaleString('zh-CN', {
                                    year: 'numeric',
                                    month: '2-digit',
                                    day: '2-digit',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </span>
                              </div>
                              <div className="text-body-m text-on-surface line-clamp-3">
                                <RichTextRenderer content={comment.body} />
                              </div>
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                  {totalCommentPages > 1 && (
                    <Pagination
                      currentPage={commentsPage}
                      totalPages={totalCommentPages}
                      onPageChange={(next) => {
                        setIsCommentsLoading(true);
                        setCommentsPage(next);
                      }}
                      className="mt-8 mb-4"
                    />
                  )}
                </>
              ) : (
                <EmptyState
                  size="pane"
                  icon={<MdChatBubbleOutline size={48} />}
                  title="暂无评论"
                  description="该用户还没有发表过任何评论"
                />
              )}
            </TabPane>
          </TabPanes>
        </div>
      </div>
    </div>
    </>
  );
}
