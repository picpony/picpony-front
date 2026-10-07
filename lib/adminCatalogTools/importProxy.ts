import { PICPONY_API_BASE, PICPONY_API_ORIGIN } from '@/lib/constants';
import { CHUNK_BYTES, DICTIONARY_LIMIT, IMAGE_DB_LIMIT, importUrl, uploadId, validatePackage, type Dataset } from './importModel';
import { integer, object } from './model';

const TARGETS: Record<Dataset, string> = { images: 'https://picpony.top/image_tags_importer.php', dictionary: 'https://picpony.top/tag_sync_importer.php' };
const HEADERS = { 'Cache-Control': 'private, no-store' };
const failure = (status: number, error: string) => Response.json({ success: false, error }, { status, headers: HEADERS });
/**
 * How many request bodies this process will hold at once.
 *
 * Unlike `app/api.php/[[...path]]/route.ts`, this route **cannot** stream: its whole security
 * boundary is that it rebuilds the PHP service's documented form field by field rather than
 * forwarding an arbitrary body (`importForm`), and a form cannot be rebuilt from a stream. So the
 * body is read into memory, and the only question is how much memory a caller can make this process
 * hold.
 *
 * A dictionary package is capped at `DICTIONARY_LIMIT` (256 MB), so without a gate a handful of
 * concurrent `POST /admin/import-tools/dictionary` is an OOM. One at a time bounds the whole process
 * to one package, and an import is a single-operator action that is already serialised by its
 * `upload_id`, so a real caller never meets the gate. The slot is taken **after** `verifyAdmin`, or
 * the gate itself becomes the target (G2-001).
 */
const MAX_IN_FLIGHT_BODIES = 1;
let inFlightBodies = 0;
/** A declared body length: `null` for a chunked body, which declares none. Throws on a malformed one. */
function declaredLength(source: Request | Response): number | null {
  const header = source.headers.get('content-length');
  if (header === null) return null;
  const declared = Number(header);
  if (!Number.isSafeInteger(declared) || declared < 0) throw new Error('length');
  return declared;
}
/**
 * No progress for this long and the body is abandoned.
 *
 * `verifyAdmin` means an administrator is the only caller who reaches a body read, so the hazard
 * left is an administrator's own connection dying mid-upload: TCP then delivers nothing more,
 * `read()` never settles, and the one slot is held until the process restarts — the upstream's own
 * 90s timeout cannot help, because the upstream call has not been made yet.
 */
const BODY_IDLE_MS = 20_000;
/**
 * And a trickle — bytes arriving steadily but far too slowly, which no idle timeout catches — is
 * abandoned too: after `BODY_GRACE_MS` the body has to be arriving at `BODY_RATE_FLOOR` on average.
 *
 * A rate rather than a total deadline, because a real 256 MB package legitimately takes minutes and
 * a fixed ceiling would either refuse it or leave the slot holdable for as long as that ceiling.
 * 32 KB/s (256 kbit/s) is the floor: below it a 256 MB package would need over two hours anyway, so
 * refusing is kinder than a slot nobody else can have.
 */
const BODY_GRACE_MS = 30_000;
const BODY_RATE_FLOOR = 32 * 1024;
/**
 * A request body's clock. `signal` is the caller's own disconnect; `now` and `idleMs` are the seam
 * `scripts/testAdminCatalogTools.mjs` drives the two bounds with, so no test waits twenty seconds.
 */
export interface Pace { signal?: AbortSignal; now?: () => number; idleMs?: number }
/** One chunk, or `stalled` / `aborted` — never a `read()` left pending against a released lock. */
async function chunkWithin(reader: ReadableStreamDefaultReader<Uint8Array>, ms: number, signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('aborted');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const pending = reader.read();
  try {
    return await Promise.race([pending, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('stalled')), ms);
      if (signal) { onAbort = () => reject(new Error('aborted')); signal.addEventListener('abort', onAbort, { once: true }); }
    })]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}
/**
 * Read a body into one buffer, never more than `limit`.
 *
 * A declared `Content-Length` is checked first and then used to allocate the buffer once and fill it
 * in place — accumulating chunks and combining them afterwards held two copies of the body at the
 * peak. It is **not required**, because a chunked body declares no length and a proxy may re-chunk a
 * large upload; refusing those would break the one path that needs this. The streaming check is the
 * authority either way, since a declared length can lie, and `MAX_IN_FLIGHT_BODIES` is what bounds
 * what the process holds in total.
 *
 * `pace` is the *request* body's clock — the idle and trickle bounds above, plus the caller's own
 * disconnect, so the slot goes back the moment the operator's browser is gone. A response body is
 * read without it: the upstream `fetch`'s signal already bounds that one.
 */
