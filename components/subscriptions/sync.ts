'use client';

import {
  finalizeTagSubscriptionSync,
  newSyncToken,
  normaliseTagName,
  syncTagSubscriptions,
  type TagCountUpdate,
  type TagSubscription,
} from '@/lib/api/tagSubscriptions';
import { TAG_COUNT_BATCH } from '@/lib/api/derpi';
import { apiErrorStatus } from '@/lib/api/errors';
import { readToken } from '@/lib/hooks';
import { derpiTagCounts, tagSubscriptions, unreadCounts } from '@/lib/resources';

/**
 * The tag-subscription sync: the only way the backend learns that a subscribed tag gained
 * pictures, and so the source of every `[tag_subscription|…]` notification.
 *
 * One run, as the original front end's `Ln()`: read the list; for each fifty, read their live
 * counts from Derpibooru and report the ones found (`sync_tag_subscriptions`, all under one
 * `sync_token`); then `finalize_tag_subscription_sync`, which compares, raises each updated
 * subscription's count of new pictures and writes its notification; re-read the list.
 *
 * **When**, also the original's: once per tab session and account — at load and right after a
 * sign-in — then every ten minutes while the tab is in view, and on returning to it, never
 * twice within a minute. The stamp lives in `sessionStorage` under the original's key, so a
 * reload does not sync again inside the ten minutes (the original lost its clock on a reload
 * and synced on the first return to the tab).
 *
 * **Never on the critical path, never a storm.** The shell schedules it on an idle callback;
 * Derpibooru's reads are background-priority on its lane (which can never take a screen's last
 * slot); a rate limit ends the run's reads; one failed run waits for the next turn of the
 * schedule rather than retrying; and a run whose account signed out midway stops writing.
 */

/** The original front end's `sessionStorage` key, per token. Holds when the last run finished. */
const STAMP_PREFIX = 'tag_subscription_sync_v2_';
/** Between two runs while the tab is in view. */
export const SYNC_PERIOD_MS = 10 * 60 * 1000;
/** The least time between two attempts for one account, failed ones included. */
export const SYNC_MIN_GAP_MS = 60 * 1000;

function stampKey(token: string) {
  return `${STAMP_PREFIX}${token}`;
}

/** When the last successful run for `token` finished in this tab session, or `null`. */
export function lastSyncAt(token: string): number | null {
  try {
    const raw = sessionStorage.getItem(stampKey(token));
    if (raw === null) return null;
    const at = Number(raw);
    /* The original wrote "1" — a run happened this session, time unknown: as old as it gets. */
    return Number.isFinite(at) ? at : 0;
  } catch {
    return null;
  }
}

function stamp(token: string, at: number) {
  try {
    sessionStorage.setItem(stampKey(token), String(at));
  } catch {
    /* Storage refused: the next load syncs again, which costs requests, not correctness. */
  }
}

export interface SyncResult {
  ok: boolean;
  /** Subscriptions the backend found new pictures for. */
  updatedTags: number;
}

let running: { token: string; promise: Promise<SyncResult> } | null = null;
const attempts = new Map<string, number>();

/** Whether `token` is still the signed-in account — checked between steps. */
const current = (token: string) => readToken() === token;

async function run(token: string, now: () => number): Promise<SyncResult> {
  const failed: SyncResult = { ok: false, updatedTags: 0 };
  /* The list as the shell already has it — the drawer reads it on every signed-in document. The
     resource joins a read already in flight, answers from a fresh entry and retries a failed one,
     so a list that failed earlier costs this run one read rather than blocking every later run
     for the tab's life (G3-017: the old guard skipped on any error of any age, and the 60-second
     gate below was spent on each skip). Runs are at least `SYNC_MIN_GAP_MS` apart, which bounds
     those retries. */
  let list: TagSubscription[];
  try {
    list = await tagSubscriptions.read({ token }, { priority: 'background' });
  } catch {
    return failed;
  }
  if (!current(token)) return failed;
  if (list.length === 0) {
    stamp(token, now());
    return { ok: true, updatedTags: 0 };
  }

  const syncToken = newSyncToken();
  /* Whether a count this run reports differs from the one the list holds: only then — or when the
     backend found new pictures — does the list read afterwards answer anything new. */
  let moved = false;
  for (let start = 0; start < list.length; start += TAG_COUNT_BATCH) {
    const batch = list.slice(start, start + TAG_COUNT_BATCH);
    let counts: Record<string, number>;
    try {
      counts = await derpiTagCounts.read(
        { tags: batch.map((entry) => normaliseTagName(entry.tagName)) },
        { priority: 'background', force: true },
      );
    } catch (error) {
      /* A rate limit is the caller's: asking for the next fifty would only spend it again. */
      if (apiErrorStatus(error) === 429) break;
      continue;
    }
    if (!current(token)) return failed;
    const updates: TagCountUpdate[] = [];
    for (const entry of batch) {
      const count = counts[normaliseTagName(entry.tagName)];
      if (typeof count !== 'number') continue;
      updates.push({ tag_name: entry.tagName, image_count: count });
      if (count !== entry.imageCount) moved = true;
    }
    if (updates.length === 0) continue;
    try {
      await syncTagSubscriptions(token, syncToken, updates);
    } catch {
      /* One batch the backend refused: the others still count, as in the original. */
    }
  }
  if (!current(token)) return failed;

  let updatedTags: number;
  try {
    ({ updatedTags } = await finalizeTagSubscriptionSync(token, syncToken));
  } catch {
    return failed;
  }
  /* The backend has finished for that account; this tab writes nothing more for it once it has
     signed out (G3-023) — no stamp under its key, no forced re-read, no expired badge. */
  if (!current(token)) return { ok: true, updatedTags };
  stamp(token, now());
  /* The new counts, and — when there are any — the notifications that came with them. A run that
     found every count where the list already had it changed nothing the list shows, and the shell
     has just read it: a second read would only repeat the drawer's. */
  if (updatedTags > 0 || moved) void tagSubscriptions.read({ token }, { force: true, priority: 'background' }).catch(() => {});
  if (updatedTags > 0) unreadCounts.expire({ token });
  return { ok: true, updatedTags };
}

/** Run once now, joining a run already going for the same account. */
export function syncTagSubscriptionsNow(token: string, now: () => number = Date.now): Promise<SyncResult> {
  if (running?.token === token) return running.promise;
  attempts.set(token, now());
  const promise = run(token, now).finally(() => {
    if (running?.promise === promise) running = null;
  });
  running = { token, promise };
  return promise;
}

/**
 * One scheduled attempt: a run, its result handed to `onResult` — and nothing else. It never
 * rejects: it is started from a timer in the root layout on every signed-in load, and neither a
 * run nor the handler (a toast) may leave an unhandled rejection behind (G3-016).
 */
export function attemptSync(token: string, onResult: (result: SyncResult) => void): Promise<void> {
  return syncTagSubscriptionsNow(token).then(onResult).catch(() => {});
}

/** The first run of a tab session for this account: due when nothing has run yet. */
export function loadSyncDue(token: string): boolean {
  return lastSyncAt(token) === null;
}

/** A periodic run: due ten minutes after the last one, never within a minute of an attempt. */
export function periodicSyncDue(token: string, at: number = Date.now()): boolean {
  if (running?.token === token) return false;
  const last = lastSyncAt(token);
  if (last !== null && at - last < SYNC_PERIOD_MS) return false;
  const tried = attempts.get(token);
  return tried === undefined || at - tried >= SYNC_MIN_GAP_MS;
}
