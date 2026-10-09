'use client';

import {
  assertAssistantAccount, assistantChat, clearAssistantHistory, confirmAssistantTask, deleteAssistantMessage,
  getAssistantConfig, getAssistantState, getAssistantPermission, claimAssistantAction, reportAssistantActions, saveAssistantReceipt,
} from '@/lib/api/assistant';
import { ApiError, apiErrorMessage, isAborted } from '@/lib/api/errors';
import { assistantQuota, assistantPermission } from './queries';
import { assistantPageContext, dispatchAssistantAction } from './siteActions';
import { ActionRejected, actionSupported } from './actions';
import { approvedAction, approvalFor, parseApprovals, taskRejected, type TaskApproval } from './approval';
import { actionGroups } from './actionGroups';
import { createActionRunner } from './runner';
import { createReceiptJournal, newRequestId, parsePendingChat, readJournalText, sessionKeyFor, writeJournalText, type PendingChat } from './journal';
import { MAX_HISTORY, MAX_MESSAGE, MAX_ROUNDS, type AssistantMessage, type AssistantReceipt, type AssistantTask, type AssistantTurn } from './protocol';

export interface AssistantSnapshot {
  ready: boolean; available: boolean; loading: boolean; busy: boolean;
  messages: AssistantMessage[]; draft: string; pending: PendingChat | null;
  task: AssistantTask | null; receipts: AssistantReceipt[];
  error: string; status: string;
}
const INITIAL: AssistantSnapshot = { ready: false, available: false, loading: false, busy: false, messages: [], draft: '', pending: null, task: null, receipts: [], error: '', status: '' };

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
  const add = (role: AssistantMessage['role'], content: string, id: number) => {
    if (!content || id > 0 && snapshot.messages.some(message => message.id === id)) return;
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

  function taskOf(turn: AssistantTurn): AssistantTask | null {
    return turn.task_id ? { id: turn.task_id, status: turn.confirmation_token ? 'waiting_confirmation' : turn.actions.length || turn.agent_pending ? 'running' : 'completed', confirmation_token: turn.confirmation_token, actions: turn.actions, confirmed: turn.actions.every(action => approvedAction(approvals, turn.task_id, action)), user_message: '' } : null;
  }
  async function applyTurn(first: AssistantTurn) {
    let turn = first;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      assertCurrent();
      if (turn.reply && !turn.agent_pending) add('assistant', turn.reply, turn.assistant_message_id);
      const task = taskOf(turn);
      publish({ task, status: turn.confirmation_token ? '请核对以下操作' : '' });
      if (turn.confirmation_token || !turn.task_id || !turn.actions.length) return;
      if (taskRejected(approvals, turn.task_id)) { publish({ task: null, status: '此操作已取消，未继续执行' }); return; }
      if (!isActive()) { publish({ status: '任务已暂停，返回后可核对结果' }); return; }
      const results: AssistantReceipt[] = [];
      for (const group of actionGroups(turn.actions)) {
        const action = group.action;
        assertCurrent();
        if (!isActive()) { publish({ status: '任务已暂停，返回后可核对结果' }); return; }
        const result = await runner.run(action, turn.task_id, approvedAction(approvals, turn.task_id, action));
        for (const original of group.originals) {
          const individual = { ...result, call_id: original.call_id, name: original.name, action: original.name, data: { ...result.data, ...(group.originals.length > 1 ? { coalesced: true } : {}) } };
          journal.save(individual); results.push(individual);
        }
        publish({ receipts: [...snapshot.receipts, ...results.slice(-group.originals.length)].slice(-24) });
        if (result.defer_navigation) {
          // The same explicitly requested task can continue on its own destination after the
          // modal's history layer closes. A user closing chat before navigation still pauses it.
          continuingNavigation = true;
          await env.navigate(result.defer_navigation);
          assertCurrent();
        }
      }
      assertCurrent();
      // A completed operation still gets one acknowledgement when its own viewer closes chat.
      const follow = await reportAssistantActions(token, turn.task_id, results, assistantPageContext(pageInstance));
      assertCurrent();
      results.forEach(result => journal.acknowledge(result.task_id, result.call_id));
      turn = follow;
      if (!turn.agent_pending && !turn.confirmation_token && !turn.actions.length) {
        if (turn.reply) add('assistant', turn.reply, turn.assistant_message_id);
        publish({ task: null, status: '' }); return;
      }
    }
    publish({ task: taskOf(turn), status: '已完成本轮操作，可核对任务后继续' });
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
          const [state] = await Promise.all([getAssistantState(token, key, controller.signal), assistantQuota.read({ token })]); assertCurrent();
          const activeTask = [...state.tasks].reverse().find(task => ['waiting_confirmation', 'queued', 'running', 'processing'].includes(task.status)) ?? null;
          if (activeTask?.confirmed) activeTask.actions = activeTask.actions.map(action => ({ ...action, approval_granted: true }));
          publish({ ready: true, available: true, messages: state.messages, task: activeTask, status: activeTask ? '上次任务尚未完成，请核对后继续' : '' });
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
        add('user', message, turn.user_message_id);
        writeJournalText(accountId, 'pending-chat', null); writeJournalText(accountId, 'draft', null);
        publish({ draft: '', pending: null });
        await applyTurn(turn);
      });
    },
    decide(decision: 'confirm' | 'reject') {
      const task = snapshot.task;
      if (!task?.confirmation_token) return Promise.resolve();
      return run(async () => {
        if (decision === 'confirm' && task.actions.some(action => !actionSupported(action))) throw new Error('此操作需要到对应页面手动完成，未提交确认');
        // Persist the human's exact reviewed plan before the confirmation response can be lost.
        /* Merged with what storage holds now (review P5-O3): another tab's confirmation written
           since this one last read would otherwise be overwritten by this tab's older copy. */
        approvals = parseApprovals(readJournalText(accountId, 'approved-tasks')).filter(record => record.taskId !== task.id);
        approvals.push(approvalFor(task.id, task.actions, decision));
        approvals = approvals.slice(-64);
        writeJournalText(accountId, 'approved-tasks', JSON.stringify(approvals));
        const result = await confirmAssistantTask(token, task.id, task.confirmation_token!, decision); assertCurrent();
        if (decision === 'reject') { publish({ task: null, status: '已取消此操作' }); return; }
        await applyTurn(result);
      });
    },
    resume() {
      const task = snapshot.task;
      if (!task) return Promise.resolve();
      return run(async () => {
        await applyTurn({ task_id: task.id, actions: task.actions, confirmation_token: task.confirmation_token, reply: '', agent_pending: true, user_message_id: 0, assistant_message_id: 0 });
      });
    },
    removeMessage(id: number) {
      return run(async () => { await deleteAssistantMessage(token, key, id); assertCurrent(); publish({ messages: snapshot.messages.filter(m => m.id !== id), status: '已删除消息' }); });
    },
    clear() {
      return run(async () => {
        await clearAssistantHistory(token, key); assertCurrent();
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
