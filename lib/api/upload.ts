import { readUserInfo, updateUserInfo } from '@/lib/hooks';
import { ApiError, FAILURE_MESSAGES, statusMessage, toApiError } from './errors';
import { API_V1, apiErrorBody, apiRequest } from './http';

/**
 * 发布图片 — a picture goes to Derpibooru in two steps, the original front end's contract:
 *
 * 1. **Staging** (`POST /api/v1/me/uploads/works`): the file goes to PicPony, which answers with
 *    an absolute `url` carrying a 24-hour capability for Derpibooru to fetch it by. PicPony is
 *    reachable where Derpibooru often is not, and the progress of the one large transfer can be
 *    shown.
 * 2. **Submission**: Derpibooru's API takes a picture *by URL* — `POST /api/v1/json/images?key=`
 *    with JSON `{image: {tag_input, source_url, description}, url}`, and nothing else; it has no
 *    multipart form (derpibooru.org/pages/api). The request goes through the relay, as the
 *    original did, by way of this app's own `/upload/submit` (the relay answers only PicPony's
 *    own origin, so the browser cannot reach it from here — see `app/upload/submit/route.ts`).
 *
 * Both are writes and neither is ever retried by this module.
 */

/** What the form takes: the original front end's list, and Derpibooru's own. */
export const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/webm', 'video/mp4'] as const;
export const UPLOAD_ACCEPT = UPLOAD_TYPES.join(',');
export const UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

/** Derpibooru's four content ratings, one of which every upload carries; the site glossary's names. */
export const RATING_TAGS = [
  { tag: 'safe', label: '安全' },
  { tag: 'suggestive', label: '性暗示' },
  { tag: 'questionable', label: '色情' },
  { tag: 'explicit', label: '露骨' },
] as const;
export type RatingTag = (typeof RATING_TAGS)[number]['tag'];

/** The original page's floor: 「标签中必须并正确包含至少3个标签」, the rating counted. */
export const MIN_UPLOAD_TAGS = 3;

/** This app's hop to the relay. */
export const UPLOAD_SUBMIT_PATH = '/upload/submit';

// ---------------------------------------------------------------------------
// A multipart write with upload progress
// ---------------------------------------------------------------------------

/** What every PicPony upload answers with (src/pg/media.rs `upload`, HTTP 201). */
export interface UploadedMedia {
  /** 64 hex characters: the file's identity, which content references as `/api/v1/media/<asset>`. */
  asset: string;
  /** `/api/v1/media/<asset>` — absolute, with a capability, for a work upload. */
  url: string;
  mime: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  /** When an unreferenced upload is discarded. */
  expires_at: string | null;
  max_bytes: number;
}

function csrfOf(token: string): string | null {
  const user = readUserInfo();
  return user && user.token === token && typeof user.csrfToken === 'string' ? user.csrfToken : null;
}

/** A fresh CSRF token for the session, stored beside it; `null` when none could be had. */
async function freshCsrf(token: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_V1}/auth/csrf`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { csrf_token?: unknown };
    if (typeof data.csrf_token !== 'string') return null;
    updateUserInfo(token, { csrfToken: data.csrf_token });
    return data.csrf_token;
  } catch {
    return null;
  }
}

interface XhrAnswer {
  status: number;
  body: unknown;
}

function sendOnce(
  path: string,
  token: string,
  form: FormData,
  csrf: string | null,
  signal: AbortSignal | undefined,
  onProgress: ((fraction: number) => void) | undefined,
): Promise<XhrAnswer> {
  return new Promise<XhrAnswer>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('上传已取消', 'AbortError'));
      return;
    }
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const done = () => signal?.removeEventListener('abort', onAbort);
    xhr.open('POST', `${API_V1}${path}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    if (csrf) xhr.setRequestHeader('X-CSRF-Token', csrf);
    xhr.responseType = 'text';
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(Math.min(1, event.loaded / event.total));
    };
    xhr.onload = () => {
      done();
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText || 'null');
      } catch {
        body = undefined;
      }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => {
      done();
      reject(toApiError(new TypeError('Failed to fetch')));
    };
    /* No `xhr.timeout`: a 50MB file on a slow line legitimately takes minutes. Kept for a
       platform that imposes its own. */
    xhr.ontimeout = () => {
      done();
      reject(new ApiError('timeout'));
    };
    xhr.onabort = () => {
      done();
      reject(new DOMException('上传已取消', 'AbortError'));
    };
    xhr.send(form);
  });
}

