'use client';

import { useEffect, useRef, useState } from 'react';
import Button from '@/components/Button';
import DataTable from '@/components/DataTable';
import EmptyState from '@/components/EmptyState';
import { readToken } from '@/lib/hooks';
import { apiErrorMessage, isAborted } from '@/lib/api/errors';
import { checkServiceLines, type LineCheck } from '@/lib/api/adminSiteTools';
import { AdminNote } from '../AdminForm';
import { tableError } from '../queries';

/** Keep the request's try/finally outside the component so its guarded callbacks compile. */
async function checkLines(token: string, signal: AbortSignal, report: (row: LineCheck) => void, failed: (error: unknown) => void, complete: () => void) {
  try { await checkServiceLines(token, signal, report); }
  catch (error) { failed(error); }
  finally { complete(); }
}

export default function ServiceChecks({ token }: { token: string }) {
  const controller = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState<LineCheck[]>([]);
  const [error, setError] = useState('');
  useEffect(() => () => controller.current?.abort(), []);
  /* A run is identified, not just flagged: 停止检测 clears `controller.current` itself, so a
     restart used to begin while the aborted run's in-flight probe could still resolve and append a
     row to the new list. Every `report` is now checked against the run that is current. */
  const runs = useRef(0);
  const run = async () => {
    if (controller.current || readToken() !== token) return;
    const id = ++runs.current;
    const runController = new AbortController();
    controller.current = runController; setBusy(true); setError(''); setChecks([]);
    await checkLines(token, runController.signal,
      (row) => { if (runs.current === id) setChecks((previous) => [...previous, row]); },
      (error) => { if (!isAborted(error) && readToken() === token) setError(apiErrorMessage(error, '线路检测失败')); },
      () => {
        if (controller.current === runController) controller.current = null;
        if (runs.current === id && readToken() === token) setBusy(false);
      });
  };
  return <div className="space-y-4">
    <AdminNote>从当前设备发起匿名读取，检测各条线路，每条最多等待 5 秒。图片线路以能否解码出图片为准；跨站的接口响应可能只允许确认已收到响应，无法读取其状态码。</AdminNote>
    <div className="flex flex-wrap gap-3"><Button variant="tonal" loading={busy} onClick={() => void run()}>检测线路</Button>{busy && <Button variant="text" onClick={() => { controller.current?.abort(); controller.current = null; setBusy(false); }}>停止检测</Button>}</div>
    <DataTable rows={checks} rowKey={(r) => r.name} loading={busy && !checks.length} {...tableError('线路检测失败', error || undefined)} empty={<EmptyState size="inline" title="按下「检测线路」查看当前状态" />} columns={[
      { key: 'name', header: '线路', primary: true, render: (r) => r.name },
      { key: 'status', header: '状态', render: (r) => r.error ?? (r.status === 'decoded' ? '图片可正常加载' : r.status === null ? '已收到响应，状态码不可读' : r.status >= 200 && r.status < 400 ? `连接正常（${r.status}）` : `返回异常（${r.status}）`) },
      { key: 'latency', header: '耗时', className: 'tabular-nums', render: (r) => `${r.latency} 毫秒` },
    ]} />
  </div>;
}
