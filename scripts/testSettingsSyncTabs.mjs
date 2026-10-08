/**
 * Settings sync across tabs of one browser, and across the moment an account's name settles
 * (review P2-F1, P2-F2). Every tab shares one `localStorage`: the values, and the record of
 * changes the account has not confirmed. This suite plays "this tab" with the real engine and
 * "the other tab" by writing that shared storage and delivering the `storage` events a browser
 * would.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requireTypeStripping } from './tsResolve.mjs';

requireTypeStripping('testSettingsSyncTabs');

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => (values.has(key) ? values.get(key) : null),
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};
const listeners = new Map();
const on = (target) => ({
  addEventListener(type, listener) {
    if (!target.has(type)) target.set(type, new Set());
    target.get(type).add(listener);
  },
  removeEventListener(type, listener) { target.get(type)?.delete(listener); },
  dispatchEvent(event) {
    for (const listener of [...(target.get(event.type) ?? [])]) listener(event);
    return true;
  },
});
globalThis.window = {
  ...on(listeners), setTimeout, clearTimeout, requestAnimationFrame: (cb) => setTimeout(cb, 0),
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
};
const root = { dataset: {}, classList: { contains: () => false, add() {}, remove() {}, toggle() {} }, style: { setProperty() {} } };
globalThis.document = {
  ...on(new Map()), visibilityState: 'visible', documentElement: root, cookie: '',
  querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, head: { appendChild() {} }, createElement: () => ({ setAttribute() {} }),
};

const writes = [];
let failWrites = false;
globalThis.fetch = async (url, init = {}) => {
  const action = new URL(String(url), 'https://app.invalid').searchParams.get('action');
  if (action !== 'update_settings') throw new Error(`unexpected request: ${action}`);
  if (failWrites) return new Response('upstream down', { status: 503 });
  writes.push(JSON.parse(init.body).settings);
  return new Response(JSON.stringify({ success: true }), { status: 200 });
};

const sync = await import('../lib/settingsSync.ts');
const { LS_KEYS } = await import('../lib/constants.ts');
sync.setSettingsSyncNotifier(() => {});

let serverUser = null;
let reads = 0;
sync.bindSettingsSync({
  refreshSession: async (token) => {
    reads += 1;
    const startedAt = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 5));
    sync.adoptCloudSettings(token, structuredClone(serverUser), startedAt);
  },
  writeSession: (_token, settings) => { serverUser = { ...serverUser, settings: structuredClone(settings) }; },
  afterBrowsingChange: () => {},
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = () => wait(700);

/** What the other tab does to shared storage, with the event this tab would receive. */
function otherTabWrites(key, value) {
  const oldValue = values.has(key) ? values.get(key) : null;
  if (value === null) values.delete(key);
  else values.set(key, value);
  window.dispatchEvent({ type: 'storage', key, oldValue, newValue: value });
}
const pendingRecord = (account, pending) => JSON.stringify({ account, pending });

const ACCOUNT = { id: 7, token: 'token-a', username: 'pony', birthday: '2000-01-01' };

test('setup: signed in, the account copy adopted', () => {
  values.set(LS_KEYS.userInfo, JSON.stringify(ACCOUNT));
  window.dispatchEvent(new Event('user_info_updated'));
  serverUser = { ...ACCOUNT, settings: { onlyPony: false, banAnthro: false, showTagCounts: false, mascotId: '3' } };
  sync.adoptCloudSettings(ACCOUNT.token, structuredClone(serverUser), Date.now());
  assert.deepEqual(sync.settingsSyncSnapshot().base, serverUser.settings);
});

