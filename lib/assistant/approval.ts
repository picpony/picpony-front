import { obj, positiveId, str, type AssistantAction } from './protocol';

export interface TaskApproval { taskId: number; decision: 'confirm' | 'reject'; calls: { id: string; signature: string }[] }
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])]));
  return value;
}
export function actionSignature(action: AssistantAction): string {
  return JSON.stringify([action.name, canonical(action.arguments)]);
}
export function approvedAction(records: readonly TaskApproval[], taskId: number, action: AssistantAction): boolean {
  return records.some(record => record.taskId === taskId && record.decision === 'confirm' && record.calls.some(call => call.id === action.call_id && call.signature === actionSignature(action)));
}
export function taskRejected(records: readonly TaskApproval[], taskId: number): boolean {
  return records.some(record => record.taskId === taskId && record.decision === 'reject');
}
export function approvalFor(taskId: number, actions: readonly AssistantAction[], decision: 'confirm' | 'reject' = 'confirm'): TaskApproval {
  return { taskId, decision, calls: actions.map(action => ({ id: action.call_id, signature: actionSignature(action) })) };
}
export function parseApprovals(text: string | null): TaskApproval[] {
  try {
    const raw: unknown = JSON.parse(text || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.slice(-64).flatMap(value => {
      const record = obj(value), taskId = positiveId(record.taskId);
      if (!taskId || !Array.isArray(record.calls)) return [];
      const calls = record.calls.slice(0, 24).flatMap(value => {
        const call = obj(value);
        return typeof call.signature === 'string' && call.signature.length <= 20000 && str(call.id, 160) ? [{ id: str(call.id, 160), signature: call.signature }] : [];
      });
      return [{ taskId, decision: record.decision === 'reject' ? 'reject' as const : 'confirm' as const, calls }];
    });
  } catch { return []; }
}
