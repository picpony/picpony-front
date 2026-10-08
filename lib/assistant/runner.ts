import { actionIsWrite, validateSiteSpec } from './actions';
import { obj, positiveId, receiptData, str, type AssistantAction, type AssistantReceipt, type JsonObject, type PermissionMode } from './protocol';
import type { createReceiptJournal } from './journal';

export class UncertainAction extends Error {
  constructor(message = '操作结果尚未确认，已停止重复提交。请先核对站内结果，再核对任务回执。') { super(message); }
}
export interface ActionDependencies {
  assertCurrent(): void;
  permission(): Promise<PermissionMode>;
  claim(taskId: number, callId: string): Promise<JsonObject>;
  save(receipt: AssistantReceipt): Promise<JsonObject>;
  dispatch(action: AssistantAction, claim: JsonObject): Promise<Partial<AssistantReceipt>>;
  journal: ReturnType<typeof createReceiptJournal>;
  failure(error: unknown): string;
  definitive(error: unknown): boolean;
}

/** One task/call promise per document; durable intents and server claims survive reload. */
export function createActionRunner(deps: ActionDependencies) {
  const running = new Map<string, Promise<AssistantReceipt>>();
  function receipt(action: AssistantAction, taskId: number, fields: Partial<AssistantReceipt>): AssistantReceipt {
    return { task_id: taskId, call_id: action.call_id, name: action.name, action: action.name, ok: false, summary: '', data: {}, ...fields };
  }
  async function settle(action: AssistantAction, taskId: number, approved: boolean): Promise<AssistantReceipt> {
    deps.assertCurrent();
    if (!positiveId(taskId) || !/^[A-Za-z0-9._:-]{1,160}$/.test(action.call_id)) {
      return receipt(action, taskId, { summary: '任务缺少可核对的操作标识，未执行', error: 'missing_identity' });
    }
    const claimed = action.name === 'call_site_api' || action.name === 'interact_page';
    const previous = deps.journal.get(taskId, action.call_id);
    if (previous?.state === 'receipt' && previous.receipt) {
      if (claimed) await save(previous.receipt);
      return previous.receipt;
    }
    const write = actionIsWrite(action);
    if (write) {
      const permission = await deps.permission(); deps.assertCurrent();
      if (!approved && !(permission === 'full' && action.approval_granted)) {
        return receipt(action, taskId, { summary: '此操作尚未得到确认，未执行', error: 'confirmation_required' });
      }
    }
    let claim: JsonObject = {};
    if (claimed) {
      claim = await deps.claim(taskId, action.call_id); deps.assertCurrent();
      if (claim.cached === true) {
        const cached = obj(claim.result);
        if (positiveId(cached.task_id) !== taskId || cached.call_id !== action.call_id || typeof cached.ok !== 'boolean') throw new UncertainAction('服务器回执与此操作不一致，未重复执行');
        const result = receipt(action, taskId, { ok: cached.ok, summary: str(cached.summary, 1000), data: receiptData(cached.data), ...(typeof cached.error === 'string' ? { error: str(cached.error, 100) } : {}) });
        deps.journal.save(result); return result;
      }
      if (claim.pending === true || previous?.state === 'started') throw new UncertainAction();
      if (action.name === 'call_site_api') {
        try { validateSiteSpec(action, claim.request); }
        catch (e) {
          const denied = receipt(action, taskId, { summary: deps.failure(e), error: 'unsupported_action' });
          deps.journal.save(denied); await save(denied); return denied;
        }
      }
    } else if (previous?.state === 'started') throw new UncertainAction();
    deps.assertCurrent();
    deps.journal.start(taskId, action.call_id);
    let result: AssistantReceipt;
    try {
      const value = await deps.dispatch(action, claim); deps.assertCurrent();
      result = receipt(action, taskId, value);
    } catch (e) {
      deps.assertCurrent();
      // Any thrown write may already have reached the backend. Keep the durable intent.
      if (write && !deps.definitive(e)) throw new UncertainAction(deps.failure(e) + '；结果尚未确认，不会重复提交');
      result = receipt(action, taskId, { summary: deps.failure(e), error: 'client_action_failed' });
    }
    deps.journal.save(result);
    if (claimed) await save(result);
    return result;
  }
  async function save(value: AssistantReceipt) {
    deps.assertCurrent();
    const saved = await deps.save(value); deps.assertCurrent();
    if (saved.success !== true || !saved.result) throw new UncertainAction('业务操作已有结果，回执尚未确认；核对时只会补交此回执');
    deps.journal.acknowledge(value.task_id, value.call_id);
  }
  return {
    run(action: AssistantAction, taskId: number, approved = false) {
      const key = `${taskId}:${action.call_id}`;
      const active = running.get(key);
      if (active) return active;
      const pending = settle(action, taskId, approved).finally(() => running.delete(key));
      running.set(key, pending); return pending;
    },
  };
}
