import type { BadgeGrant } from '@/lib/api/admin';

/**
 * The badge grant's pure half — what the form sends — kept out of the client component so the
 * Node suite can hold it to the backend's contract (`POST /admin/badges/awards`):
 *
 *   { name, color, expires_on?, user_ids? | registered_from + registered_through }
 *
 * Either the ids or a whole registration window (Beijing dates, inclusive) names the audience;
 * `expires_on` absent is a permanent badge.
 */

export type GrantTarget = 'users' | 'dates';

export interface GrantForm {
  name: string;
  color: string;
  target: GrantTarget;
  userIds: string;
  startDate: string;
  endDate: string;
  permanent: boolean;
  expiresAt: string;
}

/**
 * The account ids typed into the field — separated by commas (either width), the enumeration
 * comma or whitespace — deduplicated in order. `null` when any piece is not a positive integer,
 * so a typo is an error on the field rather than a silently shorter audience.
 */
export function parseUserIds(text: string): number[] | null {
  const pieces = text.split(/[\s,，、]+/).filter(Boolean);
  const ids: number[] = [];
  for (const piece of pieces) {
    if (!/^\d+$/.test(piece)) return null;
    const id = Number(piece);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** The request body for a validated form. */
export function grantPayload(form: GrantForm): BadgeGrant {
  const body: BadgeGrant = { name: form.name.trim(), color: form.color };
  if (form.target === 'users') body.user_ids = parseUserIds(form.userIds) ?? [];
  else {
    body.registered_from = form.startDate;
    body.registered_through = form.endDate;
  }
  if (!form.permanent && form.expiresAt) body.expires_on = form.expiresAt;
  return body;
}

/** Today's date in Beijing, `YYYY-MM-DD` — the zone the backend stamps and compares dates in. */
export function beijingToday(now = Date.now()): string {
  return new Date(now + 8 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * Review P6-O5: the dates a badge form can hold are now checked against each other. A grant could
 * expire before today (a badge that is gone the moment it is given), and a claim link could hand
 * out badges that expire before the link itself does (claims in its last days give nothing).
 */
export function badgeDateProblems(
  dates: { badgeExpiresAt?: string; linkExpiresAt?: string },
  today = beijingToday(),
): { badgeExpiresAt?: string; linkExpiresAt?: string } {
  const problems: { badgeExpiresAt?: string; linkExpiresAt?: string } = {};
  if (dates.badgeExpiresAt && dates.badgeExpiresAt < today) problems.badgeExpiresAt = '徽章到期日期不能早于今天';
  if (dates.linkExpiresAt && dates.linkExpiresAt < today) problems.linkExpiresAt = '链接失效日期不能早于今天';
  if (!problems.badgeExpiresAt && dates.badgeExpiresAt && dates.linkExpiresAt && dates.badgeExpiresAt < dates.linkExpiresAt) {
    problems.badgeExpiresAt = '徽章到期日期不能早于链接失效日期，否则后期领取的徽章会立即过期';
  }
  return problems;
}
