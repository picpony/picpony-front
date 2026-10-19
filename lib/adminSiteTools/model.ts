import { ApiError } from '@/lib/api/errors';

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
export function id(value: unknown): number {
  const n = count(value);
  if (n < 1) throw new ApiError('invalid');
  return n;
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
  { key: 'semantic_cloud_base_url', label: '云端服务地址', kind: 'url', max: 300, helper: '须以 https:// 开头' },
  { key: 'semantic_cloud_model', label: '模型名称', max: 120 },
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
/** 文本翻译 (Azure Translator), `text_translation::Save`. The key is write-only: the read shows its mask. */
export const textTranslationFields: FieldSpec[] = [
  { key: 'enabled', label: '启用文本翻译', kind: 'boolean', helper: '启用前须已保存密钥' },
  { key: 'endpoint', label: '翻译服务地址', kind: 'url', max: 300, helper: '例如 https://api.cognitive.microsofttranslator.com' },
  { key: 'region', label: '资源区域', optional: true, max: 64, helper: '例如 eastasia；全局资源留空' },
  { key: 'target_language', label: '目标语言', max: 16, helper: '例如 zh-Hans' },
  { key: 'timeout_ms', label: '超时（毫秒）', kind: 'number', min: 1000, max: 30000 },
  { key: 'api_key', label: '翻译服务密钥', kind: 'password', optional: true, max: 400, helper: '留空保留已保存的密钥' },
  { key: 'clear_key', label: '清除已保存的密钥', kind: 'boolean' },
];
/** The host rule `text_translation::validate_endpoint` applies, so a wrong address is refused on its field. */
export function azureEndpoint(value: string): boolean {
  if (!webUrl(value)) return false;
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.port || u.search) return false;
  const host = u.hostname.toLowerCase();
  return host === 'api.cognitive.microsofttranslator.com' || /^api-[a-z]+\.cognitive\.microsofttranslator\.com$/.test(host) || /^[a-z0-9-]+\.cognitiveservices\.azure\.com$/.test(host);
}
export function textTranslationPayload(values: Values): Row {
  const body = fieldsPayload(textTranslationFields, values);
  const problems: Record<string, string> = {};
  if (!azureEndpoint(text(body.endpoint))) problems.endpoint = '请填写 Azure Translator 的 HTTPS 地址';
  const region = text(body.region).toLowerCase();
  if (!/^[a-z0-9]*$/.test(region)) problems.region = '区域只能包含小写字母和数字';
  if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(text(body.target_language))) problems.target_language = '目标语言代码无效（例如 zh-Hans）';
  const key = text(body.api_key);
  if (key && !/^[\x21-\x7e]+$/.test(key)) problems.api_key = '密钥包含无效字符';
  if (body.clear_key && key) problems.api_key = '清除密钥时请先清空新密钥';
  if (Object.keys(problems).length) throw new FormProblem(problems);
  return { enabled: body.enabled, endpoint: text(body.endpoint), region, target_language: text(body.target_language), timeout_ms: body.timeout_ms, api_key: key, clear_key: body.clear_key };
}

