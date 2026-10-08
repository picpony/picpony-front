import { DERPIBOORU_API_BASE } from '@/lib/constants';
import { currentPublicBlacklist } from '@/lib/blockFilters';
import type { PonyImage, ApiResponse, FeaturedImage, Comment } from '@/lib/types/image';
import type { DerpiProfileResponse } from '@/lib/types/user';
import { proxyFetch, fetchDerpiImages, applyImageLine, buildSearchQuery } from './client';
import { listOf, readObject } from './http';
import { ApiError } from './errors';

/*
 * Derpibooru reads. Every one resolves with a validated payload or throws `ApiError`
 * (`lib/api/errors.ts`) — a 404 is `notFound`, a rate limit is a 429, a garbled body is
 * `invalid` — and every read takes an `AbortSignal`, so a typing-driven or superseded read can
 * be cancelled. No `User-Agent` header: browsers drop it (Chromium) or make it a non-safelisted
 * header that costs every direct request a CORS preflight (Firefox); the relay sets its own.
 */

/** A picture the gallery can draw: an id and a representations map, whatever else is missing. */
function isImage(value: unknown): value is PonyImage {
  if (!value || typeof value !== 'object') return false;
  const image = value as { id?: unknown };
  return typeof image.id === 'number' && Number.isSafeInteger(image.id);
}

/** Map an `{ total, images }` envelope onto the current image line, dropping malformed rows. */
function withImageLine(data: { total?: unknown; images?: unknown }): ApiResponse {
  if (!Array.isArray(data.images)) throw new ApiError('invalid');
  const images = data.images.filter(isImage).map(applyImageLine);
  const total = Number(data.total);
  return { total: Number.isFinite(total) && total >= 0 ? total : images.length, images };
}

export async function getImage(id: string, signal?: AbortSignal): Promise<{ image: PonyImage }> {
  const res = await proxyFetch(`${DERPIBOORU_API_BASE}/images/${encodeURIComponent(id)}`, {
    cache: 'no-store',
    signal,
  });
  /* Every image-bearing response is put on the current image line here rather than at the
     screens, whose featured banner, opened picture and profile grids render URLs directly.
     `applyImageLine` is idempotent, so screens that still map are no-ops. */
  const data = await readObject<{ image?: unknown }>(res);
  if (!isImage(data.image)) throw new ApiError('invalid');
  return { image: applyImageLine(data.image) };
}

/** A page of a picture's Derpibooru comments: 50, Philomena's maximum. */
export const DERPI_COMMENTS_PER_PAGE = 50;

/**
 * A Derpibooru avatar, readable from this origin: the generated placeholder arrives as an SVG data
 * URI, which the app's avatar would resolve against PicPony's asset host (a broken picture), so it
 * is dropped for the app's own fallback glyph; a root-relative path belongs to Derpibooru.
 */
function derpiAvatar(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  if (!url || url.startsWith('data:')) return null;
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('/')) return `https://derpibooru.org${url}`;
  return /^https?:\/\//.test(url) ? url : null;
}

/**
 * One page of the comments Derpibooru holds for a picture, newest first (Philomena's own order),
 * with the total, so a screen can offer the next page and name the whole count.
 */
export async function getImageComments(
  imageId: number,
  page: number,
  signal?: AbortSignal,
): Promise<{ comments: Comment[]; total: number }> {
  const query = encodeURIComponent(`image_id:${imageId}`);
  const res = await proxyFetch(
    `${DERPIBOORU_API_BASE}/search/comments?q=${query}&page=${page}&per_page=${DERPI_COMMENTS_PER_PAGE}`,
    { cache: 'no-store', signal },
  );
  const data = await readObject<{ comments?: unknown; total?: unknown }>(res);
  if (!Array.isArray(data.comments)) throw new ApiError('invalid');
  const comments = listOf<Record<string, unknown>>(data.comments)
    .filter((row) => row && typeof row === 'object' && Number.isSafeInteger(Number(row.id)))
    .map((row): Comment => ({
      id: Number(row.id),
      body: typeof row.body === 'string' ? row.body : '',
      created_at: typeof row.created_at === 'string' ? row.created_at : '',
      user_id: Number.isSafeInteger(Number(row.user_id)) && Number(row.user_id) > 0 ? Number(row.user_id) : null,
      username: typeof row.author === 'string' && row.author.trim() ? row.author : '匿名用户',
      avatar: derpiAvatar(row.avatar),
      source: 'trixiebooru',
    }));
  const total = Number(data.total);
  return { comments, total: Number.isFinite(total) && total >= 0 ? total : comments.length };
}