export async function bounded(source: Request | Response, limit: number, pace?: Pace): Promise<Uint8Array> {
  const declared = declaredLength(source);
  if (declared !== null && declared > limit) throw new Error('large');
  const reader = source.body?.getReader();
  if (!reader) return new Uint8Array();
  const now = pace?.now ?? Date.now;
  const started = now();
  let bytes = new Uint8Array(declared ?? 0);
  let length = 0;
  try {
    if (pace?.signal?.aborted) throw new Error('aborted');
    for (;;) {
      const { value, done } = pace ? await chunkWithin(reader, pace.idleMs ?? BODY_IDLE_MS, pace.signal) : await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit || (declared !== null && length > declared)) throw new Error('large');
      if (length > bytes.byteLength) {
        const grown = new Uint8Array(Math.max(length, bytes.byteLength * 2, 64 * 1024));
        grown.set(bytes.subarray(0, length - value.byteLength));
        bytes = grown;
      }
      bytes.set(value, length - value.byteLength);
      if (pace) {
        const elapsed = now() - started;
        if (elapsed > BODY_GRACE_MS && length / (elapsed / 1000) < BODY_RATE_FLOOR) throw new Error('stalled');
      }
    }
  } catch (error) {
    /* Cancel before the lock is released: `releaseLock()` throws while a `read()` is pending, and
       the stalled and aborted paths both leave one. */
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  return length === bytes.byteLength ? bytes : bytes.subarray(0, length);
}
/**
 * Who may hold the one body slot: `admin` proceeds, `denied` is a signed-in non-administrator,
 * `signed-out` is a token the backend does not know, and `unknown` is no answer at all.
 */
type Verdict = 'admin' | 'denied' | 'signed-out' | 'unknown';
/** The console's own gate for 数据导入: `canAccess('admin', …)` in `components/admin/registry.tsx`. */
const ADMIN_ROLES: ReadonlySet<string> = new Set(['admin', 'super_admin']);
const VERIFY_TIMEOUT_MS = 8000;
/** How long a verdict stands. An image database arrives as ~800 sequential chunk posts, so without
 *  a window every chunk would cost a `get_user`; with it a long upload costs about one a minute. */
const VERIFY_TTL_MS = 60_000;
/** A refusal stands for long enough to absorb a retry loop and not long enough to lock out an
 *  account that was promoted a moment ago. */
const DENY_TTL_MS = 5000;
/** Bounded, oldest first, so a flood of invented tokens cannot grow the map. */
const VERDICT_MAX = 64;
const verdicts = new Map<string, { answer: Promise<Verdict>; until: number }>();
async function askBackend(token: string, fetcher: typeof fetch): Promise<Verdict> {
  const response = await fetcher(`${PICPONY_API_ORIGIN}${PICPONY_API_BASE}?action=get_user`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
  });
  if (response.status === 401) { await response.body?.cancel().catch(() => {}); return 'signed-out'; }
  /* A 403 is the backend refusing this account, which is an answer about the account — not about
     the session, so it must not be reported as a dead login. */
  if (response.status === 403) { await response.body?.cancel().catch(() => {}); return 'denied'; }
  if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error('verify'); }
  const data = object(JSON.parse(new TextDecoder().decode(await bounded(response, 64 * 1024))));
  if (data.success !== true) throw new Error('verify');
  /* No user record on a success envelope is a hiccup, not a statement about the account (the same
     reading `readSessionUser` gives it: a dropped PHP session, a proxy), so it is `unknown` — a
     503 that is true, and not remembered — rather than a 403 telling an administrator they are not
     one. A record whose role is not an administrator's *is* the answer. */
  const user = data.user;
  if (!user || typeof user !== 'object') throw new Error('verify');
  const role = (user as Record<string, unknown>).role;
  return ADMIN_ROLES.has(typeof role === 'string' ? role.toLowerCase() : '') ? 'admin' : 'denied';
}
/**
 * Whether the bearer belongs to an administrator — asked **before a byte of the body is read**.
 *
 * The Authorization header can only be checked for *shape* in this process, so until this read the
 * route admitted a 256 MB body from anyone: `MAX_IN_FLIGHT_BODIES` bounded the memory and in doing
 * so made the slot the target, because a stranger's slow body answered the administrator's own
 * import with 导入服务正忙 (G2-001). One `get_user` with the caller's own bearer settles it — the
 * same read the console's gate uses, and the same read anyone can already make through
 * `app/api.php/…`, so this adds no amplification an attacker did not already have.
 *
 * Three properties it has to keep. **A verdict is one token's**: the map is keyed on the bearer and
 * never consulted for another. **It is bounded**: `VERIFY_TIMEOUT_MS` per read, and the promise is
 * shared while in flight so a burst of chunk posts costs one. **It fails closed**: a read that could
 * not be made is `unknown` rather than a pass, and is not remembered, so the next request asks
 * again. GET is deliberately not verified — it carries no body, so a bogus token costs only the
 * forwarded poll the PHP refuses, and a check would double every 2.5s progress poll.
 */
