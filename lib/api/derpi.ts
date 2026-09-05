import { DERPIBOORU_API_BASE } from '@/lib/constants';
import type { PonyImage, ApiResponse, FeaturedImage } from '@/lib/types/image';
import type { DerpiProfileResponse } from '@/lib/types/user';
import {
  proxyFetch,
  fetchDerpiImages,
  handleDerpiError,
  getBrowsingSettings,
  readJson,
  applyImageLine,
} from './client';

/** Map an `{ total, images }` envelope onto the current image line. */
function withImageLine(data: ApiResponse): ApiResponse {
  return Array.isArray(data?.images) ? { ...data, images: data.images.map(applyImageLine) } : data;
}

export async function getImage(id: string, signal?: AbortSignal): Promise<{ image: PonyImage }> {
  const res = await proxyFetch(`${DERPIBOORU_API_BASE}/images/${id}`, {
    cache: 'no-store',
    headers: { 'User-Agent': 'PicPony/1.0' },
    signal,
  });

  if (!res.ok) await handleDerpiError(res);
  /* Every image-bearing response is put on the current image line here rather than at the
     screens, whose featured banner, opened picture and profile grids render URLs directly.
     `applyImageLine` is idempotent, so screens that still map are no-ops. */
  const data: { image: PonyImage } = await readJson(res);
  return data?.image ? { ...data, image: applyImageLine(data.image) } : data;
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
  return withImageLine(await readJson(res));
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
    const data: FeaturedImage = await readJson(res);
    return data?.image ? { ...data, image: applyImageLine(data.image) } : data;
  } catch (err) {
    console.error('Failed to fetch featured image', err);
    return null;
  }
}

export async function searchDerpiImages(
  query: string,
  page: number = 1,
  perPage: number = 24,
): Promise<ApiResponse | null> {
  try {
    const res = await proxyFetch(
      `${DERPIBOORU_API_BASE}/search/images?q=${encodeURIComponent(query)}&page=${page}&per_page=${perPage}&sf=created_at&sd=desc`,
      { headers: { 'User-Agent': 'PicPony/1.0' } },
    );
    if (!res.ok) return null;
    return withImageLine(await readJson(res));
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
  return withImageLine(await readJson(res));
}

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
 * 标签名单次请求的上限。Philomena 把 `per_page` 钳在 1..50，漏写该参数每批只会
 * 拿回默认 25 条，后一半永远落进"查不到"的兜底分支。
 */
export const TAG_COUNT_BATCH = 50;

/**
 * 把标签名转义成 Philomena 查询里的一个字面量（与老前端同一套字符集）：
 * 这些字符在查询语法里有意义，不转义会被当成语法而不是名字的一部分。
 */
function escapePhilomenaTerm(tag: string): string {
  return tag.replace(/([+\-=&|><!(){}[\]^"~*?:\\/\s])/g, '\\$1');
}

/**
 * 一次拿回一批标签的收录量，键为小写标签名；没查到的标签不在返回的 map 里。
 *
 * 走常规 `proxyFetch`，与老前端不同：老前端对该查询显式 `directOnly`，但直连
 * 未必通——加速服务器默认开着正是为此，直连专用意味着连不上的用户永远看不到计数。
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

export async function getDerpiProfile(
  userId: string | number,
): Promise<DerpiProfileResponse | null> {
  try {
    const res = await proxyFetch(`${DERPIBOORU_API_BASE}/profiles/${userId}`, {
      headers: { 'User-Agent': 'PicPony/1.0' },
    });
    if (!res.ok) return null;
    return readJson(res);
  } catch {
    return null;
  }
}

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
  /* Through `proxyFetch` for the policy await and the write-path line, not the retry
     ladder — a POST takes neither the accel worker nor the relay, so the only line
     that can apply is a third-party origin speaking the whole Philomena API. */
  return proxyFetch(`${DERPIBOORU_API_BASE}/images?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    body: formData,
  });
}
