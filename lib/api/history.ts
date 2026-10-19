import { parseBackendUtcTime } from '@/lib/format';
import { randomId } from '@/lib/utils';
import { ApiError } from './errors';
import { api, seg } from './http';

/**
 * 浏览历史 — the signed-in account's record of pictures it has opened (Rust: `src/pg/browsing.rs`).
 *
 * Reads are strict (a refusal throws, it never becomes an empty list), and so are the writes — a
 * delete or a clear that the server refused must not read as done.
 *
 * **Every write is versioned.** The history has one revision per account; a write names the one
 * it was made against (`expected_revision`) and carries an `Idempotency-Key`, and a stale revision
 * is refused (409 `HISTORY_CONFLICT`) — opening any picture, in any tab, moves it on. The latest
 * revision this tab has seen is kept here per token (every read and write reports it), and the
 * tab's writes go one at a time. A delete of one row or a clear means the same thing whatever was
 * visited meanwhile, so a conflict re-reads the revision and sends it once more, under a new key.
 *
 * Times are the backend's ISO 8601 UTC stamps (`viewed_at`), which every formatter reads.
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

/** A row as the backend sends it. */
export interface HistoryRow {
  image_id: number;
  /** `''` when the viewer stored none. */
  preview_url: string;
  uploader: string;
  viewed_at: string;
  previous_viewed_at: string | null;
}

export function historyEntryOf(row: HistoryRow): HistoryEntry {
  return {
    id: row.image_id,
    previewUrl: row.preview_url || null,
    uploader: row.uploader || null,
    viewedAt: utcStamp(row.viewed_at),
  };
}

/** The latest revision each token's history is known to be at. */
const revisions = new Map<string, number>();

function noteRevision(token: string, revision: number) {
  revisions.set(token, revision);
}

/** The revision to write against: the one last seen, or a one-row read for it. */
async function currentRevision(token: string, fresh = false): Promise<number> {
  const known = revisions.get(token);
  if (known !== undefined && !fresh) return known;
  const data = await api<{ revision: number }>('GET', '/me/browsing-history', { token, cache: 'no-store', query: { page: 1, limit: 1 } });
  noteRevision(token, data.revision);
  return data.revision;
}

interface WriteAnswer {
  current_revision: number;
}

/** Each token's writes in flight, one after another: concurrent writes would race for one revision. */
const queues = new Map<string, Promise<unknown>>();

/**
 * One versioned write, queued behind the token's earlier ones; a stale revision is read again and
 * the write sent once more.
 */
function versioned(
  token: string,
  send: (revision: number, key: string) => Promise<WriteAnswer>,
): Promise<WriteAnswer> {
  const write = async () => {
    let answer: WriteAnswer;
    try {
      answer = await send(await currentRevision(token), randomId());
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'HISTORY_CONFLICT')) throw error;
      answer = await send(await currentRevision(token, true), randomId());
    }
    noteRevision(token, answer.current_revision);
    return answer;
  };
  const previous = queues.get(token) ?? Promise.resolve();
  const next = previous.then(write, write);
  const tail = next.catch(() => {});
  queues.set(token, tail);
  void tail.then(() => { if (queues.get(token) === tail) queues.delete(token); });
  return next;
}

/**
 * `GET /me/browsing-history?page=&limit=&date=` — one page, optionally one calendar day
 * (`YYYY-MM-DD`, Beijing — the original front end's 按日期筛选). `limit` is the backend's default.
 */
export async function getBrowsingHistory(
  token: string,
  { page = 1, date }: { page?: number; date?: string | null } = {},
  signal?: AbortSignal,
): Promise<HistoryPage> {
  const data = await api<{ revision: number; entries: HistoryRow[]; total_pages: number }>('GET', '/me/browsing-history', {
    token,
    signal,
    cache: 'no-store',
    query: { page, date: date || undefined },
  });
  noteRevision(token, data.revision);
  return { entries: data.entries.map(historyEntryOf), totalPages: Math.max(1, data.total_pages) };
}

/**
 * `PUT /me/browsing-history/{image_id} {expected_revision, preview_url?, uploader?}` — what the
 * detail sends when a picture opens (it moves the row to the top). `previewUrl` must be an
 * `https:` URL without credentials or a fragment (the backend refuses anything else), so any
 * other value is left out rather than failing the visit.
 */
export async function recordBrowsingHistory(
  token: string,
  visit: { imageId: number; previewUrl?: string | null; uploader?: string | null },
): Promise<void> {
  const preview = visit.previewUrl && /^https:\/\/[^\s#@]+$/i.test(visit.previewUrl) ? visit.previewUrl : undefined;
  const uploader = visit.uploader?.trim() || undefined;
  await versioned(token, (revision, key) =>
    api<WriteAnswer>('PUT', `/me/browsing-history/${seg(visit.imageId)}`, {
      token,
      json: { expected_revision: revision, ...(preview ? { preview_url: preview } : {}), ...(uploader ? { uploader } : {}) },
      idempotencyKey: key,
    }));
}

/**
 * `DELETE /me/browsing-history/{image_id} {expected_revision}` — one row. Throws `ApiError` on a
 * refusal. `keepalive` lets a delete the screen was still holding for 撤销 outlive a closing page.
 */
export async function deleteBrowsingHistoryItem(
  token: string,
  imageId: number,
  options: { keepalive?: boolean } = {},
): Promise<void> {
  await versioned(token, (revision, key) =>
    api<WriteAnswer>('DELETE', `/me/browsing-history/${seg(imageId)}`, {
      token,
      json: { expected_revision: revision },
      idempotencyKey: key,
      keepalive: options.keepalive,
    }));
}

/**
 * Put back a row whose delete already went out, for a late 撤销 — the visit is recorded again
 * (`recordBrowsingHistory`), so it returns at the top with a new time: the backend has no other
 * way back.
 */
export async function restoreBrowsingHistoryItem(token: string, entry: HistoryEntry): Promise<void> {
  await recordBrowsingHistory(token, { imageId: entry.id, previewUrl: entry.previewUrl, uploader: entry.uploader });
}

/** `DELETE /me/browsing-history {expected_revision}` — every row. Throws `ApiError` on a refusal. */
export async function clearBrowsingHistory(token: string): Promise<void> {
  await versioned(token, (revision, key) =>
    api<WriteAnswer>('DELETE', '/me/browsing-history', {
      token,
      json: { expected_revision: revision },
      idempotencyKey: key,
    }));
}
