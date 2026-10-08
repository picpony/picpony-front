/**
 * One date-and-number layer: fixed shapes, `zh-CN` throughout, no option objects at call sites —
 * the shapes differ by what the column has room for:
 *
 *   formatDateTime         2026/08/20 00:55   the default; a row with room
 *   formatShortDateTime    08/20 00:55        a narrow column, for times known to be recent
 *   formatCompactDateTime  08/20 00:55 or 2024/08/20
 *                                             a narrow column that may hold an old date —
 *                                             the year replaces the clock when it differs
 *   formatDate             2026/08/20         a date with no clock
 *   formatCompactDate      08/20 or 2024/08/20  the tightest form, year only when it differs
 *   formatMonthDay         08/20              the tightest form, for dates known to be recent
 *   formatClock            00:55              the time of day alone
 *   formatDayLabel         今天 00:55 / 昨天 / 周三 / 8月20日 / 2024年8月20日
 *                                             a conversation's day, as a messenger says it
 *   formatRelativeTime     刚刚 / 12 分钟前 / 3 小时前 / 2 天前 / a date past a month
 *
 * All 2-digit, so a column of them is aligned by construction. The locale is fixed, not a
 * parameter — a Chinese-language UI, pinned so server and client output stay identical.
 *
 * ## Time zone
 *
 * **PicPony's backend writes Beijing wall-clock time with no offset** (`"2026-09-25 12:39:37"`
 * read at 13:43 CST, 05:43 UTC — as UTC it would be in the future). Parsing that as device-local
 * time showed every visitor outside UTC+8 a shifted clock, and a UTC-5 device saw everybody
 * 「在线」 for thirteen hours. So `parseBackendTime` reads an offset-less string as `+08:00`,
 * and every shape *formats* in `Asia/Shanghai` too: the server that renders a profile header
 * and the browser that hydrates it then produce the same characters whatever their own zones
 * are. Derpibooru's timestamps carry `Z` and are converted, so both sources share one clock.
 *
 * **Three columns are the exception, and are read as UTC** (`parseBackendUtcTime`): written by the
 * database's own clock rather than by PHP's, by every sign, and the original front end — which ran
 * against this backend in production — reads exactly these three as UTC and no other stamp:
 *
 *   浏览历史 `view_time` / `last_view_time`  `new Date(view_time + " UTC")`
 *       (picpony-review/coord/oldfe-live-main-20261002.js:498; oldfe/main-D7X40lKR.js)
 *   词库编辑历史 `created_at`                  `formatHistoryTime` appends `Z` (picpony.top/ciku.html)
 *   维护密码 `updated_at`                      `new Date(updatedAt + 'Z')`, shown in Asia/Shanghai
 *       (picpony-review/coord/admin-live-20261003.html:5027; oldfe/admin.html:4998)
 *
 * No row of any of the three could be checked live: each needs a real staff or user session
 * (`get_dictionary_tag_history` answers 403 to anything else). They were read three different
 * ways, each appending its own `Z`; now there is one parser for them, beside the one for everything
 * else, and both readings are pinned by `scripts/testAdminConsole.mjs`.
 *
 * Relative times depend on "now", so text rendered on the server must not contain one — pass
 * `useNow()`'s value (`lib/hooks.ts`), which is `null` until after hydration.
 */

/** The zone PicPony's backend writes its offset-less timestamps in. */
export const BACKEND_TIME_ZONE = 'Asia/Shanghai';
/** `BACKEND_TIME_ZONE` as an ISO offset. China has observed no daylight saving since 1991. */
export const BACKEND_UTC_OFFSET = '+08:00';
const OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

const FORMATS = {
  dateTime: new Intl.DateTimeFormat('zh-CN', {
    timeZone: BACKEND_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }),
  shortDateTime: new Intl.DateTimeFormat('zh-CN', {
    timeZone: BACKEND_TIME_ZONE,
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }),
  date: new Intl.DateTimeFormat('zh-CN', {
    timeZone: BACKEND_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }),
  monthDay: new Intl.DateTimeFormat('zh-CN', { timeZone: BACKEND_TIME_ZONE, month: '2-digit', day: '2-digit' }),
  clock: new Intl.DateTimeFormat('zh-CN', {
    timeZone: BACKEND_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }),
};

/** `YYYY-MM-DD`, optionally `[ T]HH:mm[:ss[.fff]]`, optionally a zone. */
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;

type DateInput = string | number | Date | null | undefined;

/**
 * The one parser for a backend timestamp — PicPony's and Derpibooru's alike.
 *
 * An offset-less string is Beijing wall-clock time (see the module docstring); a string with
 * `Z` or an offset is taken as written; a date alone is that calendar day in Beijing. Hand-split
 * rather than handed to `Date`: `new Date('2026-01-01 08:00:00')` is not a format the spec
 * defines, so whether it parses — Safari says Invalid Date — and in which zone is the engine's
 * choice. Numbers are epoch milliseconds. Anything unparseable is `null`.
 */
