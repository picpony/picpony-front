/**
 * 金币商店 without a browser: what `get_shop_items` is read as (what is on sale and what is not), the
 * checkout's wire (the original front end's line shape, field for field), the cart (one per
 * account, bounded by stock and by storage, never carried from one account to another), the
 * cart against the shop's live answer (sold out, withdrawn, clamped), and a checkout end to end —
 * the balance it leaves, the lines it removes, and what a refusal and a lost answer keep.
 */
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { requireTypeStripping } from './tsResolve.mjs';

requireTypeStripping('testShop');

const values = new Map();
let storageRefuses = false;
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => {
    if (storageRefuses) throw new DOMException('quota', 'QuotaExceededError');
    values.set(key, String(value));
  },
  removeItem: (key) => values.delete(key),
};
const events = [];
globalThis.window = {
  requestAnimationFrame: (callback) => setTimeout(callback, 0),
  addEventListener() {}, removeEventListener() {},
  dispatchEvent(event) { events.push(event.type); return true; },
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (...args) => clearTimeout(...args),
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  location: { origin: 'https://app.invalid' },
};
globalThis.document = { visibilityState: 'visible', hidden: false, cookie: '', addEventListener() {}, removeEventListener() {} };

let calls;
let respond;
beforeEach(() => {
  values.clear();
  events.length = 0;
  storageRefuses = false;
  calls = [];
  respond = () => Response.json({ success: true });
  globalThis.fetch = async (url, init = {}) => {
    const request = { url: new URL(String(url), 'https://app.invalid'), init };
    calls.push(request);
    return respond(request);
  };
});

const shop = await import('../lib/api/shop.ts');
const { ApiError } = await import('../lib/api/errors.ts');
const { LS_KEYS } = await import('../lib/constants.ts');
const cart = await import('../components/shop/cartStore.ts');
const model = await import('../components/shop/cartModel.ts');
const checkout = await import('../components/shop/checkout.ts');

const ROWS = [
  { id: 4, name: '绘云彩彩钥匙扣', description: '现场领取', image_url: 'https://picpony.top/uploads/643.jpg', price: 8, stock: 3, active: 1, created_at: '2026-07-10 16:53:58' },
  { id: 5, name: '  没有图片的商品  ', description: '', image_url: '', price: 30, stock: 10, active: 1 },
  { id: 6, name: '已售罄的徽章', price: 5, stock: 0, active: 1 },
  { id: 7, name: '下架商品', price: 1, stock: 9, active: 0 },
  { id: 0, name: '没有编号', price: 1, stock: 1 },
  { id: 8, name: '', price: 1, stock: 1 },
  { id: 9, name: '没有价格', price: 'free', stock: 1 },
  { id: 10, name: '库存缺失', price: 2 },
  'not a row',
];

async function items() {
  respond = () => Response.json({ success: true, items: ROWS });
  const list = await shop.getShopItems(null);
  calls.length = 0;
  return list;
}

// --- get_shop_items ---------------------------------------------------------------------------

test('the items on sale: a row without an id, a name or a price is dropped, and so is a withdrawn one', async () => {
  respond = () => Response.json({ success: true, items: ROWS });
  const list = await shop.getShopItems(null);
  assert.deepEqual(list.map((item) => item.id), [4, 5, 6, 10]);
  const [first, second, soldOut, noStock] = list;
  assert.deepEqual(
    { name: first.name, price: first.price, stock: first.stock, imageUrl: first.imageUrl },
    { name: '绘云彩彩钥匙扣', price: 8, stock: 3, imageUrl: 'https://picpony.top/uploads/643.jpg' },
  );
  assert.equal(second.name, '没有图片的商品', 'trimmed');
  assert.equal(second.imageUrl, '');
  assert.equal(soldOut.stock, 0, 'sold out is still on sale — the card says so');
  assert.equal(noStock.stock, null, 'a missing stock is unknown, not none (G2-023)');
  assert.deepEqual(first.wire, ROWS[0], 'the row is kept as sent: the checkout sends it back');
});

