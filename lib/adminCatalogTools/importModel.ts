import { ApiError } from '@/lib/api/errors';
import { integer, object, text, type ObjectRow } from './model';

export type Dataset = 'images' | 'dictionary';
export const CHUNK_BYTES = 10 * 1024 * 1024;
export const IMAGE_DB_LIMIT = 8 * 1024 * 1024 * 1024;
export const DICTIONARY_LIMIT = 256 * 1024 * 1024;
export type ImportPhase = 'uploading' | 'paused' | 'staged' | 'submitted' | 'processing' | 'done' | 'error' | 'unknown';
export interface ImportJob {
  id: string; dataset: Dataset; filename: string; size: number; totalChunks: number; chunks: number[];
  fingerprint: string; phase: ImportPhase; percent: number; counts?: Record<string, number>;
}
export function uploadId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(value)) throw new ApiError('invalid', { message: '导入任务编号无效', retryable: false });
  return value;
}
export function validatePackage(file: Pick<File, 'name' | 'size'>, dataset: Dataset) {
  const valid = dataset === 'images' ? /\.(db|sqlite|zip|gz)$/i : /\.ppsync$/i;
  const limit = dataset === 'images' ? IMAGE_DB_LIMIT : DICTIONARY_LIMIT;
  if (!valid.test(file.name) || /[\\/\u0000-\u001f]/.test(file.name) || file.name.length > 200 || file.size < 1 || file.size > limit) {
    throw new ApiError('invalid', { message: dataset === 'images' ? '请选择不超过 8 GB 的 DB、SQLite、ZIP 或 GZ 文件' : '请选择不超过 256 MB 的 PPSync 词库更新包', retryable: false });
  }
}
export function importUrl(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  let url: URL;
  try { url = new URL(raw); } catch { throw new ApiError('invalid', { message: '请输入有效的文件直链', retryable: false }); }
  const host = url.hostname.toLowerCase();
  /* A shape check, not a destination check — and it must not be read as one. The PHP service is
     what fetches the file, so it owns the decision; these clauses only refuse the obvious local
     forms typed by hand. They cannot stop a public name that resolves to a private address
     (`169.254.169.254.nip.io`, or any domain whose A record is internal), nor a public URL that
     answers `302 → http://127.0.0.1/…`, because the PHP follows the redirect. Making this mean
     something requires an allowlist of download hosts here, and resolve-then-connect with
     redirects disabled in `image_tags_importer.php`. (Encoded literals are not a bypass: WHATWG
     `new URL()` normalises `http://0x7f.0x0.0x0.0x1/` to `127.0.0.1`, which the all-digits clause
     refuses.) */
  if (raw.length > 2048 || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash || !host.includes('.') || host.endsWith('.local') || host.endsWith('.localhost') || host.endsWith('.internal') || host.includes(':') || /^[\d.]+$/.test(host)) throw new ApiError('invalid', { message: '文件直链须为公开网站的 HTTP 或 HTTPS 地址，且不含凭据', retryable: false });
  return url.href;
}
export function chunkIndexes(value: unknown, total: number): number[] {
  if (!Array.isArray(value)) throw new ApiError('invalid');
  const indexes = value.map((value) => integer(value));
  if (indexes.some((index) => index >= total)) throw new ApiError('invalid');
  return [...new Set(indexes)].sort((a, b) => a - b);
}
export function parseJob(value: unknown, dataset: Dataset): ImportJob {
  const data = object(value);
  const phases: ImportPhase[] = ['uploading', 'paused', 'staged', 'submitted', 'processing', 'done', 'error', 'unknown'];
  if (data.dataset !== dataset || !phases.includes(data.phase as ImportPhase)) throw new ApiError('invalid');
  const totalChunks = integer(data.totalChunks);
  const size = integer(data.size);
  if (size > (dataset === 'images' ? IMAGE_DB_LIMIT : DICTIONARY_LIMIT) || totalChunks > Math.ceil(IMAGE_DB_LIMIT / CHUNK_BYTES)) throw new ApiError('invalid');
  const percent = data.percent;
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) throw new ApiError('invalid');
  const counts = data.counts === undefined ? undefined
    : Object.fromEntries(Object.entries(object(data.counts)).map(([key, value]) => [key, integer(value)]));
  return { id: uploadId(data.id), dataset, filename: text(data.filename, 200), size, totalChunks, chunks: chunkIndexes(data.chunks, totalChunks), fingerprint: text(data.fingerprint, 300), phase: data.phase === 'uploading' ? 'paused' : data.phase as ImportPhase, percent, ...(counts && { counts }) };
}
/**
 * What identifies "the same file" across a resumed upload: its size, and a digest of its first and
 * last megabyte. It answers one question — is the file the operator just chose the one whose chunks
 * the server already has — so it needs to distinguish files, not resist an attacker.
 *
 * **`crypto.subtle` only exists in a secure context** (HTTPS or `localhost`), and this app is
 * reachable over plain HTTP on a LAN address, where it is `undefined` — resuming an import there
 * threw instead of comparing. The fallback is FNV-1a over the same bytes: weaker, and sufficient,
 * because a mismatch only costs a re-upload while the size prefix already separates the common case.
 */
