'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { readToken } from '@/lib/hooks';
import { randomId } from '@/lib/utils';
import { LS_KEYS } from '@/lib/constants';
import { ApiError, apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { readImport, writeImport } from '@/lib/adminCatalogTools/importClient';
import { CHUNK_BYTES, fingerprint, finalForm, importStatus, importUrl, parseJob, uploadChunks, validatePackage, type Dataset, type ImportJob } from '@/lib/adminCatalogTools/importModel';

/**
 * `paneRef` is the element the panel renders inside its own tab pane. The poll gate used to ask
 * `document.querySelector('[data-tab-pane="data-import"][data-tab-pane-active]')` — a literal that
 * has to match the registry id, and if it ever stopped matching the loop would keep running and
 * never call `check`, freezing a visible import's progress while the server carried on. Walking up
 * from the panel's own element cannot go stale. Attributes, never geometry: a concealed pane's
 * subtree would be laid out just to answer.
 */
function paneIsShowing(node: HTMLElement | null): boolean {
  /* A dataset pane sits inside the console's pane too: the nearest one can stay active while the
     rail has moved elsewhere. Every enclosing pane has to be on screen. */
  for (let pane = node?.closest('[data-tab-pane]'); pane; pane = pane.parentElement?.closest('[data-tab-pane]')) {
    if (!pane.hasAttribute('data-tab-pane-active')) return false;
  }
  return true;
}

/** Request cleanup is kept outside the hook; the compiler cannot lower a try/finally in it. */
async function attempt(task: () => Promise<void>, failed: (failure: unknown) => void, complete: () => void) {
  try { await task(); }
  catch (failure) { failed(failure); }
  finally { complete(); }
}

export function useImportTask(token: string, viewerId: number, dataset: Dataset, active: boolean, paneRef?: { current: HTMLElement | null }) {
  const [job, setJob] = useState<ImportJob | null>(null);
  const currentJob = useRef<ImportJob | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [watching, setWatching] = useState(true);
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const recoveryLock = useRef(false);
  const lifetime = useRef(0);
  const mounted = useRef(false);
  const locked = useRef(false);
  const stopping = useRef(false);
  const key = `${LS_KEYS.adminImportPrefix}:${viewerId}:${dataset}`;
  const commit = useCallback((value: ImportJob | null) => {
    if (!mounted.current || readToken() !== token) return;
    currentJob.current = value; setJob(value);
    try { if (value) localStorage.setItem(key, JSON.stringify(value)); else localStorage.removeItem(key); }
    catch { setError('无法保留本机进度，请记下任务编号后再离开'); }
  }, [key, token]);
  useEffect(() => {
    mounted.current = true; currentJob.current = null;
    const version = lifetime.current;
    queueMicrotask(() => {
      if (!mounted.current || lifetime.current !== version || readToken() !== token) return;
      let restored: ImportJob | null = null;
      try { const stored = localStorage.getItem(key); if (stored) restored = parseJob(JSON.parse(stored), dataset); }
      catch { recoveryLock.current = true; setRecoveryBlocked(true); setError('本机进度记录已损坏，请先核对服务器上的导入任务'); }
      currentJob.current = restored; setJob(restored); setBusy(false);
    });
    return () => { mounted.current = false; lifetime.current = version + 1; stopping.current = true; locked.current = false; };
  }, [key, token, dataset]);
  async function run(task: (isCurrent: () => boolean) => Promise<void>) {
    if (locked.current || recoveryLock.current || !mounted.current || readToken() !== token) return;
    const version = lifetime.current;
    const isCurrent = () => mounted.current && lifetime.current === version && readToken() === token;
    locked.current = true; stopping.current = false; setBusy(true); setError('');
    await attempt(() => task(isCurrent), (failure) => {
      if (isCurrent()) {
        const state = currentJob.current;
        if (state?.phase === 'done' || state?.phase === 'error') return;
        const refused = failure instanceof ApiError && (failure.kind === 'envelope' || (failure.kind === 'http' && (failure.status ?? 500) < 500));
        if (state) commit({ ...state, phase: state.phase === 'uploading' ? 'paused' : refused ? 'error' : ['submitted', 'processing', 'unknown'].includes(state.phase) ? 'unknown' : state.phase });
        setError(apiErrorMessage(failure));
      }
    }, () => { if (isCurrent()) { locked.current = false; setBusy(false); } });
  }
  const check = useCallback(async (signal?: AbortSignal) => {
    const state = currentJob.current;
    const version = lifetime.current;
    if (!state || !mounted.current || readToken() !== token) return;
    try {
      const data = await readImport(dataset, token, 'status', state.id, signal);
      if (signal?.aborted || !mounted.current || lifetime.current !== version || readToken() !== token || currentJob.current?.id !== state.id) return;
      const next = importStatus(data, state);
      commit(next); setError(next.phase === 'error' ? '导入未全部完成，请核对结果后再创建新任务' : '');
    } catch (failure) { if (!signal?.aborted && mounted.current && lifetime.current === version && readToken() === token) { setError(apiErrorMessage(failure)); if (!isRetryable(failure)) setWatching(false); } }
  }, [commit, dataset, token]);
  useEffect(() => {
    if (!active || !watching || !job || !['submitted', 'processing', 'unknown'].includes(job.phase)) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const tick = async () => { if (!document.hidden && paneIsShowing(paneRef?.current ?? null)) await check(controller.signal); if (!controller.signal.aborted) timer = setTimeout(tick, 2500); };
    timer = setTimeout(tick, 1500);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [active, watching, job?.id, job?.phase, check, job, paneRef]);
  async function stage(file: File) {
    await run(async (isCurrent) => {
      validatePackage(file, dataset);
      const saved = currentJob.current;
      if (saved && !['paused', 'uploading', 'staged'].includes(saved.phase)) return;
      const sig = await fingerprint(file);
      if (!isCurrent()) return;
      const state: ImportJob = saved ?? { id: randomId(), dataset, filename: file.name, size: file.size, totalChunks: Math.ceil(file.size / CHUNK_BYTES), chunks: [], fingerprint: sig, phase: 'uploading', percent: 0 };
      if (dataset !== 'images') return;
      commit({ ...state, phase: 'uploading' });
      await uploadChunks(state, file, { status: () => saved ? readImport(dataset, token, 'chunk_status', state.id) : Promise.resolve({ chunks: [] }), send: (body) => writeImport(dataset, token, body), current: isCurrent, stop: () => stopping.current, progress: commit });
    });
  }
  async function submit(file?: File, url?: string) {
    await run(async (isCurrent) => {
      let state = currentJob.current;
      let body: FormData;
      if (state && state.phase !== 'staged') return;
      if (dataset === 'dictionary') {
        if (!file || state) return;
        validatePackage(file, dataset);
        state = { id: randomId(), dataset, filename: file.name, size: file.size, totalChunks: 0, chunks: [], fingerprint: '', phase: 'submitted', percent: 0 };
        body = new FormData(); body.set('package', file); body.set('upload_id', state.id);
      } else if (url !== undefined) {
        if (state) return;
        const validated = importUrl(url);
        state = { id: randomId(), dataset, filename: '直链导入', size: 0, totalChunks: 0, chunks: [], fingerprint: '', phase: 'submitted', percent: 0 };
        body = new FormData(); body.set('action', 'import_from_url'); body.set('url', validated); body.set('upload_id', state.id);
      } else {
        if (!state || state.phase !== 'staged' || state.chunks.length !== state.totalChunks) return;
        body = finalForm(state);
      }
      if (!isCurrent()) return;
      state = { ...state, phase: 'submitted', percent: 0 }; commit(state); setWatching(true);
      const data = await writeImport(dataset, token, body);
      if (isCurrent()) commit(importStatus(data, currentJob.current?.id === state.id ? currentJob.current : state, false));
    });
  }
  return { job, busy, error, watching, recoveryBlocked, stage, submit, check, setWatching, stop: () => { stopping.current = true; }, reset: () => { if (!locked.current) { recoveryLock.current = false; setRecoveryBlocked(false); commit(null); setError(''); } } };
}
