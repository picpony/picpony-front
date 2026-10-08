/**
 * Share links: PicPony's own short links (`share.php`), and the share counter.
 *
 * `share.php` is a separate backend endpoint from `api.php`, reached through this app's
 * `app/share.php/route.ts` so a short link resolves on this origin. `?action=create` stores a
 * target URL with the title, description and picture a chat app's link preview shows;
 * `?id=<share_id>` is the page that preview is read from, which sends a person on to the target.
 *
 * **A short link is an improvement, never a requirement**: the original front end fell back to
 * the long link on any failure, and so does this — the caller always gets a URL to hand over.
 */

import { readToken } from '@/lib/hooks';
import { deadlineSignal, picponyRequest, readEnvelope } from './http';

/** The endpoint, on this origin (the route handler forwards it). */
const SHARE_ENDPOINT = '/share.php';

/**
 * How long the person pressing 分享 waits for a short link before getting the long one. A write,
 * so abandoning it does not stop the server storing it — which costs one unused share row; a
 * button spinning for as long as the backend's worst case costs the share.
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
  /** The preview's picture: an absolute URL, or the backend's own `Derp.png`. */
  imageUrl?: string;
  /** A picture's Derpibooru id, when the share is of one picture. */
  imageId?: number;
}

export interface ShareLink {
  url: string;
  /** Whether `url` is a short link, or the long one it fell back to. */
  short: boolean;
}

/**
 * `POST share.php?action=create {image_id?, target_url, title, desc, image_url}` → `{success,
 * share_id}`; the short link is `share.php?id=<share_id>` on this origin. The body is the
 * original front end's, field for field. The token is optional — sent when signed in, so the
 * backend can attribute the share.
 */
export async function createShareLink(
  { targetUrl, title, desc, imageUrl = DEFAULT_SHARE_IMAGE, imageId }: ShareLinkInput,
  { token, signal }: { token?: string | null; signal?: AbortSignal } = {},
): Promise<ShareLink> {
  const fallback: ShareLink = { url: targetUrl, short: false };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const deadline = deadlineSignal(signal, CREATE_DEADLINE_MS);
  try {
    const response = await fetch(`${SHARE_ENDPOINT}?action=create`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...(imageId !== undefined ? { image_id: imageId } : {}),
        target_url: targetUrl,
        title,
        desc,
        image_url: imageUrl,
      }),
      cache: 'no-store',
      signal: deadline.signal,
    });
    /* The backend's error pages are HTML; only a JSON answer can carry an id. */
    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('application/json')) {
      void response.body?.cancel().catch(() => {});
      return fallback;
    }
    const data: unknown = await response.json().catch(() => null);
    const id = data && typeof data === 'object' ? (data as { success?: unknown; share_id?: unknown }) : null;
    const shareId = id?.success === true && (typeof id.share_id === 'string' || typeof id.share_id === 'number')
      ? String(id.share_id).trim()
      : '';
    if (!shareId) return fallback;
    const url = new URL(SHARE_ENDPOINT, window.location.origin);
    url.searchParams.set('id', shareId);
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
 * `POST api.php?action=track_share` — counts a share toward the signed-in account's share tasks.
 * Fire and forget, as the original front end did: a failure costs a count, never the share.
 */
export function trackShare(token: string | null | undefined): void {
  if (!token) return;
  void picponyRequest('track_share', { token, method: 'POST' })
    .then((response) => readEnvelope(response))
    .then(async () => {
      if (readToken() !== token) return;
      /* The account may return to a still-cached task screen immediately after sharing.
         Lazy lookup keeps the transport module outside the resource catalogue's cycle. */
      const { tasks } = await import('@/lib/resources');
      if (readToken() === token) tasks.expire({ token });
    })
    .catch(() => {});
}
