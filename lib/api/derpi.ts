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

/**
 * 一次请求最多能带多少个标签名。
 *
 * Philomena 把 `per_page` 钳在 1..50，所以 50 既是每批的上限，也必须原样写进
 * `per_page`——老前端漏掉了这个参数，于是每批 50 个名字只拿回默认的 25 条，
 * 后一半永远落进"查不到"的兜底分支里显示 0。
 */
export const TAG_COUNT_BATCH = 50;

/**
 * 把标签名转义成 Philomena 查询里的一个字面量。
 *
 * 与老前端的 `escapePhilomenaQuery` 同一套字符集：这些字符在查询语法里有意义
 * （`oc:littlepip` 的冒号、`3/4 view` 的斜杠、含空格的多词标签），不转义就会被
 * 当成语法而不是名字的一部分。
 */
function escapePhilomenaTerm(tag: string): string {
  return tag.replace(/([+\-=&|><!(){}[\]^"~*?:\\/\s])/g, '\\$1');
}

/**
 * 一次拿回一批标签的收录量，键为小写标签名。
 *
 * `name:a OR name:b OR …` 是老前端算标签计数用的写法，也是本文件里
 * `searchImagesByIds` 已经在用的同一个批量惯用法。没查到的标签不会出现在返回的
 * map 里——调用方需要自己区分"查到了"和"没查到"。
 *
 * 走常规 `proxyFetch`（先加速服务器、再直连），这一点与老前端不同：老前端给这个
 * 查询显式加了 `directOnly`，把这类装饰性请求挡在共享代理之外。但直连 trixiebooru
 * 本来就未必通——加速服务器默认开着正是为此——直连专用意味着连不上的用户永远看不到
 * 计数。本文件其余 Derpibooru 请求也都走 `proxyFetch`，保持一致。
 */
export async function getDerpiTagCounts(tags: string[]): Promise<Record<string, number>> {
  if (tags.length === 0) return {};
  const query = tags.map((tag) => `name:${escapePhilomenaTerm(tag)}`).join(' OR ');
  const url = `${DERPIBOORU_API_BASE}/search/tags?q=${encodeURIComponent(query)}&per_page=${TAG_COUNT_BATCH}`;
  const res = await proxyFetch(url, {
    headers: { 'User-Agent': 'PicPony/1.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data: { tags?: { name?: string; images?: number; image_count?: number }[] } =
    await readJson(res);
  const counts: Record<string, number> = {};
  for (const entry of data?.tags ?? []) {
    if (typeof entry?.name !== 'string') continue;
    const count = entry.images ?? entry.image_count;
    if (typeof count === 'number') counts[entry.name.toLowerCase()] = count;
  }
  return counts;
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
