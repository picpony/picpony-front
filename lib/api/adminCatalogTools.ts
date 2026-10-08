import { picponyRequest, picponyPostJson } from './http';
import { ApiError } from './errors';
import { object, text, integer, list, listPart, badgeDictionary, purchase, legacyPurchase, mascot, pony, discoveredPony, speech, flag, required, ponyPath, validateImage, type Pony, type ObjectRow } from '@/lib/adminCatalogTools/model';

/** A lost acknowledgement is not evidence that a write was refused. */
export class CatalogOutcomeUnknown extends ApiError {
  constructor() { super('invalid', { message: '未能确认操作结果，请先刷新记录核对，勿重复提交', retryable: false }); }
}
export async function catalogResponse(response: Response, writing = false): Promise<ObjectRow> {
  let data: ObjectRow;
  try { data = object(await response.json()); }
  catch {
    if (writing && (response.ok || (response.status >= 500 && response.status !== 501))) throw new CatalogOutcomeUnknown();
    if (!response.ok) throw new ApiError('http', { status: response.status, ...(response.status === 501 ? { message: '当前服务器尚未提供此功能', retryable: false } : {}) });
    throw new ApiError('invalid');
  }
  if (!response.ok || data.success !== true) {
    /* A refusal by status is an answer even without JSON; 501 is a missing capability, not a lost
       acknowledgement. Only a 2xx needs the boolean to tell us whether the write was accepted. */
    if (writing && ((response.status >= 500 && response.status !== 501) || (response.ok && typeof data.success !== 'boolean'))) throw new CatalogOutcomeUnknown();
    throw new ApiError(response.ok ? 'envelope' : 'http', { status: response.status, serverMessage: typeof data.error === 'string' ? data.error : typeof data.message === 'string' ? data.message : undefined, ...(response.status === 501 ? { message: '当前服务器尚未提供此功能', retryable: false } : {}) });
  }
  return data;
}
export async function catalogWrite(request: () => Promise<Response>): Promise<ObjectRow> {
  let response: Response;
  try { response = await request(); } catch { throw new CatalogOutcomeUnknown(); }
  return catalogResponse(response, true);
}
const read = async (action: string, token: string, signal?: AbortSignal, query?: Record<string, string>) =>
  catalogResponse(await picponyRequest(action, { token, signal, query }));
const write = (action: string, token: string, body?: Record<string, unknown>) => catalogWrite(() => body ? picponyPostJson(action, body, { token }) : picponyRequest(action, { token, method: 'POST' }));

export async function getBadgeDictionary(token: string, signal?: AbortSignal) { return badgeDictionary(await read('admin_get_badge_dict', token, signal)); }
export function saveBadgeDescription(token: string, name: string, description: string) { return write('admin_save_badge_dict', token, { badge_name: required(name, '徽章名称'), description: text(description).trim() }); }
export function deleteBadgeDescription(token: string, name: string) { return write('admin_delete_badge_dict', token, { badge_name: required(name, '徽章名称') }); }
export function deleteBadgeLink(token: string, id: number) { return write('admin_delete_badge_link', token, { id: integer(id, 1) }); }
export async function getShopPurchases(token: string, keyword: string, signal?: AbortSignal) { return listPart((await read('admin_get_shop_purchases', token, signal, { keyword: text(keyword, 200) })).records, purchase); }
export async function getLegacyShopPurchases(token: string, keyword: string, signal?: AbortSignal) { return listPart((await read('admin_get_legacy_shop_purchases', token, signal, { keyword: text(keyword, 200) })).records, legacyPurchase); }
export function refundShopPurchase(token: string, id: number) { return write('admin_refund_shop_purchase', token, { id: integer(id, 1) }); }
export async function uploadShopImage(token: string, file: File) {
  validateImage(file, 'shop');
  const body = new FormData(); body.append('shop_image', file);
  return catalogWrite(() => picponyRequest('admin_upload_shop_image', { token, method: 'POST', body }));
}
export async function getMascots(token: string, signal?: AbortSignal) {
  const data = await read('admin_get_mascots', token, signal);
  /* `global_enabled` stays strict while the rows do not: a response that will not say whether the
     kill switch is on is broken, and a default would draw 关闭 over a running feature. */
  const { rows, skipped } = listPart(data.mascots, mascot);
  return { enabled: flag(data.global_enabled), mascots: rows, skipped };
}
export function saveMascot(token: string, body: ReturnType<typeof import('@/lib/adminCatalogTools/model').mascotPayload>) { return write(body.id === undefined ? 'admin_add_mascot' : 'admin_edit_mascot', token, body); }
export function deleteMascot(token: string, id: number) { return write('admin_delete_mascot', token, { id: integer(id, 1) }); }
export function toggleMascot(token: string, id: number, active: boolean) { return write('admin_toggle_mascot_active', token, { id: integer(id, 1), is_active: flag(active) }); }
export async function getPonies(token: string, signal?: AbortSignal) {
  const data = await read('get_ponies_config', token, signal);
  const { rows, skipped } = listPart(data.ponies, pony);
  return { enabled: flag(object(data.config).enabled), ponies: rows, skipped };
}
export async function scanPonies(token: string) { return list((await read('scan_ponies', token)).ponies, discoveredPony); }
export function savePonies(token: string, enabled: boolean, ponies: Pony[]) {
  return write('save_ponies_config', token, { enabled: flag(enabled), ponies: ponies.map((row) => ({ name: required(row.name, '角色名称'), path: ponyPath(row.path), preview: row.preview, enabled: flag(row.enabled) })) });
}
export function savePonyName(token: string, path: string, oldName: string, name: string) { return write('save_pony_name', token, { path: ponyPath(path), old_name: required(oldName, '角色名称'), new_name: required(name, '角色名称') }); }
export async function getPonySpeeches(token: string, name: string, path: string, signal?: AbortSignal) { return list((await read('get_pony_speeches', token, signal, { name: required(name, '角色名称'), path: ponyPath(path) })).speeches, speech); }
export function savePonySpeech(token: string, path: string, name: string, value: string) { return write('save_pony_speech', token, { path: ponyPath(path), speech_name: required(name, '台词名称'), new_text: text(value) }); }
export function clearTranslationQueue(token: string) { return write('admin_clear_translation_queue', token); }
export function clearTranslationFailures(token: string) { return write('admin_clear_translation_failures', token); }
