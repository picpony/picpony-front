/**
 * Share links: PicPony's own short links, made by the Rust backend's share-link resource.
 *
 * `POST /api/v1/share-links {target_url, title, description, image_id?}` → `201 {share_id, url,
 * target_url, preview_status, expires_at, share_task_counted}`. The short link is
 * `share.php?id=<share_id>` on this origin; `app/share.php/route.ts` sends a visit on to the
 * backend's preview page (`/api/v1/share-links/{id}/page`), which carries the title, description
 * and picture a chat app shows and then leads to the target.
 *
 * - **A short link is an improvement, never a requirement**: the original front end fell back to
 *   the long link on any failure, and so does this — the caller always gets a URL to hand over.
 *   The backend only accepts targets on the site's own origins (no open redirect), so a target
 *   it refuses (a dev origin, say) also gets the long link.
 * - **The share task counts here, on the server.** A signed-in creation is the daily share task's
 *   only source of progress (one per distinct target a day, capped at the task's target); there
 *   is no client-reported counter (`track_share` is gone on purpose).
 * - A picture's preview words and thumbnail are the backend's own (it checks the picture against
 *   the block list and upstream rating first): `imageUrl` is not sent.
 */

import { readToken } from '@/lib/hooks';
import { api, deadlineSignal } from './http';

/**
 * How long the person pressing 分享 waits for a short link before getting the long one. A write,
 * so abandoning it does not stop the server storing it — which costs one unused share row; a
 * button spinning for as long as the backend's worst case costs the share. The backend's own
 * picture lookup is bounded below this (8 s metadata + thumbnail).
 */
const CREATE_DEADLINE_MS = 8_000;

/** The site's own preview picture, as the original front end sent it for a shared search. */
export const DEFAULT_SHARE_IMAGE = 'Derp.png';

export interface ShareLinkInput {
  /** Where the link leads — an absolute URL of this app. */
  targetUrl: string;
  /** The link preview's title and description, as a chat app shows them. */
  title: string;
  desc: string;
  /** The preview's picture. Not sent: the backend picks a picture's thumbnail itself. */
  imageUrl?: string;
  /** A picture's Derpibooru id, when the share is of one picture. */
  imageId?: number;
}

export interface ShareLink {
  url: string;
  /** Whether `url` is a short link, or the long one it fell back to. */
  short: boolean;
}

interface CreatedShareLink {
  share_id: string;
}

/**
 * The link to hand over for a share: the short one, or the long one on any failure. The token is
 * optional — sent when signed in, so the share counts toward the account's share task.
 */
export async function createShareLink(
  { targetUrl, title, desc, imageId }: ShareLinkInput,
  { token, signal }: { token?: string | null; signal?: AbortSignal } = {},
): Promise<ShareLink> {
  const fallback: ShareLink = { url: targetUrl, short: false };
  const deadline = deadlineSignal(signal, CREATE_DEADLINE_MS);
  try {
    const created = await api<CreatedShareLink>('POST', '/share-links', {
      token: token || undefined,
      json: {
        target_url: targetUrl,
        title,
        description: desc,
        ...(imageId !== undefined ? { image_id: imageId } : {}),
      },
      signal: deadline.signal,
      timeoutMs: false,
    });
    const url = new URL('/share.php', window.location.origin);
    url.searchParams.set('id', created.share_id);
    if (token) void expireTasks(token);
    return { url: url.href, short: true };
  } catch (error) {
    /* The caller's own abort is not a failure to fall back from. */
    if (signal?.aborted) throw error;
    return fallback;
  } finally {
    deadline.dispose();
  }
}

/**
 * The account may return to a still-cached task screen right after sharing. Lazy lookup keeps the
 * transport module outside the resource catalogue's import cycle.
 */
async function expireTasks(token: string): Promise<void> {
  if (readToken() !== token) return;
  try {
    const { tasks } = await import('@/lib/resources');
    if (readToken() === token) tasks.expire({ token });
  } catch {
    /* A stale task screen re-reads on its own next visit. */
  }
}
