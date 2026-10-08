import { parseBackendUtcTime } from '@/lib/format';
import { ApiError } from './errors';
import { listOf, pageCount, picponyPostJson, picponyRequest, readEnvelope } from './http';

/**
 * 浏览历史 — the signed-in account's record of pictures it has opened.
 *
 * Reads are strict (`readEnvelope`: a refusal throws, it never becomes an empty list), and so are
 * the two writes — a delete or a clear that the server refused must not read as done.
 *
 * **Times are UTC.** The original front end read this table's stamps as `new Date(view_time +
 * " UTC")` — one of three columns it reads that way, where every other stamp (comments, profiles)
 * is Beijing wall-clock — so the table is written by the database clock rather than by PHP's. The
 * reading is `lib/format.ts`'s `parseBackendUtcTime`, the one parser for those three (its docstring
 * holds the evidence); each stamp leaves here as an ISO string with `Z`, which every formatter then
 * converts like any other, so a screen never sees the raw column.
 */

/** One row: the picture, and when it was last opened. */
export interface HistoryEntry {
  id: number;
  /** The thumbnail the viewer stored when it opened the picture; `FadeInImage` puts it on the line. */
  previewUrl: string | null;
  uploader: string | null;
  /** ISO 8601 with `Z`, or `null` when the row carries no readable time. */
  viewedAt: string | null;
}

export interface HistoryPage {
  entries: HistoryEntry[];
  totalPages: number;
}

/** A UTC column value as ISO with `Z` (whole seconds stay whole), or `null` when it is not a time. */
export function utcStamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const date = parseBackendUtcTime(value);
  return date ? date.toISOString().replace(/\.000Z$/, 'Z') : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** A wire row as an entry, or `null` for a row without a usable picture id. */
export function historyEntryOf(row: unknown): HistoryEntry | null {
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  const id = Number(record.id ?? record.image_id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return {
    id,
    previewUrl: text(record.preview_url),
    uploader: text(record.uploader),
    /* The most recent view is what the list is about; `view_time` is the older column. */
    viewedAt: utcStamp(record.last_view_time) ?? utcStamp(record.view_time),
  };
}

/**
 * `GET get_browsing_history&page=&date=` — one page, optionally one calendar day (`YYYY-MM-DD`,
 * the original front end's 按日期筛选). A row the page cannot draw is dropped at the boundary.
 */
export async function getBrowsingHistory(
  token: string,
  { page = 1, date }: { page?: number; date?: string | null } = {},
  signal?: AbortSignal,
): Promise<HistoryPage> {
  const data = await readEnvelope<{ history?: unknown; total_pages?: unknown }>(
    await picponyRequest('get_browsing_history', {
      token,
      query: { page, date: date || undefined, _t: Date.now() },
      signal,
    }),
  );
  if (!Array.isArray(data.history)) throw new ApiError('invalid');
  const entries = listOf<unknown>(data.history)
    .map(historyEntryOf)
    .filter((entry): entry is HistoryEntry => entry !== null);
  return { entries, totalPages: pageCount(data.total_pages) };
}

/**
 * `POST delete_browsing_history_item {image_id}` — one row. Throws `ApiError` on a refusal.
 * `keepalive` lets a delete the screen was still holding for 撤销 outlive a closing page.
 */
export async function deleteBrowsingHistoryItem(
  token: string,
  imageId: number,
  options: { keepalive?: boolean } = {},
): Promise<void> {
  await readEnvelope(
    await picponyPostJson('delete_browsing_history_item', { image_id: imageId }, { token, keepalive: options.keepalive }),
  );
}

/**
 * `POST add_browsing_history {image_id, preview_url, uploader}` — what the detail sends when a
 * picture opens; here it puts back a row whose delete already went out, for a late 撤销.
 */
export async function restoreBrowsingHistoryItem(token: string, entry: HistoryEntry): Promise<void> {
  await readEnvelope(
    await picponyPostJson('add_browsing_history', {
      image_id: entry.id,
      preview_url: entry.previewUrl ?? '',
      uploader: entry.uploader ?? '',
    }, { token }),
  );
}

/** `POST clear_browsing_history` (bodyless) — every row. Throws `ApiError` on a refusal. */
export async function clearBrowsingHistory(token: string): Promise<void> {
  await readEnvelope(await picponyRequest('clear_browsing_history', { token, method: 'POST' }));
}
