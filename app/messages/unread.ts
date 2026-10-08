'use client';

import { recentContacts, unreadCounts, type UnreadBreakdown } from '@/lib/resources';

/*
 * Reading something here marks it read on the server: page 1 of 系统 or 互动, a conversation.
 * The app bar's badge reads the same `unreadCounts` entry and polls it once a minute, so the
 * count is corrected **in place** at once — then re-read, so the server's own number has the
 * last word — rather than lingering for up to a minute after the thing it counts was read.
 *
 * Nothing is re-read when nothing was counted: a badge already at zero for this tab cannot be
 * corrected downwards, and a conversation opened every ten seconds of polling must not cost a
 * second request each time.
 */

type Tab = 'notification' | 'interaction' | 'chat';

const FIELD: Record<Tab, keyof Omit<UnreadBreakdown, 'total'>> = {
  notification: 'notifications',
  interaction: 'interactions',
  chat: 'messages',
};

/** `amount` unread items of `tab` were just read — all of them when it is omitted. */
export function markRead(token: string, tab: Tab, amount?: number) {
  const field = FIELD[tab];
  const previous = unreadCounts.peek({ token }).data;
  if (!previous) return;
  const cleared = Math.min(previous[field], amount ?? previous[field]);
  if (cleared <= 0) return;
  unreadCounts.write({ token }, {
    ...previous,
    [field]: previous[field] - cleared,
    total: Math.max(0, previous.total - cleared),
  });
  void unreadCounts.read({ token }, { force: true }).catch(() => {});
}

/**
 * A conversation was read: its row's count goes to zero at once and the badge follows.
 * `seenUnread` is how many unread messages from them the conversation itself showed — what the
 * badge counted for a conversation the contact list does not hold yet (a first message from
 * somebody new, a deep link).
 */
export function markConversationRead(token: string, contactId: number, seenUnread: number) {
  const row = recentContacts.peek({ token }).data?.find((contact) => contact.id === contactId);
  if (row && row.unread_count > 0) {
    recentContacts.write({ token }, (previous) =>
      (previous ?? []).map((contact) => (contact.id === contactId ? { ...contact, unread_count: 0 } : contact)),
    );
  }
  markRead(token, 'chat', Math.max(row?.unread_count ?? 0, seenUnread));
}
