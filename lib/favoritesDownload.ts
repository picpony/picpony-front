'use client';

/**
 * Downloading favourites as one ZIP — the original front end's 批量下载 and 下载全部, without its
 * JSZip: the pictures are already compressed, so a store-only archive (`lib/zip.ts`) holds them as
 * they are.
 *
 * - **Through the image line**, as every picture in the app is fetched, in the original front
 *   end's order (`$t`): on the PicPony line the worker and then the source, on the CDN line the
 *   source and then the worker, on the direct line the source alone. Before the first picture each
 *   line is asked once whether it answers this origin at all — one read-only GET of a small known
 *   thumbnail with CORS — and a line that does not is tried last rather than first. The probe
 *   orders the lines and never removes the last of them: one dead probe picture (or a transient
 *   5xx on it) once left no line at all, and every picture of the batch "failed" without a single
 *   fetch (G3-008).
 * - **One picture at a time**, so a slow line holds one transfer, and the caller can stop between
 *   any two. A transfer that stalls fails (no bytes for 20 s), and so does one that crawls: past
 *   45 s, one averaging under 128 KiB/s (review P4-F6 — a flat 45 s failed every original over
 *   ~30MB on a 5 Mbit/s line however steadily it arrived, then fetched it again on the next line).
 * - **At most a page an archive** (`ARCHIVE_LIMIT`): a whole privacy space is several archives,
 *   each saved as it is finished, so what a download holds in memory is bounded by one archive of
 *   originals rather than by the size of the space — a phone tab packing a few hundred pictures
 *   into one archive ran out of memory and lost all of it (G3-013).
 * - **Never an empty archive**: none fetched is a failure the caller reports; otherwise the file
 *   is saved and the count of what made it in and what did not is the result.
 * - **Names** are the original front end's (`uniqueEntryName`): the source URL's last segment,
 *   made safe and de-duplicated, `pony_<id>.png` when nothing is left.
 */

import { IMAGE_PROBE_URL } from '@/lib/constants';
import { FAVE_PAGE_SIZE } from '@/lib/favorites';
import { buildImageUrl, getRawImageUrl } from '@/lib/imageLoader';
import { ensureRoutePolicy, isImageForced, resolveImageLine } from '@/lib/route';
import type { PonyImage } from '@/lib/types/image';
import { ZipWriter, uniqueEntryName } from '@/lib/zip';

const STALL_MS = 20_000;
const TRANSFER_MS = 45_000;
/** The slowest average a transfer may keep once past `TRANSFER_MS`: each byte buys this much time. */
const MIN_RATE_BYTES_PER_MS = 128 * 1024 / 1000;
const PROBE_MS = 8_000;

type Line = 'worker' | 'cdn' | 'direct';

/** The lines to try for a picture, in the original front end's order for the visitor's line. */
export function linesFor(current: 'picpony' | 'cdn' | 'direct'): Line[] {
  if (current === 'picpony') return ['worker', 'direct'];
  if (current === 'cdn') return ['direct', 'worker'];
  return ['direct'];
}

function onLine(raw: string, line: Line): string {
  return buildImageUrl(raw, line === 'worker' ? 0 : line === 'cdn' ? 1 : 2);
}

async function fetchWithin(url: string, ms: number, signal?: AbortSignal): Promise<Response> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), ms);
  const forward = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', forward, { once: true });
  try {
    return await fetch(url, { mode: 'cors', credentials: 'omit', signal: controller.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forward);
  }
}

/**
 * The lines to fetch a batch through, best first: the ones that answered the probe, in their
 * order, then the ones that did not. The probe is an optimisation and never a gate — a line it
 * could not reach is tried after the others, never left out.
 */
export async function batchLines(signal?: AbortSignal): Promise<Line[]> {
  await ensureRoutePolicy();
  const line = resolveImageLine();
  const preferred: Line[] = isImageForced() ? [line === 'picpony' ? 'worker' : line] : linesFor(line);
  const answering = await probeLines(preferred, signal);
  return [...answering, ...preferred.filter((each) => !answering.includes(each))];
}

