import { api, seg } from './http';
import { ApiError, isAborted } from './errors';
import { adminWrite, type AdminRow } from '@/lib/adminMutations';
import { integer, required, text, ponyPath, type Mascot, type Pony, type Speech, type Purchase, type LegacyPurchase, type BadgeDictionary, type MascotBody } from '@/lib/adminCatalogTools/model';

/** A lost acknowledgement is not evidence that a write was refused. */
export class CatalogOutcomeUnknown extends ApiError {
  constructor() { super('invalid', { message: '未能确认操作结果，请先刷新记录核对，勿重复提交', retryable: false }); }
}

/**
 * One catalogue write. **A lost acknowledgement is not a refusal**: a request that got no answer
 * (network, our own deadline) or a 5xx other than 501 may have been acted on, so it is held as
 * 操作结果待确认 (`useCatalogMutation`) rather than offered again. Every other refusal is an answer
 * and is rethrown with the backend's own sentence; 501 is a missing capability.
 */
export async function catalogWrite<T>(request: () => Promise<T>): Promise<T> {
  try { return await request(); }
  catch (error) {
    if (isAborted(error)) throw error;
    if (!(error instanceof ApiError)) throw new CatalogOutcomeUnknown();
    if (error.kind === 'network' || error.kind === 'timeout' || error.kind === 'invalid') throw new CatalogOutcomeUnknown();
    if (error.kind === 'http' && (error.status ?? 0) >= 500 && error.status !== 501) throw new CatalogOutcomeUnknown();
    if (error.kind === 'http' && error.status === 501) throw new ApiError('http', { status: 501, message: '当前服务器尚未提供此功能', retryable: false });
    throw error;
  }
}
const write = <T extends object = AdminRow>(method: string, path: string, json?: unknown) =>
  (token: string) => catalogWrite(() => adminWrite<T>(method, path, json === undefined ? { token } : { token, json }));
const READ = { cache: 'no-store' as const };

// ---- Badge descriptions ----------------------------------------------------

export async function getBadgeDictionary(token: string, signal?: AbortSignal): Promise<BadgeDictionary> {
  const data = await api<{ dictionary: { name: string; description: string }[]; used_badges: { name: string; color: string }[] }>('GET', '/admin/badges/dictionary', { token, signal, ...READ });
  return {
    dicts: data.dictionary.map((row) => ({ badge_name: row.name, description: row.description })),
    names: [...new Set(data.used_badges.map((row) => row.name))],
  };
}
export function saveBadgeDescription(token: string, name: string, description: string) {
  return write('PUT', `/admin/badges/dictionary/${seg(required(name, '徽章名称', 100))}`, { description: text(description).trim() })(token);
}
export function deleteBadgeDescription(token: string, name: string) {
  return write('DELETE', `/admin/badges/dictionary/${seg(required(name, '徽章名称', 100))}`)(token);
}
/** A tombstone: claims already made keep their history. */
export function deleteBadgeLink(token: string, id: number) { return write('DELETE', `/admin/badges/campaigns/${seg(integer(id, 1))}`)(token); }

// ---- Purchases -------------------------------------------------------------

/** Rows per purchase page; the backend answers at most `limit` rows and the cursor of the next page. */
export const PURCHASE_PAGE = 50;
export interface PurchasePage<R> { rows: R[]; next: number | null }
/** One page of the records matching `keyword` (newest first): `before` is the previous page's `next`. */
async function records<R>(token: string, path: string, keyword: string, before: number | undefined, signal?: AbortSignal): Promise<PurchasePage<R>> {
  const data = await api<{ records: R[]; next_cursor: number | null }>('GET', path, { token, signal, ...READ, query: { keyword: keyword.trim() || undefined, before, limit: PURCHASE_PAGE } });
  return { rows: data.records, next: data.next_cursor };
}
export function getShopPurchases(token: string, keyword: string, before?: number, signal?: AbortSignal): Promise<PurchasePage<Purchase>> {
  return records<Purchase>(token, '/admin/shop/purchases', text(keyword, 100), before, signal);
}
export function getLegacyShopPurchases(token: string, keyword: string, before?: number, signal?: AbortSignal): Promise<PurchasePage<LegacyPurchase>> {
  return records<LegacyPurchase>(token, '/admin/shop/legacy-purchases', text(keyword, 100), before, signal);
}
/** Refunds the coins and restores the stock; answers `{ purchase_id, refunded, balance }`. */
export function refundShopPurchase(token: string, id: number) { return write('POST', `/admin/shop/purchases/${seg(integer(id, 1))}/refunds`)(token); }

