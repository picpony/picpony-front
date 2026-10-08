import { readToken } from '@/lib/hooks';
import { ApiError } from './errors';
import { envelopeMessage, picponyPostJson, picponyRequest, readObject } from './http';
import {
  obj, parseState, parseTurn, positiveId, str,
  type AssistantQuota, type AssistantReceipt, type AssistantTurn, type JsonObject, type PermissionMode,
} from '@/lib/assistant/protocol';
import { READ_ENDPOINTS } from '@/lib/assistant/actions';

export function assertAssistantAccount(token: string) {
  if (!token || readToken() !== token) throw new ApiError('envelope', { serverMessage: '账号已切换，请重新打开彩彩 AI' });
}
export async function assistantRead(action: 'assistant_config' | 'assistant_state' | 'assistant_quota' | 'assistant_permission', token: string, query?: Record<string, string>, signal?: AbortSignal): Promise<JsonObject> {
  assertAssistantAccount(token);
  const response = await picponyRequest(action, { token, query, signal });
  const data = await readObject<JsonObject>(response);
  assertAssistantAccount(token);
  if (!response.ok) throw new ApiError('http', { status: response.status, serverMessage: envelopeMessage(data) });
  if (data.success !== true) throw new ApiError('envelope', { serverMessage: envelopeMessage(data) });
  return data;
}
type AssistantWrite = 'assistant_chat' | 'assistant_confirm' | 'assistant_action_result' | 'assistant_api_claim' | 'assistant_api_receipt' | 'assistant_delete_message' | 'assistant_clear_history' | 'assistant_permission' | 'assistant_quota_enabled' | 'assistant_quota_exchange';
export async function assistantWrite(action: AssistantWrite, token: string, body: JsonObject): Promise<JsonObject> {
  assertAssistantAccount(token);
  const response = await picponyPostJson(action, body, { token });
  const data = await readObject<JsonObject>(response);
  assertAssistantAccount(token);
  if (!response.ok || data.success !== true) {
    if (response.status === 400 && data.success === false) throw new AssistantRefusal(envelopeMessage(data));
    if (data.success === false) throw new ApiError('envelope', { serverMessage: envelopeMessage(data) });
    throw new ApiError(response.ok ? 'invalid' : 'http', { status: response.status });
  }
  return data;
}
export class AssistantRefusal extends ApiError {
  constructor(message?: string) { super('envelope', { serverMessage: message }); }
}
export function parseQuota(value: unknown): AssistantQuota {
  const raw = obj(value);
  if (typeof raw.enabled !== 'boolean' || typeof raw.user_enabled !== 'boolean') throw new ApiError('invalid');
  const number = (key: string) => {
    const value = raw[key];
    if (value === null || value === '' || typeof value !== 'number' && typeof value !== 'string') throw new ApiError('invalid');
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 0 || key === 'points_per_coin' && (n < 1 || n > 10000)) throw new ApiError('invalid');
    return n;
  };
  return { enabled: raw.enabled, user_enabled: raw.user_enabled,
    remaining: number('remaining'), daily_remaining: number('daily_remaining'), purchased_remaining: number('purchased_remaining'),
    reserved: number('reserved'), daily_points: number('daily_points'), points_per_coin: number('points_per_coin'), coins: number('coins') };
}
export async function getAssistantConfig(token: string, signal?: AbortSignal) {
  const raw = await assistantRead('assistant_config', token, undefined, signal);
  if (typeof raw.enabled !== 'boolean') throw new ApiError('invalid');
  return { enabled: raw.enabled, message: str(raw.error, 300) };
}
export async function getAssistantState(token: string, sessionKey: string, signal?: AbortSignal) {
  return parseState(await assistantRead('assistant_state', token, { session_key: sessionKey }, signal));
}
export async function getAssistantQuota(token: string, signal?: AbortSignal) {
  return parseQuota((await assistantRead('assistant_quota', token, undefined, signal)).quota);
}
export async function getAssistantPermission(token: string, signal?: AbortSignal): Promise<PermissionMode> {
  const mode = obj((await assistantRead('assistant_permission', token, undefined, signal)).permission).mode;
  if (mode !== 'default' && mode !== 'full') throw new ApiError('invalid');
  return mode;
}
export async function setAssistantPermission(token: string, mode: PermissionMode): Promise<PermissionMode> {
  const data = await assistantWrite('assistant_permission', token, { mode, ...(mode === 'full' ? { acknowledgement: 'full-account-v1' } : {}) });
  const saved = obj(data.permission).mode;
  if (saved !== mode) throw new ApiError('invalid');
  return mode;
}
export async function setAssistantEnabled(token: string, enabled: boolean) {
  return parseQuota((await assistantWrite('assistant_quota_enabled', token, { enabled })).quota);
}
export async function exchangeAssistantQuota(token: string, coins: number, requestId: string) {
  if (!Number.isSafeInteger(coins) || coins < 1 || coins > 100000 || !requestId) throw new ApiError('invalid');
  return parseQuota((await assistantWrite('assistant_quota_exchange', token, { coins, request_id: requestId })).quota);
}
export async function assistantChat(token: string, body: { message: string; request_id: string; session_key: string; page_context: JsonObject }): Promise<AssistantTurn> {
  const data = await assistantWrite('assistant_chat', token, body);
  if (!str(data.reply).trim() && !positiveId(data.task_id)) throw new ApiError('invalid');
  return parseTurn(data);
}
export async function confirmAssistantTask(token: string, taskId: number, confirmation: string, decision: 'confirm' | 'reject'): Promise<AssistantTurn> {
  const data = await assistantWrite('assistant_confirm', token, { task_id: taskId, confirmation_token: confirmation, decision });
  return parseTurn({ ...data, task_id: positiveId(data.task_id) || taskId, actions: data.client_actions ?? data.actions });
}
export async function reportAssistantActions(token: string, taskId: number, results: AssistantReceipt[], context: JsonObject): Promise<AssistantTurn> {
  const data = await assistantWrite('assistant_action_result', token, { task_id: taskId, results, status: results.every(r => r.ok) ? 'completed' : 'failed', page_context: context });
  return parseTurn({ ...data, task_id: positiveId(data.task_id) || taskId });
}
export const claimAssistantAction = (token: string, taskId: number, callId: string) => assistantWrite('assistant_api_claim', token, { task_id: taskId, call_id: callId });
export const saveAssistantReceipt = (token: string, receipt: AssistantReceipt) => assistantWrite('assistant_api_receipt', token, { task_id: receipt.task_id, call_id: receipt.call_id, result: receipt });
export const deleteAssistantMessage = (token: string, sessionKey: string, messageId: number) => assistantWrite('assistant_delete_message', token, { session_key: sessionKey, message_id: messageId });
export const clearAssistantHistory = (token: string, sessionKey: string) => assistantWrite('assistant_clear_history', token, { session_key: sessionKey });

