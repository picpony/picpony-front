export interface ImageRepresentation {
  full: string;
  small: string;
  thumb_tiny: string;
  thumb_small: string;
  thumb: string;
  medium: string;
  large: string;
  tall: string;
}

export interface PonyImage {
  id: number;
  width: number;
  height: number;
  aspect_ratio: number;
  representations: ImageRepresentation;
  name: string;
  view_url: string;
  source_url: string | null;
  uploader: string;
  created_at: string;
  size: number;
  score: number;
  comment_count: number;
  tags: string[];
  description: string;
  upvotes: number;
  downvotes: number;
}

export interface ApiResponse {
  total: number;
  images: PonyImage[];
}

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

export interface UnreadCountsResponse {
  success: boolean;
  unread_messages: number;
  unread_notifications: number;
  total_unread: number;
}

export interface FavesResponse {
  success: boolean;
  faves?: number[];
  message?: string;
}

export interface Comment {
  id: number;
  body: string;
  created_at: string;
  user_id: number;
  username: string;
  avatar: string | null;
  source?: 'picpony' | 'trixiebooru';
}

export interface CommentsResponse {
  success: boolean;
  comments: Comment[];
  message?: string;
}

const PICPONY_API_BASE = 'https://picpony.top/api.php';
const DERPIBOORU_API_BASE = 'https://trixiebooru.org/api/v1/json';

export const api = {
  getImage: async (id: string): Promise<{ image: PonyImage }> => {
    const res = await fetch(`${DERPIBOORU_API_BASE}/images/${id}`, {
      cache: 'no-store',
      headers: {
        'User-Agent': 'PicPony/1.0'
      }
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => 'No error text');
      console.error(`API Error: ${res.status} ${res.statusText}`, errorText);
      const error = new Error(errorText || res.statusText);
      (error as any).status = res.status;
      throw error;
    }

    return res.json();
  },

  getImages: async (search?: string, page: number = 1): Promise<ApiResponse> => {
    let query = "-explicit%2C%20-questionable%2C%20-suggestive%2C%20-grotesque%2C%20-grimdark%2C%20-spoiler%2C%20pony";
    if (search) {
      query = `${encodeURIComponent(search)}%2C%20${query}`;
    }

    const res = await fetch(
      `${DERPIBOORU_API_BASE}/search/images?q=${query}&page=${page}&per_page=50&sf=created_at&sd=desc`,
      { 
        cache: 'no-store',
        headers: {
          'User-Agent': 'PicPony/1.0'
        }
      }
    );

    if (!res.ok) {
      const errorText = await res.text().catch(() => 'No error text');
      console.error(`API Error: ${res.status} ${res.statusText}`, errorText);
      const error = new Error(errorText || res.statusText);
      (error as any).status = res.status;
      throw error;
    }

    return res.json();
  },

  login: async (data: any) => {
    return fetch(`${PICPONY_API_BASE}?action=login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
  },

  register: async (data: any) => {
    return fetch(`${PICPONY_API_BASE}?action=register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
  },

  changeUsername: async (token: string, newUsername: string) => {
    return fetch(`${PICPONY_API_BASE}?action=change_username`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        new_username: newUsername
      })
    });
  },

  changePassword: async (token: string, data: any) => {
    return fetch(`${PICPONY_API_BASE}?action=change_password`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
  },

  getAnnouncement: async () => {
    const res = await fetch(`${PICPONY_API_BASE}?action=get_announcement`);
    return res.json();
  },

  getAnnouncementHistory: async () => {
    const res = await fetch(`${PICPONY_API_BASE}?action=get_announcement_history`);
    return res.json();
  },

  getNotifications: async (token: string) => {
    const res = await fetch(`${PICPONY_API_BASE}?action=get_notifications`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    return res.json();
  },

  getRecentContacts: async (token: string): Promise<ContactsResponse> => {
    const res = await fetch(`${PICPONY_API_BASE}?action=get_recent_contacts`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    return res.json();
  },

  getMessages: async (token: string, withUserId: number): Promise<MessagesResponse> => {
    const res = await fetch(`${PICPONY_API_BASE}?action=get_messages&with_user_id=${withUserId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    return res.json();
  },

  getUnreadCounts: async (token: string): Promise<UnreadCountsResponse> => {
    const res = await fetch(`${PICPONY_API_BASE}?action=get_unread_counts`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    return res.json();
  },

  sendMessage: async (token: string, receiverId: number, content: string) => {
    return fetch(`${PICPONY_API_BASE}?action=send_message`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        receiver_id: receiverId,
        content: content
      })
    });
  },

  searchImage: async (imageFile: File, distance: number) => {
    const formData = new FormData();
    formData.append('imageFile', imageFile);
    formData.append('distance', distance.toString());

    const response = await fetch('https://picpony.top/search-api/api/upload-search', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error('搜索请求失败');
    }

    return response.json();
  },

  getFaves: async (token: string): Promise<FavesResponse> => {
    const res = await fetch(`${PICPONY_API_BASE}?action=get_faves`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    return res.json();
  },

  getUser: async (token: string) => {
    return fetch(`${PICPONY_API_BASE}?action=get_user`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
  },

  saveApikey: async (token: string, data: {api_key: string, derpi_user_id: string, derpi_username: string}) => {
    return fetch(`${PICPONY_API_BASE}?action=save_apikey`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
  },

  toggleFave: async (token: string, imageId: number) => {
    return fetch(`${PICPONY_API_BASE}?action=toggle_fave`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ image_id: imageId })
    });
  },

  postComment: async (token: string, imageId: number, body: string) => {
    return fetch(`${PICPONY_API_BASE}?action=post_comment`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        image_id: imageId,
        body: body
      })
    });
  },

  getComments: async (imageId: string): Promise<CommentsResponse> => {
    try {
      const [picponyRes, trixieRes] = await Promise.all([
        fetch(`${PICPONY_API_BASE}?action=get_comments&image_id=${imageId}`).catch(() => null),
        fetch(`${DERPIBOORU_API_BASE}/search/comments?q=image_id:${imageId}&page=1&per_page=25&key=TVdjt-Q8qRn39rcoWYl5`).catch(() => null)
      ]);

      let comments: Comment[] = [];

      if (picponyRes && picponyRes.ok) {
        const picponyData = await picponyRes.json();
        if (picponyData.success && picponyData.comments) {
          comments = comments.concat(
            picponyData.comments.map((c: any) => ({
              ...c,
              source: 'picpony' as const
            }))
          );
        }
      }

      if (trixieRes && trixieRes.ok) {
        const trixieData = await trixieRes.json();
        if (trixieData.comments) {
          comments = comments.concat(
            trixieData.comments.map((c: any) => ({
              id: c.id,
              body: c.body,
              created_at: c.created_at,
              user_id: c.user_id,
              username: c.author,
              avatar: c.avatar,
              source: 'trixiebooru' as const
            }))
          );
        }
      }

      comments.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      return {
        success: true,
        comments: comments
      };
    } catch (err) {
      console.error('Failed to fetch comments', err);
      return {
        success: false,
        comments: []
      };
    }
  }
};
