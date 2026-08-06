import { DERPIBOORU_API_BASE } from '@/lib/constants';
import type { PonyImage, ApiResponse, FeaturedImage } from '@/lib/types/image';
import type { DerpiProfileResponse } from '@/lib/types/user';
import { proxyFetch, fetchDerpiImages, handleDerpiError, getBrowsingSettings, readJson } from './client';

// ---------------------------------------------------------------------------
// 图片详情
// ---------------------------------------------------------------------------

export async function getImage(id: string, signal?: AbortSignal): Promise<{ image: PonyImage }> {
  const res = await proxyFetch(`${DERPIBOORU_API_BASE}/images/${id}`, {
    cache: 'no-store',
    headers: { 'User-Agent': 'PicPony/1.0' },
    signal,
  });

  if (!res.ok) await handleDerpiError(res);
  return readJson(res);
}

export async function getImages(
  search?: string,
  page: number = 1,
  sortField?: string,
  sortDir: 'desc' | 'asc' = 'desc',
): Promise<ApiResponse> {
  const res = await fetchDerpiImages(DERPIBOORU_API_BASE, {
    query: search || '',
    page,
    perPage: 50,
    sortField,
    sortDir,
    isSearch: !!search,
  });

  if (!res.ok) await handleDerpiError(res);
  return readJson(res);
}

export async function getFeatured(key?: string): Promise<FeaturedImage | null> {
  try {
    let url = `${DERPIBOORU_API_BASE}/images/featured`;
    const params: string[] = [];
    if (key) params.push(`key=${key}`);
    const s = getBrowsingSettings();
    if (s.contentFilter === 'developer') params.push('filter_id=56027');
    if (params.length > 0) url += '?' + params.join('&');

    const res = await proxyFetch(url, {
      cache: 'no-store',
      headers: { 'User-Agent': 'PicPony/1.0' },
    });

    if (!res.ok) {
      console.error(`Featured API Error: ${res.status} ${res.statusText}`);
      return null;
    }
    return readJson(res);
  } catch (err) {
    console.error('Failed to fetch featured image', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 搜索 Derpibooru 图片
// ---------------------------------------------------------------------------

export async function searchDerpiImages(
  query: string,
  page: number = 1,
  perPage: number = 24,
): Promise<ApiResponse | null> {
  try {
    const res = await fetch(
      `${DERPIBOORU_API_BASE}/search/images?q=${encodeURIComponent(query)}&page=${page}&per_page=${perPage}&sf=created_at&sd=desc`,
      { headers: { 'User-Agent': 'PicPony/1.0' } },
    );
    if (!res.ok) return null;
    return readJson(res);
  } catch {
    return null;
  }
}

export async function searchImagesByIds(
  ids: number[],
  page: number = 1,
  perPage: number = 12,
): Promise<ApiResponse> {
  if (ids.length === 0) {
    return { total: 0, images: [] };
  }
  const idQuery = ids.map((id) => `id:${id}`).join('%20OR%20');
  const res = await proxyFetch(
    `${DERPIBOORU_API_BASE}/search/images?q=${idQuery}&page=${page}&per_page=${perPage}`,
    {
      cache: 'no-store',
      headers: { 'User-Agent': 'PicPony/1.0' },
    },
  );
  if (!res.ok) await handleDerpiError(res);
  return readJson(res);
}

// ---------------------------------------------------------------------------
// Derpibooru 标签搜索
// ---------------------------------------------------------------------------

export async function searchDerpiTags(query: string) {
  const safeName = query.replace(/"/g, '').split(/\s+/).join('* *');
  const url = `${DERPIBOORU_API_BASE}/search/tags?q=name:*${encodeURIComponent(safeName)}*&per_page=30`;
  const res = await proxyFetch(url, {
    headers: { 'User-Agent': 'PicPony/1.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return readJson(res);
}

export async function getDerpiPopularTags(page: number = 1) {
  const url = `${DERPIBOORU_API_BASE}/search/tags?q=*&sf=images&sd=desc&per_page=50&page=${page}`;
  const res = await proxyFetch(url, {
    headers: { 'User-Agent': 'PicPony/1.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return readJson(res);
}

// ---------------------------------------------------------------------------
// Derpibooru 用户资料
// ---------------------------------------------------------------------------

export async function getDerpiProfile(
  userId: string | number,
): Promise<DerpiProfileResponse | null> {
  try {
    const res = await fetch(`${DERPIBOORU_API_BASE}/profiles/${userId}`, {
      headers: { 'User-Agent': 'PicPony/1.0' },
    });
    if (!res.ok) return null;
    return readJson(res);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 上传图片到 Derpibooru
// ---------------------------------------------------------------------------

export async function uploadImageToDerpi(
  file: File,
  tags: string,
  apiKey: string,
  source?: string,
  description?: string,
) {
  const formData = new FormData();
  formData.append('image[image]', file);
  formData.append('image[tag_input]', tags);
  if (source) formData.append('image[source_url]', source);
  if (description) formData.append('image[description]', description);
  return fetch(`${DERPIBOORU_API_BASE}/images?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    body: formData,
  });
}
