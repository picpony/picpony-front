'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { sendMessage } from '@/lib/api/messages';
import { apiErrorMessage } from '@/lib/api/errors';
import { conversationPage, recentContacts } from '@/lib/resources';
import { readToken } from '@/lib/hooks';
import { showToast } from '@/components/Toast';

/*
 * Messages on their way out — shown in the thread the moment they are sent, the way every
 * messenger does, rather than after a round trip.
 *
 * Module scope, not component state, for three reasons: a send outlives the conversation it was
 * written in (switch contacts, turn the phone, back out), sends to one person go out **in
 * order** (one chain per conversation), and a failure must survive to be retried — the text was
 * the user's, and a toast alone used to be the only trace of a message that never left.
 *
 * An item is `sending`, then `sent` until the conversation's next read shows the server's copy
 * (so the bubble never blinks out for the frame between the two), or `failed` with 重试 and
 * 删除. Keyed by the session's token; another account's items are dropped when the session
 * changes.
 */

export type OutboxStatus = 'sending' | 'sent' | 'failed';

export interface OutboxItem {
  localId: string;
  contactId: number;
  /** Serialised, exactly as sent. */
  content: string;
  status: OutboxStatus;
  /** The newest server message id known when this was queued; its server copy is newer. */
  afterId: number;
  /** A backend-style stamp (Beijing wall-clock), so the thread groups it into today. */
  createdAt: string;
}

const EMPTY: readonly OutboxItem[] = Object.freeze([]);
const items = new Map<string, readonly OutboxItem[]>();
const listeners = new Map<string, Set<() => void>>();
const chains = new Map<string, Promise<void>>();
let listening = false;
let sequence = 0;

function keyOf(token: string, contactId: number) {
  return `${token}\n${contactId}`;
}

function publish(key: string, next: readonly OutboxItem[]) {
  if (next.length) items.set(key, Object.freeze(next));
  else items.delete(key);
  for (const listener of listeners.get(key) ?? []) listener();
}

function update(key: string, localId: string, patch: Partial<OutboxItem>) {
  const current = items.get(key) ?? EMPTY;
  if (!current.some((item) => item.localId === localId)) return;
  publish(key, current.map((item) => (item.localId === localId ? { ...item, ...patch } : item)));
}

function prune() {
  const token = readToken();
  for (const key of Array.from(items.keys())) {
    if (!token || !key.startsWith(`${token}\n`)) publish(key, EMPTY);
  }
}

function listen() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('user_info_updated', prune);
  window.addEventListener('storage', prune);
}

/** Beijing wall-clock `YYYY-MM-DD HH:mm:ss`, the shape the backend stamps messages with. */
function backendStamp(now: number): string {
  return new Date(now + 8 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ');
}

function transmit(token: string, key: string, item: OutboxItem) {
  const run = async () => {
    /* A session that changed while this waited in line is not the one that wrote it. */
    if (readToken() !== token || !(items.get(key) ?? EMPTY).some((entry) => entry.localId === item.localId)) return;
    try {
      await sendMessage(token, item.contactId, item.content);
      update(key, item.localId, { status: 'sent' });
      /* The server's copy replaces this one on the next read; the contact list re-sorts. */
      conversationPage.invalidate({ token, withUserId: item.contactId, page: 1 });
      recentContacts.expire({ token });
    } catch (error) {
      update(key, item.localId, { status: 'failed' });
      if (readToken() === token) showToast(apiErrorMessage(error, '发送失败'), 'error');
    }
  };
  const chain = (chains.get(key) ?? Promise.resolve()).then(run, run);
  chains.set(key, chain);
  void chain.finally(() => {
    if (chains.get(key) === chain) chains.delete(key);
  });
}

/** Queue a message. It appears in the thread at once and goes out after the ones before it. */
export function queueMessage(token: string, contactId: number, content: string, afterId: number) {
  listen();
  const key = keyOf(token, contactId);
  const now = Date.now();
  const item: OutboxItem = {
    localId: `local-${now}-${(sequence += 1)}`,
    contactId,
    content,
    status: 'sending',
    afterId,
    createdAt: backendStamp(now),
  };
  publish(key, [...(items.get(key) ?? EMPTY), item]);
  transmit(token, key, item);
}

export function retryMessage(token: string, contactId: number, localId: string, afterId: number) {
  const key = keyOf(token, contactId);
  const item = (items.get(key) ?? EMPTY).find((entry) => entry.localId === localId);
  if (!item || item.status !== 'failed') return;
  /* To the end of the line: it is sent now, after anything written since. */
  const retried: OutboxItem = { ...item, status: 'sending', afterId, createdAt: backendStamp(Date.now()) };
  publish(key, [...(items.get(key) ?? EMPTY).filter((entry) => entry.localId !== localId), retried]);
  transmit(token, key, retried);
}

export function discardMessage(token: string, contactId: number, localId: string) {
  const key = keyOf(token, contactId);
  publish(key, (items.get(key) ?? EMPTY).filter((entry) => entry.localId !== localId));
}

/** Drop the sent items whose server copies the thread now shows. */
export function settleSent(token: string, contactId: number, localIds: readonly string[]) {
  if (!localIds.length) return;
  const key = keyOf(token, contactId);
  const done = new Set(localIds);
  const current = items.get(key) ?? EMPTY;
  const next = current.filter((item) => !(item.status === 'sent' && done.has(item.localId)));
  if (next.length !== current.length) publish(key, next);
}

/** The conversation's outgoing items, as a value a component re-renders on. */
export function useOutbox(token: string, contactId: number): readonly OutboxItem[] {
  const key = keyOf(token, contactId);
  const subscribe = useCallback(
    (listener: () => void) => {
      let set = listeners.get(key);
      if (!set) listeners.set(key, (set = new Set()));
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(key);
      };
    },
    [key],
  );
  const read = useCallback(() => items.get(key) ?? EMPTY, [key]);
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}