export async function getImages(
  search?: string,
  page: number = 1,
  sortField?: string,
  sortDir: 'desc' | 'asc' = 'desc',
  signal?: AbortSignal,
  contentFilter?: string,
): Promise<ApiResponse> {
  const res = await fetchDerpiImages(DERPIBOORU_API_BASE, {
    query: search || '',
    page,
    perPage: 50,
    sortField,
    sortDir,
    isSearch: !!search,
  }, signal, contentFilter);
  return withImageLine(await readObject(res));
}

/**
 * 近日推荐. `null` only when Derpibooru answers with no featured picture; a failure throws, so
 * the resource keeps it as an error to retry rather than caching "no banner" for its whole TTL.
 */
export async function getFeatured(key?: string, signal?: AbortSignal): Promise<FeaturedImage | null> {
  let url = `${DERPIBOORU_API_BASE}/images/featured`;
  if (key) url += `?key=${encodeURIComponent(key)}`;
  const res = await proxyFetch(url, { cache: 'no-store', signal });
  const data = await readObject<{ image?: unknown; interactions?: unknown }>(res);
  if (data.image === undefined || data.image === null) return null;
  if (!isImage(data.image)) throw new ApiError('invalid');
  return { image: applyImageLine(data.image), interactions: [] };
}

/**
 * A search with this device's exclusions around it — the profile and Derpibooru-profile upload
 * grids. They used to send the bare `uploader_id:` query, so a safe-mode visitor saw every
 * suggestive or grimdark upload on a profile the home feed would have hidden; the original
 * front end wrapped the same query in the exclusions and the public blacklist, and so does this.
 * `contentFilter` is the resource's snapshot (see `derpiUserUploads`).
 */
export async function searchDerpiImages(
  query: string,
  page: number = 1,
  perPage: number = 24,
  signal?: AbortSignal,
  contentFilter?: string,
): Promise<ApiResponse> {
  const q = buildSearchQuery(query, contentFilter);
  const res = await proxyFetch(
    `${DERPIBOORU_API_BASE}/search/images?q=${q}&page=${page}&per_page=${perPage}&sf=created_at&sd=desc`,
    { signal },
    contentFilter,
  );
  return withImageLine(await readObject(res));
}

/**
 * Pictures by id, in Derpibooru's order (callers restore their own). Ids on the public
 * blacklist are simply not asked for — a picture pulled from the site is pulled from every list
 * as well. Callers must bound `ids`: the query grows with every id (the favourites read theirs
 * fifty at a time through `lookupImagesByIds` in `lib/api/favorites.ts`).
 */
export async function searchImagesByIds(
  ids: number[],
  page: number = 1,
  perPage: number = 12,
  signal?: AbortSignal,
): Promise<ApiResponse> {
  if (ids.length === 0) {
    return { total: 0, images: [] };
  }
  const blacklist = new Set(currentPublicBlacklist());
  const visible = ids.filter((id) => !blacklist.has(id));
  if (visible.length === 0) return { total: 0, images: [] };
  const query = visible.map((id) => `id:${id}`).join(' OR ');
  const res = await proxyFetch(
    `${DERPIBOORU_API_BASE}/search/images?q=${encodeURIComponent(query)}&page=${page}&per_page=${perPage}`,
    { cache: 'no-store', signal },
  );
  return withImageLine(await readObject(res));
}

/** A Derpibooru tag row, normalised: `category` is always a string (`''` when Derpibooru sends
 *  none) and `images` always a count. */
