import { CatalogOutcomeUnknown, catalogResponse } from '@/lib/api/adminCatalogTools';
import { ApiError } from '@/lib/api/errors';
import { deadlineSignal, noteUnauthorized } from '@/lib/api/http';
import { IMPORT_NOT_SENT_HEADER, type Dataset } from './importModel';

/**
 * These two go to this app's own route rather than to `/api.php`, so they bypass `picponyRequest`
 * and with it the one place a dead session is noticed. `noteUnauthorized` puts that back: without
 * it the import panel was the single surface where an expired token produced a refusal sentence and
 * no sign-out.
 */
async function sendImport(url: string, init: RequestInit, token: string): Promise<Response> {
  const response = await fetch(url, init);
  if (response.status === 401) noteUnauthorized(token);
  return response;
}

/**
 * A write the import route refused **before** contacting the PHP service (it marks those with
 * `IMPORT_NOT_SENT_HEADER`): a busy slot, an unverifiable session, a stalled or rejected body.
 * Nothing reached the importer, so this is a plain refusal — never `CatalogOutcomeUnknown` — and the
 * same submission may be offered again (review P6-F1). Retryable when the route says it is busy or
 * the body stalled; the other refusals need the operator to change something first.
 */
export class ImportNotSent extends ApiError {
  /** Seconds the route asked for before another try (`Retry-After`), when it named any. */
  retryAfter: number | null = null;
  constructor(status: number, serverMessage?: string) {
    /* The route's own sentence (导入服务正忙…) says more than the generic 5xx one; it is ours, short
       and plain, but held to the same shape rule as any server sentence. */
    const own = serverMessage && serverMessage.length <= 200 && !/[<>]/.test(serverMessage) ? serverMessage : undefined;
    super('http', { status, serverMessage, ...(own ? { message: own } : {}), retryable: status === 503 || status === 408 });
  }
}

async function notSent(response: Response): Promise<ImportNotSent> {
  let message: string | undefined;
  try {
    const data: unknown = await response.json();
    const error = data && typeof data === 'object' ? (data as Record<string, unknown>).error : undefined;
    if (typeof error === 'string' && error) message = error;
  } catch { /* A refusal without a readable body is still a refusal. */ }
  const refusal = new ImportNotSent(response.status, message);
  const after = Number(response.headers.get('retry-after'));
  refusal.retryAfter = Number.isFinite(after) && after > 0 ? Math.min(after, 60) : null;
  return refusal;
}

/**
 * Review P6-O1: a chunk refused because the single import slot is busy (another panel or tab is
 * importing) or because its body stalled is safe to send again — nothing reached the importer —
 * so it is, a few times, after the route's `Retry-After` (5s by default), instead of pausing the
 * upload for the operator to resume by hand. Any other failure, an outcome nobody heard, or the
 * operator pressing 暂停 ends the retries and is reported as before.
 */
export async function sendWithRetry<T>(
  send: () => Promise<T>,
  ports: { stop: () => boolean; wait?: (ms: number) => Promise<void>; attempts?: number },
): Promise<T> {
  const wait = ports.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const attempts = ports.attempts ?? 4;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await send();
    } catch (error) {
      if (!(error instanceof ImportNotSent) || !error.retryable || attempt >= attempts || ports.stop()) throw error;
      await wait((error.retryAfter ?? 5) * 1000 * attempt);
      if (ports.stop()) throw error;
    }
  }
}

export async function readImport(dataset: Dataset, token: string, action: 'last_update' | 'status' | 'chunk_status', id?: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ action });
  if (id) query.set('upload_id', id);
  const deadline = deadlineSignal(signal, 15000);
  try { return await catalogResponse(await sendImport(`/admin/import-tools/${dataset}?${query}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: deadline.signal }, token)); }
  catch (error) { if (error instanceof ApiError || signal?.aborted) throw error; throw new ApiError(deadline.timedOut() ? 'timeout' : 'network'); }
  finally { deadline.dispose(); }
}

/** `catalogWrite`'s reading, except that the route's own pre-upstream refusals are `ImportNotSent`. */
export async function writeImport(dataset: Dataset, token: string, body: FormData) {
  let response: Response;
  try { response = await sendImport(`/admin/import-tools/${dataset}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body }, token); }
  catch { throw new CatalogOutcomeUnknown(); }
  if (!response.ok && response.headers.get(IMPORT_NOT_SENT_HEADER) === '1') throw await notSent(response);
  return catalogResponse(response, true);
}
