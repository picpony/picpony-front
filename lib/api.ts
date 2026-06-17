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

export interface FeaturedImage {
  image: PonyImage;
  interactions: [];
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

export interface FavesResponse {
  success: boolean;
  faves?: number[];
  message?: string;
}

export interface SharedFavesResponse {
  success: boolean;
  username: string;
  faves: number[];
}

export interface UserComment {
  id: number;
  target_id: number;
  body: string;
  created_at: string;
  type: 'post' | 'image';
  cover_image: string | null;
}

export interface UserCommentsResponse {
  success: boolean;
  comments: UserComment[];
  total_pages: number;
}

export interface UserPost {
  id: number;
  title: string;
  cover_image: string | null;
  created_at: string;
  reply_count: number;
  like_count: number;
}

export interface UserPostsResponse {
  success: boolean;
  posts: UserPost[];
  total_pages: number;
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

export interface ForumPost {
  id: number;
  user_id: number;
  title: string;
  content: string;
  views: number;
  reply_count: number;
  is_pinned: number;
  created_at: string;
  updated_at: string;
  cover_image: string | null;
  like_count: number;
  username: string;
  avatar: string | null;
  role: string;
  experience: number;
  equipped_badges: string;
  is_liked: number;
}

export interface ForumPostsResponse {
  success: boolean;
  posts: ForumPost[];
  total: number;
  total_pages: number;
}

export interface ForumComment {
  id: number;
  post_id: number;
  user_id: number;
  content: string;
  created_at: string;
  username: string;
  avatar: string | null;
  role: string;
  experience: number;
  equipped_badges: string;
}

export interface ForumPostDetail {
  id: number;
  user_id: number;
  title: string;
  content: string;
  views: number;
  reply_count: number;
  is_pinned: number;
  created_at: string;
  updated_at: string;
  cover_image: string | null;
  like_count: number;
  username: string;
  avatar: string | null;
  role: string;
  experience: number;
  user_created_at: string;
  is_liked: number;
}

export interface ForumPostDetailResponse {
  success: boolean;
  post: ForumPostDetail;
  comments: ForumComment[];
  total_comments: number;
  total_pages: number;
}

export interface CaptchaGetResponse {
  success: boolean;
  bg: string;
  piece: string;
  y: number;
}

export interface CaptchaVerifyResponse {
  success: boolean;
  token: string;
}

const PICPONY_API_BASE = '/api.php';
const DERPIBOORU_API_BASE = 'https://trixiebooru.org/api/v1/json';

export const api = {
  getFeatured: async (key?: string): Promise<FeaturedImage | null> => {
    try {
      let url = `${DERPIBOORU_API_BASE}/images/featured`;
      if (key) {
        url += `?key=${key}`;
      }
      const res = await fetch(url, {
        cache: 'no-store',
        headers: {
          'User-Agent': 'PicPony/1.0'
        }
      });

      if (!res.ok) {
        console.error(`Featured API Error: ${res.status} ${res.statusText}`);
        return null;
      }

      return res.json();
    } catch (err) {
      console.error('Failed to fetch featured image', err);
      return null;
    }
  },

  getImage: async (id: string): Promise<{ image: PonyImage }> => {
    const res = await fetch(`${DERPIBOORU_API_BASE}/images/${id}`, {
      cache: 'no-store',
      headers: {
        'User-Agent': 'PicPony/1.0'
      }
    });

    if (!res.ok) {
      let errorText = await res.text().catch(() => 'No error text');
      if (res.status === 429) {
        errorText = 'Too Many Requests';
      }
      console.error(`API Error: ${res.status} ${res.statusText}`, errorText);
      const error = new Error(errorText || res.statusText || 'Failed to fetch');
      (error as Error & { status?: number }).status = res.status;
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
      let errorText = await res.text().catch(() => 'No error text');
      if (res.status === 429) {
        errorText = 'Too Many Requests';
      }
      console.error(`API Error: ${res.status} ${res.statusText}`, errorText);
      const error = new Error(errorText || res.statusText || 'Failed to fetch');
      (error as Error & { status?: number }).status = res.status;
      throw error;
    }

    return res.json();
  },

  login: async (data: Record<string, unknown>) => {
    return fetch(`${PICPONY_API_BASE}?action=login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
  },

  register: async (data: Record<string, unknown>) => {
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

  changePassword: async (token: string, data: Record<string, unknown>) => {
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

  getInteractionNotifications: async (token: string, page: number = 1): Promise<InteractionNotificationsResponse> => {
    const timestamp = Date.now();
    const res = await fetch(`${PICPONY_API_BASE}?action=get_notifications&type=interaction&page=${page}&_t=${timestamp}`, {
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

  uploadAvatar: async (token: string, file: File) => {
    const formData = new FormData();
    formData.append('avatar', file);

    return fetch(`${PICPONY_API_BASE}?action=upload_avatar`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
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

  createForumComment: async (token: string, postId: number, content: string) => {
    return fetch(`${PICPONY_API_BASE}?action=create_forum_comment`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        post_id: postId,
        content: content
      })
    });
  },

  getUserProfile: async (userId: string) => {
    const res = await fetch(`${PICPONY_API_BASE}?action=get_user_profile&user_id=${userId}`);
    return res.json();
  },

  getForumPosts: async (page: number = 1): Promise<ForumPostsResponse> => {
    const res = await fetch(`${PICPONY_API_BASE}?action=get_forum_posts&page=${page}`, {
      cache: 'no-store'
    });
    if (!res.ok) {
      throw new Error('Failed to fetch forum posts');
    }
    return res.json();
  },

  getForumPostDetail: async (id: string, page: number = 1): Promise<ForumPostDetailResponse> => {
    const res = await fetch(`${PICPONY_API_BASE}?action=get_forum_post_detail&id=${id}&page=${page}`, {
      cache: 'no-store'
    });
    if (!res.ok) {
      throw new Error('Failed to fetch forum post detail');
    }
    return res.json();
  },

  captchaGet: async (): Promise<CaptchaGetResponse> => {
    const res = await fetch(`${PICPONY_API_BASE}?action=captcha_get`);
    return res.json();
  },

  captchaVerify: async (x: number, track?: string): Promise<CaptchaVerifyResponse> => {
    const body: Record<string, unknown> = { x };
    if (track) body.track = track;
    const res = await fetch(`${PICPONY_API_BASE}?action=captcha_verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return res.json();
  },

  getComments: async (imageId: string): Promise<CommentsResponse> => {
    try {
      const [picponyRes, trixieRes] = await Promise.all([
        fetch(`${PICPONY_API_BASE}?action=get_comments&image_id=${imageId}`).catch(() => null),
        fetch(`${DERPIBOORU_API_BASE}/search/comments?q=image_id:${imageId}&page=1&per_page=25`).catch(() => null)
      ]);

      let comments: Comment[] = [];

      if (picponyRes && picponyRes.ok) {
        const picponyData = await picponyRes.json();
        if (picponyData.success && picponyData.comments) {
          comments = comments.concat(
            picponyData.comments.map((c: Comment) => ({
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
            trixieData.comments.map((c: {id: number, body: string, created_at: string, user_id: number, author: string, avatar: string | null}) => ({
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
  },

  getSharedFaves: async (username: string): Promise<SharedFavesResponse> => {
    const res = await fetch(`${PICPONY_API_BASE}?action=get_shared_faves&username=${encodeURIComponent(username)}`);
    if (!res.ok) {
      throw new Error('获取收藏夹失败');
    }
    return res.json();
  },

  searchImagesByIds: async (ids: number[], page: number = 1, perPage: number = 12): Promise<ApiResponse> => {
    if (ids.length === 0) {
      return { total: 0, images: [] };
    }
    const idQuery = ids.map(id => `id:${id}`).join('%20OR%20');
    const res = await fetch(
      `${DERPIBOORU_API_BASE}/search/images?q=${idQuery}&page=${page}&per_page=${perPage}`,
      {
        cache: 'no-store',
        headers: {
          'User-Agent': 'PicPony/1.0'
        }
      }
    );
    if (!res.ok) {
      let errorText = await res.text().catch(() => 'No error text');
      if (res.status === 429) {
        errorText = 'Too Many Requests';
      }
      console.error(`API Error: ${res.status} ${res.statusText}`, errorText);
      const error = new Error(errorText || res.statusText || 'Failed to fetch');
      (error as Error & { status?: number }).status = res.status;
      throw error;
    }
    return res.json();
  },

  getUserComments: async (userId: string, page: number = 1): Promise<UserCommentsResponse> => {
    const res = await fetch(`${PICPONY_API_BASE}?action=get_user_comments&user_id=${userId}&page=${page}`, {
      cache: 'no-store'
    });
    if (!res.ok) {
      throw new Error('获取用户评论失败');
    }
    return res.json();
  },

  getUserPosts: async (userId: string, page: number = 1): Promise<UserPostsResponse> => {
    const res = await fetch(`${PICPONY_API_BASE}?action=get_user_posts&user_id=${userId}&page=${page}`, {
      cache: 'no-store'
    });
    if (!res.ok) {
      throw new Error('获取用户帖子失败');
    }
    return res.json();
  },

  getGlossaryEntries: async (token: string) => {
    const res = await fetch(`${PICPONY_API_BASE}?action=get_glossary_entries`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    return res.json();
  },

  createGlossaryEntry: async (token: string, data: { term: string; definition: string }) => {
    return fetch(`${PICPONY_API_BASE}?action=create_glossary_entry`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
  },

  updateGlossaryEntry: async (token: string, id: number, data: { term: string; definition: string }) => {
    return fetch(`${PICPONY_API_BASE}?action=update_glossary_entry`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ id, ...data })
    });
  },

  deleteGlossaryEntry: async (token: string, id: number) => {
    return fetch(`${PICPONY_API_BASE}?action=delete_glossary_entry`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ id })
    });
  },

  getDictionary: async (token: string, params: {
    page?: number;
    limit?: number;
    keyword?: string;
    sort?: string;
    category?: string;
    untranslated?: number;
    wiki_overlap?: number;
  }) => {
    const searchParams = new URLSearchParams();
    searchParams.append('action', 'get_dictionary');
    if (params.page) searchParams.append('page', params.page.toString());
    if (params.limit) searchParams.append('limit', params.limit.toString());
    if (params.keyword) searchParams.append('keyword', params.keyword);
    if (params.sort) searchParams.append('sort', params.sort);
    if (params.category) searchParams.append('category', params.category);
    if (params.untranslated !== undefined) searchParams.append('untranslated', params.untranslated.toString());
    if (params.wiki_overlap !== undefined) searchParams.append('wiki_overlap', params.wiki_overlap.toString());
    searchParams.append('_t', Date.now().toString());

    const res = await fetch(`${PICPONY_API_BASE}?${searchParams.toString()}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    return res.json();
  },

  getDictionaryDuplicates: async (token: string) => {
    const res = await fetch(`${PICPONY_API_BASE}?action=get_duplicates&_t=${Date.now()}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    return res.json();
  },

  saveDictionaryTag: async (token: string, data: {
    id?: number;
    cn: string;
    en: string;
    aliases: string[];
    cat: string;
    count: number;
    description: string;
  }) => {
    return fetch(`${PICPONY_API_BASE}?action=save_dictionary_tag`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
  },

  deleteDictionaryTag: async (token: string, id: number) => {
    return fetch(`${PICPONY_API_BASE}?action=delete_dictionary_tag`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ id })
    });
  },

  getDictionaryLeaderboard: async () => {
    const res = await fetch(`${PICPONY_API_BASE}?action=get_dictionary_leaderboard&_t=${Date.now()}`);
    return res.json();
  },

  getTagFeedback: async (token: string) => {
    const res = await fetch(`${PICPONY_API_BASE}?action=admin_get_tag_feedback`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    return res.json();
  },

  handleTagFeedback: async (token: string, id: number, status: string) => {
    return fetch(`${PICPONY_API_BASE}?action=admin_handle_tag_feedback`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ id, status })
    });
  },

  checkTagExists: async (token: string, enTag: string) => {
    const url = `${PICPONY_API_BASE}?action=get_dictionary&page=1&limit=50&keyword=${encodeURIComponent(enTag)}&_t=${Date.now()}`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const data = await res.json();
    if (data.success && data.tags) {
      return data.tags.some((t: { en: string }) => t.en.toLowerCase() === enTag.toLowerCase());
    }
    return false;
  },

  searchDerpiTags: async (query: string) => {
    const safeName = query.replace(/"/g, '').split(/\s+/).join('* *');
    const url = `${DERPIBOORU_API_BASE}/search/tags?q=name:*${encodeURIComponent(safeName)}*&per_page=30`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'PicPony/1.0'
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  getDerpiPopularTags: async (page: number = 1) => {
    const url = `${DERPIBOORU_API_BASE}/search/tags?q=*&sf=images&sd=desc&per_page=50&page=${page}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'PicPony/1.0'
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  adminGetUsers: async (token: string) => {
    const res = await fetch(`${PICPONY_API_BASE}?action=admin_get_users&_t=${Date.now()}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return res.json();
  },

  adminUpdateUser: async (token: string, data: Record<string, unknown>) => {
    return fetch(`${PICPONY_API_BASE}?action=admin_update_user`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
  },

  adminDeleteUser: async (token: string, targetId: number) => {
    return fetch(`${PICPONY_API_BASE}?action=admin_delete_user`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ target_id: targetId })
    });
  },

  adminGetWealth: async (token: string) => {
    const res = await fetch(`${PICPONY_API_BASE}?action=admin_get_users&_t=${Date.now()}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return res.json();
  },

  adminUpdateWealth: async (token: string, data: Record<string, unknown>) => {
    return fetch(`${PICPONY_API_BASE}?action=admin_update_wealth`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
  },

  adminGetShopItems: async (token: string) => {
    const res = await fetch(`${PICPONY_API_BASE}?action=get_shop_items&_t=${Date.now()}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return res.json();
  },

  adminSaveShopItem: async (token: string, data: Record<string, unknown>) => {
    return fetch(`${PICPONY_API_BASE}?action=admin_save_shop_item`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
  },

  adminDeleteShopItem: async (token: string, id: number) => {
    return fetch(`${PICPONY_API_BASE}?action=admin_delete_shop_item`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ id })
    });
  },

  adminGetReports: async (token: string) => {
    const res = await fetch(`${PICPONY_API_BASE}?action=admin_get_reports&_t=${Date.now()}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return res.json();
  },

  adminHandleReport: async (token: string, reportId: number, status: string) => {
    return fetch(`${PICPONY_API_BASE}?action=admin_handle_report`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ report_id: reportId, status })
    });
  },

  adminGetBlacklist: async (token: string) => {
    const res = await fetch(`${PICPONY_API_BASE}?action=admin_get_blacklist&_t=${Date.now()}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return res.json();
  },

  adminAddBlacklist: async (token: string, imageId: number, reason: string) => {
    return fetch(`${PICPONY_API_BASE}?action=admin_add_blacklist`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ image_id: imageId, reason })
    });
  },

  adminRemoveBlacklist: async (token: string, imageId: number) => {
    return fetch(`${PICPONY_API_BASE}?action=admin_remove_blacklist`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ image_id: imageId })
    });
  },

