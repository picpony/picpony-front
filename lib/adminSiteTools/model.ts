import { ApiError } from '@/lib/api/errors';
import type { SiteStatusResponse } from '@/lib/types/site';

export type Row = Record<string, unknown>;
export type Values = Record<string, string | boolean | string[]>;
export interface FieldSpec {
  key: string;
  label: string;
  kind?: 'text' | 'textarea' | 'password' | 'boolean' | 'number' | 'url' | 'origins' | 'ips';
  min?: number;
  max?: number;
  decimal?: boolean;
  optional?: boolean;
  helper?: string;
  options?: { value: string; label: string }[];
}

export class FormProblem extends ApiError {
  constructor(readonly fields: Record<string, string>) {
    super('invalid', { message: Object.values(fields)[0] || '请检查填写的内容', retryable: false });
  }
}

export function record(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('invalid');
  return value as Row;
}
export function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
export function count(value: unknown): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') throw new ApiError('invalid');
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new ApiError('invalid');
  return n;
}
export function measurement(value: unknown): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') throw new ApiError('invalid');
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new ApiError('invalid');
  return n;
}
/**
 * A count the response is allowed not to send. `null` for absent, the number otherwise — for a
 * field whose absence is information rather than a broken response (an error-log row for a request
 * that never reached its upstream has no upstream status). The caller renders `—`.
 */
export function optionalCount(value: unknown): number | null {
  return value == null ? null : count(value);
}
/**
 * A duration the response is allowed not to send — the same rule as `optionalCount`, for the
 * timings. A benchmark may answer `ok: true` with no `latency_ms`, and a model that works is not a
 * reason to fail the panel it is listed in (G2-003); a test request that succeeded without
 * reporting its duration is not a failed test either. `null`, never a fabricated 0.
 */
export function optionalMeasurement(value: unknown): number | null {
  return value == null ? null : measurement(value);
}
/**
 * A PHP timestamp, returned in milliseconds — the unit `lib/format.ts` prints.
 *
 * **The unit is read from the magnitude**, because this backend sends both: `admin_get_relay_stats`
 * answers `last_seen` in milliseconds (both original consoles read it as one —
 * `coord/admin-live-20261003.html:2287` `new Date(Number(s.last_seen))` and `:3855`), while the
 * sibling lock row's `dev_mode_lock_until` is seconds. 1e11 separates them with no ambiguity worth
 * worrying about: 1e11 seconds is the year 5138 and 1e11 milliseconds is 1973, so a value at or
 * above it can only be milliseconds and anything below it can only be seconds. Reading everything
 * as seconds printed 最后请求 as the year 57726 (NEW-1); as milliseconds it printed 1970 (G2-005).
 *
 * A string is passed through as itself (the backend sometimes formats a stamp server-side), and
 * anything unreadable is `null` rather than a thrown error that would fail the page it labels.
 */
export const EPOCH_MILLISECONDS_FROM = 1e11;
export function epochStamp(value: unknown): number | string | null {
  const scale = (n: number) => (n >= EPOCH_MILLISECONDS_FROM ? n : n * 1000);
  if (typeof value === 'string') return value.trim() === '' ? null : /^\d+$/.test(value.trim()) ? scale(Number(value)) : value;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return scale(value);
}
/**
 * A server-sent `YYYY-MM-DD`, or `''` when it is not one. The non-throwing twin of `dateValue`,
 * which is the **form**'s validator: running a form validator over a server field turned one
 * unexpected format into 请输入有效的日期 on a screen with no date input, with no retry.
 */
export function isoDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : '';
}
export function id(value: unknown): number {
  const n = count(value);
  if (n < 1) throw new ApiError('invalid');
  return n;
}
export function flag(value: unknown): boolean {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  throw new ApiError('invalid');
}
export function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((x) => typeof x !== 'string')) throw new ApiError('invalid');
  return value as string[];
}
export function rows(value: unknown): Row[] {
  if (!Array.isArray(value)) throw new ApiError('invalid');
  return value.map(record);
}
export function integer(value: unknown, min: number, max: number): number | null {
  const s = String(value).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
}
export function webUrl(value: string, originOnly = false): boolean {
  try {
    const u = new URL(value);
    return /^https?:$/.test(u.protocol) && Boolean(u.hostname) && !u.username && !u.password && !u.hash &&
      (!originOnly || ((u.pathname === '/' || u.pathname === '') && !u.search));
  } catch { return false; }
}
export function ipAddress(value: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return value.split('.').every((part) => Number(part) <= 255 && String(Number(part)) === part);
  if (!/^[\da-f:.]+$/i.test(value) || !value.includes(':')) return false;
  try { return Boolean(new URL(`http://[${value}]/`).hostname); } catch { return false; }
}
export function dateValue(value: string): string {
  if (!value) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new FormProblem({ date: '请输入有效的日期' });
  const d = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw new FormProblem({ date: '请输入有效的日期' });
  return value;
}

