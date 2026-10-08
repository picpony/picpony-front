import { ApiError, toApiError } from './errors';
import { picponyRequest, readEnvelope } from './http';
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

/** Admin-uploaded media still has to be a media URL, never a navigation/code scheme. */
export function mascotAsset(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(getAssetUrl(value.trim()));
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    return url.href;
  } catch { return ''; }
}

export async function getMascotConfig(selected = 'auto', signal?: AbortSignal): Promise<MascotConfig> {
  const data = await readEnvelope<Record<string, unknown>>(await picponyRequest('get_mascot_config', {
    query: { selected_id: selected === 'auto' ? '' : selected }, signal,
  }));
  if (typeof data.enabled !== 'boolean') throw new ApiError('invalid');
  const mascots = Array.isArray(data.mascots) ? data.mascots.slice(0, 100).flatMap(row => {
    if (!row || typeof row !== 'object' || !Number.isSafeInteger(Number(row.id)) || Number(row.id) <= 0 || typeof row.name !== 'string') return [];
    return [{ id: String(row.id), name: row.name.slice(0, 100) }];
  }) : [];
  return {
    enabled: data.enabled, id: String(data.id ?? ''), name: typeof data.name === 'string' ? data.name.slice(0, 100) : '绘云彩彩',
    image: mascotAsset(data.mascot_image), mascots,
    tips: Array.isArray(data.tips) ? data.tips.filter((v): v is string => typeof v === 'string' && !!v.trim()).slice(0, 200).map(v => v.slice(0, 1000)) : [],
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
