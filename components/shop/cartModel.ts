import type { CheckoutLine, ShopItem } from '@/lib/api/shop';
import type { CartLine } from './cartStore';

/**
 * The cart as the shop sees it now — pure, so the rules are testable without a screen.
 *
 * A stored line is only an id and a quantity; what it is worth, and whether it can still be
 * bought, is the shop's current answer:
 * - **ok** — on sale; the quantity is clamped to the stock the shop reports, and `adjusted` says
 *   the stored one was more (somebody else bought some meanwhile). The clamped number is what
 *   the checkout sends. A stock the shop did not state (`null`) clamps nothing: the backend's
 *   answer to the checkout says what there was.
 * - **sold-out** — on sale with no stock left; it stays in the cart, out of the total.
 * - **gone** — no longer offered (removed, or switched off); shown by the name it was added
 *   under, out of the total, until the user removes it.
 */
export type CartEntry =
  | { kind: 'ok'; line: CartLine; item: ShopItem; quantity: number; adjusted: boolean }
  | { kind: 'sold-out'; line: CartLine; item: ShopItem }
  | { kind: 'gone'; line: CartLine };

export interface CartSummary {
  entries: CartEntry[];
  /** Pieces the checkout would buy. */
  pieces: number;
  /** Pieces the cart shows — its badge: every line, a clamped one at its clamped quantity. */
  shown: number;
  /** Their price, in coins. */
  total: number;
  /** What `checkout_cart` is sent. */
  purchasable: CheckoutLine[];
}

export function resolveCart(lines: readonly CartLine[], items: readonly ShopItem[]): CartSummary {
  const byId = new Map(items.map((item) => [item.id, item]));
  const entries: CartEntry[] = [];
  const purchasable: CheckoutLine[] = [];
  let pieces = 0;
  let shown = 0;
  let total = 0;
  for (const line of lines) {
    const item = byId.get(line.id);
    if (!item) {
      entries.push({ kind: 'gone', line });
      shown += line.quantity;
      continue;
    }
    if (item.stock !== null && item.stock <= 0) {
      entries.push({ kind: 'sold-out', line, item });
      shown += line.quantity;
      continue;
    }
    const quantity = item.stock === null ? line.quantity : Math.min(line.quantity, item.stock);
    entries.push({ kind: 'ok', line, item, quantity, adjusted: quantity < line.quantity });
    purchasable.push({ item, quantity });
    pieces += quantity;
    shown += quantity;
    total += item.price * quantity;
  }
  return { entries, pieces, shown, total, purchasable };
}

/** Coins still missing for `total`, or 0 — also when the balance is not known (the backend decides). */
export function shortfall(total: number, balance: number | null): number {
  return balance === null ? 0 : Math.max(0, total - balance);
}

/** Pieces stored, for the badge before the shop's answer has landed. */
export function cartPieces(lines: readonly CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}