export async function verifyAdmin(token: string, fetcher: typeof fetch, now: () => number = Date.now): Promise<Verdict> {
  const cached = verdicts.get(token);
  if (cached && cached.until > now()) {
    /* Most recently used last: the eviction below drops the coldest token, not this one. */
    verdicts.delete(token); verdicts.set(token, cached);
    return cached.answer;
  }
  if (cached) verdicts.delete(token);
  const answer = askBackend(token, fetcher).catch((): Verdict => 'unknown');
  const entry = { answer, until: now() + VERIFY_TTL_MS };
  verdicts.set(token, entry);
  while (verdicts.size > VERDICT_MAX) verdicts.delete(verdicts.keys().next().value!);
  const verdict = await answer;
  if (verdicts.get(token) === entry) {
    if (verdict === 'unknown') verdicts.delete(token);
    else if (verdict !== 'admin') entry.until = now() + DENY_TTL_MS;
  }
  return verdict;
}
function fields(form: FormData, allowed: string[]) {
  const keys = [...form.keys()];
  if (keys.some((key) => !allowed.includes(key) || form.getAll(key).length !== 1)) throw new Error('fields');
}
function string(form: FormData, key: string) {
  const value = form.get(key);
  if (typeof value !== 'string') throw new Error('field');
  return value;
}
/** Rebuild a fixed PHP service's documented form, never forward an arbitrary request body. */
export function importForm(dataset: Dataset, incoming: FormData): FormData {
  const out = new FormData();
  out.set('upload_id', uploadId(incoming.get('upload_id')));
  if (dataset === 'dictionary') {
    fields(incoming, ['package', 'upload_id']);
    const file = incoming.get('package');
    if (!(file instanceof File)) throw new Error('file');
    validatePackage(file, dataset); out.set('package', file, file.name); return out;
  }
  const action = string(incoming, 'action'); out.set('action', action);
  if (action === 'import_from_url') {
    fields(incoming, ['action', 'url', 'upload_id']); out.set('url', importUrl(incoming.get('url'))); return out;
  }
  if (action !== 'upload_chunk' && action !== 'finalize') throw new Error('action');
  const expected = ['action', 'upload_id', 'filename', 'total_chunks', 'total_size'];
  fields(incoming, action === 'upload_chunk' ? [...expected, 'chunk_index', 'chunk'] : expected);
  const filename = string(incoming, 'filename'); const size = integer(string(incoming, 'total_size'), 1);
  validatePackage({ name: filename, size }, 'images');
  const total = integer(string(incoming, 'total_chunks'), 1);
  if (size > IMAGE_DB_LIMIT || total !== Math.ceil(size / CHUNK_BYTES)) throw new Error('size');
  out.set('filename', filename); out.set('total_size', String(size)); out.set('total_chunks', String(total));
  if (action === 'upload_chunk') {
    const index = integer(string(incoming, 'chunk_index')); const chunk = incoming.get('chunk');
    if (index >= total || !(chunk instanceof File) || chunk.size !== Math.min(CHUNK_BYTES, size - index * CHUNK_BYTES)) throw new Error('chunk');
    out.set('chunk_index', String(index)); out.set('chunk', chunk, 'chunk.part');
  }
  return out;
}
/** No server credential, redirect, cookie, arbitrary target or backend HTML crosses this boundary. */
export async function handleImport(request: Request, dataset: Dataset, fetcher: typeof fetch = fetch, timing: Pace = {}): Promise<Response> {
  const authorization = request.headers.get('authorization') ?? '';
  if (!/^Bearer [^\s\u0000-\u001f]{1,4096}$/.test(authorization)) return failure(401, '请先登录');
  if (request.method !== 'GET' && request.method !== 'POST') return failure(405, '请求方式无效');
  const target = new URL(TARGETS[dataset]);
  let body: FormData | undefined;
  try {
    const url = new URL(request.url);
    if (request.method === 'GET') {
      const action = url.searchParams.get('action');
      if (!['last_update', 'status', ...(dataset === 'images' ? ['chunk_status'] : [])].includes(action ?? '')) throw new Error('action');
      const allowed = action === 'last_update' ? ['action'] : ['action', 'upload_id'];
      for (const key of url.searchParams.keys()) if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) throw new Error('query');
      target.searchParams.set('action', action!);
      if (action !== 'last_update') target.searchParams.set('upload_id', uploadId(url.searchParams.get('upload_id')));
    } else {
      if ([...url.searchParams].length) throw new Error('query');
      const type = request.headers.get('content-type') ?? '';
      if (!type.startsWith('multipart/form-data;')) return failure(415, '请选择更新文件或文件直链');
      const limit = (dataset === 'images' ? CHUNK_BYTES : DICTIONARY_LIMIT) + 128 * 1024;
      /* The declared length first: a body that says it is over the cap is refused without a
         verification read and without a byte in memory. */
      const declared = declaredLength(request);
      if (declared !== null && declared > limit) throw new Error('large');
      const verdict = await verifyAdmin(authorization.slice(7), fetcher, timing.now);
      /* 401 and nothing else for a dead session: `importClient` turns exactly that status into the
         app's one sign-out (`noteUnauthorized`), and a non-administrator's 403 must not sign them
         out of a session that is perfectly alive. */
      if (verdict === 'signed-out') return failure(401, '请先登录');
      if (verdict === 'denied') return failure(403, '仅管理员可使用数据导入');
      if (verdict === 'unknown') return failure(503, '暂时无法校验管理员身份，请稍后重试');
      if (inFlightBodies >= MAX_IN_FLIGHT_BODIES) return failure(503, '导入服务正忙，请稍后重试');
      inFlightBodies += 1;
      try {
        const bytes = await bounded(request, limit, { signal: request.signal, ...timing });
        const form = await new Response(bytes as BodyInit, { headers: { 'content-type': type } }).formData();
        body = importForm(dataset, form);
      } finally { inFlightBodies -= 1; }
    }
  } catch (error) {
    const kind = error instanceof Error ? error.message : '';
    if (kind === 'stalled') return failure(408, '上传中断或过慢，请重新上传');
    return failure(kind === 'large' ? 413 : 400, '导入参数或文件无效');
  }
  try {
    const response = await fetcher(target, { method: request.method, headers: { Authorization: authorization, Accept: 'application/json' }, body, cache: 'no-store', redirect: 'manual', signal: AbortSignal.any([request.signal, AbortSignal.timeout(request.method === 'GET' ? 15000 : 90000)]) });
    if (response.status >= 300 && response.status < 400) return failure(502, '导入服务返回了无法识别的数据');
    const data = object(JSON.parse(new TextDecoder().decode(await bounded(response, 1024 * 1024))));
    if (typeof data.success !== 'boolean') return failure(502, '导入服务返回了无法识别的数据');
    const result: Record<string, unknown> = { success: data.success };
    for (const key of ['upload_id', 'status', 'stage', 'percent', 'updated_at', 'chunks', 'image_count', 'file_size_mb', 'valid_count', 'created_count', 'updated_count', 'skipped_count', 'failed_count']) if (data[key] !== undefined) result[key] = data[key];
    /* A refusal gets the file-shaped sentence only when the status does not already say what went
       wrong. On 401/403 the session is what failed, and `describeFailure` prefers a server message,
       so overwriting it told an admin whose token had expired to check their file. */
    if (!data.success && response.status !== 401 && response.status !== 403) result.error = '导入服务未接受请求，请核对任务状态和文件';
    return Response.json(result, { status: response.status, headers: HEADERS });
  } catch { return failure(502, request.method === 'POST' ? '未能确认提交结果，请核对任务状态' : '导入状态加载失败'); }
}
