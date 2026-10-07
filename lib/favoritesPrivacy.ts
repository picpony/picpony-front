'use client';

/**
 * The privacy space's unlocked state, in memory only. Its password is never kept here. Lock,
 * expiry, sign-out and account changes drop the list and invalidate every older answer.
 *
 * Presence is the original front end's five-second heartbeat, only while the space is on screen
 * and the document visible. Leaving sends `active: false` with keepalive and starts the chosen
 * unlock duration. The deadline is checked on return too: a suspended tab cannot extend it by
 * cancelling a timer the browser has not yet delivered.
 */
import { useSyncExternalStore } from 'react';
import * as api from '@/lib/api/favorites';
import { isAborted, isApiError } from '@/lib/api/errors';
import { LS_KEYS } from '@/lib/constants';
import { readToken } from '@/lib/hooks';
import { DEFAULT_PRIVACY_UNLOCK_SECONDS, parseUnlockSeconds } from '@/lib/favorites';
import { favouritesChanged } from '@/lib/favoritesActions';
import { clearImageSequence } from '@/lib/imageSequence';
import type { PonyImage } from '@/lib/types/image';

export const HEARTBEAT_MS = 5_000;
export type PrivacyStatus = 'unknown' | 'checking' | 'check-failed' | 'no-password' | 'locked' | 'loading' | 'open' | 'list-failed';

export interface PrivacySnapshot {
  token: string | null;
  status: PrivacyStatus;
  images: readonly PonyImage[] | null;
  error: unknown;
  autoLocked: boolean;
  /** A confirming read over the still-visible list, never a second first-load skeleton. */
  refreshing: boolean;
}

const INITIAL: PrivacySnapshot = { token: null, status: 'unknown', images: null, error: null, autoLocked: false, refreshing: false };
let snapshot = INITIAL;
let generation = 0;
let listVersion = 0;
let readController: AbortController | null = null;
let checking: Promise<void> | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let expiry: ReturnType<typeof setTimeout> | null = null;
let expiresAt: number | null = null;
let present = 0;
let bound = false;
const listeners = new Set<() => void>();

