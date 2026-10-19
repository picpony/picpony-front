'use client';

import {
  assertAssistantAccount, assistantChat, clearAssistantHistory, decideAssistantAction, deleteAssistantMessage,
  getAssistantConfig, getAssistantPending, getAssistantState, getAssistantPermission, claimAssistantAction, pollAssistantTask, saveAssistantReceipt,
} from '@/lib/api/assistant';
import { ApiError, apiErrorMessage, isAborted } from '@/lib/api/errors';
import { tasks as taskResource, coinTransactions, sessionUser } from '@/lib/resources';
import { assistantQuota, assistantPermission } from './queries';
import { assistantPageContext, dispatchAssistantAction } from './siteActions';
import { ActionRejected, actionLabel, actionSupported } from './actions';
import { approvalFor, parseApprovals, taskRejected, type TaskApproval } from './approval';
import { createActionRunner } from './runner';
import { createReceiptJournal, newRequestId, parsePendingChat, readJournalText, sessionKeyFor, writeJournalText, type PendingChat } from './journal';
import {
  ACTIVE_STATES, MAX_HISTORY, MAX_MESSAGE, clientCallAction, obj, pendingAction, str, uuid,
  type AssistantAction, type AssistantMessage, type AssistantReceipt, type AssistantTask, type JsonObject,
} from './protocol';

export interface AssistantSnapshot {
  ready: boolean; available: boolean; loading: boolean; busy: boolean;
  messages: AssistantMessage[]; draft: string; pending: PendingChat | null;
  task: AssistantTask | null; receipts: AssistantReceipt[];
  error: string; status: string;
}
const INITIAL: AssistantSnapshot = { ready: false, available: false, loading: false, busy: false, messages: [], draft: '', pending: null, task: null, receipts: [], error: '', status: '' };

/** One status request at a time, no faster than the backend asks (≥ 500ms). */
const POLL_MS = 900;
/** Past the backend's own budget (90s run, +120s after a dispatch) the panel stops waiting and offers 核对任务. */
const POLL_LIMIT_MS = 150_000;
const ENDED: Record<string, string> = {
  failed: '彩彩这次没能完成，请稍后再试', cancelled: '这次操作已取消', interrupted: '这次对话已中断，可重新发送',
};
const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Session closed', 'AbortError')); }, { once: true });
});

/**
 * The panel's conversation with the Rust backend's legacy bridge. A sent message queues a turn
 * (`chat`); the turn runs on the server and is followed by polling (`state {task_id}`). When it
 * parks on a write the user must decide (`waiting_confirmation`), the card shows the server's
 * pending action (`run-task`); the decision goes to the per-action confirmation resource. Every
 * call the server issues to this page — a page observation or click, a site read, a confirmed or
 * fully granted write — is listed on the poll (`task.client_calls`) and executed once (claim →
 * dispatch → receipt); the last receipt resumes the model and the turn is followed on. Receipts
 * settle no quota: the turn settles once when it ends, and the panel re-reads the quota then.
 */