test('browsing is public: no token when signed out, the token when there is one, never cached', async () => {
  respond = () => Response.json({ success: true, items: [] });
  await shop.getShopItems(null);
  await shop.getShopItems('tok');
  const [anonymous, signedIn] = calls;
  assert.equal(anonymous.url.searchParams.get('action'), 'get_shop_items');
  assert.ok(anonymous.url.searchParams.get('_t'), 'the original’s cache-buster');
  assert.equal(new Headers(anonymous.init.headers).get('authorization'), null);
  assert.equal(new Headers(signedIn.init.headers).get('authorization'), 'Bearer tok');
});

test('a refusal is an error with the backend’s words, and a body without a list is not an empty shop', async () => {
  respond = () => Response.json({ success: false, error: '商店维护中' });
  await assert.rejects(shop.getShopItems(null), (error) => error instanceof ApiError && error.message === '商店维护中');
  respond = () => Response.json({ success: true });
  await assert.rejects(shop.getShopItems(null), (error) => error instanceof ApiError && error.kind === 'invalid');
  respond = () => Response.json({ success: true, items: [] });
  assert.deepEqual(await shop.getShopItems(null), [], 'an empty shop is an answer');
});

// --- checkout_cart ----------------------------------------------------------------------------

test('checkout_cart sends the original’s lines: each item as read, plus its quantity', async () => {
  const [keyring, plain] = await items();
  respond = () => Response.json({ success: true, message: '购买成功！', spent: 46 });
  const result = await shop.checkoutCart('tok', [{ item: keyring, quantity: 2 }, { item: plain, quantity: 1 }]);
  assert.deepEqual(result, { message: '购买成功！', spent: 46 });
  const [{ url, init }] = calls;
  assert.equal(url.searchParams.get('action'), 'checkout_cart');
  assert.equal(init.method, 'POST');
  assert.equal(new Headers(init.headers).get('authorization'), 'Bearer tok');
  assert.equal(new Headers(init.headers).get('content-type'), 'application/json');
  assert.deepEqual(JSON.parse(init.body), {
    cart: [{ ...ROWS[0], quantity: 2 }, { ...ROWS[1], quantity: 1 }],
  });
  assert.equal(init.signal, undefined, 'a write has no deadline: aborting it does not stop the charge');
});

test('a checkout answer without a sentence or a number says so, and a refusal carries its words', async () => {
  const [keyring] = await items();
  respond = () => Response.json({ success: true, message: '  ', spent: 'x' });
  assert.deepEqual(await shop.checkoutCart('tok', [{ item: keyring, quantity: 1 }]), { message: null, spent: null });
  respond = () => Response.json({ success: false, error: '金币不足' });
  await assert.rejects(
    shop.checkoutCart('tok', [{ item: keyring, quantity: 1 }]),
    (error) => error instanceof ApiError && error.message === '金币不足',
  );
});

test('missing numeric values are unknown, not a free price or a zero-coin charge', async () => {
  const invalid = [null, '', '   ', false, true, [], {}];
  for (const value of invalid) {
    respond = () => Response.json({ success: true, items: [{ ...ROWS[0], price: value }] });
    assert.deepEqual(await shop.getShopItems(null), [], `invalid price: ${JSON.stringify(value)}`);
    respond = () => Response.json({ success: true, spent: value });
    assert.equal((await shop.checkoutCart('tok', [])).spent, null);
    assert.equal(checkout.balanceOf({ coins: value }), null);
  }
  respond = () => Response.json({ success: true, items: [{ ...ROWS[0], price: '0' }] });
  assert.equal((await shop.getShopItems(null))[0].price, 0, 'a genuine zero remains valid');
});

// --- the cart ---------------------------------------------------------------------------------

test('a cart belongs to an account: by id, else by name, never to nobody', () => {
  assert.equal(cart.cartAccount({ id: 3, username: 'a' }), 'id:3');
  assert.equal(cart.cartAccount({ id: '12', username: 'a' }), 'id:12');
  assert.equal(cart.cartAccount({ username: ' Old Session ' }), 'name:Old Session');
  assert.equal(cart.cartAccount({ id: 0, username: '' }), null);
  assert.equal(cart.cartAccount(null), null);
  assert.deepEqual(cart.readCart(null), []);
});

