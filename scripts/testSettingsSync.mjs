/**
 * Settings cloud sync (`lib/settingsSync.ts`), with no live service: what a sign-in restores, which
 * copy wins when a local change and a cloud read cross, what a write sends (the whole object, since
 * `update_settings` replaces it), one notice per run of failures, the content filter's gate, the
 * palette's `theme` key, and signing out.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requireTypeStripping } from './tsResolve.mjs';

requireTypeStripping('testSettingsSync');

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
const documentListeners = new Map();
globalThis.window = {
  ...on(listeners), setTimeout, clearTimeout, requestAnimationFrame: (cb) => setTimeout(cb, 0),
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
};
const root = { dataset: {}, classList: { contains: () => false, add() {}, remove() {}, toggle() {} }, style: { setProperty() {} } };
globalThis.document = {
  ...on(documentListeners), visibilityState: 'visible', documentElement: root, cookie: '',
  querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, head: { appendChild() {} }, createElement: () => ({ setAttribute() {} }),
};

const writes = [];
let failNext = 0;
globalThis.fetch = async (url, init = {}) => {
  const target = new URL(String(url), 'https://app.invalid');
  const action = target.searchParams.get('action');
  if (action !== 'update_settings') throw new Error(`unexpected request: ${action}`);
  if (failNext > 0) {
    failNext -= 1;
    throw new TypeError('Failed to fetch');
  }
  writes.push(JSON.parse(init.body).settings);
  return new Response(JSON.stringify({ success: true }), { status: 200 });
};

const sync = await import('../lib/settingsSync.ts');
const appearance = await import('../lib/appearance.ts');
const { LS_KEYS } = await import('../lib/constants.ts');

const notices = [];
sync.setSettingsSyncNotifier((message) => notices.push(message));

/** The account the fake bridge answers with; a test edits it to play another device. */
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
/** Past the write's pause, and the write itself. */
const settle = () => wait(700);

function signIn(user) {
  values.set(LS_KEYS.userInfo, JSON.stringify(user));
  window.dispatchEvent(new Event('user_info_updated'));
}
function signOut() {
  values.delete(LS_KEYS.userInfo);
  window.dispatchEvent(new Event('user_info_updated'));
}

const ACCOUNT = {
  id: 7, token: 'token-a', username: 'pony', birthday: '2000-01-01', email_notif_message: 0, email_notif_reply: 1,
};
const CLOUD = {
  contentFilter: 'spoilers', banAnthro: true, onlyPony: true, useCdn: true, theme: 'rarity',
  showFaves: false, hideIpLocation: true, mascotId: '12', publicFaveFolderIds: [3, 4], defaultFaveFolderName: '主收藏夹',
};

test('signing in restores the account: device values replaced, account values from the copy or the backend default', async () => {
  values.set(LS_KEYS.banAnthro, 'false');
  values.set(LS_KEYS.showUploads, 'false'); // a previous account's choice left on the device
  signIn({ id: 7, token: 'token-a', username: 'pony' });
  serverUser = { ...ACCOUNT, settings: JSON.stringify(CLOUD) };
  sync.adoptCloudSettings('token-a', structuredClone(serverUser), Date.now());
  assert.equal(values.get(LS_KEYS.contentFilter), 'spoilers', 'a 26-year-old account keeps 中等限制');
  assert.equal(values.get(LS_KEYS.banAnthro), 'true');
  assert.equal(values.get(LS_KEYS.useCdn), 'true');
  assert.equal(values.get(LS_KEYS.showFaves), 'false');
  assert.equal(values.get(LS_KEYS.hideIpLocation), 'true');
  assert.equal(values.has(LS_KEYS.showUploads), false, 'an account key the copy lacks is the backend default');
  assert.equal(values.get(LS_KEYS.emailNotifMessage), 'false', 'the email column stands in for a missing key');
  assert.equal(values.get(LS_KEYS.palette), 'rarity', 'the theme is the palette');
  assert.equal(writes.length, 0, 'adopting writes nothing back');
});

test('a write sends the whole object: the copy, the change, and device values the account lacks', async () => {
  sync.changeSyncedSetting('banDiscomfort', false);
  sync.changeSyncedSetting('showTagCounts', true);
  assert.equal(values.get(LS_KEYS.banDiscomfort), 'false', 'stored at once');
  await settle();
  assert.equal(writes.length, 1, 'a run of changes is one request');
  const sent = writes.at(-1);
  assert.equal(sent.banDiscomfort, false);
  assert.equal(sent.showTagCounts, true);
  assert.equal(sent.mascotId, '12', 'a key this app does not manage rides through');
  assert.deepEqual(sent.publicFaveFolderIds, [3, 4]);
  assert.equal(sent.hideIpLocation, true, 'account values ride through unchanged');
  assert.equal(sent.showUploads, undefined, 'an account key is never filled in from the device');
  assert.equal(sent.defaultHomeSort, 'created_at', 'a device key the account lacks is filled in');
  assert.equal(sent.theme, 'rarity');
  assert.deepEqual(sync.settingsSyncSnapshot().pending, {});
});

