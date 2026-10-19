import { api, deadlineSignal, readObject, seg } from './http';
import { ApiError, isAborted, toApiError } from './errors';
import { catalogWrite } from './adminCatalogTools';
import { readAnnouncementHistory } from './messages';
import { adminWrite, requestUuid } from '@/lib/adminMutations';
import { readToken, readUserInfo } from '@/lib/hooks';
import { apiPolicy, buildApiLineUrl, ensureRoutePolicy, probeImage, refreshRoutePolicy, resolveApiLine } from '@/lib/route';
import { DERPIBOORU_API_BASE, IMAGE_CDN_BASE, IMAGE_PROBE_URL, IMAGE_WORKER_BASE, PICPONY_API_ORIGIN } from '@/lib/constants';
import {
  record, rows, strings, text, count, measurement, id, integer, dateValue, fieldsPayload,
  modeFields, cloudPayload, imageRouteFields, routePayload, relayFields, quotaFields,
  textTranslationPayload, ratePayload, optionalCount, epochStamp,
  type Row, type Values, type RateRule, type AssistantConfig, type ProviderDraft,
} from '@/lib/adminSiteTools/model';

/*
 * 站点工具 against `/api/v1` (`src/pg/relay_admin.rs`, `metrics.rs`, `assistant_*.rs`,
 * `semantic_search.rs`, `text_translation.rs`, `dictionary_feedback.rs`).
 *
 * Every write goes through `catalogWrite`: **a lost acknowledgement is not a refusal** (G2-009) — no
 * answer, our own deadline, or a 5xx other than 501 is held as 操作结果待确认 rather than offered
 * again. Every write carries an `Idempotency-Key` (`adminWrite`), which the receipt-guarded handlers
 * require.
 */
const READ = { cache: 'no-store' as const };
function write<T extends object = Row>(token: string, method: string, path: string, json?: unknown): Promise<T> {
  return catalogWrite(() => adminWrite<T>(method, path, json === undefined ? { token } : { token, json }));
}

export { readAnnouncementHistory };

// ---- 智能搜索 ----------------------------------------------------------------

/**
 * `GET /admin/semantic-search` (the effective mode, resolved as the search resolves it) and
 * `GET /admin/semantic-cloud` (the saved cloud model; the key only as its mask and two flags), read
 * together: the panel's two editors start from what is stored.
 */
export interface SemanticConfig {
  mode: Values;
  cloud: Values;
  hasKey: boolean;
  /** `''` without a key, or when this server cannot open the stored one (`keyReadable` false). */
  masked: string;
  /** A key is stored but this server holds no label that opens it: the model cannot use it. */
  keyReadable: boolean;
}
interface WireSemanticCloud {
  semantic_cloud_enabled: boolean;
  semantic_cloud_base_url: string;
  semantic_cloud_model: string;
  semantic_cloud_timeout_ms: number;
  semantic_cloud_api_key_masked: string;
  semantic_cloud_has_key: boolean;
  semantic_cloud_key_readable: boolean;
}
export async function readSemanticConfig(token: string, signal?: AbortSignal): Promise<SemanticConfig> {
  const [mode, cloud] = await Promise.all([
    api<{ semantic_search_mode: string; semantic_search_enabled: boolean }>('GET', '/admin/semantic-search', { token, signal, ...READ }),
    api<WireSemanticCloud>('GET', '/admin/semantic-cloud', { token, signal, ...READ }),
  ]);
  return {
    mode: { semantic_search_mode: mode.semantic_search_mode },
    cloud: {
      semantic_cloud_enabled: cloud.semantic_cloud_enabled,
      semantic_cloud_base_url: cloud.semantic_cloud_base_url,
      semantic_cloud_model: cloud.semantic_cloud_model,
      semantic_cloud_timeout_ms: String(cloud.semantic_cloud_timeout_ms),
      semantic_cloud_api_key: '',
      semantic_cloud_clear_key: false,
    },
    hasKey: cloud.semantic_cloud_has_key,
    masked: cloud.semantic_cloud_api_key_masked,
    keyReadable: cloud.semantic_cloud_key_readable,
  };
}
/** Answers `{ semantic_search_enabled, semantic_search_mode }`. */
export const saveSemanticMode = (token: string, values: Values) => write(token, 'PUT', '/admin/semantic-search', fieldsPayload(modeFields, values));
/** Answers the saved cloud settings, `semantic_cloud_api_key_masked` and `semantic_cloud_has_key` — never the key. */
export const saveSemanticCloud = (token: string, values: Values) => write(token, 'PUT', '/admin/semantic-cloud', cloudPayload(values));
/** One `ping` against the saved settings: `ok` is whether the model answered 2xx, `http_status` what it answered. */
export interface CloudTest { ok: boolean; http_status: number; model: string; latency_ms: number }
export const testSemanticCloud = (token: string) => write<CloudTest>(token, 'POST', '/admin/semantic-cloud/tests');

