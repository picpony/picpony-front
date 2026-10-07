/**
 * Whose Derpibooru account an API key belongs to — the original front end's check, which asks the
 * key for its owner's newest upload and, failing that, newest comment.
 *
 * Three answers, and the difference is load-bearing:
 * - `invalid` — Derpibooru refused the key (401/403). Nothing is saved; the field says so.
 * - `verified` — an upload or a comment named the owner.
 * - `no-activity` — the key works but its owner has neither, so nobody can be named. The key is
 *   still bound, with **no** identity: this app once stored the invented `new_user` /
 *   `PicPony 绑定账号` pair here, which the profile then linked to as a Derpibooru account.
 *
 * Anything else (the network, a rate limit, an outage) throws: `proxyFetch` has already retried or
 * failed over as the line policy allows, so a second ladder here would only hold the dialog for
 * seconds and still end in the same sentence. A 401/403 used to fall into that retry loop — the
 * old check read `status` off a response `proxyFetch` never returns for a failure — and the user
 * waited ~4 s for the wrong message.
 */

import { DERPIBOORU_API_BASE } from '@/lib/constants';
import { proxyFetch } from '@/lib/api/client';
import { readObject } from '@/lib/api/http';
import { apiErrorStatus } from '@/lib/api/errors';

export type DerpiIdentity =
  | { status: 'verified'; id: string; name: string }
  | { status: 'no-activity' }
  | { status: 'invalid' };

/** The placeholder identity older builds saved for a key with no activity. */
const INVENTED_ID = 'new_user';

/** Whether a stored identity names somebody (and is not the invented placeholder). */
export function isRealIdentity(id: unknown, name: unknown): boolean {
  const key = typeof id === 'number' ? String(id) : typeof id === 'string' ? id.trim() : '';
  return key !== '' && key !== INVENTED_ID && typeof name === 'string' && name.trim() !== '';
}

/** Derpibooru's API key: twenty characters, no whitespace. */
export const API_KEY_PATTERN = /^\S{20}$/;

async function search<T extends object>(path: string, key: string, signal?: AbortSignal): Promise<T | 'invalid'> {
  try {
    /* `developer` pins the Everything filter on an image search: the owner's own filter must
       not hide the very upload that names them. Nothing from the answer is shown. */
    const res = await proxyFetch(
      `${DERPIBOORU_API_BASE}/${path}&per_page=1&key=${encodeURIComponent(key)}`,
      { signal },
      'developer',
    );
    return await readObject<T>(res);
  } catch (error) {
    const status = apiErrorStatus(error);
    if (status === 401 || status === 403) return 'invalid';
    throw error;
  }
}

function named(id: unknown, name: unknown): { id: string; name: string } | null {
  if (!isRealIdentity(id, name)) return null;
  return { id: String(id).trim(), name: String(name).trim() };
}

export async function detectDerpiIdentity(key: string, signal?: AbortSignal): Promise<DerpiIdentity> {
  const uploads = await search<{ images?: { uploader_id?: unknown; uploader?: unknown }[] }>(
    'search/images?q=my:uploads',
    key,
    signal,
  );
  if (uploads === 'invalid') return { status: 'invalid' };
  const upload = uploads.images?.[0];
  const uploader = upload ? named(upload.uploader_id, upload.uploader) : null;
  if (uploader) return { status: 'verified', ...uploader };

  const comments = await search<{ comments?: { user_id?: unknown; author?: unknown }[] }>(
    'search/comments?q=my:comments',
    key,
    signal,
  );
  if (comments === 'invalid') return { status: 'invalid' };
  const comment = comments.comments?.[0];
  const author = comment ? named(comment.user_id, comment.author) : null;
  return author ? { status: 'verified', ...author } : { status: 'no-activity' };
}
