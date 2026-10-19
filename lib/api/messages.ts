import { getRawImageUrl } from '@/lib/imageLoader';
import type {
  Announcement,
  AnnouncementPage,
  ChatUser,
  Contact,
  ConversationPage,
  Message,
  Notification,
  NotificationPage,
} from '@/lib/types/message';
import type { ImageRepresentation } from '@/lib/types/image';
import { api, seg } from './http';
import { createCursorPager, type CursorPage } from './cursorPages';
import { sanitizeAnnouncements } from './picpony';
import { randomId } from '@/lib/utils';

/*
 * The inbox and direct messages over the Rust backend (`/api/v1`): strict reads — a normalised
 * page of rows or an `ApiError` — plus the writes and the share-card wire format.
 *
 * The backend pages these lists by cursor (`before` / `next_cursor`, newest first) and reports
 * no totals; the screens page by number, so `lib/api/cursorPages.ts` keeps each list's cursors
 * and `totalPages` is the pages known to exist. Reading no longer marks anything read on the
 * server: a conversation's page 1 and the notices on screen are marked with their own writes.
 *
 * Every read that polls or that another person changes is `no-store`.
 */

// ---------------------------------------------------------------------------
// The backend's rows (src/pg/messages.rs, src/pg/notices.rs, src/pg/profiles.rs)
// ---------------------------------------------------------------------------

interface WireUser {
  id: number;
  username: string;
  avatar: string | null;
}

interface WireContact {
  /** The conversation's newest message id — the list's cursor, not the person. */
  id: number;
  user_id: number;
  username: string;
  avatar: string | null;
  experience: number;
  last_message_at: string;
  unread_count: number;
  /** The conversation's newest message: its first 120 characters, as stored (sanitizer entities included). */
  last_message: { id: number; sender_id: number; preview: string; truncated: boolean; created_at: string };
}

interface WireMessage {
  id: number;
  sender_id: number;
  receiver_id: number;
  content: string;
  read_at: string | null;
  created_at: string;
  sender: WireUser;
}

interface WireNotification {
  id: number;
  kind: 'system' | 'interaction' | 'announcement';
  title: string;
  content: string;
  important: boolean;
  broadcast: boolean;
  created_at: string;
  /** Always `true` for a signed-out read. */
  read: boolean;
}

interface WireAnnouncement {
  id: number;
  version: string;
  title: string;
  content: string;
  created_at: string;
}

type Keyset<K extends string, T> = { [key in K]: T[] } & { next_cursor: number | null };

const pager = createCursorPager();

/** 公告 ten to a page, as the screen always showed them. */
const ANNOUNCEMENT_PAGE = 10;
const NOTIFICATION_PAGE = 20;
const CONVERSATION_PAGE = 50;
/** The contact list is one page: the backend's largest. */
const CONTACT_PAGE = 100;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** 公告: public, paged. Bodies are sanitised here, the same way the pop-up's are. */
export async function readAnnouncementHistory(page: number, signal?: AbortSignal): Promise<AnnouncementPage> {
  const result = await pager.read('announcements', page, async (before, s): Promise<CursorPage<WireAnnouncement>> => {
    const data = await api<Keyset<'announcements', WireAnnouncement>>('GET', '/announcements', {
      query: { before, limit: ANNOUNCEMENT_PAGE },
      signal: s,
    });
    return { rows: data.announcements, next: data.next_cursor };
  }, signal);
  const rows: Announcement[] = result.rows.map((row) => ({
    id: row.id,
    version: row.version,
    title: row.title,
    content: row.content,
    date: row.created_at,
  }));
  return { announcements: await sanitizeAnnouncements(rows), totalPages: result.totalPages };
}

/**
 * 系统 or 互动, paged. The system list is public — a signed-out visitor reads the site-wide
 * notices without a token — while the interaction list needs one.
 *
 * 系统 is every notice that is not an interaction: the backend's `system` and `announcement`
 * kinds, which its unread count also counts together — asked for as `exclude_kind=interaction`,
 * so every page is a full one.
 */
export async function readNotifications(
  token: string | null,
  type: 'system' | 'interaction',
  page: number,
  signal?: AbortSignal,
): Promise<NotificationPage> {
  const result = await pager.read(`notifications:${token ?? 'guest'}:${type}`, page, async (before, s) => {
    const data = await api<Keyset<'notifications', WireNotification>>('GET', '/notifications', {
      token: token ?? undefined,
      query: { before, limit: NOTIFICATION_PAGE, ...(type === 'interaction' ? { kind: 'interaction' } : { exclude_kind: 'interaction' }) },
      cache: 'no-store',
      signal: s,
    });
    return { rows: data.notifications, next: data.next_cursor };
  }, signal);
  return {
    notifications: result.rows.map((row): Notification => ({
      id: row.id,
      title: row.title,
      content: row.content,
      is_read: row.read ? 1 : 0,
      created_at: row.created_at,
    })),
    totalPages: result.totalPages,
  };
}