// ---- 搜索反馈 ----------------------------------------------------------------

export const FEEDBACK_PAGE = 20;
export interface Feedback { id: number; status: 'new' | 'archived'; query: string; result: string; user: string; engine: string; date: string }
export type FeedbackStatus = 'all' | 'new' | 'archived';
export interface FeedbackArgs { status: FeedbackStatus; q: string; before?: number }
export interface FeedbackPage { rows: Feedback[]; next: number | null; counts: Record<FeedbackStatus, number> }
interface WireFeedback { id: number; status: 'new' | 'archived'; query: string; result: string; engine: string; username: string | null; created_at: string }
/** One cursor page (`before` → `next_cursor`), with the queue's three totals. */
export async function readFeedback(token: string, args: FeedbackArgs, signal?: AbortSignal): Promise<FeedbackPage> {
  const d = await api<{ feedback: WireFeedback[]; next_cursor: number | null; counts: Record<FeedbackStatus, number> }>('GET', '/admin/search/feedback', {
    token, signal, ...READ,
    query: { status: args.status, keyword: args.q.trim() || undefined, before: args.before, limit: FEEDBACK_PAGE },
  });
  return {
    rows: d.feedback.map((r) => ({ id: r.id, status: r.status, query: r.query, result: r.result, user: r.username ?? '', engine: r.engine, date: r.created_at })),
    next: d.next_cursor,
    counts: d.counts,
  };
}
/** `204`. */
export const archiveFeedback = (token: string, target: number, archived: boolean) => write(token, 'PUT', `/admin/search/feedback/${seg(target)}/archive`, { archived });
/** Answers `{ deleted }`. */
export function deleteFeedback(token: string, targets: number[]) {
  if (!targets.length) throw new ApiError('invalid');
  return write<{ deleted: number }>(token, 'POST', '/admin/search/feedback/deletions', { ids: [...new Set(targets)] });
}

// ---- 全站线路 ----------------------------------------------------------------

/**
 * The site-wide lines, one stored row (`website_routing_policy`) that every browser applies
 * (`GET /routing-policy`), the APP's follow-website mode reads, and the relay's origin alert
 * switches to a third-party candidate and back. `GET /admin/api-route-policy` reads the API line
 * with its candidates and failover history, `GET /admin/image-route-policy` the image line; each
 * `PUT` answers what it stored and the row's new `revision`.
 */
