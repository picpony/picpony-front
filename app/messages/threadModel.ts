import type { Message } from '@/lib/types/message';
import { formatClock, formatDate, formatDayLabel, parseBackendTime } from '@/lib/format';
import type { OutboxItem } from './outbox';

/*
 * The conversation's arithmetic — merging pages, placing the read receipts, choosing the tab a
 * visit opens on and the tabs it is offered. Pure, so it is tested without a DOM.
 */

/**
 * Every message this screen has seen, oldest first.
 *
 * Pages are offsets from the newest message, so three new messages push the oldest three of
 * page 1 onto page 2 — a thread rebuilt from the current page 1 and an older page 2 read before
 * the shift would lose them. The thread is the union of everything read instead; a later copy
 * of a message wins, which is how 已读 reaches a message already on screen.
 */
export function mergeMessages(previous: readonly Message[], incoming: readonly Message[]): Message[] {
  if (incoming.length === 0) return previous as Message[];
  const byId = new Map<number, Message>();
  for (const message of previous) byId.set(message.id, message);
  let changed = false;
  for (const message of incoming) {
    const known = byId.get(message.id);
    if (!known || known.is_read !== message.is_read || known.content !== message.content) {
      byId.set(message.id, message);
      changed = true;
    }
  }
  if (!changed) return previous as Message[];
  return Array.from(byId.values()).sort((a, b) => a.id - b.id);
}

/**
 * Where the delivery marks go.
 *
 * 已读 sits under the newest of your messages the other side has read; when you have written
 * since, 已送达 sits under the newest one as well — so the thread says both how far they have
 * read and that the rest arrived. A mark under every bubble is a column of noise.
 */
export function receiptPlacement(
  messages: readonly Message[],
  isOwn: (message: Message) => boolean,
): { readId: number | null; deliveredId: number | null } {
  let newest: Message | null = null;
  let newestRead: Message | null = null;
  for (const message of messages) {
    if (!isOwn(message)) continue;
    newest = message;
    if (message.is_read) newestRead = message;
  }
  if (!newest) return { readId: null, deliveredId: null };
  if (newest.is_read) return { readId: newest.id, deliveredId: null };
  return { readId: newestRead?.id ?? null, deliveredId: newest.id };
}

/** The Beijing calendar day of a backend stamp, as a grouping key. */
export function dayKey(value: string): string {
  return (value || '').slice(0, 10);
}

/** Two messages this far apart are two turns, however brief the pause looked. */
export const RUN_BREAK_MS = 5 * 60 * 1000;

/** Whether a turn ends between `a` and `b` for a reason other than the speaker changing. */
export function breaksRun(a: Message, b: Message): boolean {
  if (dayKey(a.created_at) !== dayKey(b.created_at)) return true;
  const left = parseBackendTime(a.created_at);
  const right = parseBackendTime(b.created_at);
  return Boolean(left && right && right.getTime() - left.getTime() >= RUN_BREAK_MS);
}

/**
 * Which outgoing items the server's copy has reached, so each message is on screen once.
 *
 * A message is shown the moment it is sent and stays until the conversation's next read shows
 * the server's copy. The copy is the first message of yours newer than everything the thread
 * knew when the item was queued, with the same text — or, for an item the server has accepted,
 * simply the next such message: messages to one person go out in order, so their copies arrive
 * in that order too, and a server that normalises what it stores (whitespace, escaping) must
 * not leave a delivered message on screen twice.
 */
export function matchOutgoing(
  messages: readonly Message[],
  outgoing: readonly OutboxItem[],
  isOwn: (message: Message) => boolean,
): { pending: OutboxItem[]; arrived: string[] } {
  const own = messages.filter(isOwn);
  const claimed = new Set<number>();
  const pending: OutboxItem[] = [];
  const arrived: string[] = [];
  for (const item of outgoing) {
    if (item.status === 'failed') {
      pending.push(item);
      continue;
    }
    const candidates = own.filter((message) => message.id > item.afterId && !claimed.has(message.id));
    const match =
      candidates.find((message) => message.content === item.content) ??
      (item.status === 'sent' ? candidates[0] : undefined);
    if (match) {
      claimed.add(match.id);
      arrived.push(item.localId);
    } else {
      pending.push(item);
    }
  }
  return { pending, arrived };
}

/**
 * A contact row's time, as a messenger prints it: the clock for today, then 昨天, a weekday
 * within the week, and the date beyond. The absolute date until the clock is known.
 */
export function contactTime(value: string, now: number | null): string {
  if (!value) return '';
  if (now === null) return formatDate(value);
  const label = formatDayLabel(value, now, { clock: false });
  return label === '今天' ? formatClock(value) : label;
}

// ---------------------------------------------------------------------------
// The tab a visit opens on
// ---------------------------------------------------------------------------

export type MessagesTab = 'announcement' | 'notification' | 'interaction' | 'chat';

export const MESSAGE_TABS: readonly MessagesTab[] = ['announcement', 'notification', 'interaction', 'chat'];

export function isMessagesTab(value: unknown): value is MessagesTab {
  return typeof value === 'string' && (MESSAGE_TABS as readonly string[]).includes(value);
}

/**
 * What a signed-out visitor is offered (decision 22): the site's own notices, which read without
 * a token. 互动 and 私信 are somebody's own, and are not in the row at all until there is a
 * somebody.
 */
export const PUBLIC_TABS: readonly MessagesTab[] = ['announcement', 'notification'];

export function isPublicTab(tab: MessagesTab): boolean {
  return PUBLIC_TABS.includes(tab);
}

/**
 * The tab a request lands on. Signed out, a link into 互动 or 私信 opens 系统: the public part
 * of the notices the link was sent into, and the tab beside where the missing ones would be —
 * where 公告 would read as the screen having ignored the link.
 */
export function landingTab(tab: MessagesTab, signedIn: boolean): MessagesTab {
  return signedIn || isPublicTab(tab) ? tab : 'notification';
}

/** What a signed-out link asked for that only an account can show. */
export interface PersonalRequest {
  tab: 'interaction' | 'chat';
  /** The person a `?to=` / `?user=` link named, whose conversation opens with 私信. */
  user: number | null;
}

/**
 * The personal half of a request, or `null` when there is none. Kept by a signed-out screen, so
 * a sign-in on the spot opens what the link was for.
 */
export function personalRequest(tab: MessagesTab | null, user: number | null): PersonalRequest | null {
  if (user !== null) return { tab: 'chat', user };
  return tab === 'interaction' || tab === 'chat' ? { tab, user: null } : null;
}

export interface UnreadByTab {
  notification: number;
  interaction: number;
  chat: number;
}

/**
 * The tab to open on. A link that names one wins. Otherwise the unread items do: the tab you
 * were last on if it has some, else the first tab that has any — the bell used to land on 公告
 * while the unread messages waited two tabs away. With nothing unread, the tab you were last on,
 * or 公告. Signed out, only a tab the row offers (`landingTab`).
 */
export function chooseInitialTab({
  requested,
  stored,
  unread,
  signedIn,
}: {
  requested: MessagesTab | null;
  stored: MessagesTab | null;
  unread: UnreadByTab | null;
  signedIn: boolean;
}): MessagesTab {
  if (requested) return landingTab(requested, signedIn);
  if (unread && signedIn) {
    if (stored && stored !== 'announcement' && unread[stored] > 0) return stored;
    const first = (['notification', 'interaction', 'chat'] as const).find((tab) => unread[tab] > 0);
    if (first) return first;
  }
  return landingTab(stored ?? 'announcement', signedIn);
}