/** The same schema validates the form and the adapter, including callers outside the UI. */
export function fieldsPayload(fields: FieldSpec[], values: Values): Row {
  const result: Row = {};
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const value = values[f.key];
    if (f.kind === 'boolean') {
      if (typeof value !== 'boolean') errors[f.key] = `请选择${f.label}`;
      else result[f.key] = value;
      continue;
    }
    const s = typeof value === 'string' ? value.trim() : '';
    if (f.kind === 'number') {
      const n = f.decimal ? (/^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN) : integer(s, f.min ?? 0, f.max ?? Number.MAX_SAFE_INTEGER);
      if (n === null || !Number.isFinite(n) || n < (f.min ?? 0) || n > (f.max ?? Number.MAX_SAFE_INTEGER)) errors[f.key] = `${f.label}须为 ${f.min ?? 0}～${f.max ?? Number.MAX_SAFE_INTEGER} 的${f.decimal ? '数字' : '整数'}`;
      else result[f.key] = n;
    } else if (f.kind === 'ips' || f.kind === 'origins') {
      const list = [...new Set(s.split(/[\s,，]+/).filter(Boolean))];
      if (list.some((item) => f.kind === 'ips' ? !ipAddress(item) : !webUrl(item, true))) errors[f.key] = f.kind === 'ips' ? '请每行填写一个有效的 IP 地址' : '请每行填写一个完整的 HTTP 或 HTTPS 站点地址，不含路径或账号';
      else result[f.key] = list;
    } else if (!s && !f.optional) errors[f.key] = `请填写${f.label}`;
    else if (f.max && s.length > f.max) errors[f.key] = `${f.label}最多 ${f.max} 字`;
    else if (s && f.kind === 'url' && !webUrl(s)) errors[f.key] = '请输入完整的 HTTP 或 HTTPS 地址，不含账号或片段';
    else if (f.options && !f.options.some((o) => o.value === s)) errors[f.key] = `请选择${f.label}`;
    else result[f.key] = s;
  }
  if (Object.keys(errors).length) throw new FormProblem(errors);
  return result;
}

/* The field is 解析模型, not 搜索解析方式: `ConfigEditor` renders the section's heading above it,
   and when the two strings matched the screen showed 搜索解析方式 twice, stacked, which a screen
   reader read as "搜索解析方式 heading, 搜索解析方式 combobox". */
export const modeFields: FieldSpec[] = [{ key: 'semantic_search_mode', label: '解析模型', options: [
  { value: 'off', label: '关闭智能解析' }, { value: 'legacy', label: '原有模型' }, { value: 'qwen', label: 'Qwen 智能解析' },
] }];
export const cloudFields: FieldSpec[] = [
  { key: 'semantic_cloud_enabled', label: '启用云端模型', kind: 'boolean' },
  { key: 'semantic_cloud_base_url', label: '云端服务地址', kind: 'url' },
  { key: 'semantic_cloud_model', label: '模型名称', max: 200 },
  { key: 'semantic_cloud_timeout_ms', label: '请求超时（毫秒）', kind: 'number', min: 500, max: 30000 },
  { key: 'semantic_cloud_api_key', label: '模型密钥', kind: 'password', optional: true, helper: '留空保留已保存的密钥' },
  { key: 'semantic_cloud_clear_key', label: '清除已保存的模型密钥', kind: 'boolean' },
];
/* The policy field is 线路规则 — the original console's own word for it — under the editor's API 线路
   / 图片线路 heading: as 全站 API 线路 and 全站图片线路 the field repeated the heading directly above it
   (G2-016, as 搜索解析方式 did). */
