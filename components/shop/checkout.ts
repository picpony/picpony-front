'use client';

import { checkoutBody, checkoutCart, type CheckoutLine, type CheckoutResult } from '@/lib/api/shop';
import { ApiError } from '@/lib/api/errors';
import { readToken, readUserInfo, updateUserInfo } from '@/lib/hooks';
import { coinTransactions, myBadges, sessionUser, shopItems, tasks } from '@/lib/resources';
import { randomId } from '@/lib/utils';
import { consumeFromCart } from './cartStore';

/* A route remount must join an account's outstanding purchase, not charge its cart again. */
const inFlight = new Map<string, Promise<CheckoutOutcome>>();

/**
 * The `Idempotency-Key` of a purchase whose answer was lost, per account, with the body it named.
 * Pressing 结算 again on the same cart sends the same key, so a purchase that did go through is
 * answered with its first result instead of being charged twice; any other cart is a new purchase.
 */
const unconfirmed = new Map<string, { body: string; key: string }>();

function purchaseKey(account: string, lines: readonly CheckoutLine[]): string {
  const body = JSON.stringify(checkoutBody(lines));
  const pending = unconfirmed.get(account);
  return pending && pending.body === body ? pending.key : randomId();
}

/** The session's coin balance, or `null` when it does not carry one (a session from before). */
export function balanceOf(user: Readonly<Record<string, unknown>> | null | undefined): number | null {
  const value = user?.coins;
  if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) return null;
  const coins = Number(value);
  return Number.isFinite(coins) && coins >= 0 ? Math.floor(coins) : null;
}

export type CheckoutOutcome =
  | { kind: 'done'; message: string }
  /** The backend refused — its own words (金币不足, 库存不足…). The cart is kept. */
  | { kind: 'refused'; message: string }
  /**
   * No verdict came back — no answer, an unreadable one, a timeout or a rate limit: it may or may
   * not have been charged. The cart is kept and the balance re-read.
   */
  | { kind: 'unknown'; message: string }
  /**
   * The account changed while the confirmation was open, so nothing was sent (G3-022): not a
   * refusal — the backend never saw it — and not to be prefixed 结算失败.
   */
  | { kind: 'stale-session'; message: string };

/**
 * Whether a failed checkout is a verdict on the request — the backend said no — rather than a
 * failure to hear one. A 4xx is a verdict; 408 (the request
 * timed out) and 429 (a rate limit, counted against the caller rather than the purchase) are
 * transport conditions, as `lib/api/errors.ts` already groups them: a limiter that answered 429
 * after accepting the charge would otherwise invite a second purchase (G3-009).
 */
export function isCheckoutRefusal(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  const status = error.status;
  return error.kind === 'http' && status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/** Every read a purchase can change, refreshed underneath what is on screen. */
function refreshAfterPurchase(token: string) {
  /* The balance's authority is the account itself: the session re-reads it (the shell folds the
     answer back into storage), and /tasks — which shows the balance too — re-reads its own. */
  sessionUser.expire({ token });
  tasks.expire({ token });
  /* 金币明细 gains a row, and every page of it moves by one. */
  coinTransactions.invalidate();
  /* A badge-granting item shows on the badge wall and in the equip dialog. */
  myBadges.expire({ token });
  /* Stock moved — ours and, likely, somebody else's. */
  shopItems.invalidate();
}

/**
 * `checkout_cart`, and everything a purchase changes.
 *
 * On success, as the original front end did: the lines leave the cart, and the balance becomes
 * the one the backend reports after the purchase — written into the session at once, so the shop, the drawer and /tasks agree before the
 * re-reads land. The session write is token-checked (`updateUserInfo`): a purchase answered after
 * a sign-out changes nobody's balance.
 *
 * **A lost answer is not a refusal.** A POST that got no answer may have been charged, so the cart
 * is kept, the reads are refreshed (the balance then shows whether it went through), and the
 * sentence says to look at 金币明细 before trying again. A retry of the same cart reuses the lost
 * purchase's key, so the backend answers it with that purchase rather than charging again.
 */
export function runCheckout(
  token: string,
  account: string,
  lines: readonly CheckoutLine[],
): Promise<CheckoutOutcome> {
  if (readToken() !== token) return Promise.resolve({ kind: 'stale-session', message: '登录状态已变化，请重新确认购买' });
  const pending = inFlight.get(account);
  if (pending) return pending;
  const purchase = performCheckout(token, account, lines).finally(() => {
    if (inFlight.get(account) === purchase) inFlight.delete(account);
  });
  inFlight.set(account, purchase);
  return purchase;
}

async function performCheckout(token: string, account: string, lines: readonly CheckoutLine[]): Promise<CheckoutOutcome> {
  /* A confirmation may outlive the session that opened it, especially in another tab. */
  if (readToken() !== token) return { kind: 'stale-session', message: '登录状态已变化，请重新确认购买' };
  const key = purchaseKey(account, lines);
  let result: CheckoutResult;
  try {
    result = await checkoutCart(token, lines, key);
  } catch (error) {
    /* A broken response after a POST is not evidence that the purchase was rejected.
       Only a backend refusal or a client-error status is a definite answer. */
    if (!isCheckoutRefusal(error)) {
      unconfirmed.set(account, { body: JSON.stringify(checkoutBody(lines)), key });
      refreshAfterPurchase(token);
      return { kind: 'unknown', message: '未能确认结算结果，请先查看金币明细再决定是否重试' };
    }
    unconfirmed.delete(account);
    /* A refusal can still mean the stock or the price moved under the cart: read them again. */
    shopItems.invalidate();
    return {
      kind: 'refused',
      message: error instanceof ApiError ? error.message : '结算失败，请稍后再试',
    };
  }

  /* A smaller cart than the one storage accepted a moment ago: a refusal here would need storage
     to have been withdrawn mid-purchase, and the re-read stock then says what is left anyway. */
  unconfirmed.delete(account);
  consumeFromCart(account, lines.map(({ item, quantity }) => ({ id: item.id, quantity })));
  const stored = readUserInfo();
  if (stored?.token === token) updateUserInfo(token, { coins: result.balance });
  /* The shell folds this entry into storage whenever it changes; corrected too, so a republish of
     the pre-purchase answer cannot put the old balance back before the re-read lands. */
  const session = sessionUser.peek({ token }).data;
  if (session?.kind === 'ok') {
    sessionUser.write({ token }, { ...session, user: { ...session.user, coins: result.balance } });
  }
  refreshAfterPurchase(token);
  return { kind: 'done', message: `已购买，花费 ${result.spent} 金币` };
}