test('a local change is newer than a read that started before it, even after its write landed', async () => {
  const startedBefore = Date.now() - 1;
  sync.changeSyncedSetting('onlyPony', false);
  await settle();
  assert.equal(writes.at(-1).onlyPony, false);
  /* The slow read comes back with the old value. */
  sync.adoptCloudSettings('token-a', { ...ACCOUNT, settings: { ...CLOUD, onlyPony: true } }, startedBefore);
  assert.equal(values.get(LS_KEYS.onlyPony), 'false');
  /* A read sent after the change speaks for it: another device turned it back on. */
  await wait(2);
  sync.adoptCloudSettings('token-a', { ...ACCOUNT, settings: { ...serverUser.settings, onlyPony: true } }, Date.now());
  assert.equal(values.get(LS_KEYS.onlyPony), 'true');
});

test('a failed write keeps the local value, says so once, and is retried', async () => {
  const before = writes.length;
  failNext = 2;
  sync.changeSyncedSetting('useCdn', false);
  await settle();
  assert.equal(values.get(LS_KEYS.useCdn), 'false');
  assert.equal(sync.settingsSyncSnapshot().state, 'failed');
  assert.deepEqual(notices, [sync.SYNC_FAILED_MESSAGE]);
  assert.ok(sync.settingsSyncSnapshot().pending.useCdn, 'still pending');
  assert.ok(JSON.parse(values.get(LS_KEYS.settingsSyncPending)).pending.useCdn, 'and persisted');
  /* A read while pending cannot undo it. */
  sync.adoptCloudSettings('token-a', { ...ACCOUNT, settings: { ...serverUser.settings, useCdn: true } }, Date.now());
  assert.equal(values.get(LS_KEYS.useCdn), 'false');
  await settle(); // the read scheduled a retry, which fails again
  assert.equal(notices.length, 1, 'one notice per run of failures');
  window.dispatchEvent(new Event('online'));
  await settle();
  assert.equal(writes.length, before + 1);
  assert.equal(writes.at(-1).useCdn, false);
  assert.equal(sync.settingsSyncSnapshot().state, 'idle');
  assert.equal(values.has(LS_KEYS.settingsSyncPending), false);
});

test('a stale copy is read again before it becomes the base of a write', async () => {
  /* Another device changed a key this app does not manage, and a minute has passed. */
  serverUser = { ...serverUser, settings: { ...serverUser.settings, mascotSizeMobile: 'large' } };
  const readsBefore = reads;
  const realNow = Date.now;
  Date.now = () => realNow() + 61_000;
  try {
    sync.changeSyncedSetting('showChineseTags', false);
    await settle();
  } finally {
    Date.now = realNow;
  }
  assert.equal(reads, readsBefore + 1);
  assert.equal(writes.at(-1).mascotSizeMobile, 'large', 'the other device’s change survives our write');
  assert.equal(writes.at(-1).showChineseTags, false);
});

test('the content filter stays inside its gate', async () => {
  sync.adoptCloudSettings('token-a', { ...ACCOUNT, birthday: '2015-06-01', settings: { ...serverUser.settings, contentFilter: 'spoilers' } }, Date.now());
  assert.equal(values.get(LS_KEYS.contentFilter), 'safe', 'too young for 中等限制');
  assert.equal(sync.spoilersBlockedBy({ birthday: '' }), 'no-birthday');
  assert.equal(sync.spoilersBlockedBy(null), 'signed-out');
  assert.equal(sync.ageFrom('2010-02-30'), null, 'not a real date');
  sync.adoptCloudSettings('token-a', { ...ACCOUNT, is_developer: 1, settings: { ...serverUser.settings, contentFilter: 'developer' } }, Date.now());
  assert.equal(values.get(LS_KEYS.developer), 'true', 'developer mode is the backend’s word');
  assert.equal(values.get(LS_KEYS.contentFilter), 'developer');
  sync.adoptCloudSettings('token-a', { ...ACCOUNT, is_developer: 0, settings: { ...serverUser.settings, contentFilter: 'developer' } }, Date.now());
  assert.equal(values.get(LS_KEYS.contentFilter), 'safe');
});

test('the palette travels as the original front end’s theme', async () => {
  sync.adoptCloudSettings('token-a', { ...ACCOUNT, settings: { ...serverUser.settings, theme: 'auto' } }, Date.now());
  assert.equal(values.get(LS_KEYS.palette), 'default', 'auto reads as the default palette');
  sync.changeSyncedSetting('banAnthro', false);
  await settle();
  assert.equal(writes.at(-1).theme, 'auto', 'and is not rewritten while the default is what is chosen');
});

