'use client';

import { Suspense, useEffect, useState } from 'react';
import { SKIP, useResource } from '@/lib/resource';
import { faveFolders, faveIds, sessionUser } from '@/lib/resources';
import { isFavoritesTab, type FavoritesTab } from '@/lib/favorites';
import { useSession } from '@/lib/hooks';
import { useSyncedSetting } from '@/lib/settingsSync';
import { formatCount } from '@/lib/format';
import { useBackgroundSearchParams } from '@/components/BackgroundLocation';
import PageHeader from '@/components/PageHeader';
import SignInRequired from '@/components/SignInRequired';
import Skeleton from '@/components/Skeleton';
import Tabs from '@/components/Tabs';
import TabPanes, { TabPane } from '@/components/TabPanes';
import { FolderGridSkeleton } from '@/components/favorites/FolderCard';
import FoldersPane from './FoldersPane';
import DerpiPane from './DerpiPane';
import PrivacyPane from './PrivacyPane';
import { dropQueuedFavoritesAddress, favoritesTabs, landingTab, replaceFavoritesAddress } from './tabs';
import { useShowPrivacyTab } from './privacyTabHint';

const TAB_ROW_LABEL = '收藏';

/**
 * 我的收藏 — one screen, three tabs: **收藏夹** (your folders, each its own page), **Derpibooru**
 * (`my:faves`) and **隐私空间** (offered while 显示隐私空间 is on). The header counts what you have.
 *
 * Signed out it is the one sign-in state (decision 4, R5-021): nothing opens by itself, and no
 * tab claims an empty list. While the session is unknown the screen shows its own shape — the
 * header, the tab row, the folder cards — with nothing in between (R5-022).
 *
 * The panes lean (decision 25): each is static once its first read is in, and a pane still on its
 * first-load placeholder marks it (`data-page-loading`), which the lean stands down for.
 */
export default function FavoritesPage() {
  return (
    <Suspense fallback={<FavoritesSkeleton />}>
      <FavoritesSession />
    </Suspense>
  );
}

function FavoritesSession() {
  const { ready, token } = useSession();
  if (!ready) return <FavoritesSkeleton />;
  if (!token) {
    return (
      <div className="mx-auto max-w-7xl">
        <PageHeader title="我的收藏" />
        <SignInRequired size="pane" description="登录后即可查看和管理你的收藏" />
      </div>
    );
  }
  /* One instance per account: another account starts with its own tabs and panes. */
  return <FavoritesScreen key={token} token={token} />;
}

/* The tab labels' own widths at `title-s`: three Han characters, ten Latin letters, four Han. */
const TAB_LABEL_WIDTHS = ['w-10', 'w-19', 'w-14'] as const;

/**
 * The screen's own shape while the session is unknown: the header, the tab row, the cards. The
 * row is the tabs' own — a label per tab, 48dp tall over the divider — not a filled box: an
 * underline row has no container, and the box became three words and a line when it landed
 * (G3-028).
 */
function FavoritesSkeleton() {
  /* The server's count until hydration has run: the row it drew is the row that stays. */
  const showPrivacy = useShowPrivacyTab(useSyncedSetting('showPrivacyFaves'));
  return (
    <div className="mx-auto max-w-7xl" data-page-loading="">
      <div className="mb-6 flex flex-col gap-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="mb-6 flex h-12 items-center border-b border-outline-variant" aria-hidden="true">
        {TAB_LABEL_WIDTHS.slice(0, favoritesTabs(showPrivacy).length).map((width) => (
          <span key={width} className="px-4">
            <Skeleton className={`h-4 ${width}`} />
          </span>
        ))}
      </div>
      <FolderGridSkeleton />
    </div>
  );
}

function FavoritesScreen({ token }: { token: string }) {
  const showPrivacy = useSyncedSetting('showPrivacyFaves');
  const account = useResource(sessionUser, { token });
  const tabParam = useBackgroundSearchParams().get('tab');
  const requested = isFavoritesTab(tabParam) ? tabParam : null;
  const [tab, setTab] = useState<FavoritesTab>(() => landingTab(requested ?? 'folders', showPrivacy));

  /* A link followed while the screen is up selects its tab. */
  const [seen, setSeen] = useState(requested);
  if (seen !== requested) {
    setSeen(requested);
    if (requested && requested !== tab) setTab(landingTab(requested, showPrivacy));
  }
  /* 隐私空间 switched off while it was on screen: the row no longer offers it. A request for it
     kept from before the setting was read (a cold load) opens it once it is offered. */
  if (landingTab(tab, showPrivacy) !== tab) setTab(landingTab(tab, showPrivacy));
  const [pending, setPending] = useState<FavoritesTab | null>(() =>
    requested && landingTab(requested, showPrivacy) !== requested ? requested : null,
  );
  if (pending && account.data && !showPrivacy) setPending(null);
  if (pending && landingTab(pending, showPrivacy) === pending) {
    setPending(null);
    setTab(pending);
  }
  const shown = landingTab(tab, showPrivacy);

  /* The address names the tab on screen; corrected in place when it names one not offered. */
  useEffect(() => {
    if (tabParam === null && shown === 'folders') return;
    if (requested === shown) return;
    if (pending) return;
    replaceFavoritesAddress(shown);
  }, [shown, tabParam, requested, pending]);
  useEffect(() => dropQueuedFavoritesAddress, []);

  /* A pane is read the first time it is shown, and kept. */
  const [visited, setVisited] = useState<ReadonlySet<FavoritesTab>>(() => new Set([shown]));
  if (!visited.has(shown)) setVisited(new Set([...visited, shown]));

  const select = (next: FavoritesTab) => {
    setPending(null);
    setTab(next);
    replaceFavoritesAddress(next);
  };

  const index = useResource(faveIds, { token });
  const folders = useResource(faveFolders, visited.has('folders') ? { token } : SKIP);
  const total = index.data?.ids.length;
  const folderCount = folders.data?.folders.length;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="我的收藏"
        subtitle={
          total === undefined ? (
            <span>正在读取收藏…</span>
          ) : (
            <span className="tabular-nums">
              共 {formatCount(total)} 张收藏{folderCount !== undefined ? `，${formatCount(folderCount)} 个收藏夹` : ''}
            </span>
          )
        }
      />
      <Tabs tabs={favoritesTabs(showPrivacy)} value={shown} onChange={select} label={TAB_ROW_LABEL} className="mb-6" />
      <TabPanes value={shown} lean>
        <TabPane value="folders">
          {visited.has('folders') && <FoldersPane token={token} active={shown === 'folders'} />}
        </TabPane>
        <TabPane value="derpibooru">
          {visited.has('derpibooru') && <DerpiPane token={token} active={shown === 'derpibooru'} />}
        </TabPane>
        {showPrivacy && (
          <TabPane value="privacy">
            {visited.has('privacy') && <PrivacyPane token={token} active={shown === 'privacy'} />}
          </TabPane>
        )}
      </TabPanes>
    </div>
  );
}
