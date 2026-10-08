import { picponyPostJson, picponyRequest, readEnvelope, readObject, deadlineSignal } from './http';
import { ApiError, isAborted, isApiError, toApiError } from './errors';
import { CatalogOutcomeUnknown } from './adminCatalogTools';
import { readAnnouncementHistory } from './messages';
import { readToken, readUserInfo } from '@/lib/hooks';
import { apiPolicy, buildApiLineUrl, ensureRoutePolicy, probeImage, refreshRoutePolicy, resolveApiLine } from '@/lib/route';
import { DERPIBOORU_API_BASE, IMAGE_CDN_BASE, IMAGE_PROBE_URL, IMAGE_WORKER_BASE, PICPONY_API_ORIGIN } from '@/lib/constants';
import {
  record, rows, strings, text, count, measurement, id, flag, integer, dateValue, fieldsPayload,
  modeFields, cloudFields, cloudPayload, apiRouteFields, imageRouteFields, routePayload,
  relayFields, quotaFields, assistantFields, assistantPayload, configValues, ratePayload,
  type Row, type Values, type RateRule, optionalCount, optionalMeasurement, epochStamp, isoDate, webUrl,
} from '@/lib/adminSiteTools/model';

/** Config errors may echo a submitted credential. Keep only the status, never that body. */
async function decode(response: Response, confidential = false): Promise<Row> {
  try { return await readEnvelope<Row>(response); }
  catch (error) {
    if (!isApiError(error)) throw error;
    if (error.status === 404 || error.status === 405 || error.status === 501) {
      throw new ApiError('http', { status: error.status, notFound: false, retryable: false, message: '当前服务器尚未提供此功能' });
    }
    if (confidential) throw new ApiError(error.kind, { status: error.status, retryable: error.retryable });
    throw error;
  }
}
async function read(action: string, token: string, query: Record<string, string | number | undefined> = {}, signal?: AbortSignal, confidential = false) {
  return decode(await picponyRequest(action, { token, query, signal, cache: 'no-store' }), confidential);
}
/**
 * A write the server may have acted on without our hearing about it — the catalogue's own error
 * (`CatalogOutcomeUnknown`), so `useCatalogMutation` holds 操作结果待确认 for it exactly as it does
 * for a catalogue write, and there is one rule rather than two. `message` is for an outcome that is
 * known to have happened but cannot be used (the invite below).
 */
export class WriteOutcomeUnknown extends CatalogOutcomeUnknown {
  constructor(message?: string) {
    super();
    if (message) this.message = message;
  }
}
/**
 * One site-tool write. **A lost acknowledgement is not a refusal** (G2-009): a request that got no
 * answer, a 5xx, or a 2xx whose body does not say `success` true or false all leave the outcome
 * unknown, because the server may have acted — and for a write that is not idempotent (the
 * whitelist invite mints a live link per press) a refusal sentence invited the second press that
 * minted the second link. 501 is the exception: 当前服务器尚未提供此功能 is an answer. Nothing here
 * retries.
 */
async function write(action: string, token: string, body?: Row, confidential = false, validate?: (data: Row) => void) {
  let response: Response;
  try {
    response = body === undefined
      ? await picponyRequest(action, { token, method: 'POST' })
      : await picponyPostJson(action, body, { token });
  } catch (error) {
    if (isAborted(error)) throw error;
    throw new WriteOutcomeUnknown();
  }
  const copy = response.clone();
  let data: Row;
  try { data = await decode(response, confidential); }
  catch (error) {
    if (!isApiError(error)) throw new WriteOutcomeUnknown();
    if (error.kind === 'invalid' || (error.kind === 'http' && (error.status ?? 0) >= 500 && error.status !== 501)) throw new WriteOutcomeUnknown();
    if (error.kind === 'envelope') {
      const answered: unknown = await copy.json().catch(() => null);
      if (!answered || typeof answered !== 'object' || typeof (answered as Row).success !== 'boolean') throw new WriteOutcomeUnknown();
    }
    throw error;
  }
  validate?.(data);
  return Response.json(data);
}

export { readAnnouncementHistory };

/**
 * 全站线路's and 智能搜索's view of the status document. **Derived, not read**: the document is the
 * console's shared `siteStatusQuery` (one request for 其他功能, the overview and these two — G2-019),
 * so this is a pure function of it and throws `invalid` only for a field these two panels need.
 */
