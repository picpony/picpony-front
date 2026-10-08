'use client';

import { useState } from 'react';
import { useResource } from '@/lib/resource';
import { useScreenStateFor } from '@/lib/screenState';
import type { ProfileSeed } from '@/lib/profile.server';
import { userProfile } from '@/lib/resources';
import { isNotFound, isRetryable } from '@/lib/api/errors';
import { useNow, useSession } from '@/lib/hooks';
import { useSyncedSetting } from '@/lib/settingsSync';
import { defaultProfileTab, withSettings, type ProfileTab } from '@/lib/profiles';
import ImageGridSkeleton from '@/components/ImageGridSkeleton';
import BadgeEquipDialog from '@/components/BadgeEquipDialog';
import Skeleton from '@/components/Skeleton';
import Tabs from '@/components/Tabs';
import TabPanes, { TabPane } from '@/components/TabPanes';
import ProfileHeader from './ProfileHeader';
import { ProfileBack, ProfileFailure, ProfileMissing } from './ProfileMissing';
import UploadsPane from './UploadsPane';
import FoldersPane from './FoldersPane';
import PostsPane from './PostsPane';
import CommentsPane from './CommentsPane';

const TABS: { value: ProfileTab; label: string }[] = [
  { value: 'uploads', label: '上传记录' },
  { value: 'faves', label: '收藏夹' },
  { value: 'posts', label: '发布的帖子' },
  { value: 'comments', label: '历史评论' },
];

/**
 * A PicPony profile — `/user/[id]`.
 *
 * The header is server-rendered: `page.tsx` reads the profile and hands it down as `profileSeed`
 * (a missing user is the route's not-found state before anything renders), and the same read
 * supplies the `<title>`. The four tabs are client reads, each sent when its tab is first opened
 * and kept after — a tab switched away from keeps its content while it slides out.
 *
 * **One clock for the page.** Relative times (上次在线) and badge expiry are read against
 * `useNow()`, which answers `null` while hydrating; until it does, the seed's own read time
 * stands in, so the server's HTML and the hydrating render print the same words and the text
 * changes only if the time it states has.
 *
 * The id comes from the route's own props, never `useParams()`: the intercepted image route also
 * has an `id`, and the background page must keep its own while the foreground changes.
 */
export default function ProfileContent({ id, profileSeed }: { id: string; profileSeed: ProfileSeed | null }) {
  const { user, token, ready } = useSession();
  const clock = useNow();
  const now = clock ?? profileSeed?.generatedAt ?? null;

  const profileRead = useResource(userProfile, { id }, { initial: profileSeed ?? undefined });
  const profile = profileRead.data ?? undefined;

  /* Every page number and the chosen tab survive a remount, per profile (`useScreenStateFor`).
     `null` until somebody picks a tab: the profile's own default is then public data, the same
     on the server and the client whoever is looking (`defaultProfileTab`). */
  const [pickedTab, setPickedTab] = useScreenStateFor<ProfileTab | null>('profile:tab', id, null);
  const [equipOpen, setEquipOpen] = useState(false);

  /* The owner's privacy choices as this device holds them (/settings writes them here first and
     the account a moment later): on their own profile a change shows at once — 已隐藏 on the IP
     line, the note on a hidden tab — where the record, cached for minutes, would lag it. */
  const ownerSettings = {
    showUploads: useSyncedSetting('showUploads'),
    showFaves: useSyncedSetting('showFaves'),
    showPosts: useSyncedSetting('showPosts'),
    showComments: useSyncedSetting('showComments'),
    hideIpLocation: useSyncedSetting('hideIpLocation'),
  };

  if (profile === undefined && profileRead.error !== undefined) {
    if (isNotFound(profileRead.error) || profileRead.data === null) return <ProfileMissing />;
    return (
      <ProfileFailure
        error={profileRead.error}
        onRetry={isRetryable(profileRead.error) ? profileRead.refresh : undefined}
      />
    );
  }
  if (profileRead.data === null) return <ProfileMissing />;

  const sessionId = Number(user?.id);
  const own = ready && profile !== undefined && Number.isSafeInteger(sessionId) && sessionId === Number(profile.id);
  const canMessage = ready && profile !== undefined && user !== null && !own;
  /* The default tab stays on public data, so the server and every viewer choose the same one. */
  const tab = pickedTab ?? (profile ? defaultProfileTab(profile) : 'uploads');
  const shown = own && profile ? withSettings(profile, ownerSettings) : profile;

  return (
    <>
      <ProfileBack />
      {/* The page opens on its banner, which spans the column at every width, so the root takes
          the media form of the back affordance's room. No entrance of its own: the route
          transition already fades the page in. */}
      <div className="page-back-room-media" data-page-loading={profile ? undefined : ''}>
        <div className="mx-auto max-w-5xl pb-8">
          <ProfileHeader
            profile={shown}
            own={own}
            canMessage={canMessage}
            now={now}
            onManageBadges={() => setEquipOpen(true)}
          />
          {shown ? (
            /* The anchor encloses the tab row *and* the panes: `Pagination` finds it with
               `closest()`, and a page turn lands on the tab row rather than replaying the banner.
               One anchor for all four tabs (R7-036). */
            <div data-pagination-anchor className="mt-8">
              <Tabs<ProfileTab> tabs={TABS} value={tab} onChange={setPickedTab} label="用户资料标签页" className="mb-6" />
              {/* The layered departure. Safe here because every pane's first-load placeholder
                  carries `data-page-loading` (the lean stands down while one is on screen, so a
                  first visit slides as one plane) and no pane holds an entrance of its own. */}
              <TabPanes value={tab} lean>
                <TabPane value="uploads">
                  <UploadsPane profile={shown} id={id} own={own} ready={ready} active={tab === 'uploads'} token={token} now={now ?? 0} />
                </TabPane>
                <TabPane value="faves">
                  <FoldersPane profile={shown} id={id} own={own} ready={ready} active={tab === 'faves'} token={token} now={now ?? 0} />
                </TabPane>
                <TabPane value="posts">
                  <PostsPane profile={shown} id={id} own={own} ready={ready} active={tab === 'posts'} token={token} now={now ?? 0} />
                </TabPane>
                <TabPane value="comments">
                  <CommentsPane profile={shown} id={id} own={own} ready={ready} active={tab === 'comments'} token={token} now={now ?? 0} />
                </TabPane>
              </TabPanes>
            </div>
          ) : (
            /* The tab row's own height, then the landing pane's grid, so nothing moves when the
               record lands. */
            <div className="mt-8" aria-hidden="true">
              <Skeleton className="mb-6 h-12 w-full max-w-md" />
              <ImageGridSkeleton count={12} entrance={false} />
            </div>
          )}
        </div>
      </div>
      {own && token && profile && now !== null && (
        <BadgeEquipDialog
          open={equipOpen}
          onClose={() => setEquipOpen(false)}
          token={token}
          profileId={id}
          now={now}
        />
      )}
    </>
  );
}
