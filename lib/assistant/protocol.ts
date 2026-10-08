export type JsonObject = Record<string, unknown>;
export type PermissionMode = 'default' | 'full';
export interface AssistantQuota {
  enabled: boolean; user_enabled: boolean;
  remaining: number; daily_remaining: number; purchased_remaining: number; reserved: number;
  daily_points: number; points_per_coin: number; coins: number;
}
export interface AssistantAction {
  name: string;
  arguments: JsonObject;
  call_id: string;
  risk: string;
  approval_granted: boolean;
}
export interface AssistantReceipt {
  task_id: number; call_id: string; name: string; action: string;
  ok: boolean; summary: string; data: JsonObject;
  error?: string; page_effect?: JsonObject; defer_navigation?: string;
}
export interface AssistantMessage { id: number; role: 'user' | 'assistant'; content: string }
export interface AssistantTurn {
  reply: string; task_id: number; confirmation_token: string | null;
  actions: AssistantAction[]; agent_pending: boolean;
  user_message_id: number; assistant_message_id: number;
  quota?: AssistantQuota;
}
export interface AssistantTask {
  id: number; status: string; confirmation_token: string | null;
  actions: AssistantAction[]; confirmed: boolean; user_message: string;
}
export interface AssistantState { messages: AssistantMessage[]; tasks: AssistantTask[] }

export const MAX_MESSAGE = 4000;
export const MAX_REPLY = 12000;
export const MAX_HISTORY = 40;
export const MAX_ROUNDS = 4;
export const obj = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
export const str = (value: unknown, max = MAX_REPLY): string => typeof value === 'string' ? value.slice(0, max) : '';
export const positiveId = (value: unknown): number => {
  const n = typeof value === 'number' || typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
};

export function parseActions(value: unknown): AssistantAction[] {
  if (!Array.isArray(value)) return [];
  if (value.length > 24) throw new Error('操作数量超出限制');
  return value.map(raw => {
    const a = obj(raw);
    if (JSON.stringify(a.arguments ?? {}).length > 32000) throw new Error('操作内容超出限制，未执行');
    return {
      name: str(a.name, 80), arguments: obj(a.arguments), call_id: str(a.call_id, 160),
      risk: str(a.risk, 40), approval_granted: a.approval_granted === true,
    };
  });
}
export function parseTurn(raw: JsonObject): AssistantTurn {
  return {
    reply: str(raw.reply), task_id: positiveId(raw.task_id), confirmation_token: str(raw.confirmation_token, 512) || null,
    actions: parseActions(raw.actions ?? raw.client_actions), agent_pending: raw.agent_pending === true,
    user_message_id: positiveId(raw.user_message_id), assistant_message_id: positiveId(raw.assistant_message_id),
  };
}
export function parseState(raw: JsonObject): AssistantState {
  const messages = Array.isArray(raw.messages) ? raw.messages.slice(-MAX_HISTORY).flatMap(value => {
    const m = obj(value);
    return m.role === 'user' || m.role === 'assistant' ? [{ id: positiveId(m.id), role: m.role, content: str(m.content) } satisfies AssistantMessage] : [];
  }) : [];
  const tasks = Array.isArray(raw.tasks) ? raw.tasks.slice(-12).flatMap(value => {
    const t = obj(value);
    if (!positiveId(t.id)) return [];
    let payload: JsonObject = {};
    try { if (typeof t.payload_json === 'string' && t.payload_json.length <= 128000) payload = obj(JSON.parse(t.payload_json)); } catch { /* An invalid task remains visibly unsupported. */ }
    return [{
      id: positiveId(t.id), status: str(t.status, 50), confirmation_token: str(t.confirmation_token, 512) || null,
      actions: parseActions(payload.actions), confirmed: payload.client_confirmed === true, user_message: str(payload.user_message, MAX_MESSAGE),
    }];
  }) : [];
  return { messages, tasks };
}

/** Never send credentials, personal contact details or file bodies back to the model. */
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