function publish(next: Partial<PrivacySnapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

function unlockMs() {
  let raw: string | null = null;
  try { raw = localStorage.getItem(LS_KEYS.privacyUnlockSeconds); } catch { /* The default remains. */ }
  return (parseUnlockSeconds(raw) ?? DEFAULT_PRIVACY_UNLOCK_SECONDS) * 1000;
}

const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';
const unlocked = () => snapshot.status === 'open' || snapshot.status === 'loading' || snapshot.status === 'list-failed';

function stopHeartbeat() {
  if (heartbeat !== null) clearInterval(heartbeat);
  heartbeat = null;
}
function clearExpiry() {
  if (expiry !== null) clearTimeout(expiry);
  expiry = null;
  expiresAt = null;
}
function cancelRead() {
  listVersion += 1;
  readController?.abort();
  readController = null;
}
function presence(token: string, active: boolean) {
  void api.setPrivacyFavesPresence(token, active, { keepalive: !active }).catch(() => {});
}

function startHeartbeat() {
  const token = snapshot.token;
  if (!token || !unlocked() || present === 0 || !visible()) return;
  if (expiresAt !== null && Date.now() >= expiresAt) {
    lockPrivacy(token, { auto: true });
    return;
  }
  clearExpiry();
  if (heartbeat !== null) return;
  presence(token, true);
  heartbeat = setInterval(() => {
    if (readToken() !== token) { sessionChanged(); return; }
    if (present === 0 || !visible() || !unlocked()) { leftScreen(); return; }
    presence(token, true);
  }, HEARTBEAT_MS);
}

function leftScreen() {
  const token = snapshot.token;
  const wasBeating = heartbeat !== null;
  stopHeartbeat();
  if (token && wasBeating) presence(token, false);
  if (!token || !unlocked() || expiresAt !== null) return;
  const asked = generation;
  expiresAt = Date.now() + unlockMs();
  expiry = setTimeout(() => {
    expiry = null;
    if (generation === asked && snapshot.token === token) lockPrivacy(token, { auto: true });
  }, unlockMs());
}

function sessionChanged() {
  const token = readToken();
  if (token === snapshot.token) return;
  if (snapshot.token) clearImageSequence(`fave-privacy:${snapshot.token}`);
  if (snapshot.token && heartbeat !== null) presence(snapshot.token, false);
  generation += 1;
  checking = null;
  cancelRead();
  stopHeartbeat();
  clearExpiry();
  present = 0;
  publish({ ...INITIAL, token });
}

function bind() {
  if (bound || typeof window === 'undefined') return;
  bound = true;
  window.addEventListener('user_info_updated', sessionChanged);
  window.addEventListener('storage', (event) => {
    if (event.key === null || event.key === LS_KEYS.userInfo) sessionChanged();
  });
  document.addEventListener('visibilitychange', () => {
    if (visible()) startHeartbeat();
    else leftScreen();
  });
  window.addEventListener('pagehide', leftScreen);
  window.addEventListener('pageshow', startHeartbeat);
}

function ownSession(token: string) {
  bind();
  if (snapshot.token !== token) sessionChanged();
  return snapshot.token === token && readToken() === token;
}
function requireSession(token: string) {
  if (!ownSession(token)) throw new DOMException('session changed', 'AbortError');
}

async function loadList(token: string) {
  cancelRead();
  const controller = new AbortController();
  readController = controller;
  const version = listVersion;
  const asked = generation;
  const hasList = snapshot.images !== null;
  publish({ status: hasList ? 'open' : 'loading', refreshing: hasList, error: null });
  if (present > 0 && visible()) startHeartbeat();
  else leftScreen();
  const current = () => generation === asked && listVersion === version && snapshot.token === token && readToken() === token;
  try {
    const images = await api.getPrivacyFaves(token, controller.signal);
    if (!current()) return;
    publish({ status: 'open', images, refreshing: false, error: null, autoLocked: false });
  } catch (error) {
    if (!current() || isAborted(error)) return;
    if (isApiError(error) && (error.status === 403 || /锁定|未解锁|请.*解锁|需要.*密码|密码.*过期/.test(error.serverMessage ?? ''))) {
      lockPrivacy(token);
      return;
    }
    publish({ status: hasList ? 'open' : 'list-failed', refreshing: false, error });
  } finally {
    if (readController === controller) readController = null;
  }
}

/** Ask once, joining Strict Mode's repeated mount; an explicit local lock never reopens itself. */
export function checkPrivacy(token: string): Promise<void> {
  if (!ownSession(token)) return Promise.resolve();
  if (checking) return checking;
  const asked = generation;
  publish({ status: 'checking', error: null });
  const work = (async () => {
    try {
      const { hasPassword, unlocked: serverUnlocked } = await api.checkHasPrivacyPassword(token);
      if (generation !== asked || !ownSession(token)) return;
      if (hasPassword && serverUnlocked) await loadList(token);
      else publish({ status: hasPassword ? 'locked' : 'no-password', images: null, refreshing: false });
    } catch (error) {
      if (generation !== asked || !ownSession(token)) return;
      publish({ status: 'check-failed', error });
    }
  })();
  checking = work;
  void work.finally(() => { if (checking === work) checking = null; });
  return work;
}

export async function createPrivacyPassword(token: string, password: string) {
  requireSession(token);
  const asked = generation;
  await api.setPrivacyPassword(token, password);
  if (generation === asked && ownSession(token)) await loadList(token);
}
export async function unlockPrivacy(token: string, password: string) {
  requireSession(token);
  const asked = generation;
  await api.verifyPrivacyPassword(token, password);
  if (generation === asked && ownSession(token)) await loadList(token);
}

/** Local lock is immediate; a slow or failed backend acknowledgement cannot keep the list visible. */
export function lockPrivacy(token: string, { auto = false }: { auto?: boolean } = {}) {
  if (snapshot.token !== token) return;
  clearImageSequence(`fave-privacy:${token}`);
  const wasUnlocked = unlocked() || snapshot.status === 'checking';
  if (heartbeat !== null) presence(token, false);
  generation += 1;
  checking = null;
  cancelRead();
  stopHeartbeat();
  clearExpiry();
  if (wasUnlocked) publish({ status: 'locked', images: null, error: null, autoLocked: auto, refreshing: false });
  if (readToken() === token) void api.lockPrivacySpace(token, { keepalive: auto }).catch(() => {});
}

export async function changePrivacyPassword(token: string, oldPassword: string, newPassword: string) {
  requireSession(token);
  await api.changePrivacyPassword(token, oldPassword, newPassword);
}

/** Verify the account password before clearing the space; never send step two for an old session. */
export async function resetPrivacy(token: string, accountPassword: string) {
  requireSession(token);
  await api.verifyAccountPassword(token, accountPassword).catch((error: unknown) => {
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { step: 'verify' as const });
  });
  requireSession(token);
  await api.resetPrivacySpace(token, accountPassword);
  if (!ownSession(token)) return;
  clearImageSequence(`fave-privacy:${token}`);
  generation += 1;
  cancelRead();
  stopHeartbeat();
  clearExpiry();
  publish({ status: 'no-password', images: null, error: null, autoLocked: false, refreshing: false });
  favouritesChanged(token);
}

