import { LS_KEYS } from '@/lib/constants';
import type { BlockGroup } from '@/lib/api/blockGroups';

/**
 * The account's switched-on 屏蔽组, mirrored into the two device lists every image read obeys:
 * `LS_KEYS.activeHiddenTags` (left out of every search, `lib/api/client.ts`) and
 * `LS_KEYS.activeSpoileredTags` (covered, `lib/spoilers.ts`).
 *
 * The groups live on the account; the lists live on the device, because a search is built from
 * them on every request. This is the one writer, and it follows whatever the group list currently
 * is — the server's answer (every `blockGroups` read) or a change the screen just made.
 *
 * Writes only on a change, and then says so (`settings_updated`), so a re-read that changed
 * nothing does not re-key every list keyed on the browsing fingerprint.
 */

/** The tags of the groups in force, lower-cased and unique, hidden first. */
export function activeBlockTags(groups: readonly BlockGroup[]): { hidden: string[]; spoilered: string[] } {
  const hidden = new Set<string>();
  const spoilered = new Set<string>();
  for (const group of groups) {
    if (!group.is_active) continue;
    for (const tag of group.hidden_tags) if (tag.trim()) hidden.add(tag.trim().toLowerCase());
    for (const tag of group.spoilered_tags) if (tag.trim()) spoilered.add(tag.trim().toLowerCase());
  }
  /* A tag both hides and covers only where two groups disagree; hiding is the stronger answer. */
  for (const tag of hidden) spoilered.delete(tag);
  return { hidden: [...hidden], spoilered: [...spoilered] };
}

function stored(key: string): string {
  try {
    return localStorage.getItem(key) ?? '[]';
  } catch {
    return '[]';
  }
}

/**
 * Mirror `groups` into the device lists. Returns whether anything changed — the caller then
 * re-mirrors the browsing cookie (`syncBrowsingCookie`, which lives with the fingerprint).
 */
export function mirrorBlockGroups(groups: readonly BlockGroup[]): boolean {
  if (typeof window === 'undefined') return false;
  const { hidden, spoilered } = activeBlockTags(groups);
  const nextHidden = JSON.stringify(hidden);
  const nextSpoilered = JSON.stringify(spoilered);
  const same = (key: string, next: string) => {
    try {
      const current: unknown = JSON.parse(stored(key));
      return Array.isArray(current) && JSON.stringify([...current].sort()) === JSON.stringify(JSON.parse(next).sort());
    } catch {
      return false;
    }
  };
  if (same(LS_KEYS.activeHiddenTags, nextHidden) && same(LS_KEYS.activeSpoileredTags, nextSpoilered)) return false;
  /* Both or neither (review P4-O6): with the hidden list written and the spoilered one refused,
     the device's filter had changed while no `settings_updated` went out, so the cookie and the
     fingerprint the server reads stayed on the old list. The first write is rolled back. */
  let previousHidden: string | null = null;
  try {
    previousHidden = localStorage.getItem(LS_KEYS.activeHiddenTags);
    localStorage.setItem(LS_KEYS.activeHiddenTags, nextHidden);
  } catch {
    /* Storage blocked: the groups still save on the account; this device just cannot apply them. */
    return false;
  }
  try {
    localStorage.setItem(LS_KEYS.activeSpoileredTags, nextSpoilered);
  } catch {
    try {
      if (previousHidden === null) localStorage.removeItem(LS_KEYS.activeHiddenTags);
      else localStorage.setItem(LS_KEYS.activeHiddenTags, previousHidden);
    } catch {
      /* Cannot even put it back: announce what storage now holds rather than leave the mirrors behind. */
      window.dispatchEvent(new Event('settings_updated'));
    }
    return false;
  }
  window.dispatchEvent(new Event('settings_updated'));
  return true;
}
