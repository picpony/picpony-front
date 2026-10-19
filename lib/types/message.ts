/**
 * One contact row of 私信 — a person you have a conversation with.
 *
 * `id` is the other person's user id. `last_message` is optional: the Rust contact row
 * (`GET /me/contacts`) does not carry the preview, and a row without it shows its day label alone.
 */
export interface Contact {
  id: number;
  username: string;
  avatar: string | null;
  last_msg_time: string;
  unread_count: number;
  /** The start of the newest message, as stored (`/me/contacts` `last_message.preview`). */
  last_message?: string;
  /** Whether `last_message` was cut (the backend sends at most 120 characters). */
  last_message_truncated?: boolean;
}

export interface Message {
  id: number;
  sender_id: number;
  receiver_id: number;
  content: string;
  is_read: number;
  created_at: string;
  sender_name: string;
  sender_avatar: string | null;
}

/** A user found by `search_users` — somebody a conversation can be started with. */
export interface ChatUser {
  id: number;
  username: string;
  avatar: string | null;
}

export interface AuditMessage {
  id: number;
  sender_id: number;
  sender_name: string;
  receiver_id: number;
  receiver_name: string;
  content: string;
  is_read: number;
  created_at: string;
}

export interface Notification {
  id: number;
  title: string;
  content: string;
  is_read: number;
  created_at: string;
}

/** `GET /api/v1/me/unread-counts` (`notices::unread`). */
export interface UnreadCountsResponse {
  messages: number;
  notifications: number;
  interactions: number;
  /** Forum posts created since the viewer's last forum read receipt. */
  forum: number;
}

/** A site announcement; one declaration on purpose — a shape declared twice will disagree.
 * `content` is HTML that has already been through `sanitizeHtml` in the adapter. */
export interface Announcement {
  id: number;
  version: string;
  title: string;
  content: string;
  date: string;
}

/*
 * The inbox reads, as the strict adapters in `lib/api/messages.ts` resolve them: a page of rows
 * or an `ApiError` — never a failure dressed as an empty list. The backend pages these lists by
 * cursor and reports no totals: `totalPages` is the pages known to exist (`lib/api/cursorPages.ts`).
 */

export interface AnnouncementPage {
  announcements: Announcement[];
  totalPages: number;
}

export interface NotificationPage {
  notifications: Notification[];
  totalPages: number;
}

/**
 * One page of a conversation, oldest first. Page 1 is the newest messages; `hasMore` says an
 * older page exists.
 */
export interface ConversationPage {
  messages: Message[];
  hasMore: boolean;
  page: number;
}