export async function fingerprint(file: File): Promise<string> {
  const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
  const head = await file.slice(0, 1048576).arrayBuffer();
  const tail = await file.slice(Math.max(0, file.size - 1048576)).arrayBuffer();
  const subtle = typeof crypto === 'undefined' ? undefined : crypto.subtle;
  if (subtle) {
    const [first, last] = await Promise.all([subtle.digest('SHA-256', head), subtle.digest('SHA-256', tail)]);
    return `${file.size}:${hex(first)}:${hex(last)}`;
  }
  const fnv = (buffer: ArrayBuffer) => {
    let hash = 0x811c9dc5;
    for (const byte of new Uint8Array(buffer)) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
    return hash.toString(16).padStart(8, '0');
  };
  return `${file.size}:fnv-${fnv(head)}:fnv-${fnv(tail)}`;
}
const PROGRESS_STAGES = new Set(['downloading', 'assembling', 'extracting', 'integrity', 'counting', 'sampling', 'saving', 'processing', 'waiting', 'queued', 'uploading']);
export function importStatus(data: ObjectRow, job: ImportJob, fromStatus = true): ImportJob {
  if (fromStatus && (job.dataset === 'images' || data.upload_id !== undefined) && data.upload_id !== job.id) throw new ApiError('invalid', { message: '任务编号不匹配，请重新核对进度', retryable: false });
  // Polling can settle before the submitted POST returns its initial processing acknowledgement.
  if (job.phase === 'done' || job.phase === 'error') return job;
  const stage = data.stage ?? data.status;
  if (stage === 'error') return { ...job, phase: 'error' };
  if (stage === 'done' || (!fromStatus && stage !== 'processing' && (job.dataset === 'images' ? data.image_count !== undefined : data.valid_count !== undefined))) {
    const keys = job.dataset === 'images' ? ['image_count'] : ['valid_count', 'created_count', 'updated_count', 'skipped_count'];
    /* Every counter is **required** on a finished stage, and that is deliberate: a `done` payload
       missing one may be a partial result, and defaulting it to 0 would report success with nothing
       created. `scripts/testAdminCatalogTools.mjs` pins it ("partial batches never become success").
       `failed_count` is the one that is genuinely optional — absent means none reported — so `null`
       is read as absent rather than thrown on. */
    const counts = Object.fromEntries(keys.map((key) => [key, integer(data[key])]));
    if (data.failed_count != null) counts.failed_count = integer(data.failed_count);
    return { ...job, phase: counts.failed_count ? 'error' : 'done', percent: 100, counts };
  }
  if (!PROGRESS_STAGES.has(String(stage))) throw new ApiError('invalid', { message: '未能识别导入进度，请核对任务状态' });
  /* `null` is "this stage does not report a percentage", like an absent key — `Number(null)` is 0,
     which passes the range check and snapped the meter back to empty on every 2.5s poll. */
  const percent = data.percent == null ? job.percent : Number(data.percent);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new ApiError('invalid');
  return { ...job, phase: 'processing', percent: Math.min(percent, 99) };
}
export function chunkForm(job: ImportJob, file: File, index: number): FormData {
  if (job.dataset !== 'images' || !Number.isInteger(index) || index < 0 || index >= job.totalChunks) throw new ApiError('invalid');
  const body = finalForm(job); body.set('action', 'upload_chunk'); body.set('chunk_index', String(index));
  body.set('chunk', file.slice(index * CHUNK_BYTES, Math.min(file.size, (index + 1) * CHUNK_BYTES)), 'chunk.part');
  return body;
}
export function finalForm(job: ImportJob): FormData {
  const body = new FormData();
  for (const [key, value] of Object.entries({ action: 'finalize', upload_id: job.id, filename: job.filename, total_chunks: job.totalChunks, total_size: job.size })) body.set(key, String(value));
  return body;
}
/** One accepted chunk at a time. Stop and account changes are observed before the next write. */
export async function uploadChunks(job: ImportJob, file: File, ports: { status: () => Promise<ObjectRow>; send: (body: FormData) => Promise<unknown>; current: () => boolean; stop: () => boolean; progress: (job: ImportJob) => void }): Promise<ImportJob> {
  validatePackage(file, 'images');
  if (file.size !== job.size || file.name !== job.filename || await fingerprint(file) !== job.fingerprint) throw new ApiError('invalid', { message: '请选择同一个文件以继续上传', retryable: false });
  /* An absent `chunks` means "nothing accepted yet", which is a resume starting from zero — not a
     broken response that should fail the resume the operator just asked for. */
  const done = new Set(chunkIndexes((await ports.status()).chunks ?? [], job.totalChunks));
  let state = { ...job, chunks: [...done], phase: 'uploading' as ImportPhase };
  for (let index = 0; index < job.totalChunks; index++) {
    if (!ports.current() || ports.stop()) { state = { ...state, phase: 'paused' }; if (ports.current()) ports.progress(state); return state; }
    if (done.has(index)) continue;
    await ports.send(chunkForm(job, file, index));
    done.add(index);
    state = { ...state, chunks: [...done], percent: Math.floor(done.size / job.totalChunks * 100) };
    if (ports.current()) ports.progress(state);
  }
  state = { ...state, phase: 'staged', percent: 100 };
  if (ports.current()) ports.progress(state);
  return state;
}