export async function reloadPrivacy(token: string) {
  if (!ownSession(token)) return;
  if (unlocked()) await loadList(token);
  else await checkPrivacy(token);
}

export function forgetPrivacyPictures(token: string, ids: readonly number[]) {
  if (!ownSession(token) || !snapshot.images || ids.length === 0) return;
  cancelRead();
  const gone = new Set(ids);
  publish({ images: snapshot.images.filter((image) => !gone.has(image.id)), refreshing: false });
}
export function addPrivacyPictures(token: string, images: readonly PonyImage[]) {
  if (!ownSession(token) || !snapshot.images) return;
  const known = new Set(snapshot.images.map((image) => image.id));
  const fresh = images.filter((image) => !known.has(image.id));
  if (fresh.length === 0) return;
  cancelRead();
  publish({ images: [...fresh, ...snapshot.images], refreshing: false });
}
export async function restoreToPrivacy(token: string, image: PonyImage) {
  requireSession(token);
  await api.addPrivacyFave(token, image);
  addPrivacyPictures(token, [image]);
  favouritesChanged(token);
}

export async function removeFromPrivacy(
  token: string,
  ids: readonly number[],
  { signal, onProgress }: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ removed: number[]; failed: { id: number; error: unknown }[] }> {
  const removed: number[] = [];
  const failed: { id: number; error: unknown }[] = [];
  for (const id of ids) {
    if (signal?.aborted || !ownSession(token)) break;
    try { await api.removePrivacyFave(token, id); removed.push(id); }
    catch (error) { failed.push({ id, error }); }
    onProgress?.(removed.length + failed.length, ids.length);
  }
  forgetPrivacyPictures(token, removed);
  if (removed.length > 0) favouritesChanged(token);
  return { removed, failed };
}

/** Acquire a visible-screen lease. An old account's cleanup cannot release the next account's. */
export function enterPrivacyScreen(token: string): () => void {
  if (!ownSession(token)) return () => {};
  present += 1;
  startHeartbeat();
  let left = false;
  return () => {
    if (left) return;
    left = true;
    if (snapshot.token !== token) return;
    present = Math.max(0, present - 1);
    if (present === 0) leftScreen();
  };
}

function subscribe(listener: () => void) {
  bind();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function usePrivacySpace(token: string | null): PrivacySnapshot {
  const current = useSyncExternalStore(subscribe, () => snapshot, () => INITIAL);
  return current.token === token ? current : { ...INITIAL, token };
}
/** The store's view for its regression tests. */
export function privacySnapshot() {
  return { ...snapshot, present, beating: heartbeat !== null, expiring: expiresAt !== null };
}
