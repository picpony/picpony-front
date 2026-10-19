import assert from 'node:assert/strict';
import test from 'node:test';
import { requireTypeStripping } from './tsResolve.mjs';
requireTypeStripping('testAssistantRecovery');
const { createActionRunner, UncertainAction } = await import('../lib/assistant/runner.ts');
const { createReceiptJournal, parseExchange, parsePendingChat } = await import('../lib/assistant/journal.ts');
const { assistantHref, actionIsWrite, actionLabel, requireIds, validateSiteSpec } = await import('../lib/assistant/actions.ts');
const { receiptData } = await import('../lib/assistant/protocol.ts');
const { approvalFor, approvedAction, parseApprovals, taskRejected } = await import('../lib/assistant/approval.ts');
/** Task ids are the backend's turn UUIDs. */
const T = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function storageFixture() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
const action = () => ({ name: 'call_site_api', arguments: { endpoint: 'claim_task', parameters: { task_type: 'login' } }, call_id: 'call-1', risk: 'read', approval_granted: false });
function fixture() {
  const storage = storageFixture();
  const journal = createReceiptJournal(storage, '1');
  const counts = { claim: 0, dispatch: 0, save: 0 };
  let current = true;
  const deps = {
    assertCurrent() { if (!current) throw new Error('账号已切换'); },
    permission: async () => 'default',
    claim: async () => { counts.claim++; return { success: true, request: { endpoint: 'claim_task', method: 'POST', body: { task_type: 'login' } } }; },
    save: async receipt => { counts.save++; return { success: true, result: receipt }; },
    dispatch: async () => { counts.dispatch++; return { ok: true, summary: '已领取', data: { coins: 1 } }; },
    journal, failure: error => error.message, definitive: error => error.definitive === true,
  };
  return { deps, counts, storage, journal, runner: createActionRunner(deps), switchAccount: () => { current = false; } };
}
test('server/model read risk cannot downgrade a known write; default permission requires confirmation', async () => {
  const f = fixture();
  assert.equal(actionIsWrite(action()), true);
  const result = await f.runner.run(action(), T(10));
  assert.equal(result.error, 'confirmation_required');
  assert.deepEqual(f.counts, { claim: 0, dispatch: 0, save: 0 });
});
test('concurrent calls, retry and a new runner after reload dispatch a confirmed operation once', async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.runner.run(action(), T(10), true), f.runner.run(action(), T(10), true)]);
  assert.deepEqual(a, b);
  await createActionRunner(f.deps).run(action(), T(10), true);
  assert.equal(f.counts.dispatch, 1);
  assert.equal(f.counts.claim, 1);
});
test('ambiguous write leaves a durable intent and a pending claim never replays it after reload', async () => {
  const f = fixture();
  f.deps.dispatch = async () => { f.counts.dispatch++; throw new TypeError('response lost'); };
  await assert.rejects(f.runner.run(action(), T(10), true), UncertainAction);
  assert.equal(f.journal.get(T(10), 'call-1').state, 'started');
  f.deps.claim = async () => ({ success: true, pending: true });
  await assert.rejects(createActionRunner(f.deps).run(action(), T(10), true), UncertainAction);
  assert.equal(f.counts.dispatch, 1);
});
test('lost receipt acknowledgement retries only the stored receipt, never the business action', async () => {
  const f = fixture();
  f.deps.save = async receipt => { f.counts.save++; return f.counts.save === 1 ? {} : { success: true, result: receipt }; };
  await assert.rejects(f.runner.run(action(), T(10), true), UncertainAction);
  assert.equal(f.journal.get(T(10), 'call-1').state, 'receipt');
  const recovered = await createActionRunner(f.deps).run(action(), T(10), true);
  assert.equal(recovered.ok, true);
  assert.equal(f.counts.dispatch, 1);
  assert.equal(f.counts.save, 2);
});
test('account switch while a claim is pending prevents dispatch; account journals are separate', async () => {
  const f = fixture();
  f.deps.claim = async () => { f.switchAccount(); return { success: true, request: { endpoint: 'claim_task', method: 'POST' } }; };
  await assert.rejects(f.runner.run(action(), T(10), true), /账号已切换/);
  assert.equal(f.counts.dispatch, 0);
  const other = createReceiptJournal(f.storage, '2');
  f.journal.start(T(77), 'old-call');
  assert.equal(other.get(T(77), 'old-call'), undefined);
});
test('server cached receipts are identity checked and never dispatch again', async () => {
  const f = fixture();
  /* `api_claim` answers a completed call with the stored tool result; its `data` is the receipt this client sent. */
  f.deps.claim = async () => ({ success: true, cached: true, result: { name: 'call_site_api', call_id: 'model-call', ok: true, summary: '已领取', data: { task_id: T(10), call_id: 'call-1', data: {} } } });
  assert.equal((await f.runner.run(action(), T(10), true)).ok, true);
  assert.equal(f.counts.dispatch, 0);
  f.deps.claim = async () => ({ success: true, cached: true, result: { ok: true, data: { task_id: T(999), call_id: 'call-2' } } });
  await assert.rejects(f.runner.run({ ...action(), call_id: 'call-2' }, T(11), true), UncertainAction);
});
test('unsupported endpoints and manual credentials are rejected before dispatch', async () => {
  const f = fixture();
  const dangerous = { ...action(), arguments: { endpoint: 'admin_delete_user' } };
  f.deps.claim = async () => ({ success: true, request: { endpoint: 'admin_delete_user', method: 'POST', body: { user_id: 2 } } });
  assert.equal((await f.runner.run(dangerous, T(10), true)).error, 'unsupported_action');
  assert.equal(f.counts.dispatch, 0);
  assert.throws(() => validateSiteSpec(action(), { endpoint: 'claim_task', method: 'POST', body: { token: 'not-current' } }));
});
test('an explicit refusal produces a failed receipt, without an uncertain/repeated mutation', async () => {
  const f = fixture();
  f.deps.dispatch = async () => { f.counts.dispatch++; throw Object.assign(new Error('领取被拒绝'), { definitive: true }); };
  const r = await f.runner.run(action(), T(10), true);
  assert.equal(r.ok, false);
  await f.runner.run(action(), T(10), true);
  assert.equal(f.counts.dispatch, 1);
});
test('full permission needs server approval; revoked default permission does not dispatch', async () => {
  const f = fixture();
  f.deps.permission = async () => 'full';
  assert.equal((await f.runner.run(action(), T(10))).error, 'confirmation_required');
  f.deps.permission = async () => 'default';
  assert.equal((await f.runner.run({ ...action(), approval_granted: true }, T(10))).error, 'confirmation_required');
  assert.equal(f.counts.dispatch, 0);
});
test('route allowlist, bounded drafts and redaction preserve the account boundary', () => {
  for (const href of ['javascript:alert(1)', 'https://example.test', '//evil.test', '/api.php?action=anything', '/admin', '/favorites/privacy/secret', '/\\evil.test']) assert.equal(assistantHref(href), null);
  assert.equal(assistantHref('/pic/123'), '/pic/123');
  assert.equal(assistantHref('/settings?tab=account'), '/settings?tab=account');
  assert.equal(parsePendingChat(JSON.stringify({ requestId: 'id', message: 'x'.repeat(2001) })), null);
  assert.equal(parseExchange(JSON.stringify({ requestId: 'stable-id', coins: 3, pointsPerCoin: 2 })), null, 'A journal without the revisions it was sent against cannot be replayed');
  assert.deepEqual(parseExchange(JSON.stringify({ requestId: 'stable-id', coins: 3, revision: 4, configRevision: 1, pointsPerCoin: 2 })), { requestId: 'stable-id', coins: 3, revision: 4, configRevision: 1, pointsPerCoin: 2 });
  assert.deepEqual(receiptData({ username: 'name', email: 'private', token: 'private', data: { password: 'private', coins: 34 } }), { username: 'name', data: { coins: 34 } });
});
test('human approval survives an interrupted confirmation but binds exact arguments and call identity', () => {
  const original = action();
  const approvals = parseApprovals(JSON.stringify([approvalFor(T(17), [original])]));
  assert.equal(approvedAction(approvals, T(17), original), true);
  assert.equal(approvedAction(approvals, T(18), original), false);
  assert.equal(approvedAction(approvals, T(17), { ...original, call_id: 'new-call' }), false);
  assert.equal(approvedAction(approvals, T(17), { ...original, arguments: { endpoint: 'claim_task', parameters: { task_type: 'other' } } }), false);
  assert.equal(approvedAction(parseApprovals('[17]'), T(17), original), false, 'Old bare IDs grant no new authority');
});
test('an explicit local rejection remains a rejection across a lost reply and reload', () => {
  const approvals = parseApprovals(JSON.stringify([approvalFor(T(17), [action()], 'reject')]));
  assert.equal(taskRejected(approvals, T(17)), true);
  assert.equal(approvedAction(approvals, T(17), action()), false);
});
test('a claimed request cannot substitute a different reviewed recipient or message', () => {
  const request = { ...action(), arguments: { endpoint: 'send_message', parameters: { receiver_id: 3, content: '已核对的文字' } } };
  assert.throws(() => validateSiteSpec(request, { endpoint: 'send_message', method: 'POST', body: { receiver_id: 4, content: '已核对的文字' } }));
  assert.throws(() => validateSiteSpec(request, { endpoint: 'send_message', method: 'POST', body: { receiver_id: 3, content: '不同文字' } }));
  assert.equal(validateSiteSpec(request, { endpoint: 'send_message', method: 'POST', body: { receiver_id: '3', content: '已核对的文字' } }).endpoint, 'send_message');
});
test('receipt retention is bounded and preserves unresolved intents while pruning acknowledged records', () => {
  const storage = storageFixture(), journal = createReceiptJournal(storage, '1');
  journal.start(T(1), 'pending');
  for (let id = 2; id < 180; id++) {
    journal.save({ task_id: T(id), call_id: 'done', name: 'call_site_api', action: 'call_site_api', ok: true, summary: '已完成', data: {} });
    journal.acknowledge(T(id), 'done');
  }
  assert.equal(journal.get(T(1), 'pending').state, 'started');
  assert.equal(journal.get(T(179), 'done').acknowledged, true);
  assert.equal(journal.get(T(2), 'done'), undefined);
});

