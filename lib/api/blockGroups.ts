import { DERPIBOORU_API_BASE } from '@/lib/constants';
import { proxyFetch } from './client';
import { ApiError } from './errors';
import { listOf, picponyPostJson, picponyRequest, readEnvelope, readObject } from './http';

/**
 * 屏蔽组 — the account's named tag lists, each either hiding its pictures outright or covering
 * them (遮挡), switched on and off one group at a time — and the one way to make a group from
 * somewhere else: a Derpibooru filter (从 Derpibooru 导入, the original front end's import).
 *
 * The reads are strict: a refusal (`{success:false, error:'登录已过期'}`) once flowed into an empty
 * list and rendered 还没有任何屏蔽组 with a create button — inviting the user to recreate groups
 * they already had. The writes are strict too, so a refused save cannot read as saved.
 */

export interface BlockGroup {
  id: number;
  name: string;
  /** Every tag in the group, both lists — the backend's own union column. */
  tags: string[];
  hidden_tags: string[];
  spoilered_tags: string[];
  is_active: number;
}

/** The original front end's limits: 50 groups, 50 tags in each list. */
export const MAX_BLOCK_GROUPS = 50;
export const MAX_TAGS_PER_LIST = 50;
/** `屏蔽组名称`'s `maxlength` in the original form. */
export const MAX_GROUP_NAME = 30;

/** A tag list from an array or the comma string the backend has sent before; lower-cased, unique. */
export function tagList(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value.filter((tag): tag is string => typeof tag === 'string')
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of raw) {
    const name = tag.trim().toLowerCase();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * A group with its three tag lists normalised. A group that predates the split stored its tags
 * in `tags` alone, and those are hidden tags — the original front end read them that way.
 */
export function blockGroupOf(row: unknown): BlockGroup | null {
  if (!row || typeof row !== 'object') return null;
  const group = row as Record<string, unknown>;
  const id = Number(group.id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const all = tagList(group.tags);
  const hidden = tagList(group.hidden_tags);
  const spoilered = tagList(group.spoilered_tags);
  const legacy = hidden.length === 0 && spoilered.length === 0;
  return {
    id,
    name: typeof group.name === 'string' ? group.name.trim() : '',
    tags: all,
    hidden_tags: legacy ? all : hidden,
    spoilered_tags: spoilered,
    is_active: Number(group.is_active) ? 1 : 0,
  };
}

export async function getBlockGroups(token: string, signal?: AbortSignal): Promise<{ success: true; groups: BlockGroup[] }> {
  const data = await readEnvelope<{ groups?: unknown }>(
    await picponyRequest('get_block_groups', { token, query: { _t: Date.now() }, signal }),
  );
  if (!Array.isArray(data.groups)) throw new ApiError('invalid');
  return {
    success: true,
    groups: data.groups.map(blockGroupOf).filter((group): group is BlockGroup => group !== null),
  };
}

export interface BlockGroupInput {
  /** Absent for a new group. */
  id?: number | null;
  name: string;
  hidden: readonly string[];
  spoilered: readonly string[];
}

/**
 * `POST save_block_group {id|0, name, tags, hidden_tags, spoilered_tags}` — the original front
 * end's body, field for field (`tags` is the union). Resolves with the saved group's id when the
 * backend names it.
 */
export async function saveBlockGroup(token: string, input: BlockGroupInput): Promise<{ id: number | null }> {
  const hidden = [...input.hidden];
  const spoilered = [...input.spoilered];
  const data = await readEnvelope<{ id?: unknown; group_id?: unknown }>(
    await picponyPostJson('save_block_group', {
      id: input.id ?? 0,
      name: input.name,
      tags: [...new Set([...hidden, ...spoilered])],
      hidden_tags: hidden,
      spoilered_tags: spoilered,
    }, { token }),
  );
  const id = Number(data.id ?? data.group_id);
  return { id: Number.isSafeInteger(id) && id > 0 ? id : (input.id ?? null) };
}

export async function deleteBlockGroup(token: string, id: number): Promise<void> {
  await readEnvelope(await picponyPostJson('delete_block_group', { id }, { token }));
}

export async function toggleBlockGroup(token: string, id: number, active: boolean): Promise<void> {
  await readEnvelope(await picponyPostJson('toggle_block_group', { id, is_active: active ? 1 : 0 }, { token }));
}

// ---------------------------------------------------------------------------
// 从 Derpibooru 导入
// ---------------------------------------------------------------------------

export interface DerpiFilterSummary {
  id: number;
  name: string;
  description: string;
}

/** `GET /filters/user?key=` — the filters the key's own account made. */
export async function getDerpiUserFilters(apiKey: string, signal?: AbortSignal): Promise<DerpiFilterSummary[]> {
  const data = await readObject<{ filters?: unknown }>(
    await proxyFetch(`${DERPIBOORU_API_BASE}/filters/user?key=${encodeURIComponent(apiKey)}`, { signal }),
  );
  if (!Array.isArray(data.filters)) throw new ApiError('invalid');
  return listOf<Record<string, unknown>>(data.filters)
    .filter((row) => row && typeof row === 'object' && Number.isSafeInteger(Number(row.id)))
    .map((row) => ({
      id: Number(row.id),
      name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : `过滤器 ${row.id}`,
      description: typeof row.description === 'string' ? row.description.trim() : '',
    }));
}

/** Only a union of plain tags can be represented by a block group's tag lists. */
export function complexTerms(expression: unknown): string[] {
  if (typeof expression !== 'string' || !expression.trim()) return [];
  const terms = expression.split(/[,，\n]|\s+(?:OR|\|\|)\s+/i).map((term) => term.trim()).filter(Boolean);
  return tagList(terms.map((term) => {
    const quoted = /^"([^"]+)"$/.exec(term);
    if (quoted) return quoted[1];
    if (/^[-!]|[()!:*?"&|]|\b(?:NOT|AND)\b/i.test(term)) {
      throw new ApiError('invalid', { message: '该过滤器包含无法转换为标签列表的条件，请先简化过滤器', retryable: false });
    }
    return term;
  }));
}

/** Tag ids as names, fifty to a request — a filter's own lists are ids, not names. */
async function tagNames(ids: readonly number[], signal?: AbortSignal): Promise<string[]> {
  const names: string[] = [];
  for (let start = 0; start < ids.length; start += 50) {
    const batch = ids.slice(start, start + 50);
    const query = batch.map((id) => `id:${id}`).join(' OR ');
    const data = await readObject<{ tags?: unknown }>(
      await proxyFetch(`${DERPIBOORU_API_BASE}/search/tags?q=${encodeURIComponent(query)}&per_page=50`, { signal }),
    );
    for (const tag of listOf<Record<string, unknown>>(data.tags)) {
      if (tag && typeof tag.name === 'string') names.push(tag.name);
    }
  }
  return names;
}

function ids(value: unknown): number[] {
  return listOf<unknown>(value).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0);
}

