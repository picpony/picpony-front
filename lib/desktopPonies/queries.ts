'use client';

import { defineResource } from '@/lib/resource';
import { getAvailablePonies, getMyPonies, getPonyConfigs, type PonyCatalog, type PonyConfig } from '@/lib/api/desktopPonies';

export const ponyCatalog = defineResource<Record<string, never>, PonyCatalog>({
  name: 'pony-catalog', key: () => '', fetch: (_, signal) => getAvailablePonies(signal), ttl: 300_000, maxEntries: 1,
});
export const myPonies = defineResource<{ token: string }, string[]>({
  name: 'my-ponies', key: ({ token }) => token, fetch: ({ token }, signal) => getMyPonies(token, signal), ttl: 60_000, maxEntries: 2,
});
export const ponyConfigs = defineResource<{ names: string[] }, PonyConfig[]>({
  name: 'pony-configs', key: ({ names }) => JSON.stringify(names), fetch: ({ names }, signal) => getPonyConfigs(names, signal), ttl: 300_000, maxEntries: 8,
});