test('a confirmation names every destructive target accepted by dispatch', () => {
  const folderIds = Array.from({ length: 200 }, (_, i) => i + 1);
  const label = actionLabel({ ...action(), arguments: { endpoint: 'delete_fave_folders', parameters: { folder_ids: folderIds } } });
  assert.deepEqual(label.slice(label.indexOf('\uff1a') + 1).split('\u3001').map(Number), requireIds(folderIds));
});

/* --- Issued client calls (`state` / turn `client_calls`, `assistant_actions::issued_calls`) --- */
const { clientCallAction, parseState } = await import('../lib/assistant/protocol.ts');
const { CLIENT_CALLS } = await import('../lib/assistant/runner.ts');
const issued = (fields = {}) => ({
  id: '11111111-2222-4333-8444-555555555555', task_id: T(30), operation: 'get_page_controls', arguments: {},
  request: { observe: true }, risk: 'read', created_at: '2026-10-18T14:00:00Z', ...fields,
});

test('an issued client call becomes an action; only a server-issued write_confirm carries approval', () => {
  assert.deepEqual(clientCallAction(issued()), { name: 'get_page_controls', arguments: {}, call_id: issued().id, risk: 'read', approval_granted: false });
  const write = clientCallAction(issued({ operation: 'call_site_api', arguments: { endpoint: 'send_message', parameters: { receiver_id: 2, content: 'hi' } }, risk: 'write_confirm' }));
  assert.equal(write.approval_granted, true, 'the server issues a write_confirm call only after a confirmation or under a current full grant');
  assert.deepEqual(CLIENT_CALLS, ['call_site_api', 'get_page_controls', 'interact_page'], 'assistant_runner::CLIENT_TOOLS');
  const state = parseState({ messages: [], tasks: [{ id: T(30), status: 'running' }], client_calls: [issued()] });
  assert.deepEqual(state.client_calls, [issued()], '`state {}` carries the conversation\'s issued calls at the top level');
});

