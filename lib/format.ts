/**
 * One date layer: four fixed shapes, `zh-CN` throughout, no option objects at call sites —
 * the shapes differ by what the column has room for:
 *
 *   formatDateTime       2026/08/20 00:55   the default; a row with room
 *   formatShortDateTime  08/20 00:55        a narrow column (drops the year — usually the current one)
 *   formatDate           2026/08/20         a date with no clock
 *   formatMonthDay       08/20              the tightest form
 *
 * All 2-digit, so a column of them is aligned by construction. The locale is fixed, not a
 * parameter — a Chinese-language UI, pinned so server and client output stay identical.
 */

const FORMATS = {
  dateTime: new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }),
  shortDateTime: new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }),
  date: new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }),
  monthDay: new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }),
};

function toDate(value: string | Date): Date | null {
  // PHP's space-separated local timestamps need ISO's T in Safari. Leave an
  // existing ISO timezone/offset intact rather than replacing every hyphen.
  const d = typeof value === 'string'
    ? new Date(value.replace(/^(\d{4}-\d{2}-\d{2}) (?=\d{2}:\d{2})/, '$1T'))
    : value;
  return Number.isNaN(d.getTime()) ? null : d;
}

function format(value: string | Date, formatter: Intl.DateTimeFormat): string {
  const d = toDate(value);
  return d ? formatter.format(d) : typeof value === 'string' ? value : '';
}

export function formatDateTime(value: string | Date): string {
  return format(value, FORMATS.dateTime);
}

export function formatShortDateTime(value: string | Date): string {
  return format(value, FORMATS.shortDateTime);
}

export function formatDate(value: string | Date): string {
  return format(value, FORMATS.date);
}

export function formatMonthDay(value: string | Date): string {
  return format(value, FORMATS.monthDay);
}

/** "在线" / "刚刚" / "12分钟前" / … / a bare date past a month. */
export function formatLastOnline(lastOnline: string): string {
  const lastTime = toDate(lastOnline);
  if (!lastTime) return lastOnline;
  const diffMs = Date.now() - lastTime.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return '在线';
  if (diffMins < 5) return '刚刚';
  if (diffMins < 60) return `${diffMins}分钟前`;
  if (diffHours < 24) return `${diffHours}小时${diffMins % 60}分前`;
  if (diffDays <= 5) return `${diffDays}天${diffHours % 24}小时前`;
  if (diffDays <= 30) return `${diffDays}天前`;
  return lastOnline.split(/[T ]/, 1)[0];
}