test('a palette picked here is noticed through the appearance store and sent as the theme', async () => {
  appearance.commitPalette('luna'); // what the palette chips' wipe ends in
  assert.ok(sync.settingsSyncSnapshot().pending.palette, 'noticed as a change');
  /* A read that still says the old theme cannot undo it. */
  sync.adoptCloudSettings('token-a', { ...ACCOUNT, settings: { ...serverUser.settings, theme: 'rarity' } }, Date.now());
  assert.equal(values.get(LS_KEYS.palette), 'luna');
  await settle();
  assert.equal(writes.at(-1).theme, 'luna');
  /* The engine's own adoption is not a change. */
  sync.adoptCloudSettings('token-a', { ...ACCOUNT, settings: { ...serverUser.settings, theme: 'pinkie' } }, Date.now() + 1);
  assert.equal(values.get(LS_KEYS.palette), 'pinkie');
  assert.equal(sync.settingsSyncSnapshot().pending.palette, undefined);
});

test('a record without settings is no base: nothing is written over it', async () => {
  const before = writes.length;
  signIn({ id: 8, token: 'token-b', username: 'zebra' });
  sync.adoptCloudSettings('token-b', { id: 8, token: 'token-b', username: 'zebra', birthday: '' }, Date.now());
  serverUser = { id: 8, username: 'zebra', birthday: '' };
  sync.changeSyncedSetting('banAnthro', true);
  await settle();
  assert.equal(writes.length, before, 'no write without a copy to lay the change over');
  assert.equal(sync.settingsSyncSnapshot().state, 'failed');
});

test('signing out drops unconfirmed changes and returns account settings to their defaults', async () => {
  values.set(LS_KEYS.contentFilter, 'spoilers');
  values.set(LS_KEYS.showFaves, 'false');
  signOut();
  assert.equal(values.has(LS_KEYS.showFaves), false);
  assert.equal(values.get(LS_KEYS.contentFilter), 'safe', 'signed out, 中等限制 is not available');
  assert.equal(values.has(LS_KEYS.settingsSyncPending), false);
  assert.equal(values.get(LS_KEYS.banAnthro), 'true', 'a device value survives signing out');
  const before = writes.length;
  sync.changeSyncedSetting('onlyPony', true);
  await settle();
  assert.equal(writes.length, before, 'signed out, a change stays on the device');
});

test('signing out ends developer mode, and the developer filter returns to 完全安全', async () => {
  signIn({ ...ACCOUNT, id: 9, token: 'token-dev', username: 'dev' });
  sync.adoptCloudSettings('token-dev', {
    ...ACCOUNT, id: 9, token: 'token-dev', username: 'dev', is_developer: 1, settings: { contentFilter: 'developer' },
  }, Date.now());
  assert.equal(values.get(LS_KEYS.developer), 'true');
  assert.equal(values.get(LS_KEYS.contentFilter), 'developer', 'signed in as a developer, the filter is theirs');
  signOut();
  /* The owner's report: the developer filter chosen while signed in was still on after signing out. */
  assert.equal(values.has(LS_KEYS.developer), false, 'developer mode is the account’s, not the device’s');
  assert.equal(values.get(LS_KEYS.contentFilter), 'safe', 'signed out, the developer filter is not available');
});


test('an old account custom palette cannot install after a different account adopts its theme', async () => {
  signOut();
  signIn(ACCOUNT);
  sync.adoptCloudSettings(ACCOUNT.token, { ...ACCOUNT, settings: { theme: 'custom', themeCustomSeed: '#aa3355' } }, Date.now() + 1);
  const next = { ...ACCOUNT, id: 88, token: 'palette-next', settings: { theme: 'luna' } };
  signIn(next);
  sync.adoptCloudSettings(next.token, next, Date.now() + 1);
  await wait(50);
  assert.equal(appearance.currentPalette(), 'luna');
  signOut();
});

test('a finishing old-account write releases the new account pending settings', async () => {
  signOut();
  const fetchBefore = globalThis.fetch;
  const sent = [];
  let release;
  globalThis.fetch = async (_url, init) => {
    const token = new Headers(init.headers).get('authorization');
    sent.push(token);
    if (token === 'Bearer token-a') return new Promise((resolve) => { release = resolve; });
    return Response.json({ success: true });
  };
  try {
    signIn(ACCOUNT);
    serverUser = { ...ACCOUNT, settings: { showFaves: true } };
    sync.adoptCloudSettings(ACCOUNT.token, serverUser, Date.now() + 1);
    sync.changeSyncedSetting('showFaves', false);
    await settle();
    assert.equal(typeof release, 'function');
    const next = { ...ACCOUNT, id: 88, token: 'flush-next', settings: { showFaves: true } };
    signIn(next); serverUser = next;
    sync.adoptCloudSettings(next.token, next, Date.now() + 1);
    sync.changeSyncedSetting('showFaves', false);
    release(Response.json({ success: true }));
    await settle();
    assert.deepEqual(sent, ['Bearer token-a', 'Bearer flush-next']);
    assert.equal(values.has(LS_KEYS.settingsSyncPending), false, 'new-account changes were acknowledged');
  } finally { signOut(); globalThis.fetch = fetchBefore; }
});
