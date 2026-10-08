/**
 * The badge grant's pure half — what the form sends — kept out of the client component so the
 * Node suite can hold it to the original console's contract (`oldfe/admin.html`, `grantBadge`):
 *
 *   admin_grant_badge { badge_name, badge_color, target_user_ids, start_date, end_date, expires_at }
 *
 * `target_user_ids` is the comma-separated string the old form sent as typed — **not** an array
 * under `user_ids`, which is what this console used to send and which the backend does not read.
 * Either the ids or a whole registration window names the audience; `expires_at` is `''` for a
 * permanent badge.
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
export function grantPayload(form: GrantForm): Record<string, string> {
  const byUsers = form.target === 'users';
  return {
    badge_name: form.name.trim(),
    badge_color: form.color,
    target_user_ids: byUsers ? (parseUserIds(form.userIds) ?? []).join(',') : '',
    start_date: byUsers ? '' : form.startDate,
    end_date: byUsers ? '' : form.endDate,
    expires_at: form.permanent ? '' : form.expiresAt,
  };
}
