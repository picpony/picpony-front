'use client';

import { LS_KEYS } from '@/lib/constants';

/**
 * /search's recent queries — the original front end's feature and its storage, so a visitor's
 * history carries over: newest first, fifteen at most, one copy of each query, the text as typed
 * (a Chinese search is remembered by its words, not by the tags they became).
 *
 * Read at event time only — when the list is about to open — never during render: this device
 * store does not exist on the server, and a render that read it would hydrate against a
 * different answer.
 */

const MAX_ENTRIES = 15;

export function readSearchHistory(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(LS_KEYS.searchHistory) || '[]');
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of raw) {
      if (typeof item !== 'string') continue;
      const query = item.trim();
      /* `*` is how the original front end recorded "everything"; it never belongs in a list. */
      if (!query || query === '*' || seen.has(query)) continue;
      seen.add(query);
      out.push(query);
      if (out.length === MAX_ENTRIES) break;
    }
    return out;
  } catch {
    return [];
  }
}

function write(entries: string[]) {
  try {
    if (entries.length === 0) localStorage.removeItem(LS_KEYS.searchHistory);
    else localStorage.setItem(LS_KEYS.searchHistory, JSON.stringify(entries));
  } catch {
    /* Storage blocked or full: the search itself still runs; only the list does not grow. */
  }
}

export function rememberSearch(query: string) {
  const text = query.trim();
  if (!text || text === '*') return;
  write([text, ...readSearchHistory().filter((entry) => entry !== text)].slice(0, MAX_ENTRIES));
}

export function forgetSearch(query: string) {
  write(readSearchHistory().filter((entry) => entry !== query));
}

export function clearSearchHistory() {
  write([]);
}