export interface DerpiTag {
  id?: number;
  name: string;
  slug?: string;
  images: number;
  category: string;
  aliased_tag?: string | null;
  [key: string]: unknown;
}

function tagsOf(data: { tags?: unknown }): DerpiTag[] {
  return listOf<Record<string, unknown>>(data.tags)
    .filter((tag) => tag !== null && typeof tag === 'object' && typeof tag.name === 'string')
    .map((tag) => ({
      ...tag,
      name: tag.name as string,
      category: typeof tag.category === 'string' ? tag.category : '',
      images: Number.isFinite(Number(tag.images)) ? Number(tag.images) : 0,
    }));
}

export async function searchDerpiTags(query: string, signal?: AbortSignal): Promise<{ tags: DerpiTag[]; total: number }> {
  /* Each word is a literal (review P1-F17): only `"` used to be removed, so a name with `(`, `:`,
     `,` or `\\` — `artist:foo`, `oc (pony)` — was read as query syntax and answered 400. */
  const safeName = query.trim().split(/\s+/).filter(Boolean).map(escapePhilomenaTerm).join('* *');
  const url = `${DERPIBOORU_API_BASE}/search/tags?q=name:*${encodeURIComponent(safeName)}*&per_page=30`;
  const data = await readObject<{ tags?: unknown; total?: unknown }>(await proxyFetch(url, { signal }));
  const tags = tagsOf(data);
  return { tags, total: Number(data.total) || tags.length };
}

export async function getDerpiPopularTags(page: number = 1, signal?: AbortSignal): Promise<{ tags: DerpiTag[]; total: number }> {
  const url = `${DERPIBOORU_API_BASE}/search/tags?q=*&sf=images&sd=desc&per_page=50&page=${page}`;
  const data = await readObject<{ tags?: unknown; total?: unknown }>(await proxyFetch(url, { signal }));
  const tags = tagsOf(data);
  return { tags, total: Number(data.total) || tags.length };
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
export async function getDerpiTagCounts(tags: string[], signal?: AbortSignal): Promise<Record<string, number>> {
  if (tags.length === 0) return {};
  /* Philomena answers at most `TAG_COUNT_BATCH` rows, so a longer list is split here rather than
     trusted to every caller (review P1-F17): the rows past 50 used to come back as "not found". */
  if (tags.length > TAG_COUNT_BATCH) {
    const counts: Record<string, number> = {};
    for (let start = 0; start < tags.length; start += TAG_COUNT_BATCH) {
      Object.assign(counts, await getDerpiTagCounts(tags.slice(start, start + TAG_COUNT_BATCH), signal));
    }
    return counts;
  }
  const query = tags.map((tag) => `name:${escapePhilomenaTerm(tag)}`).join(' OR ');
  const url = `${DERPIBOORU_API_BASE}/search/tags?q=${encodeURIComponent(query)}&per_page=${TAG_COUNT_BATCH}`;
  const data = await readObject<{ tags?: { name?: string; images?: number; image_count?: number }[] }>(
    await proxyFetch(url, { signal }),
  );
  const counts: Record<string, number> = {};
  for (const entry of listOf<{ name?: string; images?: number; image_count?: number }>(data.tags)) {
    if (typeof entry?.name !== 'string') continue;
    const count = entry.images ?? entry.image_count;
    if (typeof count === 'number') counts[entry.name.toLowerCase()] = count;
  }
  return counts;
}

/** A Derpibooru profile; an unknown id is a `notFound` `ApiError`, not a generic failure. */
export async function getDerpiProfile(
  userId: string | number,
  signal?: AbortSignal,
): Promise<DerpiProfileResponse> {
  const res = await proxyFetch(`${DERPIBOORU_API_BASE}/profiles/${encodeURIComponent(userId)}`, { signal });
  const data = await readObject<{ user?: unknown }>(res);
  const user = data.user as { id?: unknown } | undefined;
  if (!user || typeof user !== 'object' || typeof user.id !== 'number') throw new ApiError('invalid');
  const profile = data.user as DerpiProfileResponse['user'];
  return { user: { ...profile, awards: listOf(profile.awards) } };
}