test("this tab's change keeps the other tab's unconfirmed change in the shared record and in the write", async () => {
  /* The other tab turns 只看小马 on; its write has not landed. */
  otherTabWrites(LS_KEYS.onlyPony, 'true');
  otherTabWrites(LS_KEYS.settingsSyncPending, pendingRecord('7', { onlyPony: Date.now() }));
  /* Meanwhile an account read here (a tab coming back into view) answers with the old copy. */
  sync.adoptCloudSettings(ACCOUNT.token, structuredClone(serverUser), Date.now() + 1);
  assert.equal(values.get(LS_KEYS.onlyPony), 'true', "an unconfirmed change in another tab is not adopted over");
  /* This tab changes something else. */
  sync.changeSyncedSetting('banAnthro', true);
  const record = JSON.parse(values.get(LS_KEYS.settingsSyncPending));
  assert.ok(record.pending.onlyPony, "the other tab's entry survives this tab persisting its own");
  assert.ok(record.pending.banAnthro);
  await settle();
  const sent = writes.at(-1);
  assert.equal(sent.banAnthro, true);
  assert.equal(sent.onlyPony, true, "the write carries the other tab's change, not the cloud's old copy");
  assert.equal(sent.mascotId, '3');
  assert.equal(values.has(LS_KEYS.settingsSyncPending), false, 'both entries were confirmed by that write');
});

test("a confirmed change from the other tab is not reverted by this tab's stale copy or slow read", async () => {
  /* The other tab turns 显示标签数 on and its write lands (the account now says true). */
  const readStartedBefore = Date.now() - 1;
  otherTabWrites(LS_KEYS.showTagCounts, 'true');
  otherTabWrites(LS_KEYS.settingsSyncPending, pendingRecord('7', { showTagCounts: Date.now() }));
  serverUser = { ...serverUser, settings: { ...serverUser.settings, showTagCounts: true } };
  otherTabWrites(LS_KEYS.settingsSyncPending, null);
  /* A read this tab sent before all that answers now, with the old value. */
  sync.adoptCloudSettings(ACCOUNT.token, { ...ACCOUNT, settings: { ...serverUser.settings, showTagCounts: false } }, readStartedBefore);
  assert.equal(values.get(LS_KEYS.showTagCounts), 'true', 'a read older than the other tab’s change cannot speak for it');
  /* This tab's next write must not lay its own (older) cloud copy over the other tab's write. */
  const readsBefore = reads;
  sync.changeSyncedSetting('onlyPony', false);
  await settle();
  assert.equal(reads, readsBefore + 1, 'the copy is read again first');
  assert.equal(writes.at(-1).showTagCounts, true);
  assert.equal(writes.at(-1).onlyPony, false);
});

test("an unconfirmed change survives the account's name settling from username to id", async () => {
  /* A fresh sign-in: the response carries no id, so the account is known by its username. */
  values.delete(LS_KEYS.userInfo);
  window.dispatchEvent(new Event('user_info_updated'));
  const fresh = { token: 'token-b', username: 'zebra' };
  values.set(LS_KEYS.userInfo, JSON.stringify(fresh));
  window.dispatchEvent(new Event('user_info_updated'));
  assert.equal(sync.settingsSyncSnapshot().account, 'zebra');
  /* A change made before any account read: nothing to write over yet, so it stays pending. */
  sync.changeSyncedSetting('banAnthro', false);
  /* `get_user` lands and the shell merges the id into the stored session. */
  values.set(LS_KEYS.userInfo, JSON.stringify({ ...fresh, id: 12 }));
  window.dispatchEvent(new Event('user_info_updated'));
  assert.equal(sync.settingsSyncSnapshot().account, '12');
  const record = JSON.parse(values.get(LS_KEYS.settingsSyncPending));
  assert.equal(record.account, '12', 'the record follows the settled name');
  assert.ok(record.pending.banAnthro, 'and keeps the change — a reload, keyed by id, finds it');
  await settle();
});