// ---- Mascots ---------------------------------------------------------------

/** The mascots, the global switch, and the revision every mascot write names. */
export async function getMascots(token: string, signal?: AbortSignal): Promise<{ enabled: boolean; revision: number; mascots: Mascot[] }> {
  const data = await api<{ enabled: boolean; revision: number; mascots: { id: number; name: string; image_url: string; tips: string; is_active: boolean }[] }>('GET', '/admin/mascots', { token, signal, ...READ });
  return {
    enabled: data.enabled,
    revision: data.revision,
    mascots: data.mascots.map((row) => ({ id: row.id, name: row.name, image_url: row.image_url, tips: row.tips, is_active: row.is_active })),
  };
}
/** Create (`id` absent) or edit; answers `{ id, applied_revision }`. */
export function saveMascot(token: string, revision: number, body: MascotBody, id?: number) {
  const json = { expected_revision: revision, ...body };
  return id === undefined ? write('POST', '/admin/mascots', json)(token) : write('PUT', `/admin/mascots/${seg(integer(id, 1))}`, json)(token);
}
export function deleteMascot(token: string, revision: number, id: number) { return write('DELETE', `/admin/mascots/${seg(integer(id, 1))}`, { expected_revision: revision })(token); }
export function toggleMascot(token: string, revision: number, id: number, active: boolean) {
  return write('POST', `/admin/mascots/${seg(integer(id, 1))}/activation`, { expected_revision: revision, is_active: active })(token);
}
export function saveMascotSwitch(token: string, revision: number, enabled: boolean) {
  return write('PUT', '/admin/mascot-config', { expected_revision: revision, enabled })(token);
}

// ---- Desktop ponies ----------------------------------------------------------

/** The roster, the global switch, and the revision every pony write names. */
export async function getPonies(token: string, signal?: AbortSignal): Promise<{ enabled: boolean; revision: number; ponies: Pony[] }> {
  const data = await api<{ enabled: boolean; revision: number; ponies: { name: string; path: string; preview: string; enabled: boolean }[] }>('GET', '/admin/ponies', { token, signal, ...READ });
  return { enabled: data.enabled, revision: data.revision, ponies: data.ponies.map((row) => ({ name: row.name, path: row.path, preview: row.preview, enabled: row.enabled })) };
}
/** The characters on disk; none is enabled until the roster is saved. */
export async function scanPonies(token: string): Promise<Pony[]> {
  const data = await catalogWrite(() => adminWrite<{ ponies: { name: string; path: string; preview: string }[] }>('POST', '/admin/ponies/scans', { token }));
  return data.ponies.map((row) => ({ name: row.name, path: row.path, preview: row.preview, enabled: false }));
}
export function savePonies(token: string, revision: number, enabled: boolean, ponies: Pony[]) {
  return write('PUT', '/admin/ponies', { expected_revision: revision, enabled, ponies: ponies.map((row) => ({ name: required(row.name, '角色名称', 100), path: ponyPath(row.path), preview: row.preview, enabled: row.enabled })) })(token);
}
/** Answers `{ path, new_name, applied_revision }`. */
export function savePonyName(token: string, revision: number, path: string, oldName: string, name: string) {
  return write<{ path: string; new_name: string; applied_revision: number }>('PUT', `/admin/ponies/${seg(ponyPath(path))}/name`, { expected_revision: revision, old_name: required(oldName, '角色名称', 100), new_name: required(name, '角色名称', 100) })(token);
}
export async function getPonySpeeches(token: string, path: string, signal?: AbortSignal): Promise<Speech[]> {
  return (await api<{ speeches: Speech[] }>('GET', `/admin/ponies/${seg(ponyPath(path))}/speeches`, { token, signal, ...READ })).speeches;
}
export function savePonySpeech(token: string, revision: number, path: string, name: string, value: string) {
  return write('PUT', `/admin/ponies/${seg(ponyPath(path))}/speeches`, { expected_revision: revision, speech_name: required(name, '台词名称'), new_text: text(value, 2000) })(token);
}

// ---- Translation queue -----------------------------------------------------

export function clearTranslationQueue(token: string) { return write('POST', '/admin/translation/queue-clearances')(token); }
export function clearTranslationFailures(token: string) { return write('POST', '/admin/translation/failure-resets')(token); }