export function siteToolsStatus(source: Row) {
  const mode = source.semantic_search_mode ?? (source.semantic_search_enabled === true ? 'legacy' : 'off');
  const cloud = configValues(cloudFields, {
    semantic_cloud_enabled: source.semantic_cloud_enabled ?? false,
    semantic_cloud_base_url: source.semantic_cloud_base_url ?? 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    semantic_cloud_model: source.semantic_cloud_model ?? 'GLM-4.5-Flash',
    semantic_cloud_timeout_ms: source.semantic_cloud_timeout_ms ?? 15000,
  });
  /* `== null`, like every neighbour's `??`: `global_api_third_party_urls: null` is "no list", and
     testing only `undefined` sent `null` into `strings()`, which threw and took out both consumers
     of this read (全站线路 and 智能搜索) at once. */
  const urls = source.global_api_third_party_urls == null
    ? [text(source.global_api_third_party_url)].filter(Boolean) : strings(source.global_api_third_party_urls);
  const api = configValues(apiRouteFields, { policy: source.global_api_route_policy ?? 'auto', third_party_urls: urls.join('\n'), third_party_pass_api_key: source.global_api_third_party_pass_api_key ?? false });
  const image = configValues(imageRouteFields, { policy: source.global_image_route_policy ?? 'auto' });
  return { mode: String(mode), cloud, hasKey: flag(source.semantic_cloud_has_key ?? false), api, image };
}
export const saveSemanticMode = (token: string, values: Values) => write('admin_toggle_semantic_search', token, fieldsPayload(modeFields, values));
export const saveSemanticCloud = (token: string, values: Values) => write('admin_save_semantic_cloud', token, cloudPayload(values), true);
export const testSemanticCloud = (token: string) => write('admin_test_semantic_cloud', token, {}, true, (d) => { optionalMeasurement(d.ms); });
export const saveApiRoute = (token: string, values: Values) => write('admin_save_global_api_route_policy', token, routePayload(values), true);
export const saveImageRoute = (token: string, values: Values) => write('admin_save_global_image_route_policy', token, fieldsPayload(imageRouteFields, values));

