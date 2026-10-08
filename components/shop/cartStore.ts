'use client';

import { useSyncExternalStore } from 'react';
import { LS_KEYS } from '@/lib/constants';

/**
 * The shop's cart: one per account, kept in `localStorage` (`LS_KEYS.shopCart`).
 *
 * **Per account, and that is the whole point.** The original front end held the cart in memory,
 * so a reload emptied it, and its sign-out never cleared it, so the next account to sign in on
 * the same page inherited the previous one's items. Keyed by the account here: a reload keeps the
 * cart, a sign-out hides it, and another account on the same device sees only its own.
 *
 * A line is an item id, a quantity and the name it was added under — the name only so a line
 * whose item has since left the shop can still say which one it was. Price and stock are never
 * stored: they are the shop's live answer, and the screen clamps a line to the stock it reads.
 *
 * A store rather than component state because three surfaces show the one cart — the item
 * cards, the docked panel and the sheet — and another tab may change it (`storage`).
 */

export interface CartLine {
  id: number;
  quantity: number;
  name: string;
}

/** More pieces than any line may hold, whatever the stock says. */
export const MAX_LINE_QUANTITY = 999;
/** Lines per cart and accounts per device — bounds on what a bug or a bad write can grow to. */
const MAX_LINES = 100;
const MAX_ACCOUNTS = 8;

type CartBook = Record<string, CartLine[]>;

const UPDATED = 'picpony_cart_updated';
const EMPTY: readonly CartLine[] = Object.freeze([]);

/** The account a cart belongs to: the session's id, or its name when an old session has none. */
export function cartAccount(user: Readonly<Record<string, unknown>> | null | undefined): string | null {
  if (!user) return null;
  const id = Number(user.id);
  if (Number.isSafeInteger(id) && id > 0) return `id:${id}`;
  return typeof user.username === 'string' && user.username.trim() ? `name:${user.username.trim()}` : null;
}

function lineOf(value: unknown): CartLine | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as { id?: unknown; quantity?: unknown; name?: unknown };
  const id = Number(row.id);
  const quantity = Math.floor(Number(row.quantity));
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isFinite(quantity) || quantity < 1) return null;
  return {
    id,
    quantity: Math.min(quantity, MAX_LINE_QUANTITY),
    name: typeof row.name === 'string' ? row.name.slice(0, 200) : '',
  };
}

function readRaw(): string | null {
  try {
    return typeof window === 'undefined' ? null : localStorage.getItem(LS_KEYS.shopCart);
  } catch {
    return null;
  }
}

/** A corrupt or foreign value is an empty book: the cart is a convenience, never state to guard. */
function parseBook(raw: string | null): CartBook {
  if (!raw) return {};
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    const book: CartBook = {};
    for (const [account, lines] of Object.entries(data as Record<string, unknown>)) {
      if (!Array.isArray(lines)) continue;
      const seen = new Set<number>();
      const valid: CartLine[] = [];
      for (const value of lines) {
        const line = lineOf(value);
        if (!line || seen.has(line.id)) continue;
        seen.add(line.id);
        valid.push(line);
        if (valid.length >= MAX_LINES) break;
      }
      if (valid.length > 0) book[account] = valid;
    }
    return book;
  } catch {
    return {};
  }
}

function writeBook(book: CartBook): boolean {
  /* The newest carts win the bound: an account's key moves to the end whenever it is written. */
  const accounts = Object.keys(book);
  const kept: CartBook = {};
  for (const account of accounts.slice(-MAX_ACCOUNTS)) {
    if (book[account].length > 0) kept[account] = book[account].slice(0, MAX_LINES);
  }
  try {
    if (Object.keys(kept).length === 0) localStorage.removeItem(LS_KEYS.shopCart);
    else localStorage.setItem(LS_KEYS.shopCart, JSON.stringify(kept));
  } catch {
    /* Storage refused (private mode, quota): the change cannot persist, so it is not made. */
    return false;
  }
  window.dispatchEvent(new Event(UPDATED));
  return true;
}

