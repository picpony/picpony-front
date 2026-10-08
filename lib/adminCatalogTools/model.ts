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
export function flag(value: unknown): boolean {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  throw new ApiError('invalid');
}
/**
 * A catalogue list. The array itself must be an array — a `{}` where rows belong is a broken
 * response — but **a row that cannot be read is dropped, not fatal**, which is the policy the
 * console's other half already states (`adminList`: "Rows that are not objects are dropped").
 *
 * Every parser here throws on the first bad value, so one legacy row used to take the whole panel
 * with it: a mascot whose picture was never uploaded (`image_url: ''`) left 吉祥物加载失败 with no
 * 重试 — `retryable: false` — and no 全局展示吉祥物 switch, because the switch is gated on the same
 * read. The operator could not see the row, fix it, retry, or turn the feature off. Dropping the row
 * leaves every other one usable and the kill switch reachable.
 *
 * The *envelope's* own fields stay strict on purpose: a response that does not say whether the
 * global switch is on is a broken response, and defaulting it would draw a kill switch reading 关闭
 * over a feature that is running.
 *
 * `listPart` is the same read with the count, for a panel that should say so.
 */
export function list<T>(value: unknown, parse: (row: ObjectRow) => T): T[] {
  return listPart(value, parse).rows;
}
export function listPart<T>(value: unknown, parse: (row: ObjectRow) => T): { rows: T[]; skipped: number } {
  if (!Array.isArray(value)) throw new ApiError('invalid');
  const rows: T[] = [];
  let skipped = 0;
  for (const row of value) {
    /* Only a parse refusal is a droppable row. Anything else is a defect in this module and must
       not be swallowed into a silently shorter list. */
    try { rows.push(parse(object(row))); }
    catch (error) { if (!(error instanceof ApiError)) throw error; skipped += 1; }
  }
  return { rows, skipped };
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
export interface BadgeDictionary { dicts: BadgeDescription[]; names: string[] }
export function badgeDictionary(data: ObjectRow): BadgeDictionary {
  return {
    dicts: list(data.dicts, (row) => ({ badge_name: required(text(row.badge_name), '徽章名称'), description: text(row.description) })),
    names: data.allBadges === undefined ? [] : list(data.allBadges, (row) => text(row.badge_name, 200)),
  };
}
export interface Purchase { id: number; user_id: number; username: string; item_name: string; quantity: number; total_amount: number; created_at: string; status: string }
export function purchase(row: ObjectRow): Purchase {
  return { id: integer(row.id, 1), user_id: integer(row.user_id, 1), username: typeof row.username === 'string' ? row.username : '', item_name: text(row.item_name, 300), quantity: integer(row.quantity, 1), total_amount: integer(row.total_amount), created_at: text(row.created_at, 60), status: text(row.status, 40) };
}
export interface LegacyPurchase { key: string; user_id: number; username: string; reason: string; amount: number; created_at: string }
export function legacyPurchase(row: ObjectRow): LegacyPurchase {
  return { key: String(row.id ?? ''), user_id: integer(row.user_id, 1), username: typeof row.username === 'string' ? row.username : '', reason: text(row.reason), amount: integer(row.amount, -Number.MAX_SAFE_INTEGER), created_at: text(row.created_at, 60) };
}
export interface Mascot { id: number; name: string; image_url: string; tips: string[]; is_active: boolean }
export function mascot(row: ObjectRow): Mascot {
  if (!Array.isArray(row.tips)) throw new ApiError('invalid');
  return { id: integer(row.id, 1), name: text(row.name, 200), image_url: assetUrl(text(row.image_url)), tips: row.tips.map((tip) => text(tip)), is_active: flag(row.is_active) };
}
export function mascotPayload(name: string, image: string, tips: string, id?: number) {
  return { ...(id === undefined ? {} : { id: integer(id, 1) }), name: required(name, '吉祥物名称'), image_url: assetUrl(image), tips: tipLines(tips) };
}
/** The台词 box as the backend takes it: one per line, blanks dropped. */
export function tipLines(tips: string): string[] {
  const lines = tips.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 200 || lines.some((line) => line.length > 1000)) throw new ApiError('invalid', { message: '最多 200 条台词，每条不超过 1000 个字符', retryable: false });
  return lines;
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
  check('name', () => required(name, '吉祥物名称'));
  check('image', () => assetUrl(image));
  check('tips', () => tipLines(tips));
  return problems;
}
export interface Pony { name: string; path: string; preview: string; enabled: boolean }
export function ponyPath(value: string): string {
  const path = required(value, '角色路径', 1000);
  if (path.includes('..') || /[\u0000-\u001f\\?#]/.test(path) || /^[a-z]+:/i.test(path)) throw new ApiError('invalid', { message: '角色路径无效', retryable: false });
  return path;
}
export function pony(row: ObjectRow): Pony {
  return { name: text(row.pony_name, 200), path: ponyPath(text(row.pony_path)), preview: row.preview ? assetUrl(text(row.preview)) : '', enabled: flag(row.enabled) };
}
export function discoveredPony(row: ObjectRow): Pony {
  return { name: text(row.name, 200), path: ponyPath(text(row.path)), preview: row.preview ? assetUrl(text(row.preview)) : '', enabled: false };
}
export function mergeDiscovery(existing: Pony[], scanned: Pony[]): Pony[] {
  const byPath = new Map(existing.map((row) => [row.path, row]));
  for (const row of scanned) if (!byPath.has(row.path)) byPath.set(row.path, row);
  return [...byPath.values()];
}
export interface Speech { name: string; text: string; audio: string[] }
export function speech(row: ObjectRow): Speech {
  if (row.audio != null && !Array.isArray(row.audio)) throw new ApiError('invalid');
  return { name: text(row.name, 200), text: text(row.text), audio: (row.audio as unknown[] | undefined ?? []).map((value) => text(value, 1000)) };
}
export const IMAGE_LIMIT = { mascot: 2 * 1024 * 1024, shop: 10 * 1024 * 1024 } as const;
export function validateImage(file: Pick<File, 'size' | 'type'>, kind: keyof typeof IMAGE_LIMIT) {
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) throw new ApiError('invalid', { message: '请选择 PNG、JPEG、WebP 或 GIF 图片', retryable: false });
  if (!file.size || file.size > IMAGE_LIMIT[kind]) throw new ApiError('invalid', { message: `图片须小于 ${IMAGE_LIMIT[kind] / 1024 / 1024} MB`, retryable: false });
}