export interface Page<T> { rows: T[]; page: number; total: number; totalPages: number }
export interface PageArgs { page: number; perPage?: number }
function pageQuery(args: PageArgs) {
  const page = integer(args.page, 1, 1000000), perPage = integer(args.perPage ?? 20, 1, 100);
  if (!page || !perPage) throw new ApiError('invalid');
  return { page, per_page: perPage };
}
function pageOf<T>(list: T[], data: Row, args: PageArgs): Page<T> {
  const total = count(data.total), page = id(data.page ?? args.page);
  return { rows: list, total, page, totalPages: Math.max(1, Math.ceil(total / (args.perPage ?? 20))) };
}
export interface Feedback { id: number; status: string; query: string; result: string; user: string; engine: string; date: string }
export interface FeedbackArgs extends PageArgs { status: string; q: string }
export async function readFeedback(token: string, args: FeedbackArgs, signal?: AbortSignal) {
  if (!['all', 'new', 'archived'].includes(args.status)) throw new ApiError('invalid');
  const d = await read('admin_list_semantic_feedback', token, { ...pageQuery(args), status: args.status, q: args.q.trim() || undefined }, signal);
  const list = rows(d.items).map((r) => ({ id: id(r.id), status: text(r.status), query: text(r.query_text), result: text(r.model_result), user: text(r.username), engine: text(r.engine), date: text(r.created_at) }));
  return pageOf(list, d, args);
}
export const archiveFeedback = (token: string, target: number, archived: boolean) => write('admin_archive_semantic_feedback', token, { id: id(target), archived: flag(archived) });
export function deleteFeedback(token: string, targets: number[]) {
  if (!targets.length) throw new ApiError('invalid');
  return write('admin_delete_semantic_feedback', token, { ids: [...new Set(targets.map(id))] });
}
export async function readRelayConfig(token: string, signal?: AbortSignal) {
  const d = await read('get_relay_config', token, {}, signal, true);
  return { values: configValues(relayFields, d), attempts: count(d.switchback_attempts ?? 0) };
}
export const saveRelayConfig = (token: string, values: Values) => write('save_relay_config', token, fieldsPayload(relayFields, values), true);
export interface RelayStatsArgs extends PageArgs { range: string; date: string; sort: string; order: string }
export async function readRelayStats(token: string, args: RelayStatsArgs, signal?: AbortSignal) {
  if (!['1', '7', '30'].includes(args.range) || !['total', 'last_seen'].includes(args.sort) || !['asc', 'desc'].includes(args.order)) throw new ApiError('invalid');
  const d = await read('admin_get_relay_stats', token, { ...pageQuery(args), range: args.range, date: dateValue(args.date) || undefined, sort: args.sort, order: args.order }, signal);
  /* `last_seen`'s unit is read from its magnitude (`epochStamp`): this backend answers it in
     milliseconds, as both original consoles read it, while the sibling lock row's
     `dev_mode_lock_until` is seconds. A string form (a formatted date) is kept as text rather than
     failing the page, which `count()` did. */
  const list = rows(d.stats).map((r) => ({ ip: text(r.ip), username: text(r.username), total: count(r.total), search: count(r.search), normal: count(r.normal), last_seen: epochStamp(r.last_seen) }));
  return pageOf(list, record(d.pagination), args);
}
export async function readRelayErrors(token: string, args: PageArgs & { date: string }, signal?: AbortSignal) {
  const d = await read('admin_get_relay_error_logs', token, { ...pageQuery(args), date: dateValue(args.date) || undefined }, signal);
  /* The upstream status, the relay's own and the duration are **optional**: for a connect or DNS
     failure the relay never reached Derpibooru, so none of them exists — and that is precisely the
     class of row this log is opened to read. They used to throw and fail the whole page. */
  const list = rows(d.logs).map((r, i) => ({ key: `${args.page}:${i}`, time: text(r.time_beijing || r.time), status: optionalCount(r.upstream_status ?? r.status), relay: optionalCount(r.relay_status), duration: r.duration_ms == null ? null : measurement(r.duration_ms), reason: text(r.reason), method: text(r.method), phase: text(r.phase), target: text(r.target_host) + text(r.target_path) }));
  /* The envelope's own two fields are optional for the same reason the row's are: before the relay
     has written a log there is no file, so neither `available` nor `dates` exists and the whole page
     failed on the state it is opened in first (NEW-3). The original tolerated both —
     `coord/admin-live-20261003.html:2184` `Array.isArray(dates) ? dates : []` and `:2223`'s
     日志文件尚未创建. A wrong *type* still fails: that is a broken response, not an absent log. */
  return { ...pageOf(list, d, args), available: d.available == null ? false : flag(d.available), dates: d.dates == null ? [] : strings(d.dates) };
}
export interface Lock { id: number; username: string; attempts: number; until: number }
export async function readRateLimits(token: string, signal?: AbortSignal) {
  const d = await read('admin_get_rate_limit_management', token, {}, signal);
  const rules: RateRule[] = Object.entries(record(d.rules)).map(([action, value]) => {
    const r = record(value);
    return { action, label: text(r.label) || action, max: String(count(r.max)), window: String(count(r.window)), key_type: text(r.key_type) };
  });
  const locks: Lock[] = rows(d.temporary_locks).map((r) => ({ id: id(r.id), username: text(r.username), attempts: count(r.dev_mode_attempts), until: count(r.dev_mode_lock_until) }));
  return { rules, locks, serverTime: count(d.server_time) };
}
export const saveRateLimits = (token: string, rules: RateRule[]) => write('admin_save_rate_limit_rules', token, ratePayload(rules));
export const releaseLock = (token: string, target: number) => write('admin_release_temporary_lock', token, { user_id: id(target) });
export async function readDailyStats(token: string, signal?: AbortSignal) {
  const d = await read('admin_get_daily_user_stats', token, { days: 30 }, signal);
  /* `isoDate`, not `dateValue`: the latter is the **form**'s validator and throws `FormProblem`
     ("请输入有效的日期", non-retryable), so one unexpected server format told the admin to correct a
     date on a screen with no date input and left the panel unrecoverable. A date this read cannot
     parse drops its own label instead. */
  return rows(d.stats).map((r) => ({ date: isoDate(text(r.date)), newUsers: count(r.new_users) }));
}
/** 访问统计's tiles, from the `stats` the shared `admin_get_users` answer carries (G2-019 — it was a
 *  second read of the whole account list for four numbers). */
