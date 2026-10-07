import { parseEquippedBadges, type EquippedBadge } from '@/lib/userBadges';
import { ApiError } from './errors';
import { listOf, pageCount, picponyPostJson, picponyRequest, readEnvelope } from './http';

/**
 * 等级与任务 and the coin ledger (金币明细): the account's level, its task progress and every
 * coin it earned or spent.
 *
 * **Nothing is invented at this boundary.** A document without a figure reports `null` for it,
 * and a task category the answer did not carry is `null` rather than a set of zeros — a card
 * that read 「Lv.1 · 金币：0」 over an answer that carried neither was a claim nobody made.
 */

/** One task's state, as the document reports it. */
export interface TaskProgress {
  progress: number;
  claimed: boolean;
}

export type TaskCategory = 'novice' | 'daily' | 'weekly';

export interface TaskDocument {
  level: number | null;
  experience: number | null;
  coins: number | null;
  equippedBadges: EquippedBadge[];
  /** Progress by task id within each category; `null` when the answer carried no such block. */
  progress: Record<TaskCategory, Record<string, TaskProgress> | null>;
}

/** The document's task ids, per category, and where each keeps its two fields. */
const DAILY_IDS = ['login', 'fav', 'share', 'comment'] as const;
const WEEKLY_IDS = ['upload'] as const;

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** `{progress, claimed}` from a pair of fields, or `null` when the progress is not a number. */
function progressOf(progress: unknown, claimed: unknown): TaskProgress | null {
  const value = finite(progress);
  if (value === null) return null;
  return { progress: Math.max(0, value), claimed: Boolean(finite(claimed)) };
}

/** A category whose every task reports a number, or `null` — a partial block is not a block. */
function flatCategory(block: unknown, ids: readonly string[]): Record<string, TaskProgress> | null {
  const source = record(block);
  if (!source) return null;
  const out: Record<string, TaskProgress> = {};
  for (const id of ids) {
    const entry = progressOf(source[`${id}_progress`], source[`${id}_claimed`]);
    if (!entry) return null;
    out[id] = entry;
  }
  return out;
}

/** The novice block nests per task: `{bind_api: {progress, claimed}, …}`. */
function nestedCategory(block: unknown): Record<string, TaskProgress> | null {
  const source = record(block);
  if (!source) return null;
  const out: Record<string, TaskProgress> = {};
  for (const [id, value] of Object.entries(source)) {
    const entry = record(value);
    const parsed = entry ? progressOf(entry.progress, entry.claimed) : null;
    if (parsed) out[id] = parsed;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** The wire document, normalised. Exported for the tests. */
export function taskDocumentOf(data: Record<string, unknown>): TaskDocument {
  const level = finite(data.level);
  const experience = finite(data.experience);
  const coins = finite(data.coins);
  return {
    level: level !== null && level >= 1 ? Math.floor(level) : null,
    experience: experience !== null ? Math.max(0, Math.floor(experience)) : null,
    coins: coins !== null ? Math.max(0, Math.floor(coins)) : null,
    equippedBadges: parseEquippedBadges(data.equipped_badges),
    progress: {
      novice: nestedCategory(data.novice_tasks),
      daily: flatCategory(data.tasks, DAILY_IDS),
      weekly: flatCategory(data.weekly_tasks, WEEKLY_IDS),
    },
  };
}

/** `GET get_tasks` — the level card and every category's progress. */
export async function getTasks(token: string, signal?: AbortSignal): Promise<TaskDocument> {
  const data = await readEnvelope<Record<string, unknown>>(
    await picponyRequest('get_tasks', { token, query: { _t: Date.now() }, signal }),
  );
  return taskDocumentOf(data);
}

/** What a claim paid out, as the server reported it — `null` for a figure it did not send. */
export interface ClaimReceipt {
  experience: number | null;
  coins: number | null;
}

/**
 * `POST claim_task {task_type}`. A write, never retried; a refusal (already claimed, not yet
 * complete) throws `ApiError` with the backend's own sentence.
 */
export async function claimTask(token: string, taskType: string): Promise<ClaimReceipt> {
  const data = await readEnvelope<{ experience?: unknown; coins?: unknown }>(
    await picponyPostJson('claim_task', { task_type: taskType }, { token }),
  );
  return { experience: finite(data.experience), coins: finite(data.coins) };
}

/**
 * `POST record_weekly_upload` — counts one upload toward the weekly task, after Derpibooru
 * acknowledged it. Fire-and-forget at the call site: the upload itself already succeeded.
 */
export async function recordWeeklyUpload(token: string): Promise<void> {
  await readEnvelope(await picponyRequest('record_weekly_upload', { token, method: 'POST' }));
}

// ---------------------------------------------------------------------------
// The coin ledger
// ---------------------------------------------------------------------------

export interface CoinTransaction {
  /** The row's own id, or a synthetic one for a row that carries none (stable within a page). */
  key: string;
  /** Signed: positive earned, negative spent. */
  amount: number;
  reason: string;
  /** The backend's stamp as written (Beijing wall-clock), for `lib/format.ts`. */
  createdAt: string | null;
}

export interface CoinLedgerPage {
  transactions: CoinTransaction[];
  /**
   * The server's page count when it pages, else `null`: the original front end sent no page
   * and drew the whole answer, so an answer without `total_pages` is the whole ledger.
   */
  totalPages: number | null;
}

/** A ledger row, or `null` for one without a readable amount. Exported for the tests. */
export function coinTransactionOf(row: unknown, index: number): CoinTransaction | null {
  const source = record(row);
  if (!source) return null;
  const amount = finite(source.amount);
  if (amount === null) return null;
  const id = finite(source.id);
  const reason = typeof source.reason === 'string' ? source.reason.trim() : '';
  const createdAt = typeof source.created_at === 'string' && source.created_at.trim() ? source.created_at.trim() : null;
  return { key: id !== null ? String(id) : `row-${index}`, amount, reason, createdAt };
}

/** `GET get_coin_transactions&page=` — `{transactions: [{amount, reason, created_at}]}`. */
export async function getCoinTransactions(
  token: string,
  page: number = 1,
  signal?: AbortSignal,
): Promise<CoinLedgerPage> {
  const data = await readEnvelope<{ transactions?: unknown; total_pages?: unknown }>(
    await picponyRequest('get_coin_transactions', { token, query: { page, _t: Date.now() }, signal }),
  );
  if (data.transactions !== undefined && !Array.isArray(data.transactions)) throw new ApiError('invalid');
  const transactions = listOf<unknown>(data.transactions)
    .map(coinTransactionOf)
    .filter((row): row is CoinTransaction => row !== null);
  return {
    transactions,
    totalPages: data.total_pages === undefined || data.total_pages === null ? null : pageCount(data.total_pages),
  };
}