export interface ImportedFilter {
  name: string;
  hidden: string[];
  spoilered: string[];
}

/**
 * `GET /filters/<id>?key=` as two tag lists: the filter's hidden and spoilered tag ids resolved to
 * names, plus the plain tags its two expressions name. A tag in both is hidden — hiding wins.
 */
export async function getDerpiFilterTags(apiKey: string, filterId: number, signal?: AbortSignal): Promise<ImportedFilter> {
  const data = await readObject<{ filter?: unknown }>(
    await proxyFetch(`${DERPIBOORU_API_BASE}/filters/${filterId}?key=${encodeURIComponent(apiKey)}`, { signal }),
  );
  const filter = data.filter && typeof data.filter === 'object' ? (data.filter as Record<string, unknown>) : null;
  if (!filter) throw new ApiError('invalid');
  const hidden = tagList([
    ...(await tagNames(ids(filter.hidden_tag_ids), signal)),
    ...tagList(filter.hidden_tags),
    ...complexTerms(filter.hidden_complex),
  ]);
  const hiddenSet = new Set(hidden);
  const spoilered = tagList([
    ...(await tagNames(ids(filter.spoilered_tag_ids), signal)),
    ...tagList(filter.spoilered_tags),
    ...complexTerms(filter.spoilered_complex),
  ]).filter((tag) => !hiddenSet.has(tag));
  return {
    name: typeof filter.name === 'string' && filter.name.trim() ? filter.name.trim() : `过滤器 ${filterId}`,
    hidden,
    spoilered,
  };
}
