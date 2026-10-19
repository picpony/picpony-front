/**
 * Translation: a passage of text (a description, a comment) and a whole picture (the one-click
 * image translation), plus the site switch that turns the second one on and off.
 *
 * - `POST /api/v1/translations {text}` → `{translation, detected_language, target_language,
 *   provider}`; the backend's Azure Translator. A 503 `TRANSLATION_NOT_CONFIGURED` means an
 *   administrator has not set it up; other failures carry the backend's own sentence.
 * - `POST /api/v1/translation/requests {image}` queues the picture with the translation nodes, or
 *   answers at once when it has been translated before; `GET …/requests?image=` reads the job.
 *   Both answer `{status, translated_url, error_message, queue_ahead}`, `status` being
 *   `pending` / `translating` / `completed` / `failed` (the read also `not_found`, with nothing
 *   else). The request is refused with 503 `IMAGE_TRANSLATION_DISABLED` when an administrator
 *   switched it off and `IMAGE_TRANSLATION_PROVIDER_UNAVAILABLE` when the configured line (Lens)
 *   is not migrated — neither is worth retrying, so both carry the backend's sentence as final.
 *   The `image` is the picture's raw full-size URL — the queue keys its cache on it, so every
 *   visitor on every image line must send the same string.
 * - `GET /api/v1/translations/settings` carries `translate_enabled`; `false` hides the image
 *   translation (text translation was never behind the switch).
 */

import { getAssetUrl } from '@/lib/utils';
import { ApiError, isApiError } from './errors';
import { API_V1, api } from './http';

/** A long passage is cut before it is sent: the backend accepts at most this many characters. */
const MAX_TEXT_LENGTH = 4000;

/**
 * The passage in Chinese. Throws `ApiError` — with the backend's own sentence — so a caller shows
 * `apiErrorMessage` and never an empty translation.
 */
export async function translateText(text: string, signal?: AbortSignal): Promise<string> {
  const source = text.trim().slice(0, MAX_TEXT_LENGTH);
  if (!source) throw new ApiError('invalid', { message: '没有可以翻译的内容' });
  try {
    const data = await api<{ translation: string }>('POST', '/translations', {
      json: { text: source },
      /* A read that travels as a POST: bounded like one, since nothing is written. */
      timeoutMs: 20_000,
      signal,
    });
    return data.translation;
  } catch (error) {
    /* A 503 normally reads as "the service is down, try later"; this one is a setting nobody has
       made yet, so the backend's own sentence says it and 重试 is not offered. */
    if (isApiError(error) && error.code === 'TRANSLATION_NOT_CONFIGURED') {
      throw new ApiError('http', {
        status: error.status,
        code: error.code,
        serverMessage: error.serverMessage,
        message: error.serverMessage ?? '文本翻译尚未开启',
        retryable: false,
      });
    }
    throw error;
  }
}

export type ImageTranslationState = 'pending' | 'translating' | 'completed' | 'failed';

export interface ImageTranslationStatus {
  state: ImageTranslationState;
  /** The translated picture, absolute (or same-origin `/api/v1/…`), once `completed`. */
  translatedUrl: string | null;
  /** Jobs ahead of this one while `pending`; 0 when a node is about to take it. */
  queueAhead: number;
  /** The service's own sentence for a failed job. */
  message?: string;
}

/** `relay_admin::translation_request` / `translation_poll`; `not_found` carries only `status`. */
type QueueAnswer =
  | {
      status: 'pending' | 'translating' | 'completed' | 'failed';
      translated_url: string | null;
      error_message: string | null;
      queue_ahead: number;
    }
  | { status: 'not_found' };

/** The two 503s that say the image translation cannot take work at all (switch off, line not migrated). */
const UNAVAILABLE_CODES = new Set(['IMAGE_TRANSLATION_DISABLED', 'IMAGE_TRANSLATION_PROVIDER_UNAVAILABLE']);

/** The finished file is served by the backend under `/api/v1/translation/files/…`: through the
    same-origin proxy, like every other `/api/v1` read. */
function pictureUrl(url: string): string {
  if (/^(?:https?:|data:|blob:)/i.test(url)) return url;
  return url.startsWith(`${API_V1}/`) ? url : getAssetUrl(url);
}

function readStatus(data: QueueAnswer): ImageTranslationStatus {
  /* The queue no longer knows the picture (it keeps 2000 finished jobs): asking again re-queues it. */
  if (data.status === 'not_found') return { state: 'failed', translatedUrl: null, queueAhead: 0, message: '翻译任务已失效，请重新翻译' };
  const translatedUrl = data.translated_url ? pictureUrl(data.translated_url) : null;
  const queueAhead = data.queue_ahead > 0 ? data.queue_ahead : 0;
  switch (data.status) {
    case 'completed':
      /* A completed job without its file cannot be shown: keep waiting rather than show nothing. */
      return translatedUrl ? { state: 'completed', translatedUrl, queueAhead } : { state: 'pending', translatedUrl, queueAhead };
    case 'failed':
      return { state: 'failed', translatedUrl, queueAhead, message: data.error_message ?? undefined };
    case 'translating':
      return { state: 'translating', translatedUrl, queueAhead };
    default:
      return { state: 'pending', translatedUrl, queueAhead };
  }
}

/** Queue the picture (or read the finished translation of it). */
export async function requestImageTranslation(imageUrl: string, signal?: AbortSignal) {
  try {
    return readStatus(
      await api<QueueAnswer>('POST', '/translation/requests', {
        json: { image: imageUrl },
        cache: 'no-store',
        timeoutMs: 20_000,
        signal,
      }),
    );
  } catch (error) {
    /* A 503 normally reads as "try again later"; these two are a setting, so the backend's own
       sentence is shown and 重试 is not offered. */
    if (isApiError(error) && error.code && UNAVAILABLE_CODES.has(error.code)) {
      throw new ApiError('http', {
        status: error.status,
        code: error.code,
        serverMessage: error.serverMessage,
        message: error.serverMessage ?? '图片翻译暂不可用',
        retryable: false,
      });
    }
    throw error;
  }
}

/** Read the queued job for the picture. */
export async function pollImageTranslation(imageUrl: string, signal?: AbortSignal) {
  return readStatus(
    await api<QueueAnswer>('GET', '/translation/requests', { query: { image: imageUrl }, cache: 'no-store', signal }),
  );
}

/**
 * Whether the image translation is on. The settings document is public; a read that fails leaves
 * the feature off rather than offering a control that cannot work (the caller decides).
 */
export async function readTranslateEnabled(signal?: AbortSignal): Promise<boolean> {
  const data = await api<{ translate_enabled: boolean }>('GET', '/translations/settings', {
    cache: 'no-store',
    signal,
  });
  return data.translate_enabled;
}
