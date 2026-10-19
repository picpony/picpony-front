import { ApiError, toApiError } from './errors';
import { api } from './http';
import { getAssetUrl } from '@/lib/utils';
import { parseMascotShape, type MascotShape } from '@/lib/mascot/shapeModel';

export interface MascotConfig {
  enabled: boolean;
  id: string;
  name: string;
  image: string;
  tips: string[];
  mascots: { id: string; name: string }[];
}

/** One row of `GET /mascots`: active mascots only, ordered by id. `tips` is the admin's text, one line each. */
interface MascotRow { id: number; name: string; image_url: string; tips: string }

/**
 * Admin-uploaded media still has to be a media URL, never a navigation/code scheme. The backend's
 * own assets (`/api/v1/mascots/images/…`, `/api/v1/ponies/assets/…`) stay same-origin paths,
 * read through this app's `/api/v1` proxy (`getAssetUrl`).
 */
export function mascotAsset(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  const asset = getAssetUrl(value.trim());
  if (asset.startsWith('/api/v1/')) return /^\/api\/v1\/[\w\-./%]+$/.test(asset) && !asset.includes('..') ? asset : '';
  try {
    const url = new URL(asset);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    return url.href;
  } catch { return ''; }
}

const lines = (text: string) => text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

/**
 * `GET /mascots` — public `{enabled, revision, tips, mascots:[{id,name,image_url,tips}]}`. The
 * signed-in `GET /me/mascot-config` only echoes one selected row and the shared tips, and refuses
 * a visitor, so the public list serves both: `auto` (自动 / 随机) picks one of the active mascots
 * here, an explicit id that is no longer active falls back the same way. A mascot's own lines win;
 * the site-wide `tips` (a JSON array) are the fallback.
 */
export async function getMascotConfig(selected = 'auto', signal?: AbortSignal): Promise<MascotConfig> {
  const data = await api<{ enabled: boolean; tips: unknown; mascots: MascotRow[] }>('GET', '/mascots', { signal });
  const chosen = data.mascots.find(row => String(row.id) === selected)
    ?? data.mascots[Math.floor(Math.random() * data.mascots.length)];
  const shared = Array.isArray(data.tips) ? data.tips.filter((v): v is string => typeof v === 'string' && !!v.trim()) : [];
  const own = chosen ? lines(chosen.tips) : [];
  return {
    enabled: data.enabled, id: chosen ? String(chosen.id) : '', name: chosen?.name ?? '绘云彩彩',
    image: mascotAsset(chosen?.image_url), mascots: data.mascots.map(row => ({ id: String(row.id), name: row.name })),
    tips: own.length ? own : shared,
  };
}

/** Where the character is in its artwork, read on this server (`app/mascot-shape/route.ts`). */
export async function getMascotShape(src: string, signal?: AbortSignal): Promise<MascotShape> {
  let response: Response;
  try {
    response = await fetch(`/mascot-shape?src=${encodeURIComponent(src)}`, { signal });
  } catch (error) {
    throw toApiError(error);
  }
  if (!response.ok) throw new ApiError('http', { status: response.status });
  const shape = parseMascotShape(await response.json().catch(() => null));
  if (!shape) throw new ApiError('invalid');
  return shape;
}