function update(account: string, change: (lines: CartLine[]) => CartLine[]): boolean {
  const book = parseBook(readRaw());
  const next = change([...(book[account] ?? [])]);
  const rest = Object.fromEntries(Object.entries(book).filter(([key]) => key !== account));
  return writeBook(next.length > 0 ? { ...rest, [account]: next } : rest);
}

/* One parsed snapshot per stored string, so `useSyncExternalStore` sees a stable identity. */
let cachedRaw: string | null | undefined;
let cachedBook: CartBook = {};
const cachedLines = new Map<string, readonly CartLine[]>();

/** An account's cart as stored now. The same array until the cart changes. */
export function readCart(account: string | null): readonly CartLine[] {
  if (!account) return EMPTY;
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedBook = parseBook(raw);
    cachedLines.clear();
  }
  const known = cachedLines.get(account);
  if (known) return known;
  const lines = cachedBook[account] ? Object.freeze([...cachedBook[account]]) : EMPTY;
  cachedLines.set(account, lines);
  return lines;
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === LS_KEYS.shopCart) listener();
  };
  window.addEventListener(UPDATED, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(UPDATED, listener);
    window.removeEventListener('storage', onStorage);
  };
}

const serverCart = () => EMPTY;

/** The cart, as a value a component re-renders on — this tab's changes and another tab's. */
export function useCart(account: string | null): readonly CartLine[] {
  return useSyncExternalStore(subscribe, () => readCart(account), serverCart);
}

/**
 * One more of `item`, up to `limit` (the stock the screen read). Returns the quantity the cart
 * now holds, or `null` when nothing was added — the line is already at the limit, or storage
 * refused the write.
 */
export function addToCart(account: string, item: { id: number; name: string }, limit: number): number | null {
  const ceiling = Math.min(Math.max(0, Math.floor(limit)), MAX_LINE_QUANTITY);
  let result: number | null = null;
  const written = update(account, (lines) => {
    const index = lines.findIndex((line) => line.id === item.id);
    const current = index === -1 ? 0 : lines[index].quantity;
    if (current >= ceiling || (index === -1 && lines.length >= MAX_LINES)) return lines;
    result = current + 1;
    const line = { id: item.id, quantity: current + 1, name: item.name };
    if (index === -1) return [...lines, line];
    return lines.map((existing, i) => (i === index ? line : existing));
  });
  return written ? result : null;
}

/**
 * A line's quantity, clamped to [1, limit]. A line that is not in the cart stays out of it.
 * Returns whether the cart was stored — `false` when storage refused the write, and then nothing
 * changed (G3-006: the stepper used to drop this and fail silently where 加入购物车 explains).
 */
export function setCartQuantity(account: string, id: number, quantity: number, limit: number): boolean {
  const ceiling = Math.min(Math.max(1, Math.floor(limit)), MAX_LINE_QUANTITY);
  const next = Math.min(Math.max(1, Math.floor(quantity)), ceiling);
  return update(account, (lines) => lines.map((line) => (line.id === id ? { ...line, quantity: next } : line)));
}

/** Lines out of the cart. Returns whether that was stored, as `setCartQuantity` does. */
export function removeFromCart(account: string, ids: readonly number[]): boolean {
  const gone = new Set(ids);
  return update(account, (lines) => lines.filter((line) => !gone.has(line.id)));
}

/** Consume only the purchased quantities; additions made while checkout waited stay in the cart. */
export function consumeFromCart(account: string, bought: readonly { id: number; quantity: number }[]): boolean {
  const quantities = new Map(bought.map((line) => [line.id, line.quantity]));
  return update(account, (lines) => lines.map((line) => ({
    ...line, quantity: line.quantity - (quantities.get(line.id) ?? 0),
  })).filter((line) => line.quantity > 0));
}

/** What a refused write says, wherever in the cart it happens. */
export const CART_STORAGE_REFUSED = '购物车无法保存，请检查浏览器是否允许本地存储';
