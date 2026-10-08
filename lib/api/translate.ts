/**
 * Translation: a passage of text (a description, a comment) and a whole picture (the one-click
 * image translation), plus the site switch that turns the second one on and off.
 *
 * Every contract is the original front end's, parameter for parameter:
 *
 * - `POST api.php?action=translate` with a form body `text=` → `{success, translation}`; on a
 *   failure the backend puts its sentence in `translation` (or `error`), not in a status.
 * - `GET api.php?action=ext_translate_request&image=<raw view_url>` queues the picture with the
 *   translation service, or answers at once when it has been translated before; `…_poll` with the
 *   same `image` reads the job. Both answer `{success, status, translated_url?, queue_ahead?,
 *   error?, error_message?}`, `status` being `pending` / `translating` / `completed` / `failed`.
 *   The `image` is the picture's raw full-size URL — the service keys its cache on it, so every
 *   visitor on every image line must send the same string.
 * - `get_maintenance_status` carries `translate_enabled`; `false` hides the image translation
 *   (text translation was never behind the switch).
 */

import { getAssetUrl } from '@/lib/utils';
import { ApiError } from './errors';
import { envelopeMessage, picponyRequest, readEnvelope, readJson } from './http';

/** A long passage is cut before it is sent: the service answers a bounded request in time. */
const MAX_TEXT_LENGTH = 4000;

/**
 * The passage in Chinese. Throws `ApiError` — with the backend's own sentence when it sent one —
 * so a caller shows `apiErrorMessage` and never an empty translation.
 */
export async function translateText(text: string, signal?: AbortSignal): Promise<string> {
  const source = text.trim().slice(0, MAX_TEXT_LENGTH);
  if (!source) throw new ApiError('invalid', { message: '没有可以翻译的内容' });
  const res = await picponyRequest('translate', {
    method: 'POST',
    body: new URLSearchParams({ text: source }),
    /* A read that travels as a POST: bounded like one, since nothing is written. */
    timeoutMs: 20_000,
    signal,
  });
  const data = await readJson<{ success?: unknown; translation?: unknown }>(res);
  const translation = typeof data.translation === 'string' ? data.translation.trim() : '';
  if (!res.ok) throw new ApiError('http', { status: res.status, serverMessage: envelopeMessage(data) });
  if (data.success === true && translation) return translation;
  throw new ApiError('envelope', {
    status: res.status,
    serverMessage: (data.success === true ? '' : translation) || envelopeMessage(data),
    message: data.success === true ? '翻译服务没有返回译文' : undefined,
  });
}

export type ImageTranslationState = 'pending' | 'translating' | 'completed' | 'failed';

export interface ImageTranslationStatus {
  state: ImageTranslationState;
  /** The translated picture, absolute, once `completed`. */
  translatedUrl: string | null;
  /** Jobs ahead of this one while `pending`; 0 when a node is about to take it. */
  queueAhead: number;
  /** The service's own sentence for a failed job. */
  message?: string;
}

function readStatus(data: Record<string, unknown>): ImageTranslationStatus {
  const raw = typeof data.status === 'string' ? data.status : '';
  const url = typeof data.translated_url === 'string' ? data.translated_url.trim() : '';
  /* The service answers a path on its own host; the original front end ran on that host. */
  const translatedUrl = url ? (/^(?:https?:|data:|blob:)/i.test(url) ? url : getAssetUrl(url)) : null;
  const ahead = Number(data.queue_ahead);
  const state: ImageTranslationState =
    raw === 'completed' && translatedUrl
      ? 'completed'
      : raw === 'failed'
        ? 'failed'
        : raw === 'translating'
          ? 'translating'
          : 'pending';
  const message =
    (typeof data.error_message === 'string' && data.error_message.trim()) ||
    (typeof data.error === 'string' && data.error.trim()) ||
    undefined;
  return { state, translatedUrl, queueAhead: Number.isFinite(ahead) && ahead > 0 ? Math.floor(ahead) : 0, message };
}

async function imageTranslationCall(
  action: 'ext_translate_request' | 'ext_translate_poll',
  imageUrl: string,
  signal?: AbortSignal,
): Promise<ImageTranslationStatus> {
  const res = await picponyRequest(action, { query: { image: imageUrl }, cache: 'no-store', signal });
  return readStatus(await readEnvelope<Record<string, unknown>>(res));
}

/** Queue the picture (or read the finished translation of it). */
export function requestImageTranslation(imageUrl: string, signal?: AbortSignal) {
  return imageTranslationCall('ext_translate_request', imageUrl, signal);
}

/** Read the queued job for the picture. */
export function pollImageTranslation(imageUrl: string, signal?: AbortSignal) {
  return imageTranslationCall('ext_translate_poll', imageUrl, signal);
}

/**
 * Whether the image translation is on. The status document is public; a read that fails leaves
 * the feature off rather than offering a control that cannot work.
 */
export async function readTranslateEnabled(signal?: AbortSignal): Promise<boolean> {
  const res = await picponyRequest('get_maintenance_status', { query: { _t: Date.now() }, cache: 'no-store', signal });
  const data = await readEnvelope<{ translate_enabled?: unknown }>(res);
  return data.translate_enabled !== false;
}