export const apiRouteFields: FieldSpec[] = [
  { key: 'policy', label: '线路规则', options: [
    { value: 'auto', label: '按用户设置' }, { value: 'direct', label: '直连' }, { value: 'api_accel', label: 'API 加速' },
    { value: 'picpony_api', label: 'PicPony API' }, { value: 'third_party', label: '第三方线路' },
  ] },
  { key: 'third_party_urls', label: '第三方候选地址', kind: 'textarea', optional: true, helper: '每行一个完整的 HTTPS 站点地址' },
  { key: 'third_party_pass_api_key', label: '向第三方线路传递用户的 API Key', kind: 'boolean', helper: '开启后，所选第三方服务可接收到用户绑定的密钥' },
];
export const imageRouteFields: FieldSpec[] = [{ key: 'policy', label: '线路规则', options: [
  { value: 'auto', label: '按用户设置' }, { value: 'direct', label: '图片直连' }, { value: 'cdn', label: '图片 CDN' }, { value: 'picpony', label: 'PicPony 加速' },
] }];
export const relayFields: FieldSpec[] = [
  { key: 'concurrency', label: '最大并发请求数', kind: 'number', min: 1, max: 1000 },
  { key: 'switchback_enabled', label: '恢复后自动切回', kind: 'boolean' },
  { key: 'whitelisted_ips', label: '白名单 IP', kind: 'ips', optional: true, helper: '每行一个 IPv4 或 IPv6 地址' },
  { key: 'allowed_origins', label: '允许使用的站点', kind: 'origins', optional: true, helper: '每行一个完整站点地址，不含路径' },
];
export const quotaFields: FieldSpec[] = [
  { key: 'enabled', label: '开放彩彩 AI', kind: 'boolean', helper: '还需同时启用上方的助手模型' },
  { key: 'daily_points', label: '每日赠送点数', kind: 'number', min: 0, max: 100000 },
  { key: 'points_per_coin', label: '每金币兑换点数', kind: 'number', min: 1, max: 10000 },
];
export const assistantFields: FieldSpec[] = [
  { key: 'name', label: '配置名称', max: 80 },
  { key: 'base_url', label: '模型服务地址', kind: 'url' },
  { key: 'models_url', label: '模型列表地址', kind: 'url', optional: true, helper: '留空时由服务推导列表地址' },
  { key: 'model', label: '当前模型', optional: true, max: 200, helper: '可先填写，也可通过测速选择' },
  { key: 'api_key', label: '助手模型密钥', kind: 'password', optional: true, helper: '留空保留已保存的密钥' },
  { key: 'timeout_ms', label: '超时（毫秒）', kind: 'number', min: 1000, max: 30000 },
  { key: 'max_tokens', label: '最大输出长度（词元）', kind: 'number', min: 64, max: 4096 },
  { key: 'temperature', label: '随机程度', kind: 'number', min: 0, max: 2, decimal: true },
  { key: 'system_prompt', label: '补充提示词', kind: 'textarea', optional: true, max: 12000, helper: '补充角色语气与表达偏好，不会覆盖工具权限、确认流程或隐私规则' },
  { key: 'enabled', label: '启用彩彩 AI 助手', kind: 'boolean' },
  { key: 'clear_key', label: '清除已保存的助手密钥', kind: 'boolean' },
];
export const GATEWAY = 'https://ai.picpony.top:10443/v1';

/**
 * A saved configuration as the form holds it.
 *
 * **`optional` is honoured for every kind, not just text.** It used to read `f.optional` only in
 * the last branch, so a field declared optional still threw on an absent value: `whitelisted_ips`
 * and `allowed_origins` are `optional: true` and `strings(null)` throws, which made 中转服务 → 设置
 * unreachable in exactly its default state — an empty IP whitelist, on the line every visitor uses
 * by default, i.e. the control an admin opens during an incident. 彩彩 AI's `has_key` did the same
 * to a never-configured assistant.
 *
 * A **required** field still throws on an absent value, because a response that will not say what
 * the saved concurrency or policy is cannot be edited safely.
 */
