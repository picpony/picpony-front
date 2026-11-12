/**
 * Beijing calendar helpers shared by /stats, its server seed and the resource key.
 *
 * The backend buckets in Asia/Shanghai, so the screen must ask for the same
 * calendar days regardless of the device's own zone. Everything here is pure and
 * deterministic: the same instant produces the same `YYYY-MM-DD` on the server and
 * in the browser, which is what lets the seed and the island agree on a key.
 */

const TIME_ZONE = 'Asia/Shanghai';

export interface StatsWindow {
  /** Inclusive first day, `YYYY-MM-DD`. */
  start: string;
  /** Inclusive last day, `YYYY-MM-DD`. */
  end: string;
}

/** Today's Beijing calendar date, independent of the machine's zone. */
export function beijingToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Shift a `YYYY-MM-DD` key by whole days, staying on the calendar (no time zone involved). */
export function shiftDay(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, date));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** The opening window: the last seven Beijing days, today included. */
export function defaultStatsWindow(now?: Date): StatsWindow {
  const end = beijingToday(now);
  return { start: shiftDay(end, -6), end };
}

/** The resource key; the seed spells the same string. */
export function statsWindowKey(window: StatsWindow): string {
  return `${window.start}|${window.end}`;
}

/** `2026年11月12日` — the form the range is read out in beside the native fields. */
export function formatChineseDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return `${year}年${month}月${date}日`;
}
