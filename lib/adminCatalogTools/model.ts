import { ApiError } from '@/lib/api/errors';

export type ObjectRow = Record<string, unknown>;
export function object(value: unknown): ObjectRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('invalid');
  return value as ObjectRow;
}
export function text(value: unknown, max = 10000): string {
  if (typeof value !== 'string' || value.length > max) throw new ApiError('invalid');
  return value;
}
export function integer(value: unknown, min = 0): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^-?\d+$/.test(value))) throw new ApiError('invalid');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min) throw new ApiError('invalid');
  return number;
}
export function required(value: string, label: string, max = 200): string {
  const result = value.trim();
  if (!result || result.length > max) throw new ApiError('invalid', { message: `${label}须为 1 至 ${max} 个字符`, retryable: false });
  return result;
}
export function assetUrl(value: string): string {
  const result = value.trim();
  if (!result || result.length > 2048 || /[\u0000-\u0020\\]/.test(result)) throw new ApiError('invalid', { message: '请输入有效的图片链接', retryable: false });
  let parsed: URL;
  try { parsed = new URL(result, 'https://picpony.top/'); }
  catch { throw new ApiError('invalid', { message: '请输入有效的图片链接', retryable: false }); }
  /* `https:` only, because that is what the public readers accept: `mascotAsset`
     (`lib/api/mascot.ts`) returns `''` for any other protocol and `lib/api/desktopPonies.ts`
     additionally pins the host, both silently. The console used to accept `http://` and even render
     it in its own list, so an admin saw a picture the site would never show. A bare path still
     passes — it resolves against `https://picpony.top/` here and through `getAssetUrl` there. */
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new ApiError('invalid', { message: '图片链接须为 HTTPS 地址，且不含凭据', retryable: false });
  return result;
}
export interface BadgeDescription { badge_name: string; description: string }
/** The descriptions, and every badge name in use (held or offered by a campaign). */
export interface BadgeDictionary { dicts: BadgeDescription[]; names: string[] }
/** A row of `GET /admin/shop/purchases`. */
export interface Purchase { id: number; user_id: number; username: string; item_id: number; item_name: string; quantity: number; unit_price: number; total_amount: number; status: 'completed' | 'refunded'; created_at: string; refunded_at: string | null }
/** A row of `GET /admin/shop/legacy-purchases`: an imported coin-ledger debit (`amount` < 0). */
export interface LegacyPurchase { id: number; user_id: number; username: string; reason: string; amount: number; balance_after: number; created_at: string }
/** `tips` is the mascot's own lines as one text (`mascots.tips`), a line per tip, at most 500 characters. */
export interface Mascot { id: number; name: string; image_url: string; tips: string; is_active: boolean }
/** A mascot as the backend stores it (`mascot::Save`). */
export interface MascotBody { name: string; image_url: string; tips: string }
export function mascotPayload(name: string, image: string, tips: string): MascotBody {
  return { name: required(name, '吉祥物名称', 100), image_url: assetUrl(image), tips: tipText(tips) };
}
/** `mascot::Save` takes at most 500 characters of台词 (counted by character, as Rust's `chars()`). */
export const TIPS_MAX = 500;
/** The台词 box as stored: one per line, surrounding blanks dropped — the public reader splits it by line. */
export function tipText(tips: string): string {
  const text = tips.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join('\n');
  if (Array.from(text).length > TIPS_MAX) throw new ApiError('invalid', { message: `台词合计不超过 ${TIPS_MAX} 个字符`, retryable: false });
  return text;
}
/** How many lines a stored台词 text holds (the list's 台词 column). */
export function tipCount(tips: string): number {
  return tips.split(/\r?\n/).filter((line) => line.trim()).length;
}
/**
 * The same three rules as `mascotPayload`, reported per field instead of as one throw.
 *
 * A form refusal is not a failed operation: routing it through the mutation channel printed
 * 操作未完成 for a request that never left the browser, and said nothing about *which* field. The
 * sibling `ConfigEditor` (`components/admin/siteTools/common.tsx`) already validates first and sets
 * each field's own `error`; this is that, for the catalogue forms.
 */
export function mascotProblems(name: string, image: string, tips: string): Partial<Record<'name' | 'image' | 'tips', string>> {
  const problems: Partial<Record<'name' | 'image' | 'tips', string>> = {};
  const check = (field: 'name' | 'image' | 'tips', run: () => unknown) => {
    try { run(); } catch (error) { problems[field] = error instanceof ApiError ? error.message : '输入无效'; }
  };
  check('name', () => required(name, '吉祥物名称', 100));
  check('image', () => assetUrl(image));
  check('tips', () => tipText(tips));
  return problems;
}
export interface Pony { name: string; path: string; preview: string; enabled: boolean }
export function ponyPath(value: string): string {
  const path = required(value, '角色路径', 1000);
  if (path.includes('..') || /[\u0000-\u001f\\?#]/.test(path) || /^[a-z]+:/i.test(path)) throw new ApiError('invalid', { message: '角色路径无效', retryable: false });
  return path;
}
export function mergeDiscovery(existing: Pony[], scanned: Pony[]): Pony[] {
  const byPath = new Map(existing.map((row) => [row.path, row]));
  for (const row of scanned) if (!byPath.has(row.path)) byPath.set(row.path, row);
  return [...byPath.values()];
}
export interface Speech { name: string; text: string; audio: string[] }
/** `mascot::upload_image`'s own ceiling (`MAX_IMAGE_BYTES`). */
export const IMAGE_LIMIT = { mascot: 5 * 1024 * 1024 } as const;
export function validateImage(file: Pick<File, 'size' | 'type'>, kind: keyof typeof IMAGE_LIMIT) {
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) throw new ApiError('invalid', { message: '请选择 PNG、JPEG、WebP 或 GIF 图片', retryable: false });
  if (!file.size || file.size > IMAGE_LIMIT[kind]) throw new ApiError('invalid', { message: `图片须小于 ${IMAGE_LIMIT[kind] / 1024 / 1024} MB`, retryable: false });
}