  saveAnnouncement: async (token: string, data: { version: string; title: string; content: string }) => {
    return fetch(`${PICPONY_API_BASE}?action=save_announcement`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
  },

  adminDeleteAnnouncement: async (token: string, id: number) => {
    return fetch(`${PICPONY_API_BASE}?action=admin_delete_announcement`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ id })
    });
  },

  adminGetAllMessages: async (token: string, userId?: number) => {
    let url = `${PICPONY_API_BASE}?action=admin_get_all_messages&_t=${Date.now()}`;
    if (userId) url += `&user_id=${userId}`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return res.json();
  },

  adminSendNotification: async (token: string, data: { user_id: number; title: string; content: string }) => {
    return fetch(`${PICPONY_API_BASE}?action=admin_send_notification`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
  },

  adminGetNotifications: async (token: string, filter: string = 'all') => {
    const res = await fetch(`${PICPONY_API_BASE}?action=admin_get_notifications&filter=${filter}&_t=${Date.now()}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return res.json();
  },

  adminDeleteNotification: async (token: string, id: number) => {
    return fetch(`${PICPONY_API_BASE}?action=admin_delete_notification`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ id })
    });
  },

  adminGrantBadge: async (token: string, data: Record<string, unknown>) => {
    return fetch(`${PICPONY_API_BASE}?action=admin_grant_badge`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
  },

  adminGetBadgeLinks: async (token: string) => {
    const res = await fetch(`${PICPONY_API_BASE}?action=admin_list_badge_links&_t=${Date.now()}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return res.json();
  },

  adminCreateBadgeLink: async (token: string, data: Record<string, unknown>) => {
    return fetch(`${PICPONY_API_BASE}?action=admin_create_badge_link`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
  },

  adminToggleBadgeLink: async (token: string, id: number, isActive: number) => {
    return fetch(`${PICPONY_API_BASE}?action=admin_toggle_badge_link`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ id, is_active: isActive })
    });
  },

  adminDeleteBadge: async (token: string, badgeId: number) => {
    return fetch(`${PICPONY_API_BASE}?action=admin_delete_badge`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ badge_id: badgeId })
    });
  },

  adminEditBadge: async (token: string, data: { badge_id: number; badge_name: string; badge_color: string }) => {
    return fetch(`${PICPONY_API_BASE}?action=admin_edit_badge`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
  },

  getMaintenanceStatus: async () => {
    const res = await fetch(`${PICPONY_API_BASE}?action=get_maintenance_status&_t=${Date.now()}`);
    return res.json();
  },

  adminToggleMaintenance: async (token: string, data: { maintenance_mode: boolean; maintenance_message: string }) => {
    return fetch(`${PICPONY_API_BASE}?action=admin_toggle_maintenance`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
  },

  adminToggleTranslate: async (token: string, data: { translate_enabled: boolean }) => {
    return fetch(`${PICPONY_API_BASE}?action=admin_toggle_translate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
  },

  getSiteStats: async () => {
    const res = await fetch(`${PICPONY_API_BASE}?action=get_site_stats&_t=${Date.now()}`);
    return res.json();
  },

  adminSyncSiteStats: async (token: string, data: { images: number; tags: number; comments: number }) => {
    return fetch(`${PICPONY_API_BASE}?action=admin_sync_site_stats`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
  },

  adminGetMascotConfig: async (token: string) => {
    const res = await fetch(`${PICPONY_API_BASE}?action=admin_get_mascot_config&_t=${Date.now()}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return res.json();
  },

  adminSaveMascotConfig: async (token: string, data: { enabled: boolean; tips: string[] }) => {
    return fetch(`${PICPONY_API_BASE}?action=admin_save_mascot_config`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
  },

  adminUploadMascotImage: async (token: string, file: File) => {
    const formData = new FormData();
    formData.append('mascot_file', file);
    return fetch(`${PICPONY_API_BASE}?action=admin_upload_mascot_image`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
  },

  adminDeleteMascotImage: async (token: string) => {
    return fetch(`${PICPONY_API_BASE}?action=admin_delete_mascot_image`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
  },

  getBlockTags: async (token: string) => {
    const res = await fetch(`${PICPONY_API_BASE}?action=get_block_tags&_t=${Date.now()}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return res.json();
  },

  adminAddBlockTag: async (token: string, data: { filter_key: string; tag_name: string }) => {
    return fetch(`${PICPONY_API_BASE}?action=admin_add_block_tag`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
  },

  adminRemoveBlockTag: async (token: string, id: number) => {
    return fetch(`${PICPONY_API_BASE}?action=admin_remove_block_tag`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ id })
    });
  },

  adminGetDeveloperPassword: async (token: string) => {
    const res = await fetch(`${PICPONY_API_BASE}?action=admin_get_developer_password&_t=${Date.now()}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return res.json();
  },

  adminRefreshDeveloperPassword: async (token: string) => {
    return fetch(`${PICPONY_API_BASE}?action=admin_refresh_developer_password`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
  },

  adminGetDeveloperUsers: async (token: string) => {
    const res = await fetch(`${PICPONY_API_BASE}?action=admin_get_developer_users&_t=${Date.now()}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return res.json();
  },

  adminRevokeDeveloper: async (token: string, targetId: number) => {
    return fetch(`${PICPONY_API_BASE}?action=admin_revoke_developer`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ target_id: targetId })
    });
  },

  adminEnableDeveloper: async (token: string, targetId: number) => {
    return fetch(`${PICPONY_API_BASE}?action=admin_enable_developer`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ target_id: targetId })
    });
  },

  getTeamMembers: async () => {
    const res = await fetch(`${PICPONY_API_BASE}?action=get_team_members&_t=${Date.now()}`);
    return res.json();
  },

  addTeamMember: async (token: string, data: Record<string, unknown>) => {
    return fetch(`${PICPONY_API_BASE}?action=add_team_member`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
  },

  updateTeamMember: async (token: string, data: Record<string, unknown>) => {
    return fetch(`${PICPONY_API_BASE}?action=update_team_member`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
  },

  deleteTeamMember: async (token: string, id: number) => {
    return fetch(`${PICPONY_API_BASE}?action=delete_team_member`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ id })
    });
  },

  createForumPost: async (token: string, data: {
    title: string;
    content: string;
    cover_image?: string;
    category?: string;
  }) => {
    return fetch(`${PICPONY_API_BASE}?action=create_forum_post`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
  },

  toggleForumPostLike: async (token: string, postId: number) => {
    return fetch(`${PICPONY_API_BASE}?action=toggle_forum_post_like`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ post_id: postId })
    });
  },

  uploadForumImage: async (token: string, file: File) => {
    const formData = new FormData();
    formData.append('image', file);
    return fetch(`${PICPONY_API_BASE}?action=upload_forum_image`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
  },

  saveProfile: async (token: string, data: {
    bio?: string;
    gender?: string;
    birthday?: string;
    race?: string;
  }) => {
    return fetch(`${PICPONY_API_BASE}?action=save_profile`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
  },

  uploadBanner: async (token: string, file: File) => {
    const formData = new FormData();
    formData.append('banner', file);
    return fetch(`${PICPONY_API_BASE}?action=upload_banner`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
  },

  updateEmail: async (token: string, email: string) => {
    return fetch(`${PICPONY_API_BASE}?action=update_email`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email })
    });
  },

  verifyEmail: async (token: string, code: string) => {
    return fetch(`${PICPONY_API_BASE}?action=verify_email`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ code })
    });
  },

  resendVerifyCode: async (token: string) => {
    return fetch(`${PICPONY_API_BASE}?action=resend_verify_code`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });
  },

  updateSettings: async (token: string, data: Record<string, unknown>) => {
    return fetch(`${PICPONY_API_BASE}?action=update_settings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
  },

  reportImage: async (token: string, imageId: number, reason: string) => {
    return fetch(`${PICPONY_API_BASE}?action=report_image`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ image_id: imageId, reason })
    });
  },

  resetPasswordRequest: async (email: string) => {
    return fetch(`${PICPONY_API_BASE}?action=reset_password_request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
  },

  resetPassword: async (data: { email: string; code: string; new_password: string }) => {
    return fetch(`${PICPONY_API_BASE}?action=reset_password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  },

  getTagGroups: async (token: string) => {
    const res = await fetch(`${PICPONY_API_BASE}?action=get_tag_groups&_t=${Date.now()}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return res.json();
  },

  saveTagGroup: async (token: string, data: { id?: number; name: string; tags: string[] }) => {
    return fetch(`${PICPONY_API_BASE}?action=save_tag_group`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
  },

  deleteTagGroup: async (token: string, id: number) => {
    return fetch(`${PICPONY_API_BASE}?action=delete_tag_group`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ id })
    });
  },

  getBrowsingHistory: async (token: string, page: number = 1) => {
    const res = await fetch(`${PICPONY_API_BASE}?action=get_browsing_history&page=${page}&_t=${Date.now()}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return res.json();
  },

  clearBrowsingHistory: async (token: string) => {
    return fetch(`${PICPONY_API_BASE}?action=clear_browsing_history`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
  },

  deleteBrowsingHistoryItem: async (token: string, imageId: number) => {
    return fetch(`${PICPONY_API_BASE}?action=delete_browsing_history_item`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ image_id: imageId })
    });
  },

  checkHasPrivacyPassword: async (token: string) => {
    const res = await fetch(`${PICPONY_API_BASE}?action=check_has_privacy_password&_t=${Date.now()}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return res.json();
  },

  setPrivacyPassword: async (token: string, password: string) => {
    return fetch(`${PICPONY_API_BASE}?action=set_privacy_password`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ password })
    });
  },

  verifyPrivacyPassword: async (token: string, password: string) => {
    return fetch(`${PICPONY_API_BASE}?action=verify_privacy_password`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ password })
    });
  },

  getPrivacyFaves: async (token: string) => {
    const res = await fetch(`${PICPONY_API_BASE}?action=get_privacy_faves&_t=${Date.now()}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return res.json();
  },

  addPrivacyFave: async (token: string, imageId: number, imageData: Record<string, unknown>) => {
    return fetch(`${PICPONY_API_BASE}?action=add_privacy_fave`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ image_id: imageId, image_data: imageData })
    });
  },

  removePrivacyFave: async (token: string, imageId: number) => {
    return fetch(`${PICPONY_API_BASE}?action=remove_privacy_fave`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ image_id: imageId })
    });
  },

  getMyBadges: async (token: string) => {
    const res = await fetch(`${PICPONY_API_BASE}?action=get_my_badges&_t=${Date.now()}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return res.json();
  },

  equipBadge: async (token: string, badgeName: string | null) => {
    return fetch(`${PICPONY_API_BASE}?action=equip_badge`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ badge_name: badgeName })
    });
  },

  getTasks: async (token: string) => {
    const res = await fetch(`${PICPONY_API_BASE}?action=get_tasks&_t=${Date.now()}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return res.json();
  },

  claimTask: async (token: string, taskType: string) => {
    return fetch(`${PICPONY_API_BASE}?action=claim_task`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ task_type: taskType })
    });
  },

  getCoinTransactions: async (token: string, page: number = 1) => {
    const res = await fetch(`${PICPONY_API_BASE}?action=get_coin_transactions&page=${page}&_t=${Date.now()}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return res.json();
  },

  getBlockGroups: async (token: string) => {
    const res = await fetch(`${PICPONY_API_BASE}?action=get_block_groups&_t=${Date.now()}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return res.json();
  },

  saveBlockGroup: async (token: string, data: {
    id?: number; name: string; tags: string[];
    hidden_tags?: string; spoilered_tags?: string;
  }) => {
    return fetch(`${PICPONY_API_BASE}?action=save_block_group`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
  },

  deleteBlockGroup: async (token: string, id: number) => {
    return fetch(`${PICPONY_API_BASE}?action=delete_block_group`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ id })
    });
  },

  toggleBlockGroup: async (token: string, id: number, isActive: number) => {
    return fetch(`${PICPONY_API_BASE}?action=toggle_block_group`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ id, is_active: isActive })
    });
  },

  getSharedFavesByUsername: async (username: string): Promise<SharedFavesResponse> => {
    const res = await fetch(`${PICPONY_API_BASE}?action=get_shared_faves&username=${encodeURIComponent(username)}`);
    if (!res.ok) throw new Error('获取收藏夹失败');
    return res.json();
  },
};
