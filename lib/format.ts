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

const ZH = 'zh-CN';

function toDate(value: string | Date): Date | null {
  const d = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDateTime(value: string | Date): string {
  const d = toDate(value);
  if (!d) return typeof value === 'string' ? value : '';
  return d.toLocaleString(ZH, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatShortDateTime(value: string | Date): string {
  const d = toDate(value);
  if (!d) return typeof value === 'string' ? value : '';
  return d.toLocaleString(ZH, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(value: string | Date): string {
  const d = toDate(value);
  if (!d) return typeof value === 'string' ? value : '';
  return d.toLocaleDateString(ZH, { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function formatMonthDay(value: string | Date): string {
  const d = toDate(value);
  if (!d) return typeof value === 'string' ? value : '';
  return d.toLocaleString(ZH, { month: '2-digit', day: '2-digit' });
}

/**
 * "在线" / "刚刚" / "12分钟前" / … / a bare date past a month. `replace(/-/g, '/')` is load-bearing:
 * `new Date('2026-08-20 00:55')` (space, not `T`) is invalid in Safari, and that is this backend's shape.
 */
export function formatLastOnline(lastOnline: string): string {
  const lastTime = new Date(lastOnline.replace(/-/g, '/')).getTime();
  if (Number.isNaN(lastTime)) return lastOnline;
  const diffMs = Date.now() - lastTime;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return '在线';
  if (diffMins < 5) return '刚刚';
  if (diffMins < 60) return `${diffMins}分钟前`;
  if (diffHours < 24) return `${diffHours}小时${diffMins % 60}分前`;
  if (diffDays <= 5) return `${diffDays}天${diffHours % 24}小时前`;
  if (diffDays <= 30) return `${diffDays}天前`;
  return lastOnline.split(' ')[0];
}