/** Which of `lines` answer this origin with a readable body: one small GET each, in parallel. */
export async function probeLines(lines: readonly Line[], signal?: AbortSignal): Promise<Line[]> {
  const answers = await Promise.all(
    lines.map(async (line) => {
      try {
        const response = await fetchWithin(`${onLine(IMAGE_PROBE_URL, line)}${line === 'direct' ? '?' : '&'}_t=${Date.now()}`, PROBE_MS, signal);
        void response.body?.cancel().catch(() => {});
        return response.ok ? line : null;
      } catch {
        return null;
      }
    }),
  );
  return answers.filter((line): line is Line => line !== null);
}

function isMedia(response: Response): boolean {
  const type = (response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
  return type.startsWith('image/') || type.startsWith('video/') || type === 'application/octet-stream';
}

/**
 * How long a transfer that has received `bytes` may have taken in all: `TRANSFER_MS`, plus the time
 * those bytes would take at `MIN_RATE_BYTES_PER_MS`. Exported for the tests.
 */
export function transferBudgetMs(bytes: number): number {
  return TRANSFER_MS + bytes / MIN_RATE_BYTES_PER_MS;
}

/** The body as bytes, failing if no bytes arrive for `STALL_MS` or it falls behind `transferBudgetMs`. */
async function readBytes(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const forward = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', forward, { once: true });
  const started = Date.now();
  const timeout = () => controller.abort(new DOMException('timeout', 'TimeoutError'));
  let overall = setTimeout(timeout, transferBudgetMs(0));
  let stall = setTimeout(() => controller.abort(new DOMException('stalled', 'TimeoutError')), STALL_MS);
  try {
    const response = await fetch(url, { mode: 'cors', credentials: 'omit', signal: controller.signal });
    if (!response.ok || !isMedia(response)) {
      void response.body?.cancel().catch(() => {});
      throw new Error(`HTTP ${response.status}`);
    }
    const reader = response.body?.getReader();
    if (!reader) return new Uint8Array(await response.arrayBuffer());
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      clearTimeout(stall);
      if (done) break;
      chunks.push(value);
      length += value.length;
      clearTimeout(overall);
      overall = setTimeout(timeout, Math.max(0, started + transferBudgetMs(length) - Date.now()));
      stall = setTimeout(() => controller.abort(new DOMException('stalled', 'TimeoutError')), STALL_MS);
    }
    const bytes = new Uint8Array(length);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.length;
    }
    return bytes;
  } finally {
    clearTimeout(overall);
    clearTimeout(stall);
    signal?.removeEventListener('abort', forward);
  }
}

/** The original's URL, raw — the record's `view_url`, else its `full` rendition. */
export function originalUrl(image: Pick<PonyImage, 'view_url' | 'representations'>): string {
  return getRawImageUrl(image.view_url || image.representations?.full || '');
}

export interface ZipOutcome {
  packed: number;
  failed: number;
  /** Stopped by the caller before the end. */
  cancelled: boolean;
  /** `null` when nothing could be fetched: no empty archive is made. */
  archive: Blob | null;
}

/**
 * Fetch `images` and pack them. `onProgress` hears each picture's end, fetched or not. Resolves
 * with what was packed; a cancel keeps what had arrived (the caller decides whether to save it).
 * `lines` is a batch's already probed (`batchLines`), so its archives share one probe.
 */
