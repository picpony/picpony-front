import type { HistoryEntry } from '@/lib/api/history';
import { beijingDateKey, formatDate, formatDayLabel } from '@/lib/format';

export interface HistoryDay {
  /** The Beijing calendar date, or `unknown` — the group's identity, never its printed label. */
  key: string;
  label: string;
  entries: HistoryEntry[];
}

/**
 * One page's rows under their Beijing calendar days, in the order each day first appears (newest
 * first, as the backend sends them). Grouped by the date, not by the label: merging only
 * *adjacent* equal labels gave a page whose days are not contiguous two sections with one key,
 * and React then duplicated rows on every delete (G4-001).
 *
 * It is also the order 上一张 / 下一张 walk (`useHistorySequence`), so the next picture is the row
 * under this one on screen: a page whose days are not contiguous, or whose undated rows are
 * scattered, is shown regrouped, and the backend's own order would visit it out of turn.
 */
export function byDay(entries: readonly HistoryEntry[], now: number | null): HistoryDay[] {
  const days = new Map<string, HistoryDay>();
  for (const entry of entries) {
    const key = beijingDateKey(entry.viewedAt) ?? 'unknown';
    let day = days.get(key);
    if (!day) {
      const label = key === 'unknown'
        ? '时间未知'
        : now !== null ? formatDayLabel(entry.viewedAt, now, { clock: false }) : formatDate(entry.viewedAt);
      day = { key, label, entries: [] };
      days.set(key, day);
    }
    day.entries.push(entry);
  }
  return [...days.values()];
}

/** The page's picture ids in the order the screen shows them (see `byDay`). */
export function readingOrder(entries: readonly HistoryEntry[]): number[] {
  return byDay(entries, null).flatMap((day) => day.entries.map((entry) => entry.id));
}
