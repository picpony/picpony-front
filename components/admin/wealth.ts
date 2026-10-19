/**
 * The wealth dialog's rules as plain functions (`scripts/testAdminConsole.mjs`).
 */

import type { WealthAdjustment } from '@/lib/api/admin';

/** A row of the account list, as this panel reads it. */
export interface WealthUser {
  id: number;
  username: string;
  experience: number;
  coins: number;
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
 * The wealth adjustment's body: experience only when it changed, with its own reason; coins only
 * when a value was entered — an operator, a whole number and a reason. Both carry the balance the
 * dialog showed (`expected_*`): the backend refuses the adjustment if it moved in the meantime
 * (`WEALTH_CONFLICT`), so a stale preview cannot be applied. `null` when nothing would change.
 */
export function wealthPayload(
  user: WealthUser,
  form: { experience: string; experienceReason: string; coinsOp: CoinsOp; coinsValue: string; coinsReason: string },
): WealthAdjustment | null {
  const payload: WealthAdjustment = { expected_coins: user.coins, expected_experience: user.experience };
  const experience = wholeNumber(form.experience);
  if (experience !== null && experience !== user.experience) {
    payload.experience = experience;
    payload.experience_reason = form.experienceReason.trim();
  }
  const coins = wholeNumber(form.coinsValue);
  /* Adding or deducting nothing is not a change (review P6-F8): it would only write an empty line
     into the user's bill. Setting the balance to 0 is one. */
  if (coins !== null && (coins > 0 || form.coinsOp === 'set')) {
    payload.coins = { operation: form.coinsOp === 'sub' ? 'subtract' : form.coinsOp, amount: coins };
    payload.coins_reason = form.coinsReason.trim();
  }
  return payload.experience !== undefined || payload.coins !== undefined ? payload : null;
}
