/**
 * The wealth dialog's rules as plain functions (`scripts/testAdminConsole.mjs`).
 */

import { figureOf } from './figures';

/** A row of `admin_get_users`, as this panel reads it: the two figures arrive as numbers or strings, or not at all. */
export interface WealthUser {
  id: number;
  username: string;
  experience?: number | string | null;
  coins?: number | string | null;
}

export type CoinsOp = 'add' | 'sub' | 'set';

/** A non-negative whole number typed into a field, or `null` (blank and anything else alike). */
export function wholeNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}

export function coinsAfter(current: number, op: CoinsOp, value: number): number {
  if (op === 'add') return current + value;
  if (op === 'sub') return current - value;
  return value;
}

/**
 * The `admin_update_wealth` body, as the original console builds it: experience only when it
 * changed, with its own reason; coins only when a value was entered — an operator, a whole
 * number and a reason. `{ coins_op: 'set', coins_value: '' }` once went out from an empty field
 * (R9-026), which depending on the backend's cast set the user's coins to nothing.
 */
export function wealthPayload(
  user: WealthUser,
  form: { experience: string; experienceReason: string; coinsOp: CoinsOp; coinsValue: string; coinsReason: string },
): Record<string, unknown> | null {
  const payload: Record<string, unknown> = { target_id: user.id };
  const experience = wholeNumber(form.experience);
  if (experience !== null && experience !== figureOf(user.experience)) {
    payload.experience = experience;
    payload.experience_reason = form.experienceReason.trim();
  }
  const coins = wholeNumber(form.coinsValue);
  /* Adding or deducting nothing is not a change (review P6-F8): it would only write an empty line
     into the user's bill. Setting the balance to 0 is one. */
  if (coins !== null && (coins > 0 || form.coinsOp === 'set')) {
    payload.coins_op = form.coinsOp;
    payload.coins_value = coins;
    payload.reason = form.coinsReason.trim();
  }
  return Object.keys(payload).length > 1 ? payload : null;
}
