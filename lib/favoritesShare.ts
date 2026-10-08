'use client';

import { createShareLink, trackShare } from '@/lib/api/share';
import { sharedFolderHref } from '@/lib/favorites';
import { readToken } from '@/lib/hooks';
import { copyText } from '@/lib/utils';

/** A completed folder-link copy counts once; a failed copy or an obsolete session counts nothing. */
export async function copyFolderLink(token: string, username: string, folderId: number, name: string): Promise<boolean> {
  if (readToken() !== token) return false;
  const link = await createShareLink({
    targetUrl: `${window.location.origin}${sharedFolderHref(username, folderId)}`,
    title: name,
    desc: `${username} 的收藏夹`,
  }, { token });
  if (readToken() !== token) return false;
  const copied = await copyText(link.url);
  if (copied && readToken() === token) trackShare(token);
  return copied;
}