export function configValues(fields: FieldSpec[], source: Row): Values {
  return Object.fromEntries(fields.map((f) => {
    const v = source[f.key];
    const missing = v == null;
    if (f.kind === 'password') return [f.key, ''];
    if (f.key.endsWith('clear_key')) return [f.key, false];
    if (f.kind === 'boolean') return [f.key, f.optional && missing ? false : flag(v)];
    if (f.kind === 'ips' || f.kind === 'origins') return [f.key, (f.optional && missing ? [] : strings(v)).join('\n')];
    if (f.kind === 'number') {
      if (f.optional && missing) return [f.key, String(f.min ?? 0)];
      if (typeof v !== 'number' && typeof v !== 'string') throw new ApiError('invalid');
      return [f.key, String(v)];
    }
    if (typeof v !== 'string' && !f.optional) throw new ApiError('invalid');
    return [f.key, text(v)];
  }));
}

export function routePayload(values: Values): Row {
  const body = fieldsPayload(apiRouteFields, values);
  const urls = text(body.third_party_urls).split(/[\s,，]+/).filter(Boolean);
  if ((body.policy === 'third_party' && !urls.length) || urls.some((u) => !webUrl(u, true) || !u.startsWith('https://'))) throw new FormProblem({ third_party_urls: '请填写有效的 HTTPS 第三方站点地址，不含路径、账号或查询参数' });
  body.third_party_urls = [...new Set(urls)].join('\n');
  return body;
}

/** Only acknowledged, public fields may cross into the runtime policy store. */
export function savedRoutePatch(axis: 'api' | 'image', values: Values, response: Row): Partial<SiteStatusResponse> {
  if (axis === 'image') {
    const submitted = fieldsPayload(imageRouteFields, values);
    const reported = text(response.global_image_route_policy);
    return { global_image_route_policy: imageRouteFields[0].options!.some((x) => x.value === reported) ? reported : text(submitted.policy) };
  }
  const submitted = routePayload(values);
  const reported = text(response.global_api_route_policy);
  const reportedUrl = text(response.global_api_third_party_url);
  return {
    global_api_route_policy: apiRouteFields[0].options!.some((x) => x.value === reported) ? reported : text(submitted.policy),
    global_api_third_party_url: reportedUrl.startsWith('https://') && webUrl(reportedUrl, true) ? reportedUrl : text(submitted.third_party_urls).split('\n')[0] || '',
    global_api_third_party_pass_api_key: typeof response.global_api_third_party_pass_api_key === 'boolean' ? response.global_api_third_party_pass_api_key : submitted.third_party_pass_api_key === true,
  };
}
export function assistantPayload(values: Values): Row {
  const body = fieldsPayload(assistantFields, values);
  body.model_candidates = [...new Set(strings(values.model_candidates ?? []))];
  if ((body.model_candidates as string[]).some((m) => !m.trim() || m.length > 200)) throw new FormProblem({ model: '候选模型名称无效' });
  if (body.clear_key && body.api_key) throw new FormProblem({ api_key: '清除密钥时请先清空新密钥' });
  return body;
}
export function cloudPayload(values: Values): Row {
  const body = fieldsPayload(cloudFields, values);
  if (body.semantic_cloud_clear_key && body.semantic_cloud_api_key) throw new FormProblem({ semantic_cloud_api_key: '清除密钥时请先清空新密钥' });
  return body;
}
export function announcementPayload(values: Values): { version: string; title: string; content: string } {
  const p = fieldsPayload([{ key: 'version', label: '版本' }, { key: 'title', label: '标题' }, { key: 'content', label: '公告正文' }], values);
  return { version: text(p.version), title: text(p.title), content: text(p.content).replace(/\r\n?/g, '\n').replace(/\n/g, '<br>') };
}
export interface RateRule { action: string; label: string; max: string; window: string; key_type: string }
export function ratePayload(rules: RateRule[]): Row {
  const result: Row = Object.create(null);
  if (!rules.length) throw new FormProblem({ rules: '没有可保存的频率规则' });
  for (const r of rules) {
    const max = integer(r.max, 1, 10000), window = integer(r.window, 1, 86400);
    if (!r.action || !max || !window || !['ip', 'user'].includes(r.key_type)) throw new FormProblem({ [r.action]: `请检查「${r.label}」的次数（1～10000）、窗口（1～86400 秒）和计数对象` });
    result[r.action] = { max, window, key_type: r.key_type };
  }
  return { rules: result };
}
