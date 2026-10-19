import { api, seg } from './http';
import { createCursorPager } from './cursorPages';
import { randomId } from '@/lib/utils';

/**
 * 等级与任务 and the coin ledger (金币明细), over the Rust backend: `GET /me/tasks`,
 * `POST /me/tasks/{task}/claims`, `GET /me/coins/transactions` (src/pg/tasks.rs).
 *
 * The weekly upload count is the server's own (`verified_uploads`): there is no "record an
 * upload" call any more — a client-reported count was a way to farm the task.
 */

/** One task's state, as the document reports it. */
export interface TaskProgress {
  progress: number;
  /** The progress at which it can be claimed — the server's threshold. */
  required: number;
  claimed: boolean;
}

export type TaskCategory = 'novice' | 'daily' | 'weekly';

export interface TaskDocument {
  level: number;
  experience: number;
  coins: number;
  /** Progress by the screen's task key within each category; `null` for a category the answer
   *  carried none of. */
  progress: Record<TaskCategory, Record<string, TaskProgress> | null>;
}

/** One row of `tasks` (`period` is the server's `YYYY-MM-DD`, ISO week or `lifetime`). */
interface WireTask {
  task: string;
  period: string;
  progress: number;
  required: number;
  claimed: boolean;
  reward: { coins: number; experience: number };
}

interface WireTasks {
  tasks: WireTask[];
  coins: number;
  experience: number;
  level: number;
}

/** The server's task names, by the screen's category and key (`app/tasks/page.tsx`'s `claimId`). */
const TASK_KEYS: Record<string, { category: TaskCategory; key: string }> = {
  login: { category: 'daily', key: 'login' },
  fav: { category: 'daily', key: 'fav' },
  share: { category: 'daily', key: 'share' },
  comment: { category: 'daily', key: 'comment' },
  weekly_upload: { category: 'weekly', key: 'upload' },
  novice_bind_api: { category: 'novice', key: 'bind_api' },
  novice_verify_api: { category: 'novice', key: 'verify_api' },
  novice_set_bg: { category: 'novice', key: 'set_bg' },
};

/** The wire document, by category. Exported for the tests. */
export function taskDocumentOf(data: WireTasks): TaskDocument {
  const progress: TaskDocument['progress'] = { novice: null, daily: null, weekly: null };
  for (const row of data.tasks) {
    const place = TASK_KEYS[row.task];
    if (!place) continue;
    (progress[place.category] ??= {})[place.key] = {
      progress: row.progress,
      required: row.required,
      claimed: row.claimed,
    };
  }
  return { level: data.level, experience: data.experience, coins: data.coins, progress };
}

/** The level card and every category's progress. */
export async function getTasks(token: string, signal?: AbortSignal): Promise<TaskDocument> {
  return taskDocumentOf(await api<WireTasks>('GET', '/me/tasks', { token, cache: 'no-store', signal }));
}

/** What a claim paid out, as the server reported it. */
export interface ClaimReceipt {
  experience: number;
  coins: number;
  /** The coin balance after the payout. */
  balance: number;
}

/**
 * Claim one task's reward (`taskType` is the server's task name). A write; a refusal (already
 * claimed, not yet complete) throws `ApiError` with the backend's own sentence. The key makes a
 * lost answer safe to press again within this call only — every press is its own claim, and the
 * server refuses a second claim for the period anyway.
 */
export async function claimTask(token: string, taskType: string): Promise<ClaimReceipt> {
  const data = await api<{ reward: { coins: number; experience: number }; balance: number }>(
    'POST',
    `/me/tasks/${seg(taskType)}/claims`,
    { token, idempotencyKey: randomId() },
  );
  return { experience: data.reward.experience, coins: data.reward.coins, balance: data.balance };
}

/**
 * `POST /me/weekly-upload-reports {image_id}` — counts one upload toward the weekly task, after
 * Derpibooru acknowledged it with that id. Fire-and-forget at the call site: the upload itself
 * already succeeded. The submission goes from the browser straight to Derpibooru, so the backend
 * has nothing of its own to count; it takes this report instead, once per image, never past the
 * task's target, and rate-limited per account.
 */
export async function recordWeeklyUpload(token: string, imageId: number): Promise<void> {
  await api('POST', '/me/weekly-upload-reports', { token, json: { image_id: imageId } });
}

// ---------------------------------------------------------------------------
// The coin ledger
// ---------------------------------------------------------------------------

export interface CoinTransaction {
  /** The row's own id. */
  key: string;
  /** Signed: positive earned, negative spent. */
  amount: number;
  /** The balance after this row. */
  balanceAfter: number;
  reason: string;
  /** The backend's stamp (UTC, with its offset), for `lib/format.ts`. */
  createdAt: string;
}

export interface CoinLedgerPage {
  transactions: CoinTransaction[];
  /** The pages known to exist: this one, plus one while the backend says there are more. */
  totalPages: number;
}

interface WireLedgerRow {
  id: number;
  amount: number;
  balance_after: number;
  reason: string;
  source_type: string;
  source_id: string;
  created_at: string;
}

/** Thirty to a page, the screen's page. */
export const COIN_LEDGER_PAGE = 30;

const ledgerPager = createCursorPager();

/** A ledger row. Exported for the tests. */
export function coinTransactionOf(row: WireLedgerRow): CoinTransaction {
  return {
    key: String(row.id),
    amount: row.amount,
    balanceAfter: row.balance_after,
    reason: row.reason.trim(),
    createdAt: row.created_at,
  };
}

/** One page of the ledger, newest first (keyset-paged by the backend; see `cursorPages.ts`). */
export async function getCoinTransactions(
  token: string,
  page: number = 1,
  signal?: AbortSignal,
): Promise<CoinLedgerPage> {
  const result = await ledgerPager.read(`coins:${token}`, page, async (before, s) => {
    const data = await api<{ transactions: WireLedgerRow[]; next_cursor: number | null }>('GET', '/me/coins/transactions', {
      token,
      query: { before, limit: COIN_LEDGER_PAGE },
      cache: 'no-store',
      signal: s,
    });
    return { rows: data.transactions, next: data.next_cursor };
  }, signal);
  return { transactions: result.rows.map(coinTransactionOf), totalPages: result.totalPages };
}