/** Marks notices read (1–100 ids, the backend's bound). Resolves with how many changed. */
export async function markNotificationsRead(token: string, ids: readonly number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const data = await api<{ marked: number }>('POST', '/me/notifications/read-receipts', {
    token,
    json: { ids: ids.slice(0, 100) },
  });
  return data.marked;
}

/**
 * The people the account has conversations with, the most recent first, each with the start of
 * the newest message (`last_message.preview`, at most 120 characters, `truncated` when cut) — the
 * row turns it into one line (`contactPreview` in `app/messages/messageText.ts`).
 */
export async function readRecentContacts(token: string, signal?: AbortSignal): Promise<Contact[]> {
  const data = await api<Keyset<'contacts', WireContact>>('GET', '/me/contacts', {
    token,
    query: { limit: CONTACT_PAGE },
    cache: 'no-store',
    signal,
  });
  return data.contacts.map((row) => ({
    id: row.user_id,
    username: row.username,
    avatar: row.avatar,
    last_msg_time: row.last_message_at,
    unread_count: row.unread_count,
    last_message: row.last_message.preview,
    last_message_truncated: row.last_message.truncated,
  }));
}

/**
 * One page of the conversation with `withUserId`, oldest first (the backend's own order). Page 1
 * is the newest messages; reading it marks the other side's messages on it read, with the
 * backend's read receipt — a read does not do that by itself any more.
 */
export async function readConversation(
  token: string,
  withUserId: number,
  page: number,
  signal?: AbortSignal,
): Promise<ConversationPage> {
  const result = await pager.read(`conversation:${token}:${withUserId}`, page, async (before, s) => {
    const data = await api<Keyset<'messages', WireMessage>>('GET', `/me/conversations/${seg(withUserId)}/messages`, {
      token,
      query: { before, limit: CONVERSATION_PAGE },
      cache: 'no-store',
      signal: s,
    });
    return { rows: data.messages, next: data.next_cursor };
  }, signal);
  if (result.page === 1) {
    let upTo = 0;
    for (const row of result.rows) if (row.sender_id === withUserId && row.read_at === null) upTo = Math.max(upTo, row.id);
    /* Awaited, so the screen's badge correction (and its re-read of the count) comes after the
       receipt rather than racing it; never fatal to the read itself. */
    if (upTo > 0) {
      await api('POST', `/me/conversations/${seg(withUserId)}/read-receipts`, { token, json: { up_to: upTo } }).catch(() => {});
    }
  }
  return {
    messages: result.rows.map((row): Message => ({
      id: row.id,
      sender_id: row.sender_id,
      receiver_id: row.receiver_id,
      content: row.content,
      is_read: row.read_at !== null ? 1 : 0,
      created_at: row.created_at,
      sender_name: row.sender.username,
      sender_avatar: row.sender.avatar,
    })),
    hasMore: result.hasMore,
    page: result.page,
  };
}

