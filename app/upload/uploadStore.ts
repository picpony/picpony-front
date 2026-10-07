'use client';

import { useSyncExternalStore } from 'react';
import { showToast } from '@/components/Toast';
import { apiErrorMessage, isAborted } from '@/lib/api/errors';
import { recordWeeklyUpload } from '@/lib/api/tasks';
import {
  DUPLICATE_COMPLAINT,
  stageUpload,
  submitDerpiImage,
  type RatingTag,
  type UploadField,
} from '@/lib/api/upload';
import { readToken } from '@/lib/hooks';
import { tasks } from '@/lib/resources';

/**
 * 发布图片's state that outlives the screen: the draft being filled in, and the upload in
 * flight. Both are module state rather than component state, because leaving the screen must
 * lose neither — a draft comes back as it was left, and an upload keeps going and says when it
 * has landed. A reload or a closed tab would lose both, so they ask first (`beforeunload`) —
 * an upload in flight from any screen, since closing the tab kills it; a draft only while the
 * screen that shows it is open (G4-007): from another screen the browser's generic question would
 * be about something nothing on screen names.
 *
 * Owned by the session that made it: a draft or a job whose owner is not the current session
 * reads as absent, and the upload's own writes check the session before they report.
 */

export interface UploadDraft {
  file: File | null;
  rating: RatingTag | null;
  tags: string[];
  source: string;
  description: string;
}

export const EMPTY_DRAFT: UploadDraft = Object.freeze({
  file: null,
  rating: null,
  tags: [],
  source: '',
  description: '',
}) as UploadDraft;

/** What the last attempt ended in; `null` while nothing has been tried or after it is cleared. */
export type UploadOutcome =
  | { kind: 'uploaded'; imageId: number }
  | { kind: 'rejected'; fields: Partial<Record<UploadField, string>>; message: string }
  | { kind: 'unconfirmed'; message: string };

export interface UploadJob {
  phase: 'staging' | 'submitting' | 'settled';
  /** The file transfer's share, 0–1, while staging; `null` before the first progress event. */
  progress: number | null;
  outcome: UploadOutcome | null;
}

interface State {
  owner: string | null;
  draft: UploadDraft;
  job: UploadJob | null;
}

let state: State = { owner: null, draft: EMPTY_DRAFT, job: null };
const listeners = new Set<() => void>();
let controller: AbortController | null = null;
/** A completion belongs to the attempt that started it, even across account changes. */
let attemptId = 0;
/** A staged file's public URL, kept for a resubmission of the same file — it need not travel twice. */
let staged: { file: File; url: string; at: number } | null = null;
/** How long a staged URL is reused; the backend's temporary files are not kept forever. */
const STAGED_REUSE_MS = 10 * 60 * 1000;
/** Whether the screen is on show; an upload that lands while it is not says so in a toast. */
let screens = 0;
/**
 * The file whose last submission's answer was lost. Derpibooru refuses a picture it already has,
 * so when a resubmission of that very file is refused as a duplicate, the lost one most likely
 * landed — and the form says that, rather than calling the person's own upload a duplicate.
 */
let unconfirmedFile: File | null = null;
const LANDED = 'Derpibooru 上已有这张图片——很可能是上一次未能确认的发布已经成功。请在 Derpibooru 上查看你的上传以确认';

function emit(next: State) {
  state = next;
  syncUnloadGuard();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function owned(owner: string | null): boolean {
  return owner !== null && state.owner === owner;
}

/** A draft with anything in it — what a reload would lose. */
export function draftHasContent(draft: UploadDraft): boolean {
  return Boolean(draft.file || draft.rating || draft.tags.length || draft.source.trim() || draft.description.trim());
}

function inFlight(job: UploadJob | null): boolean {
  return job !== null && job.phase !== 'settled';
}

/** What a reload would lose that the reader can see: an upload anywhere, a draft on its screen. */
function worthGuarding(): boolean {
  return inFlight(state.job) || (screens > 0 && draftHasContent(state.draft));
}

function onBeforeUnload(event: BeforeUnloadEvent) {
  if (!state.owner || readToken() !== state.owner || !worthGuarding()) return;
  event.preventDefault();
  /* Older engines show the prompt only for a non-empty return value. */
  event.returnValue = '';
}

let guarded = false;
function syncUnloadGuard() {
  if (typeof window === 'undefined') return;
  const want = worthGuarding();
  if (want === guarded) return;
  guarded = want;
  if (want) window.addEventListener('beforeunload', onBeforeUnload);
  else window.removeEventListener('beforeunload', onBeforeUnload);
}

const SERVER_SNAPSHOT: State = { owner: null, draft: EMPTY_DRAFT, job: null };

/** The current session's draft and job. */
export function useUpload(owner: string | null): { draft: UploadDraft; job: UploadJob | null } {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => SERVER_SNAPSHOT);
  return owner !== null && snapshot.owner === owner ? { draft: snapshot.draft, job: snapshot.job } : { draft: EMPTY_DRAFT, job: null };
}

/** Change the draft. A different session's leftovers are dropped first. */
export function updateDraft(owner: string, patch: Partial<UploadDraft>) {
  if (readToken() !== owner) return;
  if (!owned(owner)) discardAttempt();
  const base = owned(owner) ? state : { owner, draft: EMPTY_DRAFT, job: null };
  emit({ ...base, owner, draft: { ...base.draft, ...patch } });
}

