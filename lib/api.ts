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
  uploader: string;
  created_at: string;
  size: number;
  score: number;
  comment_count: number;
  tags: string[];
  description: string;
}

export interface ApiResponse {
  total: number;
  images: PonyImage[];
}

const PICPONY_API_BASE = 'https://picpony.top/api.php';
const DERPIBOORU_API_BASE = 'https://derpibooru.org/api/v1/json';

export const api = {
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
  }
};