export interface RouteHistory { time: string; url: string; reason: string }
export interface SiteRoutes {
  api: Values;
  image: Values;
  revision: number;
  /** The third-party address in use (the first candidate, or the one the alert switched to). */
  currentUrl: string;
  /** The line the origin alert switched away from, restored when the origin recovers. */
  previousPolicy: string | null;
  history: RouteHistory[];
}
interface WireApiRoute {
  global_api_route_policy: string;
  global_api_third_party_url: string;
  global_api_third_party_urls: string[];
  global_api_third_party_pass_api_key: boolean;
  relay_origin_previous_policy: string | null;
  global_api_third_party_history: { time?: unknown; url?: unknown; reason?: unknown }[];
  revision: number;
}
export async function readSiteRoutes(token: string, signal?: AbortSignal): Promise<SiteRoutes> {
  const [apiLine, image] = await Promise.all([
    api<WireApiRoute>('GET', '/admin/api-route-policy', { token, signal, ...READ }),
    api<{ global_image_route_policy: string; revision: number }>('GET', '/admin/image-route-policy', { token, signal, ...READ }),
  ]);
  return {
    api: { policy: apiLine.global_api_route_policy, third_party_urls: apiLine.global_api_third_party_urls.join('\n'), third_party_pass_api_key: apiLine.global_api_third_party_pass_api_key },
    image: { policy: image.global_image_route_policy },
    revision: Math.max(apiLine.revision, image.revision),
    currentUrl: apiLine.global_api_third_party_url,
    previousPolicy: apiLine.relay_origin_previous_policy,
    /* The history is a stored JSON list the alert appends to (`{ time, url, reason }`, Beijing
       time as text): read through `text` so a hand-edited entry cannot fail the panel. */
    history: apiLine.global_api_third_party_history.map((h) => ({ time: text(h.time), url: text(h.url), reason: text(h.reason) })),
  };
}
/** What a route save answers: the stored line, `global_*` keyed (the patch `applySavedRoutePolicy` takes). */
export interface SavedRoute extends Row { revision: number }
export const saveApiRoute = (token: string, values: Values) => {
  const body = routePayload(values);
  return write<SavedRoute>(token, 'PUT', '/admin/api-route-policy', {
    policy: body.policy,
    third_party_urls: text(body.third_party_urls).split('\n').filter(Boolean),
    third_party_pass_api_key: body.third_party_pass_api_key,
  });
};
export const saveImageRoute = (token: string, values: Values) => write<SavedRoute>(token, 'PUT', '/admin/image-route-policy', fieldsPayload(imageRouteFields, values));

// ---- 中转服务 ----------------------------------------------------------------

export async function readRelayConfig(token: string, signal?: AbortSignal) {
  const d = await api<{ concurrency: number; switchback_enabled: boolean; switchback_attempts: number; whitelisted_ips: string[]; allowed_origins: string[] }>('GET', '/admin/relay-config', { token, signal, ...READ });
  return {
    values: { concurrency: String(d.concurrency), switchback_enabled: d.switchback_enabled, whitelisted_ips: d.whitelisted_ips.join('\n'), allowed_origins: d.allowed_origins.join('\n') } as Values,
    attempts: d.switchback_attempts,
  };
}
export const saveRelayConfig = (token: string, values: Values) => write(token, 'PUT', '/admin/relay-config', fieldsPayload(relayFields, values));

export interface Page<T> { rows: T[]; page: number; total: number; totalPages: number }
export interface PageArgs { page: number; perPage?: number }
function pageQuery(args: PageArgs) {
  const page = integer(args.page, 1, 1000000), perPage = integer(args.perPage ?? 20, 10, 100);
  if (!page || !perPage) throw new ApiError('invalid');
  return { page, per_page: perPage };
}
function pageOf<T>(list: T[], total: number, page: number, args: PageArgs): Page<T> {
  return { rows: list, total, page, totalPages: Math.max(1, Math.ceil(total / (args.perPage ?? 20))) };
}
/*
 * The relay's stats and error rows are the relay process's own JSON passed through
 * (`metrics::relay_stats` / `relay_logs` copy them field by field), so they are read with the
 * tolerant helpers; the envelope around them is the Rust handler's and is used as typed.
 */
export interface RelayStatsArgs extends PageArgs { range: string; date: string; sort: string; order: string }
export async function readRelayStats(token: string, args: RelayStatsArgs, signal?: AbortSignal) {
  if (!['1', '3', '7', '30'].includes(args.range) || !['total', 'search', 'normal', 'last_seen'].includes(args.sort) || !['asc', 'desc'].includes(args.order)) throw new ApiError('invalid');
  const d = await api<{ stats: Row[]; pagination: Row; available: boolean; message?: string }>('GET', '/admin/relay/stats', {
    token, signal, ...READ, query: { ...pageQuery(args), range: args.range, date: dateValue(args.date) || undefined, sort: args.sort, order: args.order },
  });
  /* `last_seen`'s unit is read from its magnitude (`epochStamp`): the relay answers milliseconds. */
  const list = rows(d.stats).map((r) => ({ ip: text(r.ip), username: text(r.username), total: count(r.total), search: count(r.search), normal: count(r.normal), last_seen: epochStamp(r.last_seen) }));
  const pagination = record(d.pagination);
  return { ...pageOf(list, count(pagination.total), id(pagination.page ?? args.page), args), available: d.available, message: d.message ?? '' };
}
export async function readRelayErrors(token: string, args: PageArgs & { date: string }, signal?: AbortSignal) {
  const d = await api<{ logs: Row[]; total: unknown; page: unknown; dates: string[]; available: boolean }>('GET', '/admin/relay/error-logs', {
    token, signal, ...READ, query: { ...pageQuery(args), date: dateValue(args.date) || undefined },
  });
  /* The upstream status, the relay's own and the duration are **optional**: for a connect or DNS
     failure the relay never reached Derpibooru, so none of them exists. */
  const list = rows(d.logs).map((r, i) => ({ key: `${args.page}:${i}`, time: text(r.time_beijing) || text(r.time), status: optionalCount(r.upstream_status ?? r.status), relay: optionalCount(r.relay_status), duration: r.duration_ms == null ? null : measurement(r.duration_ms), reason: text(r.reason), method: text(r.method), phase: text(r.phase), target: text(r.target_host) + text(r.target_path) }));
  return { ...pageOf(list, count(d.total), id(d.page), args), available: d.available, dates: strings(d.dates) };
}

