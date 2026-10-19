'use client';

import { useEffect, useState } from 'react';
import { apiRequest, readApi, seg } from '@/lib/api/http';

/**
 * Previews of the backend's media that an `<img src>` cannot show.
 *
 * `GET /api/v1/media/{asset}` (`src/pg/media.rs` `read`) knows the reader only by its
 * `Authorization` header: a picture is open to everyone once a published post, comment or the
 * profile references it, but a fresh upload that is not yet published — the editor's pictures and
 * a post's cover between upload and 发布 — is the uploader's alone, and a bare `<img>` (which
 * cannot carry the header) gets 404. Such a picture is read with the token and shown as a Blob
 * URL (the media docs' own advice: never a token in an image URL). What is stored and published
 * stays the `/api/v1/media/<asset>` path; only what the editor draws is the Blob URL.
 */

const MEDIA_PATH = /^\/api\/v1\/media\/([0-9a-f]{64})$/;
const MEDIA_IN_TEXT = /\/api\/v1\/media\/[0-9a-f]{64}/g;

/** The asset of a backend media path (`/api/v1/media/<64 hex>`), or `null` for anything else. */
export function mediaAsset(path: string): string | null {
  return MEDIA_PATH.exec(path.trim())?.[1] ?? null;
}

/** Read one media path with the token, as a Blob. Throws `ApiError` on a refusal. */
async function readMedia(token: string, asset: string, signal?: AbortSignal): Promise<Blob> {
  const response = await apiRequest('GET', `/media/${seg(asset)}`, { token, signal, cache: 'no-store', timeoutMs: 60_000 });
  if (!response.ok) await readApi(response);
  return response.blob();
}

// ---------------------------------------------------------------------------
// The editor's previews: one Blob URL per stored path, for the page's lifetime
// ---------------------------------------------------------------------------

/* Kept for the page's lifetime, never revoked: the editor's HTML (and a draft restored into a
   remounted editor) refers to them by URL, and a picture is at most 5MB, a handful a post. */
const previewByPath = new Map<string, string>();
const pathByPreview = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

/** Register a picture's preview from bytes already in hand (the uploaded file itself). */
export function rememberMediaPreview(path: string, blob: Blob): string {
  const known = previewByPath.get(path);
  if (known) return known;
  const url = URL.createObjectURL(blob);
  previewByPath.set(path, url);
  pathByPreview.set(url, path);
  return url;
}

/**
 * A media path's Blob URL preview, read with the token the first time; `null` when it cannot be
 * read (the caller then keeps the path). Anything that is not a backend media path is `null`.
 */
export function mediaPreview(token: string, path: string): Promise<string | null> {
  const known = previewByPath.get(path);
  if (known) return Promise.resolve(known);
  const asset = mediaAsset(path);
  if (!asset) return Promise.resolve(null);
  let read = pending.get(path);
  if (!read) {
    read = readMedia(token, asset)
      .then((blob) => rememberMediaPreview(path, blob))
      .catch(() => null)
      .finally(() => pending.delete(path));
    pending.set(path, read);
  }
  return read;
}

/** The backend media paths in a text that have no preview yet. */
export function mediaWithoutPreview(text: string): string[] {
  return [...new Set(text.match(MEDIA_IN_TEXT) ?? [])].filter((path) => !previewByPath.has(path));
}

/** Editor HTML → what is stored: each preview's Blob URL back to its media path. */
export function storedMediaText(html: string): string {
  if (!html.includes('blob:')) return html;
  let result = html;
  for (const [url, path] of pathByPreview) if (result.includes(url)) result = result.split(url).join(path);
  return result;
}

/** Stored text (as editor HTML) → what the editor draws: each previewed media path as its Blob URL. */
export function previewMediaText(html: string): string {
  if (!html.includes('/api/v1/media/')) return html;
  return html.replace(MEDIA_IN_TEXT, (path) => previewByPath.get(path) ?? path);
}

// ---------------------------------------------------------------------------
// One picture's preview, owned by its component
// ---------------------------------------------------------------------------

/**
 * A backend media path's preview for one component — a Blob URL read with the token, revoked when
 * the path changes or the component leaves. `undefined` while it is read; `null` when the path is
 * not backend media, there is no token, or the read failed (the caller falls back to the path).
 */
export function useMediaPreview(path: string | null, token: string | null): string | null | undefined {
  const asset = path ? mediaAsset(path) : null;
  const wanted = asset && token ? `${token}\n${asset}` : null;
  const [state, setState] = useState<{ key: string; url: string | null } | null>(null);

  useEffect(() => {
    if (!wanted || !asset || !token) return;
    const controller = new AbortController();
    let url: string | null = null;
    readMedia(token, asset, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setState({ key: wanted, url });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ key: wanted, url: null });
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [wanted, asset, token]);

  if (!wanted) return null;
  return state?.key === wanted ? state.url : undefined;
}