/** A new draft owner cannot reuse a URL, cancellation handle or uncertain result from the old one. */
function discardAttempt() {
  attemptId += 1;
  const previous = controller;
  controller = null;
  previous?.abort();
  staged = null;
  unconfirmedFile = null;
}

/** Start again: an empty draft, and the last outcome forgotten. */
export function resetUpload(owner: string) {
  if (readToken() !== owner || (owned(owner) && inFlight(state.job))) return;
  discardAttempt();
  emit({ owner, draft: EMPTY_DRAFT, job: null });
}

/** Forget the last outcome (the form is being edited again); the draft stays. */
export function clearOutcome(owner: string) {
  if (!owned(owner) || !state.job || inFlight(state.job)) return;
  emit({ ...state, job: null });
}

/**
 * The screen counts itself in and out, so a landing upload knows whether anyone is watching — and
 * the draft's unload guard is armed only while somebody is.
 */
export function attachUploadScreen(): () => void {
  screens += 1;
  syncUnloadGuard();
  return () => {
    screens = Math.max(0, screens - 1);
    syncUnloadGuard();
  };
}

/** Stops the file transfer. The submission step cannot be called back — it may already have landed. */
export function cancelUpload(owner: string) {
  if (!owned(owner) || state.job?.phase !== 'staging') return;
  controller?.abort();
}

function setJob(owner: string, job: UploadJob | null) {
  if (!owned(owner)) return;
  emit({ ...state, job });
}

export interface UploadRequest {
  owner: string;
  apiKey: string;
  username?: string;
  tagInput: string;
  /** In-app navigation, for the toast an upload that lands after the screen was left shows. */
  navigate: (href: string) => void;
}

/**
 * Stage the draft's file (unless this very file was staged moments ago), then hand it to
 * Derpibooru. Never throws; the outcome lands on the job.
 */
export async function startUpload({ owner, apiKey, username, tagInput, navigate }: UploadRequest): Promise<void> {
  if (readToken() !== owner || !owned(owner) || inFlight(state.job)) return;
  const { file, source, description } = state.draft;
  if (!file) return;

  const attempt = ++attemptId;
  const transfer = new AbortController();
  controller = transfer;
  const { signal } = transfer;
  const current = () => attemptId === attempt && owned(owner);
  const stale = () => {
    if (current() && readToken() === owner) return false;
    if (controller === transfer) controller = null;
    if (current()) setJob(owner, null);
    return true;
  };
  let url = staged && staged.file === file && Date.now() - staged.at < STAGED_REUSE_MS ? staged.url : null;

  if (!url) {
    setJob(owner, { phase: 'staging', progress: null, outcome: null });
    try {
      url = await stageUpload(owner, file, {
        signal,
        onProgress: (fraction) => {
          if (current() && readToken() === owner && state.job?.phase === 'staging') {
            setJob(owner, { ...state.job, progress: fraction });
          }
        },
      });
      if (stale()) return;
      staged = { file, url, at: Date.now() };
    } catch (error) {
      if (stale()) return;
      if (controller === transfer) controller = null;
      if (isAborted(error)) {
        setJob(owner, null);
        return;
      }
      setJob(owner, {
        phase: 'settled',
        progress: null,
        outcome: { kind: 'rejected', fields: {}, message: apiErrorMessage(error, '作品暂存失败，请重试') },
      });
      if (screens === 0 && readToken() === owner) {
        showToast('作品发布失败', 'error', { action: { label: '查看', onClick: () => navigate('/upload') } });
      }
      return;
    }
  }

  if (stale()) return;
  controller = null;
  setJob(owner, { phase: 'submitting', progress: 1, outcome: null });
  let outcome: UploadOutcome = await submitDerpiImage({
    apiKey,
    url,
    tagInput,
    source: source.trim() || undefined,
    description: description.trim() || undefined,
    username,
  });
  if (stale()) return;

  if (outcome.kind === 'rejected' && unconfirmedFile === file && outcome.fields.image === DUPLICATE_COMPLAINT) {
    outcome = { kind: 'unconfirmed', message: LANDED };
  } else if (outcome.kind === 'rejected' && outcome.fields.image) {
    /* A file Derpibooru could not fetch or read is staged again on the next attempt. */
    staged = null;
  }
  unconfirmedFile = outcome.kind === 'unconfirmed' ? file : null;
  if (outcome.kind === 'uploaded') {
    staged = null;
    /* Counts toward the weekly task — fire-and-forget, only for an upload Derpibooru confirmed. */
    void recordWeeklyUpload(owner).then(() => tasks.expire({ token: owner }), () => {});
    emit({ owner, draft: EMPTY_DRAFT, job: { phase: 'settled', progress: 1, outcome } });
    if (screens === 0) {
      showToast(`已发布作品，图片 ID：${outcome.imageId}`, 'success', {
        action: { label: '查看', onClick: () => navigate(`/pic/${outcome.imageId}`) },
      });
    }
    return;
  }
  setJob(owner, { phase: 'settled', progress: null, outcome });
  if (screens === 0) {
    showToast(outcome.kind === 'unconfirmed' ? '未能确认作品是否已发布' : '作品发布失败', 'error', {
      action: { label: '查看', onClick: () => navigate('/upload') },
    });
  }
}
