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
import { ApiError } from './errors';
import { listOf, pageCount, picponyPostJson, picponyRequest, readEnvelope } from './http';
import { sanitizeAnnouncements } from './picpony';

/*
 * The inbox and direct messages: PicPony's messaging actions as **strict** reads — a normalised
 * page of rows or an `ApiError`, never `{ success: false }` for a caller to forget to check —
 * plus the two writes and the share-card wire format.
 *
 * Every read that polls or that another person changes (a conversation, the contact list, the
 * notification lists) is `no-store`: a cached answer is the one thing a poll must not get.
 */

// ---------------------------------------------------------------------------
// Normalising rows
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

/** Only objects survive into a list — a `null` row would crash the first `.id` read. */
function objects(value: unknown): Row[] {
  return listOf<unknown>(value).filter((row): row is Row => row !== null && typeof row === 'object');
}

/** A positive integer id off the wire (numbers and numeric strings both occur), or `null`. */
function idOf(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

function optionalText(value: unknown): string | null {
  const s = text(value).trim();
  return s ? s : null;
}

/** `is_read` and friends: `1`, `'1'` and `true` all mean yes. */
function flag(value: unknown): number {
  return value === true || value === 1 || value === '1' ? 1 : 0;
}

function countOf(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** The list a read exists to deliver: a success without it is a failure, never an empty list. */
function listField(data: Row, field: string): Row[] {
  if (!Array.isArray(data[field])) throw new ApiError('invalid');
  return objects(data[field]);
}

/** The last-message preview, under whichever name the backend used. */
const LAST_MESSAGE_FIELDS = ['last_message', 'last_msg', 'last_content', 'last_msg_content'] as const;

function toContact(row: Row): Contact | null {
  const id = idOf(row.id);
  if (id === null) return null;
  const contact: Contact = {
    id,
    username: optionalText(row.username) ?? optionalText(row.name) ?? `用户 ${id}`,
    avatar: optionalText(row.avatar),
    last_msg_time: text(row.last_msg_time),
    unread_count: countOf(row.unread_count),
  };
  for (const field of LAST_MESSAGE_FIELDS) {
    const value = row[field];
    if (typeof value === 'string') {
      contact.last_message = value;
      break;
    }
  }
  return contact;
}

function toMessage(row: Row): Message | null {
  const id = idOf(row.id);
  const sender = idOf(row.sender_id);
  if (id === null || sender === null) return null;
  return {
    id,
    sender_id: sender,
    receiver_id: idOf(row.receiver_id) ?? 0,
    content: text(row.content),
    is_read: flag(row.is_read),
    created_at: text(row.created_at),
    sender_name: optionalText(row.sender_name) ?? '',
    sender_avatar: optionalText(row.sender_avatar),
  };
}

function toNotification(row: Row): Notification | null {
  const id = idOf(row.id);
  if (id === null) return null;
  return {
    id,
    title: text(row.title),
    content: text(row.content),
    is_read: flag(row.is_read),
    created_at: text(row.created_at),
  };
}

function toChatUser(row: Row): ChatUser | null {
  const id = idOf(row.id);
  const username = optionalText(row.username) ?? optionalText(row.name);
  if (id === null || !username) return null;
  return { id, username, avatar: optionalText(row.avatar) };
}

function present<T>(value: T | null): value is T {
  return value !== null;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** 公告: public, paged. Bodies are sanitised here, the same way the pop-up's are. */
export async function readAnnouncementHistory(page: number, signal?: AbortSignal): Promise<AnnouncementPage> {
  const data = await readEnvelope<Row>(
    await picponyRequest('get_announcement_history', { query: { page }, signal }),
  );
  const rows = listField(data, 'announcements')
    .map((row): Announcement | null => {
      const id = idOf(row.id);
      if (id === null) return null;
      return { id, version: text(row.version), title: text(row.title), content: text(row.content), date: text(row.date) };
    })
    .filter(present);
  return { announcements: await sanitizeAnnouncements(rows), totalPages: pageCount(data.total_pages) };
}

/**
 * 系统 or 互动, paged. The system list is public — a signed-out visitor reads the site-wide
 * notices without a token, as the original front end did — while the interaction list needs one.
 */
export async function readNotifications(
  token: string | null,
  type: 'system' | 'interaction',
  page: number,
  signal?: AbortSignal,
): Promise<NotificationPage> {
  const data = await readEnvelope<Row>(
    await picponyRequest('get_notifications', {
      token: token ?? undefined,
      query: { type, page },
      cache: 'no-store',
      signal,
    }),
  );
  return {
    notifications: listField(data, 'notifications').map(toNotification).filter(present),
    totalPages: pageCount(data.total_pages),
  };
}

export async function readRecentContacts(token: string, signal?: AbortSignal): Promise<Contact[]> {
  const data = await readEnvelope<Row>(
    await picponyRequest('get_recent_contacts', { token, cache: 'no-store', signal }),
  );
  const seen = new Set<number>();
  return listField(data, 'contacts')
    .map(toContact)
    .filter((contact): contact is Contact => {
      if (!contact || seen.has(contact.id)) return false;
      seen.add(contact.id);
      return true;
    });
}

/**
 * One page of the conversation with `withUserId`, oldest first. Page 1 is the newest messages;
 * reading it also marks the other side's messages read, server-side. A body without `has_more`
 * is a conversation that fits one page.
 */
export async function readConversation(
  token: string,
  withUserId: number,
  page: number,
  signal?: AbortSignal,
): Promise<ConversationPage> {
  const data = await readEnvelope<Row>(
    await picponyRequest('get_messages', {
      token,
      query: { with_user_id: withUserId, page },
      cache: 'no-store',
      signal,
    }),
  );
  const messages = listField(data, 'messages').map(toMessage).filter(present);
  /* Oldest first, whatever order the page arrived in: the thread appends at the bottom. Ids are
     the backend's auto-increment, so they order a conversation without parsing a clock. */
  messages.sort((a, b) => a.id - b.id);
  return {
    messages,
    hasMore: data.has_more === true || data.has_more === 1 || data.has_more === '1',
    page: idOf(data.page) ?? page,
  };
}

/** `search_users`: people to start a conversation with. The body has used both field names. */
export async function searchUsers(token: string, keyword: string, signal?: AbortSignal): Promise<ChatUser[]> {
  const data = await readEnvelope<Row>(
    await picponyRequest('search_users', { token, query: { kw: keyword }, signal }),
  );
  const list = Array.isArray(data.users) ? data.users : Array.isArray(data.results) ? data.results : null;
  if (!list) throw new ApiError('invalid');
  const seen = new Set<number>();
  return objects(list)
    .map(toChatUser)
    .filter((user): user is ChatUser => {
      if (!user || seen.has(user.id)) return false;
      seen.add(user.id);
      return true;
    });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Send one message. Resolves once the server has accepted it and throws `ApiError` otherwise —
 * the refusal's own sentence (a rate limit, a blocked recipient) is the error's message. No
 * deadline, like every write: aborting a POST does not stop the server acting on it.
 */
export async function sendMessage(token: string, receiverId: number, content: string): Promise<void> {
  await readEnvelope(await picponyPostJson('send_message', { receiver_id: receiverId, content }, { token }));
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
