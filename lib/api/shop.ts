/**
 * 金币商店 — the items on sale and the checkout (decision 15), the original front end's two actions.
 *
 * **Browsing is public**: `GET /shop/items` answers without a token, so a visitor sees the shop
 * and only the checkout asks for an account.
 *
 * **What the user has bought** is not an action of its own: the original front end showed a
 * purchase only as a line of 金币明细 (`GET /me/coins/transactions`) and, for an item that grants one,
 * as a badge under 我的徽章 (my badges). The checkout therefore refreshes those reads rather
 * than keeping a list of its own (see `runCheckout` in `components/shop/checkout.ts`).
 */

import { ApiError } from './errors';
import { api } from './http';

/** One row of `GET /shop/items` (src/pg/shop.rs `list`). */
interface WireShopItem {
  id: number;
  name: string;
  description: string;
  image_url: string | null;
  price: number;
  stock: number;
  active: boolean;
  revision: number;
  created_at: string;
}

export interface ShopItem {
  id: number;
  name: string;
  description: string;
  /** Absolute; render through `getAssetUrl`. `''` for an item with no picture. */
  imageUrl: string;
  /** Coins per piece. */
  price: number;
  /** Pieces left; `0` is sold out. */
  stock: number;
}

/** The backend's largest catalogue page: the shop shows the whole catalogue at once. */
const CATALOGUE_LIMIT = 1000;

/**
 * The items on sale, newest first (the backend's order). An administrator's token is also answered
 * with the switched-off items (what the console calls 已下架); those are not on sale here.
 */
export async function getShopItems(token: string | null, signal?: AbortSignal): Promise<ShopItem[]> {
  const data = await api<{ items: WireShopItem[]; next_cursor: number | null }>('GET', '/shop/items', {
    token: token ?? undefined,
    query: { limit: CATALOGUE_LIMIT },
    cache: 'no-store',
    signal,
  });
  return data.items
    .filter((row) => row.active)
    .map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description.trim(),
      imageUrl: row.image_url?.trim() ?? '',
      price: row.price,
      stock: row.stock,
    }));
}

export interface CheckoutLine {
  item: ShopItem;
  quantity: number;
}

export interface CheckoutResult {
  /** Coins spent, as the backend counted them. */
  spent: number;
  /** The account's balance after the purchase. */
  balance: number;
}

/** The body a checkout sends, exactly — what its `Idempotency-Key` names. */
export function checkoutBody(lines: readonly CheckoutLine[]) {
  return { items: lines.map(({ item, quantity }) => ({ item_id: item.id, quantity })) };
}

/**
 * `POST /me/shop/checkouts {items: [{item_id, quantity}]}`. A write: no deadline (aborting a POST
 * does not stop the server charging for it), and a refusal throws `ApiError` carrying the
 * backend's words — 金币不足, 库存不足 and the like are its to say. `idempotencyKey` names the
 * purchase: the same key with the same cart is answered with the first result, never a second
 * charge.
 */
export async function checkoutCart(
  token: string,
  lines: readonly CheckoutLine[],
  idempotencyKey: string,
): Promise<CheckoutResult> {
  const data = await api<{ spent?: unknown; balance?: unknown } | undefined>('POST', '/me/shop/checkouts', {
    token,
    json: checkoutBody(lines),
    idempotencyKey,
  });
  /* A 2xx that does not say what was spent cannot say whether anything was: money is the one
     answer read with suspicion, so the caller treats it as unconfirmed, never as done. */
  if (typeof data?.spent !== 'number' || typeof data.balance !== 'number') throw new ApiError('invalid');
  return { spent: data.spent, balance: data.balance };
}
