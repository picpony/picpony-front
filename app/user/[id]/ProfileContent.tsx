'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { UserComment } from '@/lib/api';
import { SKIP, useResource } from '@/lib/resource';
import { useScreenStateFor } from '@/lib/screenState';
import type { ProfileSeed } from '@/lib/profile.server';
import {
  imagesByIds,
  sharedFaveIds,
  userComments,
  userPosts,
  userProfile,
  userUploads,
} from '@/lib/resources';
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
import ProgressBar from '@/components/ProgressBar';
import RoleBadge from '@/components/RoleBadge';
import Pagination from '@/components/Pagination';
import Tabs from '@/components/Tabs';
import PageBack from '@/components/PageBack';
import { useEscapeBack, useSession } from '@/lib/hooks';
import Skeleton from '@/components/Skeleton';
import TabPanes, { TabPane } from '@/components/TabPanes';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import { buttonClasses } from '@/components/Button';
import { ICON } from '@/lib/icons';
import { formatDate, formatDateTime, formatLastOnline } from '@/lib/format';
import { getAssetUrl } from '@/lib/utils';

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

const PER_PAGE = 12;


export default function ProfileContent({ profileSeed }: { profileSeed: ProfileSeed | null }) {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const { user, token, ready } = useSession();
  const currentUserId = typeof user?.id === 'number' ? user.id : null;

  /* Every page number survives a remount, so coming back to a profile lands on the page you left
     rather than on page 1. Scoped per profile id: two profiles are two screens that happen to
     share a component. See `lib/screenState.ts`. */
  const [tabValue, setTabValue] = useScreenStateFor<ProfileTab>('profile:tab', id, 'uploads');
  const [favesPage, setFavesPage] = useScreenStateFor('profile:faves', id, 1);
  const [commentsPage, setCommentsPage] = useScreenStateFor('profile:comments', id, 1);
  const [postsPage, setPostsPage] = useScreenStateFor('profile:posts', id, 1);
  const [uploadsPage, setUploadsPage] = useScreenStateFor('profile:uploads', id, 1);

  /**
   * Five reads. The point is that only the favourites wait on the profile:
   * `get_shared_faves` is keyed by *username*, which only arrives with the profile — a
   * property of the endpoint, so the answer is not to parallelise it but to not send it
   * at all until somebody opens the tab (`SKIP`). It used to run unconditionally on
   * mount, twice over, for a tab most visitors never open.
   */
  /* The header is server-rendered: `app/user/[id]/page.tsx` reads the profile and hands
     it down, and the same read supplies the route's `<title>`, so this read costs
     nothing when the seed matches — which it does whenever the id does, since
     `userProfile` is keyed on the id alone and the record is anonymous. The tabs
     underneath are deliberately *not* seeded: `userUploads` is keyed on a token and
     differs for the owner, so it stays a client read. */
  const profileRead = useResource(
    userProfile,
    id ? { id } : SKIP,
    { initial: profileSeed ?? undefined },
  );
  const profile = profileRead.data as UserProfile | null | undefined;

  const uploadsRead = useResource(
    userUploads,
    ready && id && tabValue === 'uploads' ? { id, page: uploadsPage, perPage: PER_PAGE, token } : SKIP,
    { keepPrevious: true },
  );
  const postsRead = useResource(
    userPosts,
    id && tabValue === 'posts' ? { id, page: postsPage } : SKIP,
    { keepPrevious: true },
  );
  const commentsRead = useResource(
    userComments,
    id && tabValue === 'comments' ? { id, page: commentsPage } : SKIP,
    { keepPrevious: true },
  );

  const favesActive = tabValue === 'faves' && Boolean(profile?.username);
  const faveIdsRead = useResource(
    sharedFaveIds,
    favesActive ? { username: profile!.username } : SKIP,
  );
  const allFaveIds = faveIdsRead.data ?? [];
  const faveImagesRead = useResource(
    imagesByIds,
    favesActive && allFaveIds.length > 0
      ? { ids: allFaveIds, page: favesPage, perPage: PER_PAGE }
      : SKIP,
    { keepPrevious: true },
  );

  const uploads = uploadsRead.data?.uploads ?? [];
  const totalUploadPages = uploadsRead.data?.totalPages ?? 1;
  const posts = postsRead.data?.posts ?? [];
  const totalPostPages = postsRead.data?.totalPages ?? 1;
  const comments = commentsRead.data?.comments ?? [];
  const totalCommentPages = commentsRead.data?.totalPages ?? 1;
  const faveImages = faveImagesRead.data?.images ?? [];
  const totalFavePages = Math.max(1, Math.ceil(allFaveIds.length / PER_PAGE));

  /* A placeholder is for having nothing to draw, never for "a request is in flight": a
     cached page re-renders with `isLoading` true while it refreshes underneath, and
     branching on that would put a skeleton over content that is already correct. */
  const isUploadsLoading = uploadsRead.data === undefined;
  const isPostsLoading = postsRead.data === undefined;
  const isCommentsLoading = commentsRead.data === undefined;
  const isFavesLoading = favesActive && (
    faveIdsRead.data === undefined || (faveImagesRead.data === undefined && allFaveIds.length > 0)
  );
  const favesError = faveIdsRead.error ?? faveImagesRead.error;

  const isLoading = profileRead.data === undefined && profileRead.error === undefined;
  const error = profileRead.error
    ? (profileRead.error as Error).message || '获取用户资料失败'
    : null;

  const getCommentTargetLink = (comment: UserComment): string => {
    return comment.type === 'post' ? `/forum/${comment.target_id}` : `/pic/${comment.target_id}`;
  };

  const getCommentTypeLabel = (
    type: 'post' | 'image',
  ): { label: string; icon: React.ReactNode } => {
    if (type === 'post') return { label: '论坛帖子', icon: <MdForum size={ICON.dense} /> };
    return { label: '图片', icon: <MdImage size={ICON.dense} /> };
  };

  const isOwnProfile = currentUserId !== null && profile && currentUserId === profile.id;

  /* Not a sidebar destination, so it carries the shared back affordance (AGENTS.md).
     Drawn in all three states: an affordance that disappears when a request fails is
     worse than one that was never there. No `pt-14` — the top of this page is the
     banner, not text. */
  const handleBack = useCallback(() => router.back(), [router]);
  useEscapeBack(handleBack);

  if (isLoading) {
    return (
      <>
      <PageBack onClick={handleBack} title="返回 (Esc)" />
      <div>
        <Skeleton className="h-48 sm:h-64 md:h-80 w-full rounded-2xl sm:rounded-3xl mt-4 sm:mt-6 mx-auto max-w-full px-2 sm:max-w-[98%] sm:px-0" />
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
    /* `ErrorRetry`, so a profile that fails to load looks like every other failure in
       the app instead of announcing itself in the page-title role. */
    return (
      <>
        <PageBack onClick={handleBack} title="返回 (Esc)" />
        {/* `onRetry`, because this was the one `ErrorRetry` in the app with an empty
            action slot — a failure that offered no way forward at all. */}
        <ErrorRetry title="加载失败" message={error || '用户可能不存在'} onRetry={profileRead.refresh} />
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
      {/* No entrance animation: the route transition already fades this page in (400ms
          `decelerate`); an extra fade here was the arrival happening twice on two
          clocks. */}
      <div>
      <div className="h-48 sm:h-64 md:h-80 relative bg-surface-container-high rounded-2xl sm:rounded-3xl overflow-hidden mt-4 sm:mt-6 mx-auto max-w-full sm:max-w-[98%] px-2 sm:px-0">
        {profile.banner ? (
          <FadeInImage
            src={getAssetUrl(profile.banner)}
            alt={`${profile.username} 的个人横幅`}
            fill
            /* The banner spans the detail column (1024px), inset to 98% from `sm` up.
               Without this, `fill` resolved to `100vw` — a 1920px variant to fill a
               1024px box. */
            sizes="(min-width: 1024px) 1024px, 100vw"
            className="object-cover"
          />
        ) : (
          <div className="w-full h-full bg-surface-container-highest flex items-center justify-center">
            
            <MdPerson size={ICON.display} className="text-outline" />
          </div>
        )}
        {/* **The level is not on the banner.** A meter over a photograph has no ground:
            nothing over a picture can take a surface role, and the indicator's contrast
            was whatever the user's banner happened to be. Level is identity metadata, so
            it lives in the identity column with the name, role and badges, where the
            surface roles apply and the meter can carry its own value. */}
      </div>
      <div className="max-w-5xl mx-auto relative">
        {' '}
        <div className="pb-8 relative pt-12 sm:pt-16">
          {' '}
          <div className="absolute -top-12 sm:-top-16 left-0">
            {' '}
            {/* `Avatar`, not a fourth hand-rolled copy of it — the URL was built inline
                rather than through `getAvatarUrl`, the rule that module exists to hold. */}
            <Avatar
              src={profile.avatar}
              name={profile.username}
              size="hero"
              className="border-4 border-surface"
            />
          </div>
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6 mt-2 sm:mt-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-1 flex-wrap">
                <h1 className="text-headline-s sm:text-headline-m text-on-surface break-words">
                  {profile.username}
                </h1>
                {/* One `Badge` silhouette for all three marks — the role, 已核验 and the
                    earned badges used to render in three different shapes. */}
                <RoleBadge role={profile.role} showUser size="md" />
                {profile.has_api_key && profile.derpi_username && (
                  <Badge tone="success" size="md" icon={<MdVerified />}>
                    已核验
                  </Badge>
                )}
              </div>
              {/* The level as a labelled meter, the shape /tasks already gives the same
                  value — the two screens report experience the same way. It carries the
                  number, which a chip could not (68/100 and 70/100 would be the same bar).
                  Capped so a meter as wide as the column does not read as a divider under
                  the name. */}
              {level !== null && (
                <div className="mt-3 max-w-xs">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-label-l text-on-surface">Lv.{level}</span>
                    {profile.experience !== undefined && (
                      <span className="text-label-m tabular-nums text-on-surface-variant">
                        经验：{xpInLevel} / 100
                      </span>
                    )}
                  </div>
                  <ProgressBar
                    value={xpProgress * 100}
                    label={`等级 ${level} 经验进度`}
                    className="mt-1.5"
                  />
                </div>
              )}
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
                    <MdPerson size={ICON.dense} />
                    {profile.gender}
                  </span>
                )}
                {profile.birthday && (
                  <span className="flex items-center gap-1.5">
                    <MdCake size={ICON.dense} />
                    {profile.birthday}
                  </span>
                )}
                <span className="flex items-center gap-1.5">
                  <MdAccessTime size={ICON.dense} />
                  注册于 {formatDate(profile.created_at)}
                </span>
                {profile.last_online && (
                  <span className="flex items-center gap-1.5 text-on-surface-variant">
                    
                    <MdAccessTime size={ICON.dense} /> 上次在线：
                    {formatLastOnline(profile.last_online)}
                  </span>
                )}
              </div>
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
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 mt-2 sm:mt-0">
              
              {!isOwnProfile && currentUserId !== null && (
                <Link
                  scroll={false}
                  href={`/messages?to=${profile.id}`}
                  className={buttonClasses({ variant: 'filled' })}
                >
                  <MdMessage size={ICON.dense} aria-hidden="true" /> 发送私信
                </Link>
              )}
            </div>
          </div>{' '}
          {profile.derpi_username ? (
            <div className="mb-8">
              {/* An anchor, not a click-handled container: the card opens an external
                  profile, so it is a link and always was — a plain div cannot be tabbed
                  to, middle-clicked, copied, or previewed, and `window.open` is what a
                  popup blocker stops. The trailing glyph promises the same thing. */}
              <a
                href={`https://derpibooru.org/profiles/${encodeURIComponent(
                  profile.derpi_user_id ? String(profile.derpi_user_id) : profile.derpi_username,
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="state-layer transition-ui block rounded-md border border-outline-variant bg-surface-container-low p-4 outline-none focus-visible:ring-2 focus-ring"
                aria-label="在 Derpibooru 查看个人主页"
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
                  {/* `Avatar`, not a bare `<img>` whose `onError` hid itself — an
                      imperative DOM edit React does not know about, leaving a blank
                      circle rather than a fallback. */}
                  <Avatar
                    src={
                      profile.derpi_user_id
                        ? `https://derpicdn.net/img/${profile.derpi_user_id}/avatar.png`
                        : undefined
                    }
                    name={profile.derpi_username}
                    size={40}
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
                  <MdOpenInNew size={ICON.dense} className="text-outline shrink-0" />
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
                  size: 'xs',
                  className: 'text-primary-ink',
                })}
              >
                <MdSearch size={ICON.dense} />
                搜索 TA 在 Derpibooru 的所有作品
              </a>
            </div>
          )}
          {/* The anchor encloses the tab row *and* the panes, which is what makes it
              reach the four pagers inside them: `Pagination` finds it with `closest()`.
              Landing on the tab row rather than at the top of the page is the point — a
              page turn inside a tab should not replay the banner, the name and the level
              bar. */}
          <div data-pagination-anchor>
            <Tabs<ProfileTab>
              tabs={navTabs}
              value={tabValue}
              onChange={setTabValue}
              label="用户资料标签页"
              className="mb-6"
            />
          {/* `TabPanes`, not the tab attributes written out by hand — and not only for
              tidiness: written out, this was passing `lean` by default, and `lean`
              requires the blocks inside a pane to survive the run. Every tab here
              fetches when it is *selected*, so within a few frames of a switch the
              incoming pane's subtree is replaced by a skeleton and GSAP is shearing
              detached nodes. The primitive defaults it off, which is correct here. */}
          <TabPanes value={tabValue}>
            <TabPane value="uploads">
              {uploadsRead.error ? (
                <ErrorRetry size="pane" title="上传记录加载失败" onRetry={uploadsRead.refresh} />
              ) : isUploadsLoading ? (
                /* `PER_PAGE`, the number the request actually asks for: a full page is
                   12, so an 8-row placeholder left the pane growing by one row after the
                   tab switch had visibly finished. */
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
                        scroll={false}
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
                          alt={item.name || `图片 #${item.id}`}
                          fill
                          quality={82}
                          className="object-cover"
                          sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, 25vw"
                        />
                        <div className="media-caption-gradient absolute inset-x-0 bottom-0 p-2 opacity-0 transition-opacity duration-composite ease-[var(--ease-standard)] group-hover:opacity-100">
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
                      onPageChange={setUploadsPage}
                      onPrefetchPage={(next) =>
                        userUploads.prefetch({ id, page: next, perPage: PER_PAGE, token })
                      }
                      className="mt-8 mb-4"
                    />
                  )}
                </>
              ) : (
                <EmptyState
                  size="pane"
                  icon={<MdCloudUpload size={ICON.display} />}
                  title="暂无上传记录"
                  description="该用户还没有上传过任何作品"
                />
              )}
            </TabPane>

            <TabPane value="faves">
              {favesError ? (
                <ErrorRetry
                  size="pane"
                  title="收藏加载失败"
                  onRetry={faveIdsRead.error ? faveIdsRead.refresh : faveImagesRead.refresh}
                />
              ) : isFavesLoading && faveImages.length === 0 ? (
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
                        scroll={false}
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
                          alt={img.name || `图片 #${img.id}`}
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
                      onPageChange={setFavesPage}
                      onPrefetchPage={(next) =>
                        allFaveIds.length > 0 &&
                        imagesByIds.prefetch({ ids: allFaveIds, page: next, perPage: PER_PAGE })
                      }
                      className="mt-8 mb-4"
                    />
                  )}
                </>
              ) : (
                <EmptyState
                  size="pane"
                  icon={<MdFavorite size={ICON.display} />}
                  title="暂无收藏"
                  description="该用户还没有添加任何收藏"
                />
              )}
            </TabPane>

            <TabPane value="posts">
              {' '}
              {postsRead.error ? (
                <ErrorRetry size="pane" title="帖子加载失败" onRetry={postsRead.refresh} />
              ) : isPostsLoading ? (
                /* The card these stand in for: 12px rhythm, 56px cover thumbnail,
                   two-line title. The placeholder must match the real card's geometry or
                   the list re-spaces the moment the posts land — the one thing a skeleton
                   exists to prevent. */
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Card key={i} variant="transparent" className="rounded-md bg-surface-container-low p-4">
                      <div className="flex items-start gap-3">
                        <Skeleton className="size-14 shrink-0 rounded-sm" delay={i * 80} />
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
                        scroll={false}
                        key={post.id}
                        href={`/forum/${post.id}`}
                        /* A card-shaped link: `Card` could render only a `div` or a
                           `button`, so this recipe appeared twice in this file before the
                           primitive could render an anchor. */
                        className="state-layer block rounded-md bg-surface-container-low p-4 transition-ui"
                      >
                        {' '}
                        <div className="flex items-start gap-3">
                          
                          {post.cover_image ? (
                            <div className="size-14 rounded-sm overflow-hidden bg-surface-container-highest shrink-0">
                              {' '}
                              <FadeInImage
                                src={getAssetUrl(post.cover_image)}
                                alt=""
                                fill
                                /* 56px box. Same `sizes` reason as the banner above. */
                                sizes="56px"
                                className="object-cover"
                              />
                            </div>
                          ) : null}
                          <div className="flex-1 min-w-0">
                            
                            <h3 className="text-title-m-emphasized text-on-surface mb-1.5 line-clamp-2">
                              {' '}
                              {post.title}{' '}
                            </h3>
                            <div className="flex items-center gap-4 text-label-m text-on-surface-variant">
                              
                              <span>
                                {formatDateTime(post.created_at)}
                              </span>
                              <span className="flex items-center gap-1">
                                <MdChatBubbleOutline size={ICON.dense} />
                                {post.reply_count}
                              </span>
                              <span className="flex items-center gap-1">
                                <MdFavorite size={ICON.dense} />
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
                      onPageChange={setPostsPage}
                      onPrefetchPage={(next) => userPosts.prefetch({ id, page: next })}
                      className="mt-8 mb-4"
                    />
                  )}
                </>
              ) : (
                <EmptyState
                  size="pane"
                  icon={<MdArticle size={ICON.display} />}
                  title="暂无帖子"
                  description="该用户还没有发表过任何帖子"
                />
              )}
            </TabPane>

            <TabPane value="comments">
              {' '}
              {commentsRead.error ? (
                <ErrorRetry size="pane" title="评论加载失败" onRetry={commentsRead.refresh} />
              ) : isCommentsLoading ? (
                /* The card these stand in for: 12px rhythm, 56px cover thumbnail,
                   two-line title. The placeholder must match the real card's geometry or
                   the list re-spaces the moment the posts land — the one thing a skeleton
                   exists to prevent. */
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Card key={i} variant="filled">
                      <div className="flex items-start gap-3">
                        <Skeleton className="size-14 shrink-0 rounded-sm" delay={i * 80} />
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
                          scroll={false}
                          key={`${comment.type}-${comment.id}-${index}`}
                          href={getCommentTargetLink(comment)}
                          className="state-layer block rounded-md bg-surface-container-low p-4 transition-ui"
                        >
                          {' '}
                          <div className="flex items-start gap-3">
                            
                            {comment.cover_image ? (
                              <div className="size-14 rounded-sm overflow-hidden bg-surface-container-highest shrink-0">
                                {' '}
                                <FadeInImage
                                  src={getAssetUrl(comment.cover_image)}
                                  alt=""
                                  fill
                                  /* 56px box. Same `sizes` reason as the banner above. */
                                  sizes="56px"
                                  className="object-cover"
                                />
                              </div>
                            ) : null}
                            <div className="flex-1 min-w-0">
                              
                              <div className="flex items-center gap-2 mb-1.5">
                                
                                <Badge tone="primary">
                                  {' '}
                                  {typeInfo.icon} {typeInfo.label}{' '}
                                </Badge>
                                <span className="text-body-s text-on-surface-variant">
                                  {' '}
                                  {formatDateTime(comment.created_at)}
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
                      onPageChange={setCommentsPage}
                      onPrefetchPage={(next) => userComments.prefetch({ id, page: next })}
                      className="mt-8 mb-4"
                    />
                  )}
                </>
              ) : (
                <EmptyState
                  size="pane"
                  icon={<MdChatBubbleOutline size={ICON.display} />}
                  title="暂无评论"
                  description="该用户还没有发表过任何评论"
                />
              )}
            </TabPane>
          </TabPanes>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
