import { ApiError } from './errors';
import { api } from './http';
import { mascotAsset } from './mascot';
import { randomId } from '@/lib/utils';

export interface PonyChoice { name: string; path: string }
export interface PonyCatalog { enabled: boolean; ponies: PonyChoice[] }
export interface PonyConfig { name: string; ini: string; baseurl: string }
export const MAX_PONIES = 6;

/** The user's own choice (and the assistant's arguments), not a backend answer: still checked. */
export function ponyNames(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string' && !!v.trim() && v.length <= 100))].slice(0, MAX_PONIES) : [];
}

/** `GET /ponies` — `{enabled, ponies:[{name,path}]}`; the list is empty while disabled. */
export async function getAvailablePonies(signal?: AbortSignal): Promise<PonyCatalog> {
  const data = await api<{ enabled: boolean; ponies: PonyChoice[] }>('GET', '/ponies', { signal });
  return { enabled: data.enabled, ponies: data.ponies.map(({ name, path }) => ({ name, path })) };
}

/** `GET /me/ponies` — `{ponies: string[]}`. */
export async function getMyPonies(token: string, signal?: AbortSignal): Promise<string[]> {
  const data = await api<{ ponies: string[] }>('GET', '/me/ponies', { token, signal });
  return data.ponies;
}

/** `PUT /me/ponies {ponies}` — replaces the whole selection; needs an Idempotency-Key. */
export async function saveMyPonies(token: string, ponies: string[]): Promise<void> {
  if (ponies.length > MAX_PONIES || ponyNames(ponies).length !== ponies.length) throw new ApiError('invalid');
  await api('PUT', '/me/ponies', { token, json: { ponies }, idempotencyKey: randomId() });
}

/**
 * `POST /ponies/configs {names}` — `{configs:[{name,path,ini,baseurl}]}`; unknown or disabled
 * names are skipped by the backend. `baseurl` is the backend's own asset path
 * (`/api/v1/ponies/assets/{path}/`): the runtime loads the artwork from it, so it is held to that
 * same-origin path (through this app's `/api/v1` proxy) or an https address on picpony.top.
 */
export async function getPonyConfigs(names: string[], signal?: AbortSignal): Promise<PonyConfig[]> {
  const wanted = ponyNames(names);
  if (!wanted.length) return [];
  const data = await api<{ configs: { name: string; ini: string; baseurl: string }[] }>('POST', '/ponies/configs', { json: { names: wanted }, signal, timeoutMs: 15_000 });
  return data.configs.flatMap(row => {
    const baseurl = mascotAsset(row.baseurl);
    if (!baseurl || !(baseurl.startsWith('/api/v1/ponies/assets/') || (!baseurl.startsWith('/') && new URL(baseurl).hostname === 'picpony.top'))) return [];
    return [{ name: row.name, ini: row.ini, baseurl: baseurl.endsWith('/') ? baseurl : baseurl + '/' }];
  });
}
