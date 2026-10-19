import { MAX_MESSAGE, obj, positiveId, str, type AssistantReceipt } from './protocol';
import { LS_KEYS } from '@/lib/constants';
import { randomId } from '@/lib/utils';

export interface JournalStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export interface PendingChat { requestId: string; message: string }
/** An exchange in flight: the revisions it was sent against travel with the request id, since a
 *  replay must repeat the same body to be recognised (`assistant_quota::exchange`). */
export interface PendingExchange { requestId: string; coins: number; revision: number; configRevision: number; pointsPerCoin?: number }
export interface JournalEntry { state: 'started' | 'receipt'; receipt?: AssistantReceipt; acknowledged?: boolean }
export const JOURNAL_EVENT = 'picpony-assistant-storage';
export const journalKey = (accountId: string, suffix: string) => `${LS_KEYS.assistantStoragePrefix}:${accountId}:${suffix}`;
export const newRequestId = () => randomId();

export function readJournalText(accountId: string, suffix: string): string | null {
  try { return localStorage.getItem(journalKey(accountId, suffix)); } catch { return null; }
}
export function writeJournalText(accountId: string, suffix: string, value: string | null): void {
  const key = journalKey(accountId, suffix);
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }
  catch { throw new Error('浏览器未能保存操作记录，请允许本地存储后再试'); }
  window.dispatchEvent(new Event(JOURNAL_EVENT));
}
export function sessionKeyFor(accountId: string): string {
  const previous = readJournalText(accountId, 'session');
  if (previous && /^[A-Za-z0-9._-]{1,80}$/.test(previous)) return previous;
  const key = `s_${newRequestId()}`;
  writeJournalText(accountId, 'session', key);
  return key;
}
export function parseExchange(text: string | null): PendingExchange | null {
  try {
    const value = obj(JSON.parse(text || 'null'));
    const coins = positiveId(value.coins);
    const rate = positiveId(value.pointsPerCoin);
    const revision = value.revision, configRevision = value.configRevision;
    if (!Number.isSafeInteger(revision) || !Number.isSafeInteger(configRevision)) return null;
    return coins && coins <= 100000 && str(value.requestId, 100) ? { requestId: str(value.requestId, 100), coins, revision: revision as number, configRevision: configRevision as number, ...(rate && rate <= 10000 ? { pointsPerCoin: rate } : {}) } : null;
  } catch { return null; }
}
export function parsePendingChat(text: string | null): PendingChat | null {
  try {
    const value = obj(JSON.parse(text || 'null'));
    return typeof value.message === 'string' && value.message.length <= MAX_MESSAGE && str(value.requestId, 100) ? { message: value.message, requestId: str(value.requestId, 100) } : null;
  } catch { return null; }
}

/** A persisted intent precedes dispatch; a missing answer is never permission to dispatch again. */
export function createReceiptJournal(storage: JournalStorage, accountId: string) {
  const key = journalKey(accountId, 'receipts');
  function read(): Record<string, JournalEntry> {
    const text = storage.getItem(key);
    if (!text) return {};
    if (text.length > 2_000_000) throw new Error('操作记录过大，请先核对未完成任务');
    return obj(JSON.parse(text)) as Record<string, JournalEntry>;
  }
  function put(id: string, entry: JournalEntry) {
    const entries = read();
    entries[id] = entry;
    for (const [oldId, old] of Object.entries(entries)) {
      if (Object.keys(entries).length <= 128) break;
      if (oldId !== id && old.acknowledged) delete entries[oldId];
    }
    if (Object.keys(entries).length > 128) {
      throw new Error('操作记录已满，请先核对历史任务');
    }
    storage.setItem(key, JSON.stringify(entries));
  }
  return {
    get: (taskId: string, callId: string) => read()[`${taskId}:${callId}`],
    start: (taskId: string, callId: string) => put(`${taskId}:${callId}`, { state: 'started' }),
    save: (receipt: AssistantReceipt) => put(`${receipt.task_id}:${receipt.call_id}`, { state: 'receipt', receipt }),
    acknowledge: (taskId: string, callId: string) => {
      const id = `${taskId}:${callId}`, entry = read()[id];
      if (entry?.state === 'receipt') put(id, { ...entry, acknowledged: true });
    },
  };
}
