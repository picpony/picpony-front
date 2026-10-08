'use client';

import { readToken } from '@/lib/hooks';

/*
 * Unsent text, per conversation, for the length of the session.
 *
 * Switching conversations, backing out of one on a phone and pressing Esc all used to empty the
 * composer; a half-written message is the user's, not the screen's. Kept in memory rather than
 * in storage — a reload is a deliberate fresh start, and nothing private is written to disk —
 * and keyed by the session's token, with every other account's drafts dropped the moment the
 * session changes, so a sign-in on a shared device never sees the previous person's words.
 */

const drafts = new Map<string, string>();
let listening = false;

function keyOf(token: string, contactId: number) {
  return `${token}\n${contactId}`;
}

function prune() {
  const token = readToken();
  for (const key of drafts.keys()) {
    if (!token || !key.startsWith(`${token}\n`)) drafts.delete(key);
  }
}

function listen() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('user_info_updated', prune);
  window.addEventListener('storage', prune);
}

/** The serialised draft (`$emoji_…$` markers and all), or an empty string. */
export function readDraft(token: string, contactId: number): string {
  return drafts.get(keyOf(token, contactId)) ?? '';
}

export function writeDraft(token: string, contactId: number, value: string) {
  listen();
  const key = keyOf(token, contactId);
  if (value.trim()) drafts.set(key, value);
  else drafts.delete(key);
}
