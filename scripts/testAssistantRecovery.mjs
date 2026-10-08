import assert from 'node:assert/strict';
import test from 'node:test';
import { requireTypeStripping } from './tsResolve.mjs';
requireTypeStripping('testAssistantRecovery');
const { createActionRunner, UncertainAction } = await import('../lib/assistant/runner.ts');
const { createReceiptJournal, parseExchange, parsePendingChat } = await import('../lib/assistant/journal.ts');
const { assistantHref, actionIsWrite, actionLabel, requireIds, validateSiteSpec } = await import('../lib/assistant/actions.ts');
const { receiptData } = await import('../lib/assistant/protocol.ts');
const { approvalFor, approvedAction, parseApprovals, taskRejected } = await import('../lib/assistant/approval.ts');

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
  const result = await f.runner.run(action(), 10);
  assert.equal(result.error, 'confirmation_required');
  assert.deepEqual(f.counts, { claim: 0, dispatch: 0, save: 0 });
});
test('concurrent calls, retry and a new runner after reload dispatch a confirmed operation once', async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.runner.run(action(), 10, true), f.runner.run(action(), 10, true)]);
  assert.deepEqual(a, b);
  await createActionRunner(f.deps).run(action(), 10, true);
  assert.equal(f.counts.dispatch, 1);
  assert.equal(f.counts.claim, 1);
});
test('ambiguous write leaves a durable intent and a pending claim never replays it after reload', async () => {
  const f = fixture();
  f.deps.dispatch = async () => { f.counts.dispatch++; throw new TypeError('response lost'); };
  await assert.rejects(f.runner.run(action(), 10, true), UncertainAction);
  assert.equal(f.journal.get(10, 'call-1').state, 'started');
  f.deps.claim = async () => ({ success: true, pending: true });
  await assert.rejects(createActionRunner(f.deps).run(action(), 10, true), UncertainAction);
  assert.equal(f.counts.dispatch, 1);
});
test('lost receipt acknowledgement retries only the stored receipt, never the business action', async () => {
  const f = fixture();
  f.deps.save = async receipt => { f.counts.save++; return f.counts.save === 1 ? {} : { success: true, result: receipt }; };
  await assert.rejects(f.runner.run(action(), 10, true), UncertainAction);
  assert.equal(f.journal.get(10, 'call-1').state, 'receipt');
  const recovered = await createActionRunner(f.deps).run(action(), 10, true);
  assert.equal(recovered.ok, true);
  assert.equal(f.counts.dispatch, 1);
  assert.equal(f.counts.save, 2);
});
test('account switch while a claim is pending prevents dispatch; account journals are separate', async () => {
  const f = fixture();
  f.deps.claim = async () => { f.switchAccount(); return { success: true, request: { endpoint: 'claim_task', method: 'POST' } }; };
  await assert.rejects(f.runner.run(action(), 10, true), /账号已切换/);
  assert.equal(f.counts.dispatch, 0);
  const other = createReceiptJournal(f.storage, '2');
  f.journal.start(77, 'old-call');
  assert.equal(other.get(77, 'old-call'), undefined);
});
test('server cached receipts are identity checked and never dispatch again', async () => {
  const f = fixture();
  f.deps.claim = async () => ({ success: true, cached: true, result: { task_id: 10, call_id: 'call-1', ok: true, summary: '已领取', data: {} } });
  assert.equal((await f.runner.run(action(), 10, true)).ok, true);
  assert.equal(f.counts.dispatch, 0);
  f.deps.claim = async () => ({ success: true, cached: true, result: { task_id: 999, call_id: 'call-2', ok: true } });
  await assert.rejects(f.runner.run({ ...action(), call_id: 'call-2' }, 11, true), UncertainAction);
});
test('unsupported endpoints and manual credentials are rejected before dispatch', async () => {
  const f = fixture();
  const dangerous = { ...action(), arguments: { endpoint: 'admin_delete_user' } };
  f.deps.claim = async () => ({ success: true, request: { endpoint: 'admin_delete_user', method: 'POST', body: { user_id: 2 } } });
  assert.equal((await f.runner.run(dangerous, 10, true)).error, 'unsupported_action');
  assert.equal(f.counts.dispatch, 0);
  assert.throws(() => validateSiteSpec(action(), { endpoint: 'claim_task', method: 'POST', body: { token: 'not-current' } }));
});
test('an explicit refusal produces a failed receipt, without an uncertain/repeated mutation', async () => {
  const f = fixture();
  f.deps.dispatch = async () => { f.counts.dispatch++; throw Object.assign(new Error('领取被拒绝'), { definitive: true }); };
  const r = await f.runner.run(action(), 10, true);
  assert.equal(r.ok, false);
  await f.runner.run(action(), 10, true);
  assert.equal(f.counts.dispatch, 1);
});
test('full permission needs server approval; revoked default permission does not dispatch', async () => {
  const f = fixture();
  f.deps.permission = async () => 'full';
  assert.equal((await f.runner.run(action(), 10)).error, 'confirmation_required');
  f.deps.permission = async () => 'default';
  assert.equal((await f.runner.run({ ...action(), approval_granted: true }, 10)).error, 'confirmation_required');
  assert.equal(f.counts.dispatch, 0);
});
test('route allowlist, bounded drafts and redaction preserve the account boundary', () => {
  for (const href of ['javascript:alert(1)', 'https://example.test', '//evil.test', '/api.php?action=anything', '/admin', '/favorites/privacy/secret', '/\\evil.test']) assert.equal(assistantHref(href), null);
  assert.equal(assistantHref('/pic/123'), '/pic/123');
  assert.equal(assistantHref('/settings?tab=account'), '/settings?tab=account');
  assert.equal(parsePendingChat(JSON.stringify({ requestId: 'id', message: 'x'.repeat(4001) })), null);
  assert.deepEqual(parseExchange(JSON.stringify({ requestId: 'stable-id', coins: 3, pointsPerCoin: 2 })), { requestId: 'stable-id', coins: 3, pointsPerCoin: 2 });
  assert.deepEqual(receiptData({ username: 'name', email: 'private', token: 'private', data: { password: 'private', coins: 34 } }), { username: 'name', data: { coins: 34 } });
});
test('human approval survives an interrupted confirmation but binds exact arguments and call identity', () => {
  const original = action();
  const approvals = parseApprovals(JSON.stringify([approvalFor(17, [original])]));
  assert.equal(approvedAction(approvals, 17, original), true);
  assert.equal(approvedAction(approvals, 18, original), false);
  assert.equal(approvedAction(approvals, 17, { ...original, call_id: 'new-call' }), false);
  assert.equal(approvedAction(approvals, 17, { ...original, arguments: { endpoint: 'claim_task', parameters: { task_type: 'other' } } }), false);
  assert.equal(approvedAction(parseApprovals('[17]'), 17, original), false, 'Old bare IDs grant no new authority');
});
test('an explicit local rejection remains a rejection across a lost reply and reload', () => {
  const approvals = parseApprovals(JSON.stringify([approvalFor(17, [action()], 'reject')]));
  assert.equal(taskRejected(approvals, 17), true);
  assert.equal(approvedAction(approvals, 17, action()), false);
});
test('a claimed request cannot substitute a different reviewed recipient or message', () => {
  const request = { ...action(), arguments: { endpoint: 'send_message', parameters: { receiver_id: 3, content: '已核对的文字' } } };
  assert.throws(() => validateSiteSpec(request, { endpoint: 'send_message', method: 'POST', body: { receiver_id: 4, content: '已核对的文字' } }));
  assert.throws(() => validateSiteSpec(request, { endpoint: 'send_message', method: 'POST', body: { receiver_id: 3, content: '不同文字' } }));
  assert.equal(validateSiteSpec(request, { endpoint: 'send_message', method: 'POST', body: { receiver_id: '3', content: '已核对的文字' } }).endpoint, 'send_message');
});
test('receipt retention is bounded and preserves unresolved intents while pruning acknowledged records', () => {
  const storage = storageFixture(), journal = createReceiptJournal(storage, '1');
  journal.start(1, 'pending');
  for (let id = 2; id < 180; id++) {
    journal.save({ task_id: id, call_id: 'done', name: 'call_site_api', action: 'call_site_api', ok: true, summary: '已完成', data: {} });
    journal.acknowledge(id, 'done');
  }
  assert.equal(journal.get(1, 'pending').state, 'started');
  assert.equal(journal.get(179, 'done').acknowledged, true);
  assert.equal(journal.get(2, 'done'), undefined);
});

test('a confirmation names every destructive target accepted by dispatch', () => {
  const folderIds = Array.from({ length: 200 }, (_, i) => i + 1);
  const label = actionLabel({ ...action(), arguments: { endpoint: 'delete_fave_folders', parameters: { folder_ids: folderIds } } });
  assert.deepEqual(label.slice(label.indexOf('\uff1a') + 1).split('\u3001').map(Number), requireIds(folderIds));
});