export function parseBackendTime(value: DateInput): Date | null {
  return parseIn(value, BACKEND_UTC_OFFSET);
}

/**
 * `parseBackendTime` for the three columns the backend writes in UTC (the module docstring names
 * them, with the evidence): an offset-less string is UTC, `Z` or an offset is taken as written.
 * Everything else about the reading is the same parser's.
 */
export function parseBackendUtcTime(value: DateInput): Date | null {
  return parseIn(value, 'Z');
}

/** The shared parse, with the zone an offset-less string is read in. */
function parseIn(value: DateInput, offsetless: string): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value !== 'string') {
    /* Tested by tag rather than `instanceof`, which is false for a Date from another realm. */
    if (Object.prototype.toString.call(value) !== '[object Date]') return null;
    const time = (value as Date).getTime();
    return Number.isNaN(time) ? null : new Date(time);
  }
  const text = value.trim();
  const m = TIMESTAMP.exec(text);
  if (m) {
    const [, y, mo, d, h = '00', mi = '00', s = '00', fraction = '', zone] = m;
    const offset = !zone ? offsetless
      : zone.toUpperCase() === 'Z' ? 'Z'
        : zone.includes(':') ? zone : `${zone.slice(0, 3)}:${zone.slice(3)}`;
    const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${fraction.slice(0, 4)}${offset}`);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const loose = new Date(text);
  return Number.isNaN(loose.getTime()) ? null : loose;
}

/** Epoch milliseconds for sorting; unparseable values sort first rather than throwing. */
export function backendTimeValue(value: DateInput): number {
  return parseBackendTime(value)?.getTime() ?? 0;
}

function format(value: DateInput, formatter: Intl.DateTimeFormat): string {
  const d = parseBackendTime(value);
  return d ? formatter.format(d) : typeof value === 'string' ? value : '';
}

/** The Beijing calendar day a moment falls on, as a day count — for "today"/"this year" tests. */
function beijingDay(ms: number): number {
  return Math.floor((ms + OFFSET_MS) / DAY_MS);
}

function beijingYear(ms: number): number {
  return new Date(ms + OFFSET_MS).getUTCFullYear();
}

/**
 * The Beijing calendar day a moment falls on, as `YYYY-MM-DD` — a key for grouping by day, which
 * the display label cannot be (two different days can print the same label, and a label repeats
 * wherever the rows are not sorted by it). Null for a value that is not a time.
 */
export function beijingDateKey(value: DateInput): string | null {
  const d = parseBackendTime(value);
  return d ? new Date(d.getTime() + OFFSET_MS).toISOString().slice(0, 10) : null;
}

export function formatDateTime(value: DateInput): string {
  return format(value, FORMATS.dateTime);
}

export function formatShortDateTime(value: DateInput): string {
  return format(value, FORMATS.shortDateTime);
}

export function formatDate(value: DateInput): string {
  return format(value, FORMATS.date);
}

export function formatMonthDay(value: DateInput): string {
  return format(value, FORMATS.monthDay);
}

/**
 * A birthday as a profile prints it: month and day, never the year. This is a calendar date,
 * not a moment, so it is read as written and never passed through a time-zone conversion.
 */
export function birthdayLabel(value: unknown): string | null {
  const m = typeof value === 'string' ? /^\s*(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value) : null;
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${month}月${day}日`;
}

export function formatClock(value: DateInput): string {
  return format(value, FORMATS.clock);
}

/**
 * `08/20 00:55` this year, `2024/08/20` otherwise — for a narrow column whose dates may be
 * years old (a comment, a picture's upload date). Dropping the year unconditionally made a 2013
 * picture read as this year's; showing the clock of a day years ago says nothing useful.
 */
export function formatCompactDateTime(value: DateInput, now: number = Date.now()): string {
  const d = parseBackendTime(value);
  if (!d) return typeof value === 'string' ? value : '';
  return beijingYear(d.getTime()) === beijingYear(now) ? FORMATS.shortDateTime.format(d) : FORMATS.date.format(d);
}

