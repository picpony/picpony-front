'use client';

import { createShareLink } from '@/lib/api/share';
import { sharedFolderHref } from '@/lib/favorites';
import { readToken, readUserInfo } from '@/lib/hooks';
import { copyText } from '@/lib/utils';

/**
 * Copy a link to one of your own public folders — the short link when the backend makes one, the
 * long one otherwise. The link names you by id (what the backend takes, and what an anonymous
 * visitor's read needs); the username is only the preview's words. Making the short link signed
 * in is what counts the share toward the daily task (server-side, see `lib/api/share.ts`).
 */
export async function copyFolderLink(token: string, username: string, folderId: number, name: string): Promise<boolean> {
  if (readToken() !== token) return false;
  const ownId = Number(readUserInfo()?.id);
  const link = await createShareLink({
    targetUrl: `${window.location.origin}${sharedFolderHref(ownId > 0 ? ownId : username, folderId)}`,
    title: name,
    desc: `${username} 的收藏夹`,
  }, { token });
  if (readToken() !== token) return false;
  return copyText(link.url);
}