/** Named read-only capability; neither a URL nor an arbitrary model endpoint can enter. */
export async function readAssistantSiteInfo(token: string, endpoint: string, query: Record<string, string | number> = {}) {
  if (!READ_ENDPOINTS.has(endpoint)) throw new ApiError('envelope', { serverMessage: '此读取操作不受支持' });
  assertAssistantAccount(token);
  const response = await picponyRequest(endpoint, { token, query });
  const data = await readObject<JsonObject>(response);
  assertAssistantAccount(token);
  if (!response.ok || data.success === false) throw new ApiError('envelope', { serverMessage: envelopeMessage(data) });
  if (data.success !== true) throw new ApiError('invalid');
  return data;
}

/** The original assistant's verified semantic receipt, separate from the ordinary search parser. */
export async function resolveAssistantSearch(query: string, mode: 'new' | 'refine', current: string) {
  const response = await picponyPostJson('semantic_search', { query, ai_context: { query_mode: mode, query_source: 'model_query', current_query: mode === 'refine' ? current.slice(0, 300) : '' } }, { timeoutMs: 45000 });
  const data = await readObject<JsonObject>(response);
  const receipt = obj(data.ai_receipt);
  if (!response.ok || data.success !== true) throw new ApiError('envelope', { serverMessage: envelopeMessage(data) });
  const tags = Array.isArray(data.tags) ? data.tags.filter((t): t is string => typeof t === 'string' && t.length <= 300) : [];
  if (!tags.length || tags.length > 24 || receipt.query_mode !== mode || receipt.query_source !== 'model_query' || receipt.semantic_input !== query || JSON.stringify(receipt.semantic_output) !== JSON.stringify(data.tags) || !Array.isArray(data.tags) || tags.length !== data.tags.length) {
    throw new ApiError('envelope', { serverMessage: '搜索接口未返回一致的查询回执，未执行搜索' });
  }
  return { tags, receipt };
}
