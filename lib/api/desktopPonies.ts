import { ApiError } from './errors';
import { picponyPostJson, picponyRequest, readEnvelope } from './http';
import { mascotAsset } from './mascot';

export interface PonyChoice { name: string; path: string }
export interface PonyCatalog { enabled: boolean; ponies: PonyChoice[] }
export interface PonyConfig { name: string; ini: string; baseurl: string }
export const MAX_PONIES = 6;

export function ponyNames(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string' && !!v.trim() && v.length <= 100))].slice(0, MAX_PONIES) : [];
}
export async function getAvailablePonies(signal?: AbortSignal): Promise<PonyCatalog> {
  const data = await readEnvelope<Record<string, unknown>>(await picponyRequest('get_available_ponies', { signal }));
  if (typeof data.enabled !== 'boolean' || !Array.isArray(data.ponies)) throw new ApiError('invalid');
  return { enabled: data.enabled, ponies: data.ponies.slice(0, 500).flatMap(row =>
    row && typeof row.pony_name === 'string' && typeof row.pony_path === 'string' ? [{ name: row.pony_name.slice(0, 100), path: row.pony_path }] : []) };
}
export async function getMyPonies(token: string, signal?: AbortSignal): Promise<string[]> {
  const data = await readEnvelope<{ ponies?: unknown }>(await picponyRequest('get_my_ponies', { token, signal }));
  if (!Array.isArray(data.ponies)) throw new ApiError('invalid');
  return ponyNames(data.ponies);
}
export async function saveMyPonies(token: string, ponies: string[]): Promise<void> {
  if (ponies.length > MAX_PONIES || ponyNames(ponies).length !== ponies.length) throw new ApiError('invalid');
  const data = await readEnvelope<{ success?: unknown }>(await picponyPostJson('save_my_ponies', { ponies }, { token }));
  if (data.success !== true) throw new ApiError('invalid');
}
export async function getPonyConfigs(names: string[], signal?: AbortSignal): Promise<PonyConfig[]> {
  const data = await readEnvelope<{ configs?: unknown }>(await picponyRequest('get_pony_configs', {
    query: { names: ponyNames(names).join(',') }, signal,
  }));
  if (!Array.isArray(data.configs)) throw new ApiError('invalid');
  return data.configs.slice(0, MAX_PONIES).flatMap(row => {
    if (!row || typeof row.name !== 'string' || !names.includes(row.name) || typeof row.ini !== 'string' || row.ini.length > 150_000) return [];
    const baseurl = mascotAsset(row.baseurl);
    if (!baseurl || new URL(baseurl).hostname !== 'picpony.top') return [];
    return [{ name: row.name, ini: row.ini, baseurl: baseurl.endsWith('/') ? baseurl : baseurl + '/' }];
  });
}
