export interface Contact {
  id: number;
  username: string;
  avatar: string | null;
  last_msg_time: string;
  unread_count: number;
}

export interface ContactsResponse {
  success: boolean;
  contacts: Contact[];
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

export interface MessagesResponse {
  success: boolean;
  messages: Message[];
}

export interface Notification {
  id: number;
  title: string;
  content: string;
  is_read: number;
  created_at: string;
}

export interface InteractionNotificationsResponse {
  success: boolean;
  notifications: Notification[];
  total_pages: number;
}

export interface UnreadCountsResponse {
  success: boolean;
  unread_messages: number;
  unread_notifications: number;
  unread_interactions: number;
  total_unread: number;
}