// ---- 频率与临时封禁 -------------------------------------------------------------

export interface Lock { id: number; username: string; attempts: number; until: string | null }
export async function readRateLimits(token: string, signal?: AbortSignal) {
  const d = await api<{
    rules: Record<string, { label: string; max: number; window: number; key_type: string }>;
    temporary_locks: { id: number; username: string; attempts: number; locked_until: string | null }[];
    server_time: number;
  }>('GET', '/admin/rate-limit-rules', { token, signal, ...READ });
  const rules: RateRule[] = Object.entries(d.rules).map(([action, r]) => ({ action, label: r.label || action, max: String(r.max), window: String(r.window), key_type: r.key_type }));
  const locks: Lock[] = d.temporary_locks.map((r) => ({ id: r.id, username: r.username, attempts: r.attempts, until: r.locked_until }));
  return { rules, locks, serverTime: d.server_time };
}
/** Super administrators only; the whole rule set at once. Answers `{ saved }`. */
export const saveRateLimits = (token: string, rules: RateRule[]) => write(token, 'PUT', '/admin/rate-limit-rules', ratePayload(rules));
/** Super administrators only. Answers `{ user_id, released }`. */
export const releaseLock = (token: string, target: number) => write(token, 'POST', `/admin/temporary-locks/${seg(id(target))}/release`);

// ---- 访问统计 ----------------------------------------------------------------

/** One Beijing day: new accounts (`/admin/metrics/registrations`) beside distinct visitors and hits
 *  (`/admin/metrics/visitors`, counted from `POST /site-visits`). */
export interface DayStats { date: string; newUsers: number; visitors: number | null; hits: number | null }
export interface SiteStatistics {
  todayNewUsers: number;
  /** Accounts and anonymous visitors seen in the last 30 minutes. */
  onlineUsers: number;
  todayVisitors: number;
  onlineVisitors: number;
  days: DayStats[];
}
export const STATISTICS_DAYS = 30;
export interface WireVisitors {
  today_visitors: number;
  online_visitors_30m: number;
  today_new_users: number;
  online_users_30m: number;
  days: { date: string; visitors: number; hits: number }[];
}
/** Newest first (today is the first row), the two reads joined by date. */
export async function readStatistics(token: string, signal?: AbortSignal): Promise<SiteStatistics> {
  const [registrations, visitors] = await Promise.all([
    api<{ stats: { date: string; new_users: number }[] }>('GET', '/admin/metrics/registrations', { token, signal, ...READ, query: { days: STATISTICS_DAYS } }),
    api<WireVisitors>('GET', '/admin/metrics/visitors', { token, signal, ...READ, query: { days: STATISTICS_DAYS } }),
  ]);
  const visits = new Map(visitors.days.map((d) => [d.date, d]));
  return {
    todayNewUsers: visitors.today_new_users,
    onlineUsers: visitors.online_users_30m,
    todayVisitors: visitors.today_visitors,
    onlineVisitors: visitors.online_visitors_30m,
    days: registrations.stats.map((r) => ({ date: r.date, newUsers: r.new_users, visitors: visits.get(r.date)?.visitors ?? null, hits: visits.get(r.date)?.hits ?? null })),
  };
}

// ---- 开发者 -------------------------------------------------------------------