test('get_page_controls is claimed and receipted like every other issued call', async () => {
  const f = fixture();
  const claims = [];
  f.deps.claim = async (task, call) => { claims.push([task, call]); f.counts.claim++; return { success: true, request: { observe: true } }; };
  f.deps.dispatch = async (_action, claim) => { f.counts.dispatch++; assert.deepEqual(claim.request, { observe: true }); return { ok: true, summary: '已读取当前可用的页面入口', data: {} }; };
  const action = clientCallAction(issued());
  const result = await f.runner.run(action, T(30), action.approval_granted);
  assert.equal(result.ok, true);
  assert.deepEqual(claims, [[T(30), issued().id]]);
  assert.deepEqual(f.counts, { claim: 1, dispatch: 1, save: 1 });
  /* Polled again before the next state read: the journal answers, nothing runs twice. */
  await createActionRunner(f.deps).run(action, T(30));
  assert.equal(f.counts.dispatch, 1);
});

test('interact_page reads its control from the claim\'s request ({control: the model\'s arguments})', async () => {
  const values = new Map();
  globalThis.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)), removeItem: k => values.delete(k) };
  globalThis.window = { location: { pathname: '/', search: '' }, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; }, setTimeout, clearTimeout };
  globalThis.document ??= { cookie: '', visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  const { writeUserInfo } = await import('../lib/hooks.ts');
  const { dispatchAssistantAction } = await import('../lib/assistant/siteActions.ts');
  writeUserInfo({ token: 'tok', csrfToken: 'c' });
  const control = { control_id: 'nav.tasks', action: 'click', page_instance: 'p_1' };
  const action = { name: 'interact_page', arguments: control, call_id: issued().id, risk: 'read', approval_granted: false };
  const opened = await dispatchAssistantAction('tok', 'p_1', action, { success: true, request: { control } });
  assert.equal(opened.ok, true);
  assert.equal(opened.defer_navigation, '/tasks');
  const stale = await dispatchAssistantAction('tok', 'p_1', action, { success: true, control });
  assert.equal(stale.ok, false, 'a control outside `request` is not the server\'s envelope');
  const otherPage = await dispatchAssistantAction('tok', 'p_2', action, { success: true, request: { control } });
  assert.equal(otherPage.error, 'manual_control');
});
