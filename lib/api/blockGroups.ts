import { DERPIBOORU_API_BASE } from '@/lib/constants';
import { proxyFetch } from './client';
import { ApiError } from './errors';
import { api, readObject, seg } from './http';

/**
 * 屏蔽组 — the account's named tag lists, each either hiding its pictures outright or covering
 * them (遮挡), switched on and off one group at a time — and the one way to make a group from
 * somewhere else: a Derpibooru filter (从 Derpibooru 导入, the original front end's import).
 * Rust: `src/pg/tag_groups.rs` (`block_*`).
 *
 * The reads are strict: a refusal is an `ApiError`, never an empty list (an empty one once
 * rendered 还没有任何屏蔽组 and invited the user to recreate groups they already had). Every edit
 * and every switch carries the group's `revision`; a group changed elsewhere meanwhile is refused
 * (409 `GROUP_VERSION_CONFLICT`).
 */

export interface BlockGroup {
  id: number;
  name: string;
  hidden_tags: string[];
  spoilered_tags: string[];
  active: boolean;
  /** The backend's version of the group, sent back with an edit or a switch. */
  revision: number;
}

/** The original front end's limits: 50 groups, 50 tags in each list (the backend allows 1,000 in all). */
export const MAX_BLOCK_GROUPS = 50;
export const MAX_TAGS_PER_LIST = 50;
/** `屏蔽组名称`'s `maxlength` in the original form. */
export const MAX_GROUP_NAME = 30;

/** A tag list — lower-cased, unique — from what a Derpibooru filter holds (an array or a comma string). */
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

interface BlockGroupRow {
  id: number;
  name: string;
  hidden_tags: string[];
  spoilered_tags: string[];
  active: boolean;
  revision: number;
  created_at: string;
}

/** `GET /me/block-groups` — oldest first. */
export async function getBlockGroups(token: string, signal?: AbortSignal): Promise<BlockGroup[]> {
  const data = await api<{ groups: BlockGroupRow[] }>('GET', '/me/block-groups', { token, signal, cache: 'no-store' });
  return data.groups.map(({ id, name, hidden_tags, spoilered_tags, active, revision }) => ({
    id, name, hidden_tags, spoilered_tags, active, revision,
  }));
}

export interface BlockGroupInput {
  /** Absent for a new group. */
  id?: number | null;
  /** An edit's: the version the screen holds, and the switch's state, which the edit keeps. */
  revision?: number;
  active?: boolean;
  name: string;
  hidden: readonly string[];
  spoilered: readonly string[];
}

/**
 * `POST /me/block-groups` for a new group (switched on), `PUT /me/block-groups/{id}` for an edit —
 * `{name, hidden_tags, spoilered_tags, active, expected_revision}`. **An edit must send `active`**:
 * the backend writes it, and its default is on. Resolves with the group's id and new revision.
 */
export async function saveBlockGroup(token: string, input: BlockGroupInput): Promise<{ id: number; revision: number }> {
  const body = {
    name: input.name,
    hidden_tags: [...input.hidden],
    spoilered_tags: [...input.spoilered],
    active: input.active ?? true,
  };
  return input.id
    ? api<{ id: number; revision: number }>('PUT', `/me/block-groups/${seg(input.id)}`, {
      token,
      json: { ...body, expected_revision: input.revision },
    })
    : api<{ id: number; revision: number }>('POST', '/me/block-groups', { token, json: body });
}

/** `DELETE /me/block-groups/{id}`. */
export async function deleteBlockGroup(token: string, id: number): Promise<void> {
  await api('DELETE', `/me/block-groups/${seg(id)}`, { token });
}

/** `PUT /me/block-groups/{id}/activation {active, expected_revision}` → the group's new revision. */
export async function toggleBlockGroup(token: string, id: number, active: boolean, revision: number): Promise<{ revision: number }> {
  const data = await api<{ active: boolean; revision: number }>('PUT', `/me/block-groups/${seg(id)}/activation`, {
    token,
    json: { active, expected_revision: revision },
  });
  return { revision: data.revision };
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
  return (data.filters as Record<string, unknown>[])
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
    for (const tag of Array.isArray(data.tags) ? (data.tags as Record<string, unknown>[]) : []) {
      if (tag && typeof tag.name === 'string') names.push(tag.name);
    }
  }
  return names;
}

function ids(value: unknown): number[] {
  return (Array.isArray(value) ? value : []).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0);
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
