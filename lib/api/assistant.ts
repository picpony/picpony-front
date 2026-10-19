import { readToken } from '@/lib/hooks';
import { randomId } from '@/lib/utils';
import { ApiError } from './errors';
import { api, seg, type ApiOptions } from './http';
import { parseSemanticQuery } from './semantic';
import {
  parseState, uuid,
  type AssistantClientCall, type AssistantPending, type AssistantQuota, type AssistantReceipt, type AssistantTaskPoll, type JsonObject, type PermissionMode,
} from '@/lib/assistant/protocol';
import { READ_ENDPOINTS } from '@/lib/assistant/actions';

export type { AssistantClientCall };

/*
 * 彩彩 on the Rust backend. Two families of resources, both under `/api/v1/me/assistant`:
 *
 * - the legacy bridge (`pg::assistant_legacy`): `chat`, `state`, `run-task`, `api-claims`,
 *   `receipts` — task-style envelopes that still carry `success`, which is the backend's real
 *   answer on these routes (`chat` answers HTTP 200 `{success:false,error:'assistant_not_ready'}`);
 * - native resources: runtime, quota, preferences, permissions, conversations, and the per-action
 *   confirmation (`action-requests/{id}/confirmations`).
 *
 * A turn runs on the server. `chat` only queues it (`status:'queued'`, empty reply); the client
 * polls `state` with the task id until it is terminal or waiting for a confirmation.
 */

export function assertAssistantAccount(token: string) {
  if (!token || readToken() !== token) throw new ApiError('envelope', { serverMessage: '账号已切换，请重新打开彩彩 AI' });
}

/** One request on behalf of `token`, refused before and after if another account took the screen. */
async function call<T>(method: string, path: string, token: string, options: Omit<ApiOptions, 'token'> = {}): Promise<T> {
  assertAssistantAccount(token);
  const data = await api<T>(method, path, { ...options, token });
  assertAssistantAccount(token);
  return data;
}

/**
 * A definitive refusal: the backend answered and nothing happened (a 4xx other than an expired
 * session or a rate limit), or `chat` reported the model not ready. Callers drop their retry
 * journal on it; anything else may have reached the backend.
 */
export class AssistantRefusal extends ApiError {
  constructor(message?: string, init: { status?: number; code?: string } = {}) { super('envelope', { serverMessage: message, ...init }); }
}
function refusal(error: unknown): never {
  if (error instanceof ApiError && error.kind === 'http' && error.status && error.status >= 400 && error.status < 500 && ![401, 408, 429].includes(error.status)) {
    throw new AssistantRefusal(error.serverMessage, { status: error.status, code: error.code });
  }
  throw error;
}

/** `assistant_quota::snapshot` — every count is a bigint the backend computes; `revision`s guard writes. */
interface QuotaWire {
  enabled: boolean; user_enabled: boolean; revision: number; config_revision: number;
  daily_points: number; points_per_coin: number; daily_remaining: number; purchased_remaining: number;
  remaining: number; reserved: number; coins: number;
}
export function parseQuota(raw: QuotaWire): AssistantQuota {
  return {
    enabled: raw.enabled, user_enabled: raw.user_enabled, revision: raw.revision, config_revision: raw.config_revision,
    remaining: raw.remaining, daily_remaining: raw.daily_remaining, purchased_remaining: raw.purchased_remaining,
    reserved: raw.reserved, daily_points: raw.daily_points, points_per_coin: raw.points_per_coin, coins: raw.coins,
  };
}

/** `GET /me/assistant/runtime` — whether a model is configured, and the site switch in `quota.enabled`. */
export async function getAssistantConfig(token: string, signal?: AbortSignal) {
  const raw = await call<{ model_configured: boolean; quota: QuotaWire }>('GET', '/me/assistant/runtime', token, { signal });
  const enabled = raw.model_configured && raw.quota.enabled;
  return { enabled, message: !raw.quota.enabled ? '彩彩 AI 已暂停' : raw.model_configured ? '' : '彩彩 AI 暂未开放' };
}

/** `POST /me/assistant/state {}` — the account's one cloud conversation: last 30 messages, active tasks and their issued `client_calls`. */
export async function getAssistantState(token: string, signal?: AbortSignal) {
  return parseState(await call<JsonObject>('POST', '/me/assistant/state', token, { json: {}, signal, timeoutMs: 15_000 }));
}

/**
 * `POST /me/assistant/state {task_id}` — one turn: its state, its final visible reply and the calls
 * the server issued to this client that still wait for a receipt (`task.client_calls`).
 */