/** The provider list as `readAssistantConfig` answers it. */
export interface AssistantConfig<P> { revision: number; defaultPrompt: string; providers: P[] }
/** One provider's form (`assistant_providers::Fields`), and the key as a replacement or a clear. */
export interface ProviderDraft {
  name: string;
  base_url: string;
  models_url: string;
  model: string;
  model_selection: 'auto' | 'manual';
  model_candidates: string[];
  timeout_ms: number;
  max_tokens: number;
  temperature: number;
  thinking: 'off' | 'low';
  system_prompt: string;
  enabled: boolean;
  is_primary: boolean;
  fallback_rank: number;
  api_key: string;
  clear_key: boolean;
}
export const providerFields: FieldSpec[] = [
  { key: 'name', label: '配置名称', max: 80 },
  { key: 'base_url', label: '模型服务地址', kind: 'url', helper: '须为 HTTPS 地址' },
  { key: 'models_url', label: '模型列表地址', kind: 'url', optional: true, helper: '留空时由服务推导列表地址' },
  { key: 'model_selection', label: '模型选择', options: [{ value: 'auto', label: '自动（候选中延迟最低）' }, { value: 'manual', label: '固定模型' }] },
  { key: 'model', label: '固定模型', optional: true, max: 160, helper: '「固定模型」时必填' },
  { key: 'api_key', label: '助手模型密钥', kind: 'password', optional: true, max: 400, helper: '留空保留已保存的密钥' },
  { key: 'timeout_ms', label: '超时（毫秒）', kind: 'number', min: 1000, max: 30000 },
  { key: 'max_tokens', label: '最大输出长度（词元）', kind: 'number', min: 64, max: 4096 },
  { key: 'temperature', label: '随机程度', kind: 'number', min: 0, max: 2, decimal: true },
  { key: 'thinking', label: '思考模式', options: [{ value: 'off', label: '关闭' }, { value: 'low', label: '轻度' }] },
  { key: 'fallback_rank', label: '备用顺序', kind: 'number', min: 0, max: 100, helper: '数字越小越优先' },
  { key: 'system_prompt', label: '角色提示词', kind: 'textarea', optional: true, max: 12000, helper: '留空使用默认角色词；不会覆盖工具权限、确认流程或隐私规则' },
  { key: 'enabled', label: '启用此配置', kind: 'boolean', helper: '启用前须已保存密钥' },
  { key: 'is_primary', label: '设为主模型', kind: 'boolean', helper: '已有主模型时，原主模型改为备用' },
  { key: 'clear_key', label: '清除已保存的密钥', kind: 'boolean' },
];
export const GATEWAY = 'https://ai.picpony.top:10443/v1';
/** The form's values for a provider (or a new one), the candidates kept beside them. */
export function providerValues(source: Omit<ProviderDraft, 'api_key' | 'clear_key'> | null): Values {
  const p = source ?? { name: '', base_url: '', models_url: '', model: '', model_selection: 'auto', model_candidates: [], timeout_ms: 15000, max_tokens: 800, temperature: 0.7, thinking: 'off', system_prompt: '', enabled: false, is_primary: false, fallback_rank: 0 };
  return {
    name: p.name, base_url: p.base_url, models_url: p.models_url, model: p.model, model_selection: p.model_selection,
    model_candidates: [...p.model_candidates], timeout_ms: String(p.timeout_ms), max_tokens: String(p.max_tokens),
    temperature: String(p.temperature), thinking: p.thinking, system_prompt: p.system_prompt, enabled: p.enabled,
    is_primary: p.is_primary, fallback_rank: String(p.fallback_rank), api_key: '', clear_key: false,
  };
}
export function providerPayload(values: Values): ProviderDraft {
  const body = fieldsPayload(providerFields, values);
  const candidates = [...new Set(strings(values.model_candidates ?? []))];
  const problems: Record<string, string> = {};
  if (candidates.some((m) => !m.trim() || m.length > 160)) problems.model = '候选模型名称无效';
  if (body.model_selection === 'manual' && !text(body.model)) problems.model = '固定模型时请填写模型名称';
  if (text(body.base_url) && !text(body.base_url).startsWith('https://')) problems.base_url = '请填写 HTTPS 地址';
  if (text(body.models_url) && !text(body.models_url).startsWith('https://')) problems.models_url = '请填写 HTTPS 地址';
  if (body.clear_key && body.api_key) problems.api_key = '清除密钥时请先清空新密钥';
  if (Object.keys(problems).length) throw new FormProblem(problems);
  return {
    name: text(body.name), base_url: text(body.base_url), models_url: text(body.models_url), model: text(body.model),
    model_selection: body.model_selection === 'manual' ? 'manual' : 'auto', model_candidates: candidates,
    timeout_ms: Number(body.timeout_ms), max_tokens: Number(body.max_tokens), temperature: Number(body.temperature),
    thinking: body.thinking === 'low' ? 'low' : 'off', system_prompt: text(body.system_prompt),
    enabled: body.enabled === true, is_primary: body.is_primary === true, fallback_rank: Number(body.fallback_rank),
    api_key: text(body.api_key), clear_key: body.clear_key === true,
  };
}

export function routePayload(values: Values): Row {
  const body = fieldsPayload(apiRouteFields, values);
  const urls = text(body.third_party_urls).split(/[\s,，]+/).filter(Boolean);
  if ((body.policy === 'third_party' && !urls.length) || urls.some((u) => !webUrl(u, true) || !u.startsWith('https://'))) throw new FormProblem({ third_party_urls: '请填写有效的 HTTPS 第三方站点地址，不含路径、账号或查询参数' });
  body.third_party_urls = [...new Set(urls)].join('\n');
  return body;
}

export function cloudPayload(values: Values): Row {
  const body = fieldsPayload(cloudFields, values);
  if (body.semantic_cloud_clear_key && body.semantic_cloud_api_key) throw new FormProblem({ semantic_cloud_api_key: '清除密钥时请先清空新密钥' });
  if (!text(body.semantic_cloud_base_url).toLowerCase().startsWith('https://')) throw new FormProblem({ semantic_cloud_base_url: '云端服务地址须以 https:// 开头' });
  return body;
}
export function announcementPayload(values: Values): { version: string; title: string; content: string } {
  const p = fieldsPayload([{ key: 'version', label: '版本' }, { key: 'title', label: '标题' }, { key: 'content', label: '公告正文' }], values);
  return { version: text(p.version), title: text(p.title), content: announcementHtml(text(p.content)) };
}

const BLOCK_TAG = '(?:ul|ol|li|p|div|h[1-6]|table|thead|tbody|tr|td|th|blockquote|pre|hr|br)';
const AFTER_BLOCK = new RegExp(`<\\/?${BLOCK_TAG}\\b[^>]*>[ \\t]*$`, 'i');
const BEFORE_BLOCK = new RegExp(`^[ \\t]*<\\/?${BLOCK_TAG}\\b`, 'i');

/**
 * The body's line breaks as `<br>` — except a break beside a block tag (review P6-O3): a list
 * written over several lines became `<ul><br><li>…`, invalid markup that sanitizers and browsers
 * repair differently. Text lines keep their breaks, as 「换行会保留」 promises; markup lines are
 * left to the markup.
 */
export function announcementHtml(content: string): string {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  let out = lines[0] ?? '';
  for (let i = 1; i < lines.length; i += 1) {
    const beside = AFTER_BLOCK.test(lines[i - 1]) || BEFORE_BLOCK.test(lines[i]);
    out += (beside ? '\n' : '<br>') + lines[i];
  }
  return out;
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