export function createAssistantSession(token: string, accountId: string, env: { active(): boolean; navigate(href: string): Promise<void> }) {
  let snapshot = INITIAL;
  let key = '';
  let disposed = false;
  let active = false;
  let continuingNavigation = false;
  let restoring: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const controller = new AbortController();
  const pageInstance = `p_${newRequestId()}`;
  let approvals: TaskApproval[] = [];
  /** Issued client calls this document has already taken up (the runner dedupes in-flight ones too). */
  const handled = new Set<string>();
  const isActive = () => (active || continuingNavigation) && env.active();
  const journal = createReceiptJournal(localStorage, accountId);
  const assertCurrent = () => {
    assertAssistantAccount(token);
    if (disposed) throw new DOMException('Session closed', 'AbortError');
  };
  const publish = (next: Partial<AssistantSnapshot>) => {
    if (disposed) return;
    snapshot = { ...snapshot, ...next };
    listeners.forEach(listener => listener());
  };
  const add = (role: AssistantMessage['role'], content: string, id = '') => {
    if (!content || id && snapshot.messages.some(message => message.id === id)) return;
    publish({ messages: [...snapshot.messages, { role, content, id }].slice(-MAX_HISTORY) });
  };
  const runner = createActionRunner({
    assertCurrent,
    permission: async () => {
      const mode = await getAssistantPermission(token); assertCurrent();
      assistantPermission.write({ token }, mode); return mode;
    },
    claim: (task, call) => claimAssistantAction(token, task, call),
    save: receipt => saveAssistantReceipt(token, receipt),
    dispatch: async (action, claim) => {
      assertCurrent();
      if (!isActive()) throw new Error('会话已暂停，请返回彩彩 AI 核对任务');
      return dispatchAssistantAction(token, pageInstance, action, claim);
    },
    failure: apiErrorMessage,
    definitive: error => error instanceof ActionRejected || error instanceof ApiError && (error.kind === 'envelope' || error.status === 400 || error.status === 403),
    journal,
  });
  const following = (id: string, status: string): AssistantTask => ({ id, status, pending_id: null, actions: [], confirmed: false });

  /** Poll one turn until it ends, parks on a confirmation, or outlives the backend's budget. */
  async function follow(taskId: string) {
    const started = Date.now();
    for (;;) {
      assertCurrent();
      const turn = await pollAssistantTask(token, taskId, controller.signal);
      assertCurrent();
      if (turn.status === 'waiting_confirmation') { await showPending(taskId); return; }
      /* Calls the server issued to this page while the turn runs (page observations, clicks, reads
         and confirmed / fully granted writes). Each is executed once: the runner claims it (a call
         already answered comes back `cached`) and its receipt resumes the model. */
      const calls = turn.client_calls.filter(call => call.task_id === taskId && !handled.has(call.id));
      if (calls.length) {
        publish({ task: following(taskId, turn.status), status: '彩彩正在操作页面…' });
        calls.forEach(call => handled.add(call.id));
        /* A paused or failed run releases its calls for 核对任务; the runner's journal still keeps a
           write that may have reached the backend from being sent twice. */
        const release = () => calls.forEach(call => handled.delete(call.id));
        const ran = await runActions(taskId, calls.map(clientCallAction)).catch((error: unknown) => { release(); throw error; });
        if (!ran) { release(); return; }
        await wait(POLL_MS, controller.signal);
        continue;
      }
      if (ACTIVE_STATES.includes(turn.status)) {
        if (Date.now() - started > POLL_LIMIT_MS) { publish({ task: following(taskId, turn.status), status: '彩彩仍在处理，可稍后核对任务' }); return; }
        publish({ task: following(taskId, turn.status), status: '彩彩正在思考…' });
        await wait(POLL_MS, controller.signal);
        continue;
      }
      add('assistant', turn.reply);
      publish({ task: null, status: turn.status === 'done' || turn.reply ? '' : ENDED[turn.status] ?? '' });
      return;
    }
  }
  /** The server's pending action for a turn that waits on the user, as a card to decide. */
  async function showPending(taskId: string) {
    const { status, pending } = await getAssistantPending(token, taskId, controller.signal);
    assertCurrent();
    if (!pending) {
      publish({ task: ACTIVE_STATES.includes(status) ? following(taskId, status) : null, status: ACTIVE_STATES.includes(status) ? '待确认的操作已失效，可核对任务' : '' });
      return;
    }
    if (taskRejected(approvals, taskId)) { publish({ task: null, status: '此操作已取消，未继续执行' }); return; }
    publish({ task: { id: taskId, status: 'waiting_confirmation', pending_id: pending.id, actions: [pendingAction(pending)], confirmed: false }, status: '请核对以下操作' });
  }
  /** Execute client actions the server issued for this turn, receipting each. */
  async function runActions(taskId: string, actions: AssistantAction[]) {
    for (const action of actions) {
      assertCurrent();
      if (!isActive()) { publish({ status: '任务已暂停，返回后可核对结果' }); return false; }
      const result = await runner.run(action, taskId, action.approval_granted);
      journal.save(result);
      publish({ receipts: [...snapshot.receipts, result].slice(-24) });
      if (result.defer_navigation) {
        // The same explicitly requested task can continue on its own destination after the
        // modal's history layer closes. A user closing chat before navigation still pauses it.
        continuingNavigation = true;
        await env.navigate(result.defer_navigation);
        assertCurrent();
      }
    }
    return true;
  }
  /**
   * What a confirmation answered. A confirmed site call is `{dispatched, call_id, request}` (or,
   * replayed after the pending row closed, `{status:'completed', results:[{dispatched, call_id}]}`);
   * a confirmed server write is `{status:'completed', results:[receipt]}`; a refused one is HTTP 200
   * `{success:false, code, message}`; a rejection is `{status:'cancelled'}`.
   */
  async function applyDecision(taskId: string, action: AssistantAction, result: JsonObject) {
    if (result.success === false) { publish({ task: null, status: str(result.message, 300) || '操作未执行' }); return; }
    if (result.status === 'cancelled') { publish({ task: null, status: '已取消此操作' }); return; }
    const first = obj(Array.isArray(result.results) ? result.results[0] : undefined);
    const dispatched = result.dispatched === true ? result : first.dispatched === true ? first : null;
    if (dispatched) {
      const callId = uuid(dispatched.call_id);
      if (!callId) throw new Error('服务器未返回可核对的操作标识，未执行');
      handled.add(callId);
      const ran = await runActions(taskId, [{ name: 'call_site_api', arguments: action.arguments, call_id: callId, risk: 'write_confirm', approval_granted: true }]);
      if (ran) await follow(taskId);
      return;
    }
    if (result.status === 'completed') {
      const receipt: AssistantReceipt = { task_id: taskId, call_id: action.call_id, name: action.name, action: action.name, ok: first.ok === true, summary: `已完成：${actionLabel(action)}`, data: {} };
      journal.save(receipt); journal.acknowledge(taskId, action.call_id);
      publish({ receipts: [...snapshot.receipts, receipt].slice(-24) });
      taskResource.expire({ token }); coinTransactions.expire(); sessionUser.expire({ token });
      await follow(taskId);
      return;
    }
    await follow(taskId);
  }
  /** The reviewed action a stored approval was made for (its signature is `[name, arguments]`). */
  function approvedActionOf(record: TaskApproval): AssistantAction | null {
    const call = record.calls[0];
    if (!call) return null;
    try {
      const [name, args] = JSON.parse(call.signature) as [unknown, unknown];
      return typeof name === 'string' ? { name, arguments: obj(args), call_id: call.id, risk: 'write_confirm', approval_granted: false } : null;
    } catch { return null; }
  }
  async function run(operation: () => Promise<void>) {
    if (snapshot.busy || disposed) return;
    try { assertCurrent(); publish({ busy: true, error: '' }); await operation(); }
    catch (error) {
      if (!disposed && !isAborted(error)) {
        try { assertCurrent(); publish({ error: apiErrorMessage(error), status: '' }); } catch { /* Another account owns the screen now. */ }
      }
    } finally {
      continuingNavigation = false;
      if (!disposed) publish({ busy: false });
      if (!disposed) { try { assertCurrent(); assistantQuota.expire({ token }); } catch { /* Never refresh the previous account. */ } }
    }
  }

  return {
    setActive(value: boolean) { active = value; },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    restore() {
      if (restoring || disposed || snapshot.busy) return restoring ?? Promise.resolve();
      restoring = (async () => {
        publish({ loading: true, error: '' });
        try {
          assertCurrent();
          key = sessionKeyFor(accountId);
          approvals = parseApprovals(readJournalText(accountId, 'approved-tasks'));
          publish({ draft: (readJournalText(accountId, 'draft') ?? '').slice(0, MAX_MESSAGE), pending: parsePendingChat(readJournalText(accountId, 'pending-chat')) });
          const config = await getAssistantConfig(token, controller.signal); assertCurrent();
          if (!config.enabled) { publish({ ready: true, available: false, status: config.message || '彩彩 AI 暂未开放' }); return; }
          const [state] = await Promise.all([getAssistantState(token, controller.signal), assistantQuota.read({ token })]); assertCurrent();
          /* Active tasks come newest first. */
          const activeTask = state.tasks.find(task => ACTIVE_STATES.includes(task.status));
          publish({ ready: true, available: true, messages: state.messages, task: activeTask ? following(activeTask.id, activeTask.status) : null, status: activeTask ? '上次任务尚未完成，请核对后继续' : '' });
        } catch (error) {
          if (!disposed && !isAborted(error)) publish({ error: apiErrorMessage(error), ready: true });
        } finally { restoring = null; if (!disposed) publish({ loading: false }); }
      })();
      return restoring;
    },
    setDraft(value: string) {
      if (snapshot.pending || snapshot.busy) return;
      const draft = value.slice(0, MAX_MESSAGE);
      publish({ draft });
      try { writeJournalText(accountId, 'draft', draft || null); }
      catch { publish({ error: '草稿未能保存在此设备，请勿在发送前关闭页面' }); }
    },
    send() {
      return run(async () => {
        if (!snapshot.available || !key || !isActive()) return;
        const message = snapshot.pending?.message ?? snapshot.draft.trim();
        if (!message) return;
        const pending = snapshot.pending ?? { requestId: newRequestId(), message };
        // The id must survive before a request can be sent; a blocked store stops here.
        writeJournalText(accountId, 'pending-chat', JSON.stringify(pending));
        publish({ pending, status: '彩彩正在思考…' });
        const turn = await assistantChat(token, { message, request_id: pending.requestId, session_key: key, page_context: assistantPageContext(pageInstance) });
        assertCurrent();
        add('user', message);
        writeJournalText(accountId, 'pending-chat', null); writeJournalText(accountId, 'draft', null);
        publish({ draft: '', pending: null, task: following(turn.task_id, 'queued') });
        await follow(turn.task_id);
      });
    },
    decide(decision: 'confirm' | 'reject') {
      const task = snapshot.task;
      if (!task?.pending_id) return Promise.resolve();
      const pendingId = task.pending_id;
      return run(async () => {
        if (decision === 'confirm' && task.actions.some(action => !actionSupported(action))) throw new Error('此操作需要到对应页面手动完成，未提交确认');
        // Persist the human's exact reviewed plan before the confirmation response can be lost.
        /* Merged with what storage holds now (review P5-O3): another tab's confirmation written
           since this one last read would otherwise be overwritten by this tab's older copy. */
        approvals = parseApprovals(readJournalText(accountId, 'approved-tasks')).filter(record => record.taskId !== task.id);
        approvals.push(approvalFor(task.id, task.actions, decision));
        approvals = approvals.slice(-64);
        writeJournalText(accountId, 'approved-tasks', JSON.stringify(approvals));
        const result = await decideAssistantAction(token, pendingId, decision); assertCurrent();
        await applyDecision(task.id, task.actions[0], result);
      });
    },
    /**
     * 核对任务: pick a paused or reloaded turn back up. A confirmation this device already sent is
     * sent again under the same idempotency key, which replays its outcome (a site call's id) so the
     * issued call can still be executed or receipted; otherwise the turn is simply followed.
     */
    resume() {
      const task = snapshot.task;
      if (!task) return Promise.resolve();
      return run(async () => {
        if (task.status === 'waiting_confirmation' && !task.pending_id) { await showPending(task.id); return; }
        const record = approvals.find(item => item.taskId === task.id && item.decision === 'confirm');
        const action = record && approvedActionOf(record);
        if (record && action && task.status === 'running') {
          const result = await decideAssistantAction(token, action.call_id, 'confirm'); assertCurrent();
          await applyDecision(task.id, action, result);
          return;
        }
        await follow(task.id);
      });
    },
    removeMessage(id: string) {
      return run(async () => { await deleteAssistantMessage(token, id); assertCurrent(); publish({ messages: snapshot.messages.filter(m => m.id !== id), status: '已删除消息' }); });
    },
    clear() {
      return run(async () => {
        await clearAssistantHistory(token); assertCurrent();
        writeJournalText(accountId, 'pending-chat', null);
        publish({ messages: [], receipts: [], task: null, pending: null, status: '已清空聊天记录' });
      });
    },
    /* Not through `run()` (it is not a request and must not show busy), so it catches for itself:
       the journal write throws on a browser that refuses storage — the very case the journal
       protects — and a throw here was an unhandled rejection out of a click handler. */
    discardPending() {
      try {
        assertCurrent(); writeJournalText(accountId, 'pending-chat', null);
        publish({ pending: null, error: '', status: '已保留草稿，可修改后发送；之前的请求仍以站内记录为准' });
      } catch (error) {
        try { assertCurrent(); publish({ error: apiErrorMessage(error), status: '' }); } catch { /* Another account owns the screen now. */ }
      }
    },
    dispose() { disposed = true; controller.abort(); listeners.clear(); },
  };
}
export type AssistantSession = ReturnType<typeof createAssistantSession>;