export async function pollAssistantTask(token: string, taskId: string, signal?: AbortSignal): Promise<AssistantTaskPoll> {
  const data = await call<{ task: { id: string; status: string; result: { reply: string; ok: boolean }; client_calls: AssistantClientCall[] } }>(
    'POST', '/me/assistant/state', token, { json: { task_id: taskId }, signal, timeoutMs: 15_000 });
  const { task } = data;
  return { id: task.id, status: task.status, reply: task.result.reply, ok: task.result.ok, client_calls: task.client_calls };
}

/** `POST /me/assistant/run-task {task_id}` — the turn's state and its pending confirmation, if any. */
export async function getAssistantPending(token: string, taskId: string, signal?: AbortSignal): Promise<{ status: string; pending: AssistantPending | null }> {
  const data = await call<{ status: string; pending_confirmation: AssistantPending | null }>(
    'POST', '/me/assistant/run-task', token, { json: { task_id: taskId }, signal, timeoutMs: 15_000 });
  return { status: data.status, pending: data.pending_confirmation };
}

export async function getAssistantQuota(token: string, signal?: AbortSignal) {
  return parseQuota(await call<QuotaWire>('GET', '/me/assistant/quota', token, { signal }));
}

async function readPermission(token: string, signal?: AbortSignal) {
  return call<{ mode: PermissionMode; revision: number }>('GET', '/me/assistant/permissions', token, { signal });
}
export async function getAssistantPermission(token: string, signal?: AbortSignal): Promise<PermissionMode> {
  return (await readPermission(token, signal)).mode;
}
/** `PUT /me/assistant/permissions` — CAS on the grant's revision, read just before. */
export async function setAssistantPermission(token: string, mode: PermissionMode): Promise<PermissionMode> {
  const { revision } = await readPermission(token);
  const saved = await call<{ mode: PermissionMode }>('PUT', '/me/assistant/permissions', token, {
    json: { expected_revision: revision, mode, ...(mode === 'full' ? { acknowledgement: 'full-account-v1' } : {}) },
    idempotencyKey: randomId(),
  }).catch(refusal);
  return saved.mode;
}
/** `PATCH /me/assistant/preferences {expected_revision, enabled}` — answers the new quota snapshot. */
export async function setAssistantEnabled(token: string, enabled: boolean) {
  const { revision } = await call<QuotaWire>('GET', '/me/assistant/quota', token);
  return parseQuota(await call<QuotaWire>('PATCH', '/me/assistant/preferences', token, {
    json: { expected_revision: revision, enabled }, idempotencyKey: randomId(),
  }).catch(refusal));
}
/**
 * `POST /me/assistant/quota-exchanges` — the revisions are the ones the user saw, kept in the
 * retry journal with the request id: a replay with the same key and body answers the stored
 * receipt instead of exchanging twice.
 */
export async function exchangeAssistantQuota(token: string, pending: { coins: number; requestId: string; revision: number; configRevision: number }) {
  const { coins, requestId, revision, configRevision } = pending;
  if (!Number.isSafeInteger(coins) || coins < 1 || coins > 100000 || !requestId) throw new ApiError('invalid');
  const data = await call<{ quota: QuotaWire }>('POST', '/me/assistant/quota-exchanges', token, {
    json: { expected_revision: revision, expected_config_revision: configRevision, coins }, idempotencyKey: requestId,
  }).catch(refusal);
  return parseQuota(data.quota);
}

/**
 * `POST /me/assistant/chat` — queues one turn. `request_id` must be a UUID and stays the same on a
 * retry (the backend's quota hold is idempotent on it). `message` is at most 2000 characters.
 */
export async function assistantChat(token: string, body: { message: string; request_id: string; session_key: string; page_context: JsonObject }): Promise<{ task_id: string }> {
  const data = await call<{ success: boolean; task_id?: string; error?: string }>('POST', '/me/assistant/chat', token, { json: body }).catch(refusal);
  if (data.success === false) throw new AssistantRefusal(data.error === 'assistant_not_ready' ? '彩彩 AI 暂未就绪，请稍后再试' : '彩彩暂时无法回复');
  const taskId = uuid(data.task_id);
  if (!taskId) throw new ApiError('invalid');
  return { task_id: taskId };
}

/**
 * `POST /me/assistant/action-requests/{id}/confirmations {decision}` — the per-action decision.
 * The idempotency key is the pending id and the decision, so re-sending after a lost answer
 * replays the stored outcome (for a site call: its `call_id` and `request`) instead of failing.
 */