test('adding stops at the stock the screen read, and at the cart’s own ceiling', () => {
  const item = { id: 4, name: '钥匙扣' };
  assert.equal(cart.addToCart('id:1', item, 2), 1);
  assert.equal(cart.addToCart('id:1', item, 2), 2);
  assert.equal(cart.addToCart('id:1', item, 2), null, 'at the stock: nothing added');
  assert.deepEqual(cart.readCart('id:1'), [{ id: 4, quantity: 2, name: '钥匙扣' }]);
  assert.equal(cart.addToCart('id:1', { id: 6, name: '售罄' }, 0), null, 'sold out cannot be added');
  assert.ok(events.includes('picpony_cart_updated'), 'the other surfaces hear of it');
  cart.setCartQuantity('id:1', 4, 5000, 5000);
  assert.equal(cart.readCart('id:1')[0].quantity, cart.MAX_LINE_QUANTITY);
});

test('a quantity is clamped to [1, stock], a missing line stays missing, and removal empties the key', () => {
  cart.addToCart('id:1', { id: 4, name: '钥匙扣' }, 3);
  cart.setCartQuantity('id:1', 4, 9, 3);
  assert.equal(cart.readCart('id:1')[0].quantity, 3);
  cart.setCartQuantity('id:1', 4, 0, 3);
  assert.equal(cart.readCart('id:1')[0].quantity, 1, 'never below one: removing is its own action');
  cart.setCartQuantity('id:1', 99, 2, 3);
  assert.deepEqual(cart.readCart('id:1').map((line) => line.id), [4]);
  cart.removeFromCart('id:1', [4]);
  assert.deepEqual(cart.readCart('id:1'), []);
  assert.equal(values.get(LS_KEYS.shopCart), undefined, 'nothing left: nothing stored');
});

test('two accounts on one device never see each other’s carts', () => {
  cart.addToCart('id:1', { id: 4, name: '钥匙扣' }, 3);
  cart.addToCart('id:2', { id: 5, name: '立牌' }, 3);
  assert.deepEqual(cart.readCart('id:1').map((line) => line.id), [4]);
  assert.deepEqual(cart.readCart('id:2').map((line) => line.id), [5]);
  cart.removeFromCart('id:2', [5]);
  assert.deepEqual(cart.readCart('id:1').map((line) => line.id), [4], 'the other cart is untouched');
});

test('the same cart is the same array until it changes — what a store subscription needs', () => {
  cart.addToCart('id:1', { id: 4, name: '钥匙扣' }, 3);
  const first = cart.readCart('id:1');
  assert.equal(cart.readCart('id:1'), first);
  cart.addToCart('id:1', { id: 4, name: '钥匙扣' }, 3);
  assert.notEqual(cart.readCart('id:1'), first);
});

test('a corrupt or foreign stored value is an empty cart, and a refused write adds nothing', () => {
  values.set(LS_KEYS.shopCart, '{not json');
  assert.deepEqual(cart.readCart('id:1'), []);
  values.set(LS_KEYS.shopCart, JSON.stringify({ 'id:1': [{ id: 4, quantity: 2, name: 'a' }, { id: 4, quantity: 5 }, { id: -1, quantity: 1 }, { id: 5, quantity: 0 }, 'x'] }));
  assert.deepEqual(cart.readCart('id:1'), [{ id: 4, quantity: 2, name: 'a' }], 'one line per item, valid lines only');
  storageRefuses = true;
  assert.equal(cart.addToCart('id:1', { id: 5, name: 'b' }, 3), null, 'a change that cannot persist is not made');
});

test('the stepper and the cross report a refused write, and a refused write changes nothing (G3-006)', () => {
  assert.equal(cart.addToCart('id:1', { id: 4, name: '钥匙扣' }, 5), 1);
  assert.equal(cart.addToCart('id:1', { id: 5, name: '立牌' }, 5), 1);
  assert.equal(cart.setCartQuantity('id:1', 4, 2, 5), true, 'a stored change says so');
  storageRefuses = true;
  const before = cart.readCart('id:1');
  assert.equal(cart.setCartQuantity('id:1', 4, 3, 5), false, 'a refused quantity is reported');
  assert.equal(cart.removeFromCart('id:1', [4]), false, 'a refused removal is reported');
  assert.equal(cart.readCart('id:1'), before, 'and neither changed the cart');
  assert.equal(cart.readCart('id:1')[0].quantity, 2);
  assert.equal(cart.removeFromCart('id:1', [4, 5]), true, 'emptying the cart deletes the key, which storage never refuses');
  storageRefuses = false;
  assert.deepEqual(cart.readCart('id:1'), []);
  assert.equal(typeof cart.CART_STORAGE_REFUSED, 'string');
});