/** Every account barred from API acceleration (`GET /admin/api-accel-bans`, an id cursor). */
export async function readAccelerationBans(token: string, signal?: AbortSignal): Promise<Set<number>> {
  const banned = new Set<number>();
  let after: number | undefined;
  for (let n = 0; n < 500; n += 1) {
    const d = await api<{ users: { id: number }[]; total: number; next_cursor: number | null }>('GET', '/admin/api-accel-bans', { token, signal, ...READ, query: { after, limit: 200 } });
    for (const u of d.users) banned.add(u.id);
    if (d.next_cursor == null) break;
    after = d.next_cursor;
  }
  return banned;
}
/** One account's flag, re-read from `GET /admin/users/{id}`. */
export async function readAccelerationBan(token: string, target: number, signal?: AbortSignal): Promise<boolean> {
  return (await api<{ user: { api_accel_banned: boolean } }>('GET', `/admin/users/${seg(id(target))}`, { token, signal, ...READ })).user.api_accel_banned;
}
/** Answers `{ id, banned }`. */
export const toggleAccelerationBan = (token: string, target: number, banned: boolean) =>
  write<{ id: number; banned: boolean }>(token, 'POST', '/admin/api-accel-bans', { id: id(target), banned });

// ---- 文本翻译（Azure） -----------------------------------------------------------

/** `GET /admin/text-translation`: the saved settings; the key only as `has_key` and its mask. */
export interface TextTranslationConfig { values: Values; hasKey: boolean; masked: string }
interface WireTextTranslation { enabled: boolean; endpoint: string; region: string; target_language: string; timeout_ms: number; has_key: boolean; api_key_masked: string }
function textTranslationOf(d: WireTextTranslation): TextTranslationConfig {
  return {
    values: { enabled: d.enabled, endpoint: d.endpoint, region: d.region, target_language: d.target_language, timeout_ms: String(d.timeout_ms), api_key: '', clear_key: false },
    hasKey: d.has_key,
    masked: d.api_key_masked,
  };
}
export async function readTextTranslation(token: string, signal?: AbortSignal) {
  return textTranslationOf(await api<WireTextTranslation>('GET', '/admin/text-translation', { token, signal, ...READ }));
}
/** Answers the saved settings in the read's own shape (the key masked). */
export const saveTextTranslation = (token: string, values: Values) =>
  write<WireTextTranslation>(token, 'PUT', '/admin/text-translation', textTranslationPayload(values));

// ---- 彩彩 AI：额度 -------------------------------------------------------------

export interface QuotaConfig { values: Values; revision: number }
export async function readAiQuota(token: string, signal?: AbortSignal): Promise<QuotaConfig> {
  const d = await api<{ enabled: boolean; daily_points: number; points_per_coin: number; revision: number }>('GET', '/admin/assistant/quota-config', { token, signal, ...READ });
  return { values: { enabled: d.enabled, daily_points: String(d.daily_points), points_per_coin: String(d.points_per_coin) }, revision: d.revision };
}
/** Names the revision read (409 `QUOTA_CONFIG_CONFLICT` when another admin saved since). */
export const saveAiQuota = (token: string, revision: number, values: Values) =>
  write(token, 'PUT', '/admin/assistant/quota-config', { expected_revision: revision, ...fieldsPayload(quotaFields, values) });

// ---- 彩彩 AI：模型配置（主备，最多 8 个） -------------------------------------------

export interface Benchmark { ok: boolean; latency: number | null; failure: string | null }
export interface Provider {
  id: string;
  name: string;
  base_url: string;
  models_url: string;
  model: string;
  selected_model: string;
  model_selection: 'auto' | 'manual';
  model_candidates: string[];
  model_catalog: string[];
  benchmarks: Record<string, Benchmark>;
  timeout_ms: number;
  max_tokens: number;
  temperature: number;
  thinking: 'off' | 'low';
  system_prompt: string;
  enabled: boolean;
  is_primary: boolean;
  fallback_rank: number;
  has_key: boolean;
  /** The key's encryption label is held by this server: a key that is not cannot be used. */
  key_available: boolean;
  key_hint: string | null;
  updated_at: string;
}
export const PROVIDER_LIMIT = 8;
interface WireProvider extends Omit<Provider, 'benchmarks' | 'model_selection' | 'thinking'> { model_selection: string; thinking: string; model_benchmarks: Record<string, { ok: boolean; latency_ms?: number | null; failure?: { code: string; upstream_status: number | null } | null }> }

