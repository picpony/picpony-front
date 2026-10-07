/**
 * Saving a picture's original file — the one path, shared by the detail's 下载原图 and the
 * lightbox's own download control, which used to disagree about the file's name and about what
 * counted as a success.
 *
 * - **Through the visitor's image line first, then direct** — the original front end's order: a
 *   visitor who cannot reach derpicdn.net gets the file through the line the pictures come by,
 *   and a line that fails falls back to the source only when the site has not forced a line.
 * - **Only a picture is saved.** A response that is not OK, or whose type is not an image or a
 *   video, is a failure — an error page saved as `123.png` was the old outcome.
 * - **A name that survives the lines**: `<id>.<format>`. The last path segment of a line-wrapped
 *   URL was the proxy's query string.
 * - **A stalled transfer fails** rather than spinning for ever: no bytes for `STALL_MS` aborts it.
 *
 * The blob round trip is what lets `download` name a cross-origin file (the attribute is ignored
 * for another origin's URL). A failure throws `ApiError`; the caller reports it and offers the
 * file in a new tab, from the tap on the toast (a fresh gesture, which a popup blocker allows).
 */

import { ApiError, toApiError } from '@/lib/api/errors';
import { getRawImageUrl, toCurrentImageLine } from '@/lib/imageLoader';
import { ensureRoutePolicy, isImageForced } from '@/lib/route';

/** No bytes for this long ends a transfer. Large originals are slow, but never silent. */
const STALL_MS = 20_000;

export interface DownloadSource {
  id: number;
  /** The original's URL — the record's `full` or `view_url`, on any line. */
  url: string;
  /** The record's `format`; otherwise read from the URL. */
  format?: string | null;
}

const KNOWN_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'webm', 'mp4', 'apng']);

/** `3901120.png` — the file name a download is given. */
export function downloadName({ id, url, format }: DownloadSource): string {
  const fromFormat = (format ?? '').toLowerCase().replace(/^\./, '');
  const fromUrl = getRawImageUrl(url).split(/[?#]/, 1)[0].split('.').pop()?.toLowerCase() ?? '';
  const extension = KNOWN_EXTENSIONS.has(fromFormat) ? fromFormat : KNOWN_EXTENSIONS.has(fromUrl) ? fromUrl : '';
  return extension ? `${id}.${extension}` : String(id);
}

/** The URLs to try, in order: the visitor's line, then the source itself. */
export function downloadCandidates(url: string): string[] {
  const raw = getRawImageUrl(url);
  return [...new Set((isImageForced() ? [toCurrentImageLine(raw)] : [toCurrentImageLine(raw), raw]).filter(Boolean))];
}

function isMedia(response: Response): boolean {
  const type = (response.headers.get('content-type') ?? '').toLowerCase();
  return type.startsWith('image/') || type.startsWith('video/') || type === 'application/octet-stream';
}

/** Read the body, failing if it stalls; the caller's abort is kept. */
async function readBlob(response: Response, controller: AbortController): Promise<Blob> {
  const reader = response.body?.getReader();
  if (!reader) return response.blob();
  const parts: BlobPart[] = [];
  let timer = setTimeout(() => controller.abort(new DOMException('stalled', 'TimeoutError')), STALL_MS);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      clearTimeout(timer);
      if (done) break;
      parts.push(value as Uint8Array<ArrayBuffer>);
      timer = setTimeout(() => controller.abort(new DOMException('stalled', 'TimeoutError')), STALL_MS);
    }
  } finally {
    clearTimeout(timer);
  }
  return new Blob(parts, { type: response.headers.get('content-type') ?? '' });
}

/** Hand a blob to the browser's own download. */
function save(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = name;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  /* Revoked a beat later: revoking in the same task cancels the download in some engines. */
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/**
 * Download the original. Resolves once the browser has the file; throws `ApiError` when every
 * line failed (the last failure's), or the caller's `AbortError` when it cancelled.
 */
export async function downloadOriginal(source: DownloadSource, signal?: AbortSignal): Promise<void> {
  await ensureRoutePolicy();
  let lastError: unknown = new ApiError('network');
  for (const candidate of downloadCandidates(source.url)) {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const forward = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', forward, { once: true });
    const headersTimer = setTimeout(() => controller.abort(new DOMException('stalled', 'TimeoutError')), STALL_MS);
    try {
      const response = await fetch(candidate, { signal: controller.signal });
      clearTimeout(headersTimer);
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        lastError = new ApiError('http', { status: response.status });
        continue;
      }
      if (!isMedia(response)) {
        void response.body?.cancel().catch(() => {});
        lastError = new ApiError('invalid', { status: response.status });
        continue;
      }
      save(await readBlob(response, controller), downloadName(source));
      return;
    } catch (error) {
      if (signal?.aborted) throw error;
      const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
      lastError = timedOut ? new ApiError('timeout', { cause: error }) : toApiError(error);
    } finally {
      clearTimeout(headersTimer);
      signal?.removeEventListener('abort', forward);
    }
  }
  throw lastError;
}