test('a device keeps the newest eight accounts’ carts', () => {
  for (let account = 1; account <= 9; account += 1) cart.addToCart(`id:${account}`, { id: 4, name: '钥匙扣' }, 3);
  assert.deepEqual(cart.readCart('id:1'), [], 'the oldest went');
  assert.equal(cart.readCart('id:9').length, 1);
  assert.equal(cart.readCart('id:2').length, 1);
});

// --- the cart against the shop ----------------------------------------------------------------

test('a cart is read against the shop’s live answer: clamped, sold out, withdrawn', async () => {
  const list = await items();
  const summary = model.resolveCart(
    [
      { id: 4, quantity: 5, name: '钥匙扣' },
      { id: 5, quantity: 1, name: '立牌' },
      { id: 6, quantity: 2, name: '徽章' },
      { id: 99, quantity: 1, name: '已经下架的' },
    ],
    list,
  );
  assert.deepEqual(summary.entries.map((entry) => entry.kind), ['ok', 'ok', 'sold-out', 'gone']);
  assert.equal(summary.entries[0].quantity, 3, 'clamped to the stock somebody else left');
  assert.equal(summary.entries[0].adjusted, true);
  assert.equal(summary.entries[1].adjusted, false);
  assert.equal(summary.pieces, 4, 'what the checkout buys');
  assert.equal(summary.shown, 7, 'what the badge counts: every line, a clamped one as clamped');
  assert.equal(summary.total, 3 * 8 + 30);
  assert.deepEqual(summary.purchasable.map(({ item, quantity }) => [item.id, quantity]), [[4, 3], [5, 1]]);
  assert.equal(summary.entries[3].line.name, '已经下架的', 'a withdrawn line is shown by the name it was added under');
});

test('an item whose stock the shop did not state is on sale: bought, never clamped, never sold out (G2-023)', async () => {
  const list = await items();
  const unknown = list.find((item) => item.id === 10);
  assert.equal(unknown.stock, null);
  const summary = model.resolveCart([{ id: 10, quantity: 7, name: '库存缺失' }, { id: 6, quantity: 1, name: '徽章' }], list);
  assert.deepEqual(summary.entries.map((entry) => entry.kind), ['ok', 'sold-out'], 'unknown is buyable; a stated 0 is still sold out');
  assert.equal(summary.entries[0].quantity, 7, 'nothing to clamp to');
  assert.equal(summary.entries[0].adjusted, false);
  assert.deepEqual(summary.purchasable.map(({ item, quantity }) => [item.id, quantity]), [[10, 7]]);
  assert.equal(summary.total, 14);
  /* The screen's limit for it is the cart's own ceiling. */
  const item = { id: 10, name: '库存缺失' };
  assert.equal(cart.addToCart('id:1', item, unknown.stock ?? cart.MAX_LINE_QUANTITY), 1);
  cart.setCartQuantity('id:1', 10, cart.MAX_LINE_QUANTITY + 5, unknown.stock ?? cart.MAX_LINE_QUANTITY);
  assert.equal(cart.readCart('id:1')[0].quantity, cart.MAX_LINE_QUANTITY);
});

test('a shortfall is stated before the checkout, and an unknown balance leaves it to the backend', () => {
  assert.equal(model.shortfall(106, 100), 6);
  assert.equal(model.shortfall(80, 100), 0);
  assert.equal(model.shortfall(80, null), 0);
  assert.equal(model.cartPieces([{ id: 1, quantity: 2, name: '' }, { id: 2, quantity: 3, name: '' }]), 5);
});

// --- a checkout, end to end -------------------------------------------------------------------

function signIn(coins = 100) {
  values.set('user_info', JSON.stringify({ id: 1, username: 'a', token: 'tok', coins }));
}

