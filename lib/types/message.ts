/**
 * One contact row of 私信 — a person you have a conversation with.
 *
 * `last_message` is optional because `get_recent_contacts` has not always carried it; the adapter
 * (`lib/api/messages.ts`) reads it under the names the backend has used, and a row without it
 * shows its day label alone.
 */
export interface Contact {
  id: number;
  username: string;
  avatar: string | null;
  last_msg_time: string;
  unread_count: number;
  last_message?: string;
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

export interface AuditMessagesResponse {
  success: boolean;
  messages?: AuditMessage[];
  error?: string;
  message?: string;
}

export interface Notification {
  id: number;
  title: string;
  content: string;
  is_read: number;
  created_at: string;
}

export interface UnreadCountsResponse {
  success: boolean;
  unread_messages: number;
  unread_notifications: number;
  unread_interactions: number;
  total_unread: number;
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
 * or an `ApiError` — never a failure dressed as an empty list. A success envelope without its
 * list once took every tab of /messages down; it is an `invalid` error now.
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
