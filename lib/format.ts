/**
 * One date layer.
 *
 * `lib/utils.ts` exported a `formatDate` with **zero importers** while the app
 * formatted dates sixteen other ways: four local helpers (`formatCommentTime`,
 * `formatLastOnline`, `formatHistoryTime`, and `DetailHeader`'s responsive pair)
 * and twelve inline `toLocaleString` calls carrying five different option
 * objects — plus one `toLocaleDateString()` with **no locale at all**, so the
 * forum list's dates followed the reader's OS while every other date on the site
 * was `zh-CN`.
 *
 * Four shapes cover every call site, and they differ by what the column has room
 * for rather than by taste:
 *
 *   `formatDateTime`      2026/08/20 00:55   the default; a row with room
 *   `formatShortDateTime` 08/20 00:55        a narrow column — drops the year,
 *                                            which is almost always the current one
 *   `formatDate`          2026/08/20         a date with no clock
 *   `formatMonthDay`      08/20              the tightest form, below `sm`
 *
 * All four are 2-digit and `zh-CN`, so a column of them is aligned by
 * construction and `tabular-nums` does the rest. The locale is fixed rather than
 * a parameter: this is a Chinese-language UI, and the one call site that left it
 * to the platform is the bug this module exists to end.
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
 * "在线" / "刚刚" / "12分钟前" / … / a bare date past a month.
 *
 * Lived in `app/user/[id]/page.tsx`. The `replace(/-/g, '/')` is load-bearing:
 * `new Date('2026-08-20 00:55')` — a space rather than a `T` — is invalid in
 * Safari, and that is the shape this backend returns.
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