/** `08/20` this year, `2024/08/20` otherwise — the tightest form that cannot lie about a year. */
export function formatCompactDate(value: DateInput, now: number = Date.now()): string {
  const d = parseBackendTime(value);
  if (!d) return typeof value === 'string' ? value : '';
  return beijingYear(d.getTime()) === beijingYear(now) ? FORMATS.monthDay.format(d) : FORMATS.date.format(d);
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/**
 * A conversation's day, as a messenger says it: `今天 00:55` (or `今天` with `clock: false`),
 * `昨天`, a weekday inside the last week, `8月20日` this year, `2024年8月20日` before. Days are
 * Beijing calendar days, like everything else here.
 */
export function formatDayLabel(value: DateInput, now: number = Date.now(), { clock = true }: { clock?: boolean } = {}): string {
  const d = parseBackendTime(value);
  if (!d) return typeof value === 'string' ? value : '';
  const ms = d.getTime();
  const days = beijingDay(now) - beijingDay(ms);
  if (days === 0) return clock ? `今天 ${FORMATS.clock.format(d)}` : '今天';
  if (days === 1) return '昨天';
  const local = new Date(ms + OFFSET_MS);
  if (days > 1 && days < 7) return WEEKDAYS[local.getUTCDay()];
  const month = local.getUTCMonth() + 1;
  const day = local.getUTCDate();
  return beijingYear(ms) === beijingYear(now) ? `${month}月${day}日` : `${local.getUTCFullYear()}年${month}月${day}日`;
}

/**
 * How long ago, at one precision: `刚刚` under a minute, then the largest whole unit —
 * `12 分钟前`, `3 小时前`, `2 天前` — and the plain date past thirty days. One unit, never two
 * (`1小时24分前` read as a stopwatch). A time slightly in the future (a clock skew) is `刚刚`.
 */
export function formatRelativeTime(value: DateInput, now: number = Date.now()): string {
  const d = parseBackendTime(value);
  if (!d) return typeof value === 'string' ? value : '';
  const minutes = Math.floor((now - d.getTime()) / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days <= 30) return `${days} 天前`;
  return FORMATS.date.format(d);
}

/** Within this, a last-seen stamp means "here now" rather than a time. */
export const ONLINE_WINDOW_MS = 5 * 60_000;

/**
 * A profile's last-seen line: a status while the stamp is recent (`在线`), a relative time
 * otherwise. Returned as two fields so the screen can present 在线 as a state rather than as
 * 「上次在线：在线」.
 */
export function lastOnlineStatus(value: DateInput, now: number = Date.now()): { online: boolean; text: string } {
  const d = parseBackendTime(value);
  if (!d) return { online: false, text: typeof value === 'string' ? value : '' };
  if (now - d.getTime() < ONLINE_WINDOW_MS) return { online: true, text: '在线' };
  return { online: false, text: formatRelativeTime(d, now) };
}

/** The last-seen line as one string: `在线`, or the relative time. */
export function formatLastOnline(lastOnline: DateInput, now: number = Date.now()): string {
  return lastOnlineStatus(lastOnline, now).text;
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

const GROUPED = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });
const ONE_DECIMAL = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });
/** Coins are counted exactly — a ledger that rounds to 1.2万 is not a ledger. */
const EXACT = new Intl.NumberFormat('zh-CN');

/**
 * A count — votes, faves, comments, views: `4,422` below ten thousand, then `1.2万` and
 * `3.4亿` (the units a Chinese reader counts in; `12,345` is read as 一万两千…). One formatter
 * for every surface, so a card, the banner and the detail header show one number one way.
 */
export function formatCount(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '0';
  const n = Math.round(value);
  const abs = Math.abs(n);
  if (abs < 10_000) return GROUPED.format(n);
  /* Decided on the value as it will be printed: 99,995,000 is 9,999.5万 but 99,999,999 rounds
     to 10,000万 at one decimal — which is 1亿, and must read as one (review P2-F6). */
  const wan = Math.round(n / 1_000) / 10;
  if (Math.abs(wan) < 10_000) return `${ONE_DECIMAL.format(wan)}万`;
  return `${ONE_DECIMAL.format(n / 100_000_000)}亿`;
}

/**
 * A count read **exactly**, grouped and never compacted — money and anything else that is
 * reconciled rather than skimmed. `formatCount`'s 万 / 亿 is right for a vote tally and wrong for a
 * ledger: a column that rounds 12,345 coins to 1.2万 cannot be checked against a balance. `''` for
 * a value that is not a number, so a missing amount reads as missing rather than as zero — the
 * opposite of `formatCount`, whose `'0'` is correct for an absent vote count.
 */
export function formatExactCount(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? EXACT.format(value) : '';
}

/**
 * A signed exact amount, with a true minus sign (U+2212) rather than a hyphen so a column of them
 * lines up under `tabular-nums`. For a ledger, where the direction is the point.
 */
export function formatSignedCount(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  if (value > 0) return `+${EXACT.format(value)}`;
  if (value < 0) return `−${EXACT.format(-value)}`;
  return '0';
}

/**
 * A file size in the unit that reads naturally: `512 B`, `30 KB`, `1.5 MB`, `1.2 GB` — one
 * decimal below ten of a unit, none above. `0.03 MB` for a 30 KB file was the defect.
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value < 10 ? 1 : 0;
  return `${Number(value.toFixed(digits))} ${units[unit]}`;
}
