export type JsonObject = Record<string, unknown>;
export type PermissionMode = 'default' | 'full';
export interface AssistantQuota {
  enabled: boolean; user_enabled: boolean;
  /** The wallet's and the quota configuration's revisions: the CAS a preference or exchange sends. */
  revision: number; config_revision: number;
  remaining: number; daily_remaining: number; purchased_remaining: number; reserved: number;
  daily_points: number; points_per_coin: number; coins: number;
}
/**
 * One action the client carries out for a turn. On the Rust backend that is a site call the user
 * confirmed (`call_site_api`, `call_id` = the server's issued call UUID), a server-side write
 * awaiting confirmation (`claim_task_reward`, `call_id` = the pending action's UUID), or a page
 * action (`get_page_controls` / `interact_page`).
 */
export interface AssistantAction {
  name: string;
  arguments: JsonObject;
  call_id: string;
  risk: string;
  approval_granted: boolean;
}
export interface AssistantReceipt {
  task_id: string; call_id: string; name: string; action: string;
  ok: boolean; summary: string; data: JsonObject;
  error?: string; page_effect?: JsonObject; defer_navigation?: string;
}
/** `id` is the backend's message UUID; `''` for a bubble only this page has seen. */
export interface AssistantMessage { id: string; role: 'user' | 'assistant'; content: string }
/** `assistant_pending_actions` as `run-task` returns it: one write waiting for the user's decision. */
export interface AssistantPending { id: string; operation: string; arguments: JsonObject; expires_at: string }
/**
 * One call the server issued for this client and that still waits for its receipt
 * (`assistant_actions::issued_calls`): listed by `state` (in `task.client_calls` with a task id,
 * top-level `client_calls` without) and by the native turn projection. `arguments` are the model's
 * already server-validated arguments; `request` is the envelope `api-claims` answers too.
 */
export interface AssistantClientCall {
  id: string; task_id: string; operation: string; arguments: JsonObject; request: JsonObject;
  risk: string; created_at: string;
}
/** One turn, as `state {task_id}` reports it. */
export interface AssistantTaskPoll { id: string; status: string; reply: string; ok: boolean; client_calls: AssistantClientCall[] }
/** The turn the panel is following. `pending_id` names the confirmation the card decides. */
export interface AssistantTask {
  id: string; status: string; pending_id: string | null;
  actions: AssistantAction[]; confirmed: boolean;
}
export interface AssistantState { messages: AssistantMessage[]; tasks: { id: string; status: string }[]; client_calls: AssistantClientCall[] }

/** The legacy chat bridge's limit (`assistant_legacy::chat`). */
export const MAX_MESSAGE = 2000;
export const MAX_REPLY = 12000;
export const MAX_HISTORY = 40;
/** Turn states that are still moving on the server. */
export const ACTIVE_STATES: readonly string[] = ['queued', 'running', 'waiting_confirmation'];
export const obj = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
export const str = (value: unknown, max = MAX_REPLY): string => typeof value === 'string' ? value.slice(0, max) : '';
/** A business id the model or the user supplied (folder, image, user) — still checked. */
export const positiveId = (value: unknown): number => {
  const n = typeof value === 'number' || typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A backend task / call / message id, or `''`. */
export const uuid = (value: unknown): string => typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : '';

/**
 * The action a pending confirmation stands for. `call_site_api` keeps the catalogue
 * `{endpoint, parameters}` the server validated; anything else (`claim_task_reward {task}`) is a
 * server-side write the confirmation itself executes.
 */
export function pendingAction(pending: AssistantPending): AssistantAction {
  return { name: pending.operation, arguments: pending.arguments, call_id: pending.id, risk: 'write_confirm', approval_granted: false };
}

/**
 * The action an issued client call stands for. The server issues a `write_confirm` call only after
 * the user confirmed it or under a current full grant (`client_dispatch` / `decide_pending`), so
 * such a call carries `approval_granted`; the runner still claims it before executing.
 */
export function clientCallAction(call: AssistantClientCall): AssistantAction {
  return { name: call.operation, arguments: obj(call.arguments), call_id: call.id, risk: call.risk, approval_granted: call.risk === 'write_confirm' };
}

/** `state {}`: `{messages:[{id,role,content,created_at}], tasks:[{id,status}], client_calls}` — ordered by the backend. */
export function parseState(raw: JsonObject): AssistantState {
  const messages = (raw.messages as { id: string; role: string; content: string }[]).slice(-MAX_HISTORY).flatMap(m =>
    m.role === 'user' || m.role === 'assistant' ? [{ id: m.id, role: m.role, content: m.content } satisfies AssistantMessage] : []);
  const tasks = (raw.tasks as { id: string; status: string }[]).map(t => ({ id: t.id, status: t.status }));
  return { messages, tasks, client_calls: raw.client_calls as AssistantClientCall[] };
}

/**
 * Never send credentials, personal contact details or file bodies back to the model, and keep a
 * receipt small enough for the device's journal (`journal.ts`) and the backend's 64000-byte
 * receipt limit. The backend redacts again (`assistant_site_api::redact`) before the model reads it.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[内容已截短]';
  if (Array.isArray(value)) return value.slice(0, 30).map(v => redact(v, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 40)
    .filter(([k]) => !/password|passphrase|api_?key|secret|token|captcha|session|cookie|authorization|credential|encryption|csrf|email|(^|_)ip($|_)|image_data|__proto__|constructor|prototype/i.test(k))
    .map(([k, v]) => [k, redact(v, depth + 1)]));
  if (typeof value === 'string') return /^(data:|blob:)/i.test(value) ? '[文件内容未提供]' : value.slice(0, 800);
  return value;
}
export function receiptData(value: unknown): JsonObject {
  const safe = obj(redact(value));
  return JSON.stringify(safe).length <= 12000 ? safe : { truncated: true };
}