test('a purchase removes its lines, lowers the balance by what was spent, and keeps the rest of the cart', async () => {
  const [keyring, plain] = await items();
  signIn(100);
  cart.addToCart('id:1', { id: 4, name: keyring.name }, 3);
  cart.addToCart('id:1', { id: 4, name: keyring.name }, 3);
  cart.addToCart('id:1', { id: 6, name: '售罄' }, 9);
  respond = () => Response.json({ success: true, message: '购买成功！共花费 16 金币', spent: 16 });
  const outcome = await checkout.runCheckout('tok', 'id:1', [{ item: keyring, quantity: 2 }]);
  assert.deepEqual(outcome, { kind: 'done', message: '购买成功！共花费 16 金币' });
  assert.deepEqual(cart.readCart('id:1').map((line) => line.id), [6], 'the line that was not bought stays');
  assert.equal(JSON.parse(values.get('user_info')).coins, 84, 'the balance the original front end computed');
  assert.equal(calls.length, 1, 'refreshing the reads sends nothing for screens that are not mounted');
  void plain;
});

test('without a number in the answer the total is what was spent, and a balance never goes below zero', async () => {
  const [keyring] = await items();
  signIn(10);
  respond = () => Response.json({ success: true });
  const outcome = await checkout.runCheckout('tok', 'id:1', [{ item: keyring, quantity: 2 }]);
  assert.deepEqual(outcome, { kind: 'done', message: '已购买' });
  assert.equal(JSON.parse(values.get('user_info')).coins, 0);
});

test('a purchase answered after a sign-out changes nobody’s balance', async () => {
  const [keyring] = await items();
  signIn(100);
  respond = () => {
    values.set('user_info', JSON.stringify({ id: 2, username: 'b', token: 'other', coins: 50 }));
    return Response.json({ success: true, spent: 8 });
  };
  await checkout.runCheckout('tok', 'id:1', [{ item: keyring, quantity: 1 }]);
  assert.equal(JSON.parse(values.get('user_info')).coins, 50);
});

test('confirming a checkout after the account changed sends no purchase request, and says so without 结算失败 (G3-022)', async () => {
  const [keyring] = await items();
  values.set('user_info', JSON.stringify({ id: 2, username: 'b', token: 'other', coins: 50 }));
  cart.addToCart('id:1', { id: keyring.id, name: keyring.name }, 3);
  const outcome = await checkout.runCheckout('tok', 'id:1', [{ item: keyring, quantity: 1 }]);
  assert.equal(outcome.kind, 'stale-session', 'not a refusal: the backend never saw it');
  assert.equal(outcome.message, '登录状态已变化，请重新确认购买');
  assert.equal(calls.length, 0);
  assert.equal(cart.readCart('id:1').length, 1);
  assert.equal(JSON.parse(values.get('user_info')).coins, 50);
});

test('a rate-limited checkout is not a verdict: the cart is kept and the sentence says to look first (G3-009)', async () => {
  const [keyring] = await items();
  signIn(100);
  cart.addToCart('id:1', { id: keyring.id, name: keyring.name }, 3);
  respond = () => Response.json({ success: false, error: '请求过于频繁' }, { status: 429 });
  const outcome = await checkout.runCheckout('tok', 'id:1', [{ item: keyring, quantity: 1 }]);
  assert.equal(outcome.kind, 'unknown', 'a limiter may have answered after accepting the charge');
  assert.match(outcome.message, /金币明细/);
  assert.equal(cart.readCart('id:1').length, 1);
  assert.equal(JSON.parse(values.get('user_info')).coins, 100, 'no balance is assumed either way');
});

test('only the backend saying no is a refusal: an envelope or a 4xx, never 408 or 429 or a transport failure', () => {
  const verdicts = [
    [new ApiError('envelope', { serverMessage: '金币不足' }), true],
    [new ApiError('http', { status: 400 }), true],
    [new ApiError('http', { status: 401 }), true],
    [new ApiError('http', { status: 403 }), true],
    [new ApiError('http', { status: 409 }), true],
    [new ApiError('http', { status: 422 }), true],
    [new ApiError('http', { status: 408 }), false],
    [new ApiError('http', { status: 429 }), false],
    [new ApiError('http', { status: 500 }), false],
    [new ApiError('http', { status: 502 }), false],
    [new ApiError('network'), false],
    [new ApiError('timeout'), false],
    [new ApiError('invalid'), false],
    [new TypeError('Failed to fetch'), false],
  ];
  for (const [error, refusal] of verdicts) {
    assert.equal(checkout.isCheckoutRefusal(error), refusal, `${error.kind ?? error.name} ${error.status ?? ''}`);
  }
});