/** A failed probe's static code as a sentence: the backend never forwards the upstream's body. */
const FAILURES: Record<string, string> = {
  MODEL_TIMEOUT: '请求超时', MODEL_DNS_TIMEOUT: '域名解析超时', MODEL_DNS: '域名解析失败', MODEL_NETWORK: '网络连接失败',
  MODEL_AUTHENTICATION: '密钥无效或无权限', MODEL_KEY_INVALID: '已保存的密钥无法使用', MODEL_KEY_REQUIRED: '请先保存密钥',
  MODEL_RATE_LIMIT: '模型服务限流', MODEL_UNAVAILABLE: '模型服务暂不可用', MODEL_ENDPOINT: '接口地址无法使用',
  MODEL_CATALOG_URL_REQUIRED: '请填写模型列表地址', MODEL_INVALID_CATALOG: '模型列表格式无法识别', MODEL_CATALOG_TOO_LARGE: '模型列表过大',
  MODEL_EMPTY_COMPLETION: '模型返回空回复', MODEL_INCOMPLETE_COMPLETION: '模型回复不完整', MODEL_INVALID_COMPLETION: '模型回复格式无法识别',
  MODEL_INVALID_RESPONSE: '模型响应无法识别', MODEL_ADDRESS_FORBIDDEN: '该地址不允许访问', MODEL_LOCAL_FORBIDDEN: '不允许访问本机或内网地址',
  MODEL_REDIRECT_FORBIDDEN: '模型服务要求重定向，已拒绝', MODEL_PROBE_EXPIRED: '检查已过期，请重新发起', MODEL_PROBE_BUSY: '已有检查在进行，请稍后再试',
  MODEL_REQUEST_REJECTED: '模型服务拒绝了请求', MODEL_RESPONSE_TOO_LARGE: '模型响应过大',
};
export function probeFailure(failure: { code: string; upstream_status?: number | null } | null | undefined): string {
  if (!failure) return '检查失败';
  const sentence = FAILURES[failure.code] ?? `检查失败（${failure.code}）`;
  return failure.upstream_status ? `${sentence}（HTTP ${failure.upstream_status}）` : sentence;
}
function provider(row: WireProvider): Provider {
  const { model_benchmarks, ...rest } = row;
  return {
    ...rest,
    model_selection: row.model_selection === 'manual' ? 'manual' : 'auto',
    thinking: row.thinking === 'low' ? 'low' : 'off',
    benchmarks: Object.fromEntries(Object.entries(model_benchmarks).map(([name, b]) => [name, {
      ok: b.ok,
      /* A working model that did not report its duration is still a working model (G2-003). */
      latency: b.ok && typeof b.latency_ms === 'number' ? b.latency_ms : null,
      failure: b.ok ? null : probeFailure(b.failure),
    }])),
  };
}
function assistantConfig(d: { revision: number; default_system_prompt: string; providers: WireProvider[] }): AssistantConfig<Provider> {
  return { revision: d.revision, defaultPrompt: d.default_system_prompt, providers: d.providers.map(provider) };
}
/** The global revision every provider write names, the default persona, and the providers (primary first). */
export async function readAssistantConfig(token: string, signal?: AbortSignal) {
  return assistantConfig(await api('GET', '/admin/assistant/providers', { token, signal, ...READ }));
}
/**
 * Create (`id` absent) or replace one provider. `request_id` is the backend's own retry key (a
 * `Uuid`): one per press. Answers the whole list again, which replaces the read.
 */
export async function saveAssistantProvider(token: string, revision: number, draft: ProviderDraft, providerId?: string) {
  const { api_key, clear_key, ...config } = draft;
  const json = { request_id: requestUuid(), expected_revision: revision, config, ...(api_key ? { api_key } : {}), clear_key };
  const d = await catalogWrite(() => api<{ saved_id: string; configuration: { revision: number; default_system_prompt: string; providers: WireProvider[] } }>(
    providerId ? 'PUT' : 'POST', providerId ? `/admin/assistant/providers/${seg(providerId)}` : '/admin/assistant/providers', { token, json }));
  return { savedId: d.saved_id, config: assistantConfig(d.configuration) };
}
/** A tombstone: the key is wiped, and the next enabled provider becomes primary if this one was. */
export async function removeAssistantProvider(token: string, revision: number, providerId: string) {
  return assistantConfig(await catalogWrite(() => api('DELETE', `/admin/assistant/providers/${seg(providerId)}`, {
    token, json: { request_id: requestUuid(), expected_revision: revision },
  })));
}