export async function decideAssistantAction(token: string, pendingId: string, decision: 'confirm' | 'reject'): Promise<JsonObject> {
  return call<JsonObject>('POST', `/me/assistant/action-requests/${seg(pendingId)}/confirmations`, token, {
    json: { decision }, idempotencyKey: `${pendingId}-${decision}`,
  }).catch(refusal);
}

/** `POST /me/assistant/api-claims {task_id, call_id}` — `{request}` while issued, `{cached, result}` once answered. */
export const claimAssistantAction = (token: string, taskId: string, callId: string) =>
  call<JsonObject>('POST', '/me/assistant/api-claims', token, { json: { task_id: taskId, call_id: callId } });
/**
 * `POST /me/assistant/receipts {task_id, call_id, result}` — the client's real outcome for one
 * issued call; `result.ok` is required. When it is the turn's last open call the model resumes.
 * A receipt settles no quota (client-reported success is never charged as a task): the turn
 * settles once, when the resumed run finishes, so the panel refreshes its quota after the turn.
 */
export const saveAssistantReceipt = (token: string, receipt: AssistantReceipt) =>
  call<JsonObject>('POST', '/me/assistant/receipts', token, { json: { task_id: receipt.task_id, call_id: receipt.call_id, result: receipt } });

/** The legacy bridge keeps every session in one conversation per account, under this client key. */
const LEGACY_CONVERSATION = 'account-cloud-v1';
async function legacyConversation(token: string): Promise<{ id: string; revision: number } | null> {
  const data = await call<{ conversations: { id: string; client_key: string; revision: number }[] }>('GET', '/me/assistant/conversations', token);
  const found = data.conversations.find(row => row.client_key === LEGACY_CONVERSATION);
  return found ? { id: found.id, revision: found.revision } : null;
}
/** `DELETE /me/assistant/conversations/{id}/messages/{message}` — CAS on the conversation revision. */
export async function deleteAssistantMessage(token: string, messageId: string) {
  const conversation = await legacyConversation(token);
  if (!conversation) return;
  await call('DELETE', `/me/assistant/conversations/${seg(conversation.id)}/messages/${seg(messageId)}`, token, {
    json: { expected_revision: conversation.revision }, idempotencyKey: randomId(),
  });
}
/** `DELETE /me/assistant/conversations/{id}/messages` — clears the history and cancels an active turn. */
export async function clearAssistantHistory(token: string) {
  const conversation = await legacyConversation(token);
  if (!conversation) return;
  await call('DELETE', `/me/assistant/conversations/${seg(conversation.id)}/messages`, token, {
    json: { expected_revision: conversation.revision }, idempotencyKey: randomId(),
  });
}

/**
 * The read-only catalogue endpoints the client executes for `call_site_api` (`READ_ENDPOINTS`,
 * mirroring `mode:"read"` rows of the backend's frozen catalogue), each mapped to its `/api/v1`
 * resource. Only the catalogue's whitelisted query parameters arrive here.
 */
const SITE_READS: Record<string, (token: string, query: Record<string, number>) => Promise<unknown>> = {
  get_faves: (token, query) => call('GET', '/me/favorites', token, { query: query.folder_id ? { folder_id: query.folder_id } : {} }),
  get_recent_contacts: token => call('GET', '/me/contacts', token),
  get_tag_subscriptions: token => call('GET', '/me/tag-subscriptions', token),
  get_my_ponies: token => call('GET', '/me/ponies', token),
};
/** Named read-only capability; neither a URL nor an arbitrary model endpoint can enter. */
export async function readAssistantSiteInfo(token: string, endpoint: string, query: Record<string, number> = {}): Promise<unknown> {
  const read = SITE_READS[endpoint];
  if (!READ_ENDPOINTS.has(endpoint) || !read) throw new ApiError('envelope', { serverMessage: '此读取操作不受支持' });
  return read(token, query);
}

/**
 * The words of an assistant search turned into tags by the site's semantic parse
 * (`lib/api/semantic.ts`, owned by the search migration). The PHP-era `ai_context` /
 * `ai_receipt` cross-check has no counterpart on the Rust backend and is gone.
 */
export async function resolveAssistantSearch(query: string): Promise<{ tags: string[] }> {
  const parsed = await parseSemanticQuery(query, { timeoutMs: 45_000 });
  const tags = parsed.tags.filter(tag => tag.length <= 300).slice(0, 24);
  if (!parsed.enabled || !tags.length) throw new ApiError('envelope', { serverMessage: '未能把这条查询转换为标签，未执行搜索' });
  return { tags };
}