/**
 * One multipart upload to the new backend, over XMLHttpRequest — the one transport that reports
 * upload progress. The session's `X-CSRF-Token` goes with it like any write's; a `CSRF_MISMATCH`
 * refusal (made before the body is read, so nothing was stored) refreshes it and sends once more.
 * Every failure is an `ApiError` carrying the backend's `error.code` / `error.message`; the
 * caller's abort stays an `AbortError`.
 */
export async function uploadMedia(
  path: string,
  token: string,
  form: FormData,
  { signal, onProgress, tooLarge }: { signal?: AbortSignal; onProgress?: (fraction: number) => void; tooLarge: string },
): Promise<UploadedMedia> {
  let answer = await sendOnce(path, token, form, csrfOf(token), signal, onProgress);
  if (answer.status === 403 && apiErrorBody(answer.body).code === 'CSRF_MISMATCH') {
    const fresh = await freshCsrf(token);
    if (fresh) answer = await sendOnce(path, token, form, fresh, signal, onProgress);
  }
  /* A bare XHR is not `apiRequest`, so its 401 confirms the session the same way: one `GET /me`,
     whose own 401 ends it. */
  if (answer.status === 401) void apiRequest('GET', '/me', { token }).catch(() => {});
  if (answer.status < 200 || answer.status >= 300) {
    const { code, message } = apiErrorBody(answer.body);
    throw new ApiError('http', {
      status: answer.status,
      code,
      serverMessage: message,
      message: answer.status === 413 ? tooLarge : undefined,
    });
  }
  const media = answer.body as UploadedMedia | null | undefined;
  if (!media || typeof media.url !== 'string' || typeof media.asset !== 'string') {
    throw new ApiError('invalid', { status: answer.status });
  }
  onProgress?.(1);
  return media;
}

/**
 * Stage the file on PicPony; resolves with the absolute URL Derpibooru will fetch it from (it
 * carries a 24-hour capability — the backend's, never the session's).
 */
export async function stageUpload(
  token: string,
  file: File,
  { signal, onProgress }: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {},
): Promise<string> {
  const form = new FormData();
  form.append('file', file, file.name || 'upload');
  const media = await uploadMedia('/me/uploads/works', token, form, {
    signal,
    onProgress,
    tooLarge: '文件太大，服务器拒绝了这次上传',
  });
  /* Derpibooru fetches it by this address, so it must be one it can reach. */
  let url: URL | null = null;
  try {
    url = new URL(media.url);
  } catch {
    url = null;
  }
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) throw new ApiError('invalid');
  return url.href;
}

/** Which form field a Derpibooru complaint belongs to. */
export type UploadField = 'tags' | 'source' | 'description' | 'image';

export type DerpiUploadOutcome =
  | { kind: 'uploaded'; imageId: number }
  /** Derpibooru answered and refused: per field, in Chinese where the complaint is a known one. */
  | { kind: 'rejected'; fields: Partial<Record<UploadField, string>>; message: string }
  /** The request may or may not have been accepted — the answer never came back. */
  | { kind: 'unconfirmed'; message: string };

export interface DerpiUploadInput {
  apiKey: string;
  /** The staged file's public URL. */
  url: string;
  tagInput: string;
  source?: string;
  description?: string;
  /** The relay's per-user accounting label, as every relayed request carries it. */
  username?: string;
}

const UNCONFIRMED = '未能确认上传结果，文件和填写内容已保留。请先检查 Derpibooru 上是否已有这张图片，再重试';

/** Philomena's field names, onto the form's. */
function fieldOf(key: string): UploadField {
  if (key === 'tag_input') return 'tags';
  if (key === 'source_url') return 'source';
  if (key === 'description') return 'description';
  return 'image';
}

/** What a refusal of a picture Derpibooru already has says — the form recognises it after a lost answer. */
export const DUPLICATE_COMPLAINT = '这张图片已在 Derpibooru 上，不能重复上传';