/** `GET …/models`: the last successful catalogue and benchmarks, read without contacting the model. */
export async function readProviderModels(token: string, providerId: string, signal?: AbortSignal) {
  const d = await api<{ revision: number; models: string[]; benchmarks: WireProvider['model_benchmarks']; selected_model: string; catalog_checked_at: string | null }>(
    'GET', `/admin/assistant/providers/${seg(providerId)}/models`, { token, signal, ...READ });
  return { revision: d.revision, models: d.models, benchmarks: provider({ model_benchmarks: d.benchmarks } as WireProvider).benchmarks, selected: d.selected_model, checkedAt: d.catalog_checked_at };
}

/** A finished probe: `revision` is the global revision after it (the next probe names that one). */
export type ProbeResult =
  | { ok: true; revision: number; result: { models?: string[]; model?: string; latency_ms: number } }
  | { ok: false; revision: number; failure: string };
/** How long a probe is polled before the console stops waiting (the backend's lease is 45 s). */
const PROBE_WAIT_MS = 90_000;
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
});
/**
 * One catalogue discovery or one model's benchmark. The backend answers `202 {state:'running'}`
 * while another request holds the same `request_id`'s lease, and the finished result for a repeat
 * of it — so the poll re-sends the **same** body, which can never start a second remote call.
 * A lost answer is re-asked the same way; only a refusal ends the poll early.
 */
export async function probeProvider(token: string, providerId: string, revision: number, kind: 'discover' | 'benchmark', model?: string, signal?: AbortSignal): Promise<ProbeResult> {
  const json = { request_id: requestUuid(), expected_revision: revision, ...(kind === 'benchmark' && model ? { model } : {}) };
  const path = `/admin/assistant/providers/${seg(providerId)}/${kind === 'discover' ? 'model-discoveries' : 'model-benchmarks'}`;
  const deadline = Date.now() + PROBE_WAIT_MS;
  let lost = 0;
  for (;;) {
    let d: { state: 'running' | 'done'; retry_after_seconds?: number; revision?: number; ok?: boolean; result?: { models?: string[]; model?: string; latency_ms: number }; failure?: { code: string; upstream_status: number | null } };
    try {
      d = await api('POST', path, { token, signal, json });
    } catch (error) {
      if (isAborted(error)) throw error;
      const transient = error instanceof ApiError && (error.kind === 'network' || error.kind === 'timeout' || (error.kind === 'http' && (error.status ?? 0) >= 500 && error.status !== 501));
      if (!transient || (lost += 1) > 3 || Date.now() > deadline) throw transient ? new ApiError('timeout', { message: '未能确认检查结果，请刷新模型列表核对', retryable: false }) : error;
      await sleep(2000, signal);
      continue;
    }
    if (d.state === 'running') {
      if (Date.now() > deadline) throw new ApiError('timeout', { message: '检查仍在进行，请稍后刷新模型列表查看结果', retryable: false });
      await sleep(Math.max(1, d.retry_after_seconds ?? 1) * 1000, signal);
      continue;
    }
    return d.ok ? { ok: true, revision: d.revision!, result: d.result! } : { ok: false, revision: d.revision!, failure: probeFailure(d.failure) };
  }
}

// ---- 全站统计（Derpibooru） ----------------------------------------------------------