test('P2-F11: turning developer mode off takes the developer filter with it at once', async () => {
  const { readFileSync } = await import('node:fs');
  const dev = { id: 21, token: 'token-dev', username: 'dev', birthday: '2000-01-01', is_developer: 1 };
  values.set(LS_KEYS.userInfo, JSON.stringify(dev));
  window.dispatchEvent(new Event('user_info_updated'));
  sync.adoptCloudSettings(dev.token, { ...dev, settings: { contentFilter: 'developer' } }, Date.now());
  assert.equal(values.get(LS_KEYS.contentFilter), 'developer');
  /* What DeveloperGuideModal does on an accepted 关闭: the device flag goes, then the gate. */
  values.delete(LS_KEYS.developer);
  sync.enforceContentGate();
  assert.equal(values.get(LS_KEYS.contentFilter), 'safe');
  const modal = readFileSync(new URL('../components/DeveloperGuideModal.tsx', import.meta.url), 'utf8');
  assert.match(modal, /if \(!enabled\) enforceContentGate\(\);/);
  await settle();
});

test('review P5-F1: a change another tab confirmed ends this tab\'s failed state, and is not re-sent', async () => {
  /* Signed in afresh, with a copy of the account in hand. */
  const user = { id: 31, token: 'token-p5', username: 'p5', birthday: '2000-01-01' };
  values.set(LS_KEYS.userInfo, JSON.stringify(user));
  window.dispatchEvent(new Event('user_info_updated'));
  serverUser = { ...user, settings: { onlyPony: false } };
  sync.adoptCloudSettings(user.token, structuredClone(serverUser), Date.now());
  /* This tab's write fails: the change stays pending and the screen says so. */
  failWrites = true;
  sync.changeSyncedSetting('onlyPony', true);
  await settle();
  assert.equal(sync.settingsSyncSnapshot().state, 'failed');
  const record = values.get(LS_KEYS.settingsSyncPending);
  const at = JSON.parse(record).pending.onlyPony;
  assert.ok(at, 'the change is in the shared record');
  failWrites = false;
  /* The other tab's write carries it (the stored value) and drops it from the shared record. */
  const sentBefore = writes.length;
  otherTabWrites(LS_KEYS.settingsSyncPending, null);
  assert.equal(sync.settingsSyncSnapshot().state, 'idle', 'the banner goes with the confirmation');
  assert.deepEqual(sync.settingsSyncSnapshot().pending, {});
  await wait(50);
  assert.equal(writes.length, sentBefore, 'nothing is re-sent');
  /* A later change here does not put the confirmed entry back into the shared record. */
  sync.changeSyncedSetting('banAnthro', true);
  assert.deepEqual(Object.keys(JSON.parse(values.get(LS_KEYS.settingsSyncPending)).pending), ['banAnthro']);
  await settle();
});

test('review P5-F1: an entry the other tab re-keyed or replaced with a newer change is kept', async () => {
  failWrites = true;
  sync.changeSyncedSetting('showChineseTags', false);
  await settle();
  assert.equal(sync.settingsSyncSnapshot().state, 'failed');
  const mine = JSON.parse(values.get(LS_KEYS.settingsSyncPending)).pending.showChineseTags;
  /* Another account's record (a sign-in elsewhere being written) says nothing about this one. */
  otherTabWrites(LS_KEYS.settingsSyncPending, pendingRecord('someone-else', { onlyPony: Date.now() }));
  assert.ok(sync.settingsSyncSnapshot().pending.showChineseTags, 'kept across a foreign record');
  /* An older timestamp leaving the record does not cover this tab's newer change. */
  otherTabWrites(LS_KEYS.settingsSyncPending, pendingRecord('31', { showChineseTags: mine - 1000 }));
  otherTabWrites(LS_KEYS.settingsSyncPending, null);
  assert.ok(sync.settingsSyncSnapshot().pending.showChineseTags, 'an older confirmation does not cover a newer change');
  assert.equal(sync.settingsSyncSnapshot().state, 'failed');
  failWrites = false;
  sync.retrySettingsSync();
  await settle();
  assert.equal(sync.settingsSyncSnapshot().state, 'idle');
  assert.equal(writes.at(-1).showChineseTags, false);
});