export function visitorStats(value: unknown) {
  const stats = record(value);
  return { today: count(stats.today_new_users), online: count(stats.online_users_30m), visitors: count(stats.today_visitors), onlineVisitors: count(stats.online_visitors_30m) };
}
export const banDeveloper = (token: string, target: number) => write('admin_ban_developer', token, { target_id: id(target) });
export const unbanDeveloper = (token: string, target: number) => write('admin_unban_developer', token, { target_id: id(target) });
export const toggleAccelerationBan = (token: string, target: number, banned: boolean) => write('admin_toggle_api_accel_ban', token, { id: id(target), banned: flag(banned) ? 1 : 0 });
/**
 * Minting an invite is **not idempotent**, so every failure sentence here has to be true.
 *
 * `new URL(text(d.url))` threw a bare `TypeError` for a missing or relative `url`, which
 * `lib/api/errors.ts` turns into 网络连接失败，请检查网络后再试 — so an admin whose invite the backend
 * had just created was told the network failed, pressed again, and minted a second live invite with
 * the first one loose. `webUrl` answers instead of throwing, and the sentence says what happened —
 * as an outcome to reconcile, not a refusal, so the panel holds it (`useCatalogMutation`) rather
 * than offering the press again.
 */
export const generateWhitelistInvite = (token: string) => write('admin_generate_whitelist_invite', token, undefined, true, (d) => {
  if (!webUrl(text(d.url))) throw new WriteOutcomeUnknown('邀请链接已生成，但返回地址无效，请刷新后核对，勿重复生成');
});
export const cleanupLegacyVerifications = (token: string) => write('admin_cleanup_legacy_derpi_verifications', token, undefined, false, (d) => { count(d.cleared_count); });

export async function readAiQuota(token: string, signal?: AbortSignal) {
  return configValues(quotaFields, record((await read('admin_get_ai_quota', token, {}, signal, true)).quota_config));
}
export const saveAiQuota = (token: string, values: Values) => write('admin_save_ai_quota', token, fieldsPayload(quotaFields, values));
export interface ModelList { catalog: string[]; candidates: string[]; benchmarks: Record<string, { ok: boolean; latency: number | null }>; model: string }
export function modelList(d: Row, optionalCatalog = false): ModelList {
  const catalog = [...new Set(strings(optionalCatalog && d.model_catalog === undefined ? [] : d.model_catalog))], candidates = strings(d.model_candidates === undefined ? [] : d.model_candidates);
  const benchmarks = Object.fromEntries(Object.entries(record(d.model_benchmarks === undefined ? {} : d.model_benchmarks)).map(([name, raw]) => {
    const r = record(raw), ok = flag(r.ok ?? false);
    /* A working model that did not report its duration is still a working model: `latency_ms` is
       optional, and the cell says 可用 rather than inventing a number or failing the panel (G2-003). */
    return [name, { ok, latency: ok ? optionalMeasurement(r.latency_ms) : null }];
  }));
  return { catalog, candidates, benchmarks, model: text(d.model) };
}
export async function readAssistantConfig(token: string, signal?: AbortSignal) {
  const d = await read('admin_get_ai_assistant_config', token, {}, signal, true);
  const values: Values = { ...configValues(assistantFields, d), model_candidates: strings(d.model_candidates === undefined ? [] : d.model_candidates) };
  /* `has_key ?? false`, like the sibling read's `semantic_cloud_has_key`: a never-configured
     assistant sends no flag, and that is "no key saved", not a response nobody can read — it used
     to make the one form that could configure it unreachable (G2-003). */
  return { values, hasKey: flag(d.has_key ?? false), ...modelList(d, true) };
}
export const saveAssistantConfig = (token: string, values: Values) => write('admin_save_ai_assistant_config', token, assistantPayload(values), true);
export const testAssistant = (token: string) => write('admin_test_ai_assistant_provider', token, {}, true, (d) => { optionalMeasurement(d.latency_ms); });
export const listAssistantModels = (token: string) => write('admin_list_ai_assistant_models', token, {}, true, (d) => { modelList(d); });
export const discoverAssistantModels = (token: string, values: Values) => write('admin_discover_ai_assistant_models', token, { ...assistantPayload(values), clear_key: false }, true, (d) => { modelList(d); });

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
 * the only evidence that means "this line works". A `no-cors` fetch yields an opaque response that
 * resolves on a 500 as readily as on a 200, which is why 线路检测 could previously only ever answer
 * 已收到响应，状态码不可读 for them — honest, and useless. An API line stays a `fetch`: it answers
 * JSON, and `picpony_api` is CORS-capable so its real status is readable.
 *
 * For the lines that remain opaque, an opaque response proves reachability only, never an HTTP
 * success or an unbanned upstream.
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
           prints for these lines. `probeImage` owns its own 5s timer and takes no signal, so the
           elapsed time is what distinguishes a timeout from a refusal; a late resolution after
           停止检测 is dropped by the caller's run guard. */
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