/** People to start a conversation with, by name. */
export async function searchUsers(token: string, keyword: string, signal?: AbortSignal): Promise<ChatUser[]> {
  const data = await api<{ users: (WireUser & { experience: number })[]; next_cursor: number | null }>('GET', '/users', {
    token,
    query: { keyword, limit: 20 },
    signal,
  });
  return data.users.map(({ id, username, avatar }) => ({ id, username, avatar }));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Send one message. Resolves once the server has accepted it and throws `ApiError` otherwise —
 * the refusal's own sentence is the error's message. No deadline, like every write.
 *
 * `idempotencyKey` names this one send: a retry of the same message passes the same key, so a
 * send whose answer was lost is not written twice; a new message gets a new one.
 */
export async function sendMessage(
  token: string,
  receiverId: number,
  content: string,
  idempotencyKey: string = randomId(),
): Promise<void> {
  await api('POST', `/me/conversations/${seg(receiverId)}/messages`, {
    token,
    json: { content },
    idempotencyKey,
  });
}

// ---------------------------------------------------------------------------
// Share cards — the original front end's wire format, verbatim
// ---------------------------------------------------------------------------

/**
 * Something shared into a conversation as a card. The content of the message *is* the card:
 *
 *     [image_share:<imageId>:<encodeURIComponent(thumbUrl)>]
 *     [fave_folder_share:<encodeURIComponent(ownerUsername)>:<folderId>:<encodeURIComponent(folderName)>]
 *     [privacy_space_share:<ownerId>:<ownerName>]
 *
 * Byte for byte what the original front end sends and matches (its patterns are anchored to the
 * whole message), so a card sent from either front end renders as a card in both.
 */
export type ShareTarget =
  | { kind: 'image'; imageId: number; thumbUrl: string }
  | { kind: 'fave-folder'; ownerUsername: string; folderId: number; folderName: string }
  | { kind: 'privacy-space'; ownerId: number; ownerName: string };

/** A positive integer id out of a card's digits, or `null`. */
function idOf(digits: string): number | null {
  const n = Number(digits);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * The thumbnail a card carries: the picture's `small` (else `thumb`, else `medium`)
 * representation, absolute, and **raw** — the image line (a proxy wrapper) is the sender's, and
 * the recipient's own line is applied when the card is drawn.
 */
export function shareThumbUrl(representations: Partial<ImageRepresentation> | null | undefined): string {
  const chosen = representations?.small || representations?.thumb || representations?.medium || '';
  return absoluteImageUrl(chosen);
}

function absoluteImageUrl(url: string): string {
  const value = url.trim();
  if (!value) return '';
  const absolute = value.startsWith('//')
    ? `https:${value}`
    : value.startsWith('/')
      ? `https://derpibooru.org${value}`
      : value;
  return getRawImageUrl(absolute);
}

export function encodeShare(target: ShareTarget): string {
  switch (target.kind) {
    case 'image':
      return `[image_share:${target.imageId}:${encodeURIComponent(absoluteImageUrl(target.thumbUrl))}]`;
    case 'fave-folder':
      return `[fave_folder_share:${encodeURIComponent(target.ownerUsername)}:${target.folderId}:${encodeURIComponent(target.folderName)}]`;
    case 'privacy-space':
      /* Not encoded, as the original sends it; a closing bracket would end the card early, so it
         is the one character that cannot pass. */
      return `[privacy_space_share:${target.ownerId}:${target.ownerName.replace(/\]/g, '］')}]`;
  }
}

const IMAGE_SHARE = /^\[image_share:(\d+):(.*)\]$/;
const FOLDER_SHARE = /^\[fave_folder_share:([^:]+):(\d+):(.*)\]$/;
const PRIVACY_SHARE = /^\[privacy_space_share:(\d+):([^\]]+)\]$/;

/** The card a message is, or `null` for an ordinary message. */
export function parseShare(content: string): ShareTarget | null {
  const value = content.trim();
  let match = PRIVACY_SHARE.exec(value);
  if (match) {
    const ownerId = idOf(match[1]);
    return ownerId === null ? null : { kind: 'privacy-space', ownerId, ownerName: match[2] };
  }
  match = IMAGE_SHARE.exec(value);
  if (match) {
    const imageId = idOf(match[1]);
    if (imageId === null) return null;
    const thumb = safeDecode(match[2]);
    return { kind: 'image', imageId, thumbUrl: /^https?:\/\//i.test(thumb) ? thumb : '' };
  }
  match = FOLDER_SHARE.exec(value);
  if (match) {
    const folderId = idOf(match[2]);
    if (folderId === null) return null;
    return {
      kind: 'fave-folder',
      ownerUsername: safeDecode(match[1]),
      folderId,
      folderName: safeDecode(match[3]) || '收藏夹',
    };
  }
  return null;
}

/**
 * Where a card leads. The folder route is `/favorites/shared/[username]/[folderId]`, and the
 * privacy space's `/favorites/privacy/[ownerId]` — both built with the favourites screens.
 */
export function shareHref(target: ShareTarget): string {
  switch (target.kind) {
    case 'image':
      return `/pic/${target.imageId}`;
    case 'fave-folder':
      return `/favorites/shared/${encodeURIComponent(target.ownerUsername)}/${target.folderId}`;
    case 'privacy-space':
      return `/favorites/privacy/${target.ownerId}`;
  }
}

/** A card as one line of text — a contact row's preview, a notification. */
export function shareSummary(target: ShareTarget): string {
  switch (target.kind) {
    case 'image':
      return '[图片]';
    case 'fave-folder':
      return `[收藏夹] ${target.folderName}`;
    case 'privacy-space':
      return '[隐私空间]';
  }
}
