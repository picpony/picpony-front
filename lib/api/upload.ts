import { PICPONY_API_BASE, PICPONY_API_ORIGIN } from '@/lib/constants';
import { ApiError, FAILURE_MESSAGES, statusMessage, toApiError } from './errors';
import { envelopeMessage, noteUnauthorized } from './http';

/**
 * 发布图片 — a picture goes to Derpibooru in two steps, the original front end's contract:
 *
 * 1. **Staging** (`upload_temp_upload`): the file goes to PicPony, which answers with a public
 *    `url`. PicPony is reachable where Derpibooru often is not, and the progress of the one
 *    large transfer can be shown.
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

/**
 * Stage the file on PicPony; resolves with the absolute URL Derpibooru will fetch it from.
 *
 * Over XMLHttpRequest, the one transport that reports upload progress — this is a file of up to
 * 50MB, and a bar that moves is the difference between waiting and wondering. Every failure is an
 * `ApiError`; the caller's abort stays an `AbortError`.
 */
export function stageUpload(
  token: string,
  file: File,
  { signal, onProgress }: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {},
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('上传已取消', 'AbortError'));
      return;
    }
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const done = () => signal?.removeEventListener('abort', onAbort);
    xhr.open('POST', `${PICPONY_API_BASE}?action=upload_temp_upload`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.responseType = 'text';
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(Math.min(1, event.loaded / event.total));
    };
    xhr.onload = () => {
      done();
      let data: Record<string, unknown> | null = null;
      try {
        const parsed: unknown = JSON.parse(xhr.responseText || 'null');
        data = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
      } catch {
        data = null;
      }
      const serverMessage = envelopeMessage(data);
      /* A bare XHR bypasses `picponyRequest`, so its 401 must report itself (review P1-F10):
         otherwise a dead session failed the upload and left the app signed in. */
      if (xhr.status === 401) noteUnauthorized(token);
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new ApiError('http', {
          status: xhr.status,
          serverMessage,
          message: xhr.status === 413 ? '文件太大，服务器拒绝了这次上传'
            /* Our hop's answer for a body that stopped arriving (review P4-O2): the visitor's
               network, not an outage. Nothing was staged, so trying again is safe. */
            : xhr.status === 408 ? '上传中断，请检查网络后重试' : undefined,
        }));
        return;
      }
      if (!data) {
        reject(new ApiError('invalid', { status: xhr.status }));
        return;
      }
      if (data.success !== true) {
        reject(new ApiError('envelope', { status: xhr.status, serverMessage, message: serverMessage ?? '作品暂存失败' }));
        return;
      }
      const raw = typeof data.url === 'string' ? data.url.trim() : '';
      let url: URL | null = null;
      try {
        url = raw ? new URL(raw, `${PICPONY_API_ORIGIN}/`) : null;
      } catch {
        url = null;
      }
      if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
        reject(new ApiError('invalid', { status: xhr.status }));
        return;
      }
      onProgress?.(1);
      resolve(url.href);
    };
    xhr.onerror = () => {
      done();
      reject(toApiError(new TypeError('Failed to fetch')));
    };
    /* No `xhr.timeout`: a 50MB file on a slow line legitimately takes minutes, and the server
       hop bounds a stalled body by its pace instead (`app/api.php/…/route.ts`). Kept for a
       platform that imposes its own. */
    xhr.ontimeout = () => {
      done();
      reject(new ApiError('timeout'));
    };
    xhr.onabort = () => {
      done();
      reject(new DOMException('上传已取消', 'AbortError'));
    };
    const form = new FormData();
    form.append('file', file, file.name || 'upload');
    xhr.send(form);
  });
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
    message: envelopeMessage(body) ?? statusMessage(response.status),
  };
}