/** Philomena's English complaints, as the form says them. Unknown ones keep their own words. */
export function uploadComplaint(field: UploadField, raw: string): string {
  const text = raw.trim();
  if (/already been (?:taken|uploaded)|duplicate/i.test(text)) return DUPLICATE_COMPLAINT;
  if (field === 'tags') {
    if (/rating/i.test(text)) return '需要且只能有一个分级标签';
    const count = /at least (\d+)/i.exec(text);
    if (count) return `至少需要 ${count[1]} 个标签`;
  }
  if (field === 'image') {
    if (/too (?:large|big)|size/i.test(text)) return '文件超出了 Derpibooru 的大小上限';
    if (/mime|format|type/i.test(text)) return '文件格式不受 Derpibooru 支持';
  }
  return `Derpibooru：${text}`;
}

/**
 * `{errors: {field: [messages]}}` as one sentence per form field. Exported for the tests. The
 * documentation writes the body as `{"errors": [image-errors-response]}`, so a list of such
 * objects is read too.
 */
export function uploadErrorsOf(body: unknown): Partial<Record<UploadField, string>> {
  const errors = body && typeof body === 'object' ? (body as { errors?: unknown }).errors : undefined;
  const out: Partial<Record<UploadField, string>> = {};
  const blocks = Array.isArray(errors) ? errors : [errors];
  for (const block of blocks) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
    for (const [key, value] of Object.entries(block as Record<string, unknown>)) {
      const first = Array.isArray(value)
        ? value.find((item): item is string => typeof item === 'string' && item.trim() !== '')
        : typeof value === 'string' && value.trim() ? value : undefined;
      if (!first) continue;
      const field = fieldOf(key);
      out[field] ??= uploadComplaint(field, first);
    }
  }
  return out;
}

function hopMessage(body: unknown): string | undefined {
  const message = body && typeof body === 'object' ? (body as { message?: unknown }).message : undefined;
  return typeof message === 'string' && message.trim() ? message.trim() : undefined;
}

/**
 * Submit a staged picture. Resolves with the outcome — uploaded, refused (with what to fix) or
 * unconfirmed (the answer was lost, so it may have landed) — and never throws for an answer;
 * only the caller's own abort rejects.
 */
export async function submitDerpiImage(input: DerpiUploadInput, signal?: AbortSignal): Promise<DerpiUploadOutcome> {
  let response: Response;
  try {
    response = await fetch(UPLOAD_SUBMIT_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        key: input.apiKey,
        url: input.url,
        tag_input: input.tagInput,
        source_url: input.source || undefined,
        description: input.description || undefined,
        xp_user: input.username || undefined,
      }),
      cache: 'no-store',
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    return { kind: 'unconfirmed', message: UNCONFIRMED };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (response.ok) {
    const id = Number((body as { image?: { id?: unknown } } | null)?.image?.id);
    if (Number.isSafeInteger(id) && id > 0) return { kind: 'uploaded', imageId: id };
    /* A success without the picture's id cannot be confirmed — the original showed 上传成功
       either way, which is a claim the answer did not make. */
    return { kind: 'unconfirmed', message: UNCONFIRMED };
  }

  if (response.status === 401 || response.status === 403) {
    return { kind: 'rejected', fields: {}, message: 'API Key 无效或没有上传权限，请在设置中重新绑定' };
  }
  const fields = uploadErrorsOf(body);
  if (Object.keys(fields).length > 0) {
    return { kind: 'rejected', fields, message: fields.image ?? '请按提示修改后再发布' };
  }
  /* Our hop's own answers: a refused body (400 — a bug, not the user's), a dead relay (502), or
     the relay's silence (504, which may have reached Derpibooru). */
  if (response.status === 504) return { kind: 'unconfirmed', message: UNCONFIRMED };
  if (response.status === 429) return { kind: 'rejected', fields: {}, message: FAILURE_MESSAGES.rateLimited };
  if (response.status >= 500) return { kind: 'unconfirmed', message: UNCONFIRMED };
  return {
    kind: 'rejected',
    fields: {},
    /* `/upload/submit`'s own refusal: `{message}` (it is this app's route, not PicPony's). */
    message: hopMessage(body) ?? statusMessage(response.status),
  };
}
