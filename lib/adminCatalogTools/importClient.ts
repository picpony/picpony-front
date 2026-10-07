import { catalogResponse, catalogWrite } from '@/lib/api/adminCatalogTools';
import { ApiError } from '@/lib/api/errors';
import { deadlineSignal, noteUnauthorized } from '@/lib/api/http';
import type { Dataset } from './importModel';

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

export async function readImport(dataset: Dataset, token: string, action: 'last_update' | 'status' | 'chunk_status', id?: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ action });
  if (id) query.set('upload_id', id);
  const deadline = deadlineSignal(signal, 15000);
  try { return await catalogResponse(await sendImport(`/admin/import-tools/${dataset}?${query}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: deadline.signal }, token)); }
  catch (error) { if (error instanceof ApiError || signal?.aborted) throw error; throw new ApiError(deadline.timedOut() ? 'timeout' : 'network'); }
  finally { deadline.dispose(); }
}
export function writeImport(dataset: Dataset, token: string, body: FormData) {
  return catalogWrite(() => sendImport(`/admin/import-tools/${dataset}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body }, token));
}