test('a server failure or unreadable checkout response cannot prove that nothing was charged', async () => {
  const [keyring] = await items();
  signIn(100);
  cart.addToCart('id:1', { id: keyring.id, name: keyring.name }, 3);
  for (const response of [
    () => new Response('upstream failed', { status: 502 }),
    () => new Response('request timed out', { status: 408 }),
    () => new Response('<html>broken</html>', { status: 200 }),
    () => Response.json({}),
    () => Response.json({ message: 'response without a success flag', spent: 8 }),
    () => Response.json({ success: 'true', message: 'wrong flag type', spent: 8 }),
  ]) {
    respond = response;
    const outcome = await checkout.runCheckout('tok', 'id:1', [{ item: keyring, quantity: 1 }]);
    assert.equal(outcome.kind, 'unknown');
    assert.match(outcome.message, /金币明细/);
    assert.equal(cart.readCart('id:1').length, 1);
    assert.equal(JSON.parse(values.get('user_info')).coins, 100);
  }
});

test('a refusal keeps the cart and says the backend’s words', async () => {
  const [keyring] = await items();
  signIn(5);
  cart.addToCart('id:1', { id: 4, name: keyring.name }, 3);
  respond = () => Response.json({ success: false, error: '金币不足' });
  assert.deepEqual(await checkout.runCheckout('tok', 'id:1', [{ item: keyring, quantity: 1 }]), { kind: 'refused', message: '金币不足' });
  assert.equal(cart.readCart('id:1').length, 1);
  assert.equal(JSON.parse(values.get('user_info')).coins, 5);
});

test('a lost answer is not a refusal: the cart is kept and the sentence says to look before retrying', async () => {
  const [keyring] = await items();
  signIn(100);
  cart.addToCart('id:1', { id: 4, name: keyring.name }, 3);
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const outcome = await checkout.runCheckout('tok', 'id:1', [{ item: keyring, quantity: 1 }]);
  assert.equal(outcome.kind, 'unknown');
  assert.match(outcome.message, /金币明细/);
  assert.equal(cart.readCart('id:1').length, 1, 'it may not have been charged — nothing is assumed');
  assert.equal(JSON.parse(values.get('user_info')).coins, 100);
});

test('the balance is read from the session only when it carries one', () => {
  assert.equal(checkout.balanceOf({ coins: 12.9 }), 12);
  assert.equal(checkout.balanceOf({ coins: '30' }), 30);
  assert.equal(checkout.balanceOf({ coins: -1 }), null);
  assert.equal(checkout.balanceOf({}), null);
  assert.equal(checkout.balanceOf(null), null);
});


test('a repeated checkout joins the pending purchase and preserves later cart additions', async () => {
  const [item] = await items();
  signIn(100);
  cart.addToCart('id:1', item, 10);
  let release;
  respond = () => new Promise((resolve) => { release = resolve; });
  const first = checkout.runCheckout('tok', 'id:1', [{ item, quantity: 1 }]);
  const second = checkout.runCheckout('tok', 'id:1', [{ item, quantity: 1 }]);
  assert.equal(first, second, 'the account owns the purchase even when its screen remounts');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.length, 1, 'one non-idempotent POST');
  cart.addToCart('id:1', item, 10);
  release(Response.json({ success: true, spent: 8 }));
  assert.equal((await first).kind, 'done');
  assert.equal((await second).kind, 'done');
  assert.equal(cart.readCart('id:1')[0].quantity, 1, 'only the submitted quantity is consumed');
  assert.equal(JSON.parse(values.get('user_info')).coins, 92, 'balance applied once');
});

test('a full cart does not report adding a new product', () => {
  for (let id = 1; id <= 100; id++) assert.equal(cart.addToCart('id:1', { id, name: String(id) }, 5), 1);
  assert.equal(cart.addToCart('id:1', { id: 101, name: 'extra' }, 5), null);
  assert.equal(cart.readCart('id:1').length, 100);
});
