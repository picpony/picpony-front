'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { MdFolder } from 'react-icons/md';
import { SKIP, useResource } from '@/lib/resource';
import { folderCovers, profileFaveFolders, useBrowsingFingerprint } from '@/lib/resources';
import { hiddenFromVisitors, tabVisible } from '@/lib/profiles';
/* A folder's page — the shared-folder route the favourites screens own (B4's share cards link
   there too). */
import { sharedFolderHref } from '@/lib/favorites';
import { useFolderReturn } from '@/lib/folderTransit';
import { ICON } from '@/lib/icons';
import EmptyState from '@/components/EmptyState';
import { buttonClasses } from '@/components/buttonStyles';
/* The favourites' own card, grid and placeholder: a profile's folder opens the very page
   /favorites' card for it does, and the two used to disagree about its name and its count
   (G3-010) — one copy now. */
import { FOLDER_GRID, FolderCard, FolderGridSkeleton } from '@/components/favorites/FolderCard';
import { OwnerHiddenNote, PaneFailure, PaneHidden, useVisited, type ProfilePaneProps } from './ProfilePaneStates';

/**
 * 收藏夹 — the user's public favourite folders (decision 15, `get_profile_fave_folders`): the
 * folders the owner chose to make public, each opening its own page, where its pictures are read
 * and filtered. The covers are one search for every folder's newest picture, inside the viewer's
 * content settings like every other picture list. A folder's page left with Back shrinks back into
 * its card here (`useFolderReturn`).
 */
export default function FoldersPane({ profile, own, ready, active }: ProfilePaneProps) {
  const visited = useVisited(active);
  const fp = useBrowsingFingerprint();
  const visible = tabVisible(profile, 'faves', own);
  const username = profile.username;
  const read = useResource(profileFaveFolders, ready && visited && visible ? { username } : SKIP);
  const folders = read.data;
  const coverIds = folders
    ? [...new Set(folders.map((folder) => folder.latestImageId).filter((cover): cover is number => cover !== null))]
    : [];
  const covers = useResource(folderCovers, coverIds.length > 0 ? { ids: coverIds, fp } : SKIP, { keepPrevious: fp });
  const rootRef = useRef<HTMLDivElement>(null);
  useFolderReturn(rootRef);

  if (!ready) return <FolderGridSkeleton />;
  if (!visible) return <PaneHidden />;
  if (folders === undefined) {
    return read.error ? <PaneFailure error={read.error} title="收藏夹加载失败" onRetry={read.refresh} /> : <FolderGridSkeleton />;
  }
  if (folders.length === 0) {
    return own ? (
      <EmptyState
        size="pane"
        icon={<MdFolder size={ICON.display} />}
        title="你还没有公开的收藏夹"
        description="公开的收藏夹会显示在你的个人主页上"
        action={
          <Link scroll={false} href="/favorites" className={buttonClasses({ variant: 'tonal' })}>
            管理收藏夹
          </Link>
        }
      />
    ) : (
      <EmptyState size="pane" icon={<MdFolder size={ICON.display} />} title="该用户没有公开的收藏夹" />
    );
  }

  return (
    <div ref={rootRef}>
      {own && hiddenFromVisitors(profile, 'faves') && <OwnerHiddenNote tab="faves" />}
      <ul className={FOLDER_GRID}>
        {folders.map((folder) => (
          <li key={folder.id} className="min-w-0">
            <FolderCard
              folder={folder}
              href={sharedFolderHref(username, folder.id)}
              cover={folder.latestImageId !== null ? covers.data?.[folder.latestImageId] : undefined}
              coverPending={folder.latestImageId !== null && covers.data === undefined && !covers.error}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
