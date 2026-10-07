/**
 * 金币商店 — the items on sale and the checkout (decision 15), the original front end's two actions.
 *
 * **Browsing is public**: `get_shop_items` answers without a token (read live, 2026-09-27), so a
 * visitor sees the shop and only the checkout asks for an account. The token is still sent when
 * there is one, as the original front end sent it.
 *
 * **What the user has bought** is not an action of its own: the original front end showed a
 * purchase only as a line of 金币明细 (`get_coin_transactions`) and, for an item that grants one,
 * as a badge under 我的徽章 (`get_my_badges`). The checkout therefore refreshes those reads rather
 * than keeping a list of its own (see `runCheckout` in `components/shop/checkout.ts`).
 */

import { ApiError } from './errors';
import { envelopeMessage, listOf, picponyPostJson, picponyRequest, readEnvelope, readObject } from './http';

export interface ShopItem {
  id: number;
  name: string;
  description: string;
  /** Absolute or PicPony-relative; render through `getAssetUrl`. `''` for an item with no picture. */
  imageUrl: string;
  /** Coins per piece. */
  price: number;
  /** Pieces left; `0` is sold out, `null` the shop did not say — unknown, not none, so not sold out. */
  stock: number | null;
  /**
   * The row exactly as the backend sent it. The checkout sends it back with a `quantity`, which
   * is the original front end's line shape field for field — the backend's contract, not ours.
   */
  wire: Readonly<Record<string, unknown>>;
}

/** A whole, non-negative number off the wire, or `null` for anything else. */
function wholeNumber(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

/**
 * One row, validated. A row without an id, a name or a price is not something a person can buy,
 * and one that is switched off (`active: 0`, what the console calls 已下架) is not on sale — the
 * console reads the same action, so an administrator's token may well be answered with both.
 */
function itemOf(row: Record<string, unknown>): ShopItem | null {
  const id = Number(row.id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const name = typeof row.name === 'string' ? row.name.trim() : '';
  const price = wholeNumber(row.price);
  if (!name || price === null) return null;
  if (row.active !== undefined && row.active !== null && Number(row.active) === 0) return null;
  return {
    id,
    name,
    description: typeof row.description === 'string' ? row.description.trim() : '',
    imageUrl: typeof row.image_url === 'string' ? row.image_url.trim() : '',
    price,
    stock: wholeNumber(row.stock),
    wire: row,
  };
}

/** `GET get_shop_items` → the items on sale, in the backend's order. A refusal throws. */
export async function getShopItems(token: string | null, signal?: AbortSignal): Promise<ShopItem[]> {
  const data = await readEnvelope<{ items?: unknown }>(
    await picponyRequest('get_shop_items', {
      ...(token ? { token } : {}),
      query: { _t: Date.now() },
      signal,
    }),
  );
  if (!Array.isArray(data.items)) throw new ApiError('invalid');
  const items: ShopItem[] = [];
  for (const row of listOf<unknown>(data.items)) {
    if (!row || typeof row !== 'object') continue;
    const item = itemOf(row as Record<string, unknown>);
    if (item) items.push(item);
  }
  return items;
}

export interface CheckoutLine {
  item: ShopItem;
  quantity: number;
}

export interface CheckoutResult {
  /** The backend's own sentence (「购买成功」-like), when it sent one. */
  message: string | null;
  /** Coins spent, as the backend counted them; `null` when the answer carried no number. */
  spent: number | null;
}

/**
 * `POST checkout_cart {cart: [...]}` — each line the item as `get_shop_items` sent it plus its
 * `quantity`, the original front end's body. A write: no deadline (aborting a POST does not stop
 * the server charging for it), and a refusal throws `ApiError` carrying the backend's words —
 * 金币不足, 库存不足 and the like are its to say.
 */
export async function checkoutCart(token: string, lines: readonly CheckoutLine[]): Promise<CheckoutResult> {
  const response = await picponyPostJson(
    'checkout_cart',
    { cart: lines.map(({ item, quantity }) => ({ ...item.wire, quantity })) },
    { token },
  );
  /* Preserve HTTP status errors, but require an explicit success flag on a 2xx purchase
     reply: a message alone cannot say whether the account was charged. */
  if (!response.ok) await readEnvelope(response);
  const data = await readObject<{ success?: unknown; message?: unknown; error?: unknown; spent?: unknown }>(response);
  if (data.success === false) throw new ApiError('envelope', { serverMessage: envelopeMessage(data) });
  if (data.success !== true) throw new ApiError('invalid');
  const message = typeof data.message === 'string' && data.message.trim() ? data.message.trim() : null;
  return { message, spent: wholeNumber(data.spent) };
}