/** Counts ignore gallery filters. Use the current route policy and the operator's own key. */
export async function collectSiteStats(token: string, current: () => boolean, signal?: AbortSignal) {
  await refreshRoutePolicy();
  const result = { images: 0, tags: 0, comments: 0 };
  for (const type of ['images', 'tags', 'comments'] as const) {
    if (!current() || readToken() !== token) return null;
    signal?.throwIfAborted();
    const url = new URL(`${DERPIBOORU_API_BASE}/search/${type}`);
    url.searchParams.set('q', '*'); url.searchParams.set('per_page', '1');
    if (type === 'images') url.searchParams.set('filter_id', '56027');
    const key = readUserInfo()?.api_key;
    if (typeof key === 'string' && key) url.searchParams.set('key', key);
    const deadline = deadlineSignal(signal, 20000);
    try {
      const res = await fetch(buildApiLineUrl(url.toString(), resolveApiLine()), { signal: deadline.signal });
      if (!res.ok) throw new ApiError('http', { status: res.status });
      result[type] = count((await readObject<Row>(res)).total);
    } catch (error) { throw toApiError(error, deadline.timedOut()); }
    finally { deadline.dispose(); }
  }
  return current() && readToken() === token ? result : null;
}

/** Each probe's own budget. */
const PROBE_MS = 5000;
export interface LineCheck { name: string; latency: number; status: number | 'decoded' | null; error?: string }
/**
 * The original console's manual accelerator probes, mapped to this app's shared line catalogue.
 *
 * **An image line is probed with an `Image()`, never a `fetch`** (`probeImage` in `lib/route.ts`,
 * the same mechanism the degrade ladder uses): these hosts are image proxies, so a decoded bitmap is
 * the only evidence that means "this line works". An API line stays a `fetch`: it answers JSON, and
 * `picpony_api` is CORS-capable so its real status is readable. For the lines that remain opaque, an
 * opaque response proves reachability only, never an HTTP success or an unbanned upstream.
 */
export async function checkServiceLines(token: string, signal: AbortSignal, report: (row: LineCheck) => void) {
  await ensureRoutePolicy();
  signal.throwIfAborted();
  const url = `${DERPIBOORU_API_BASE}/images?per_page=1`;
  const probes: { name: string; url: string; opaque: boolean; image?: boolean }[] = [
    { name: '图片加速服务器', url: IMAGE_WORKER_BASE + encodeURIComponent(IMAGE_PROBE_URL), opaque: true, image: true },
    { name: '图片 CDN', url: IMAGE_CDN_BASE + encodeURIComponent(IMAGE_PROBE_URL), opaque: true, image: true },
    { name: 'API 加速服务器', url: buildApiLineUrl(url, 'api_accel'), opaque: true },
    { name: '图库 API 直连', url, opaque: true },
    { name: 'PicPony API 中转', url: buildApiLineUrl(url, 'picpony_api'), opaque: false },
    { name: '图片直连', url: IMAGE_PROBE_URL, opaque: true, image: true },
    { name: 'PicPony 主站', url: `${PICPONY_API_ORIGIN}/favicon.ico`, opaque: true },
    ...(apiPolicy() === 'third_party' ? [{ name: '全站第三方 API', url: buildApiLineUrl(url, 'third_party'), opaque: true }] : []),
  ];
  for (const probe of probes) {
    signal.throwIfAborted();
    if (readToken() !== token) return;
    const started = Date.now(), deadline = deadlineSignal(signal, PROBE_MS);
    let row: LineCheck;
    try {
      if (probe.image) {
        /* A decode is the answer, so there is no status to report — `decoded` is what the cell
           prints for these lines. `probeImage` owns its own 5s timer and takes no signal. */
        try {
          await probeImage(`${probe.url}${probe.url.includes('?') ? '&' : '?'}_t=${Date.now()}`, PROBE_MS);
          row = { name: probe.name, latency: Date.now() - started, status: 'decoded' };
        } catch {
          const latency = Date.now() - started;
          row = { name: probe.name, latency, status: null, error: latency >= PROBE_MS - 100 ? '请求超时' : '无法加载图片' };
        }
      } else {
        const response = await fetch(probe.url, { mode: probe.opaque ? 'no-cors' : 'cors', signal: deadline.signal, cache: 'no-store', credentials: 'omit' });
        row = { name: probe.name, latency: Date.now() - started, status: response.type === 'opaque' ? null : response.status };
        await response.body?.cancel();
      }
    } catch (error) {
      if (signal.aborted) throw error;
      row = { name: probe.name, latency: Date.now() - started, status: null, error: deadline.timedOut() ? '请求超时' : '无法连接' };
    } finally { deadline.dispose(); }
    if (!signal.aborted && readToken() === token) report(row);
  }
}
