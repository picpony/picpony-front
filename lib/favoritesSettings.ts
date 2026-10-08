'use client';

import { useEffect } from 'react';
import type { FaveFolder } from '@/lib/api/favorites';
import { folderLabel, resolveDefaultFolder } from '@/lib/favorites';
import { readToken, readUserInfo } from '@/lib/hooks';
import { SKIP, useResource } from '@/lib/resource';
import { profileFaveFolders, sessionUser, sharedFaveIds, userProfile } from '@/lib/resources';
import { changeSyncedSetting, SYNCED_SETTINGS, useSyncedSetting, type SyncedValues } from '@/lib/settingsSync';

/** Read through the registry at event time, rather than a dialog's older render. */
export function readFavouriteSetting<K extends 'defaultFaveFolder' | 'publicFaveFolderIds'>(id: K): SyncedValues[K] {
  return SYNCED_SETTINGS.find((entry) => entry.id === id)!.read() as SyncedValues[K];
}

/** The folder's live name; an expired choice is corrected only after this account's settings arrive. */
export function useDefaultFaveFolder(token: string | null, folders: readonly FaveFolder[] | undefined) {
  const stored = useSyncedSetting('defaultFaveFolder');
  const account = useResource(sessionUser, token ? { token } : SKIP);
  const resolved = folders ? resolveDefaultFolder(folders, stored) : { ...stored, corrected: false };
  useEffect(() => {
    if (!token || !folders || !resolved.corrected || account.data?.kind !== 'ok' || !('settings' in account.data.user)) return;
    if (readToken() !== token) return;
    changeSyncedSetting('defaultFaveFolder', { id: resolved.id, name: resolved.name });
  }, [token, folders, resolved.corrected, resolved.id, resolved.name, account.data]);
  return { id: resolved.id, name: resolved.name };
}

let watching = false;
let seenToken: string | null = null;
let seenPublic = '';

function visibilityOf(user: ReturnType<typeof readUserInfo>) {
  let settings: unknown = user?.settings;
  if (typeof settings === 'string') {
    try { settings = JSON.parse(settings); } catch { settings = null; }
  }
  const record = settings && typeof settings === 'object' ? settings as Record<string, unknown> : {};
  return JSON.stringify([record.showFaves, record.publicFaveFolderIds]);
}

/**
 * Re-read public answers only after the settings engine has confirmed its write. Local settings
 * change before the backend does (the engine batches for 600ms); expiring at the click would
 * cache the old public list again. Its confirmed session write emits `user_info_updated`, even
 * after the menu's page has gone, so one small session listener covers that handoff.
 */
function watchConfirmedVisibility() {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  const current = readUserInfo();
  seenToken = current?.token ?? null;
  seenPublic = visibilityOf(current);
  window.addEventListener('user_info_updated', () => {
    const user = readUserInfo();
    const next = visibilityOf(user);
    if (user?.token === seenToken && next !== seenPublic && typeof user.username === 'string') {
      profileFaveFolders.expire({ username: user.username });
      sharedFaveIds.expire();
      if (user.id != null) userProfile.expire({ id: String(user.id) });
    }
    seenToken = user?.token ?? null;
    seenPublic = next;
  });
}

/** One folder's public choice, preserving changes made while a menu or a confirm was open. */
export function setFolderPublic(token: string, folders: readonly FaveFolder[], folderId: number, on: boolean) {
  if (readToken() !== token) return;
  watchConfirmedVisibility();
  const current = readFavouriteSetting('publicFaveFolderIds') ?? folders.map((folder) => folder.id);
  const next = on ? [...new Set([...current, folderId])] : current.filter((id) => id !== folderId);
  changeSyncedSetting('publicFaveFolderIds', next);
}

export function setDefaultFaveFolder(token: string, folder: FaveFolder) {
  if (readToken() === token) changeSyncedSetting('defaultFaveFolder', { id: folder.id, name: folderLabel(folder) });
}