export async function packFavourites(
  images: readonly Pick<PonyImage, 'id' | 'view_url' | 'representations'>[],
  {
    signal,
    onProgress,
    lines: given,
  }: { signal?: AbortSignal; onProgress?: (done: number, failed: number, total: number) => void; lines?: readonly Line[] } = {},
): Promise<ZipOutcome> {
  signal?.throwIfAborted();
  if (images.length === 0) return { packed: 0, failed: 0, cancelled: false, archive: null };
  const lines = given ?? (await batchLines(signal));
  const zip = new ZipWriter();
  const taken = new Set<string>();
  let failed = 0;
  let done = 0;
  for (const image of images) {
    if (signal?.aborted) break;
    const raw = originalUrl(image);
    let bytes: Uint8Array | null = null;
    for (const line of raw ? lines : []) {
      if (signal?.aborted) break;
      try {
        bytes = await readBytes(onLine(raw, line), signal);
        break;
      } catch {
        /* The next line, if any. */
      }
    }
    if (bytes && bytes.length > 0) zip.add(uniqueEntryName(raw, `pony_${image.id}.png`, taken), bytes);
    else if (!signal?.aborted) failed += 1;
    done += 1;
    onProgress?.(done, failed, images.length);
  }
  const cancelled = Boolean(signal?.aborted);
  return { packed: zip.count, failed, cancelled, archive: zip.count > 0 ? zip.finish() : null };
}

/** At most this many pictures in one archive: a grid page, the most a selection holds. */
export const ARCHIVE_LIMIT = FAVE_PAGE_SIZE;

export interface ArchivesOutcome {
  packed: number;
  failed: number;
  cancelled: boolean;
  /** How many archives were handed over (`onArchive`). */
  archives: number;
}

/**
 * Fetch and pack `images` in archives of at most `ARCHIVE_LIMIT`, each handed to `onArchive` as
 * soon as it is finished — so it can be saved and let go before the next one is fetched — with
 * its place among them (`part` of `parts`). Progress counts across the whole batch. A cancel ends
 * the run; archives already handed over stay handed over, and the one in progress is dropped.
 */
export async function packArchives(
  images: readonly Pick<PonyImage, 'id' | 'view_url' | 'representations'>[],
  {
    signal,
    onProgress,
    onArchive,
  }: {
    signal?: AbortSignal;
    onProgress?: (done: number, failed: number, total: number) => void;
    onArchive: (archive: Blob, part: number, parts: number) => void;
  },
): Promise<ArchivesOutcome> {
  signal?.throwIfAborted();
  const result: ArchivesOutcome = { packed: 0, failed: 0, cancelled: false, archives: 0 };
  if (images.length === 0) return result;
  const lines = await batchLines(signal);
  const parts = Math.ceil(images.length / ARCHIVE_LIMIT);
  for (let part = 0; part < parts; part += 1) {
    const slice = images.slice(part * ARCHIVE_LIMIT, (part + 1) * ARCHIVE_LIMIT);
    const before = { done: part * ARCHIVE_LIMIT, failed: result.failed };
    const outcome = await packFavourites(slice, {
      signal,
      lines,
      onProgress: (done, failed) => onProgress?.(before.done + done, before.failed + failed, images.length),
    });
    result.failed += outcome.failed;
    if (outcome.cancelled) {
      result.cancelled = true;
      return result;
    }
    result.packed += outcome.packed;
    if (outcome.archive) {
      onArchive(outcome.archive, part + 1, parts);
      result.archives += 1;
    }
  }
  return result;
}

/** One stamp for a batch; a batch of several archives numbers them: `_2of3`. */
export function archiveName(stamp: number, part = 1, parts = 1): string {
  return parts > 1 ? `picpony_batch_${stamp}_${part}of${parts}.zip` : `picpony_batch_${stamp}.zip`;
}

/** Hand the archive to the browser's own download, under the original front end's name. */
export function saveArchive(archive: Blob, name = archiveName(Date.now())) {
  const href = URL.createObjectURL(archive);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = name;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  /* Revoked a beat later: revoking in the same task cancels the download in some engines. */
  setTimeout(() => URL.revokeObjectURL(href), 30_000);
}

/** 已打包 3 张，失败 1 张 — and, for a batch saved in several archives, how many: 分为 3 个压缩包. */
export function packedSentence(packed: number, failed: number, archives = 1): string {
  const split = archives > 1 ? `，分为 ${archives} 个压缩包` : '';
  /* The failure counted as every count sentence counts it (`runSummary`'s `，M 张失败`). */
  return failed > 0 ? `已打包 ${packed} 张${split}，${failed} 张失败` : `已打包 ${packed} 张${split}`;
}
