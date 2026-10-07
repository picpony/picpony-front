import { ApiError } from './errors';
import { picponyPostJson, picponyRequest, readEnvelope } from './http';
import { tagList } from './blockGroups';

/**
 * 标签组 — a named set of tags kept on the account, searched as one (搜索这组标签) and shared as a
 * link (the original front end's 自定义标签收藏组, `tag_groupsPageContainer`). The forum's
 * 标签组分享 imports other people's into the same list (`import_shared_tag_group`).
 *
 * Strict at both ends, like every account list: a refusal is an `ApiError`, never an empty list
 * or a save that seemed to land.
 */

export interface TagGroup {
  id: number;
  name: string;
  tags: string[];
}

/** The original front end's limits: 50 groups of up to 50 tags. */
export const MAX_TAG_GROUPS = 50;
export const MAX_TAGS_PER_TAG_GROUP = 50;
export const MAX_TAG_GROUP_NAME = 30;

export function tagGroupOf(row: unknown): TagGroup | null {
  if (!row || typeof row !== 'object') return null;
  const group = row as Record<string, unknown>;
  const id = Number(group.id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return { id, name: typeof group.name === 'string' ? group.name.trim() : '', tags: tagList(group.tags) };
}

export async function getTagGroups(token: string, signal?: AbortSignal): Promise<TagGroup[]> {
  const data = await readEnvelope<{ groups?: unknown }>(
    await picponyRequest('get_tag_groups', { token, query: { _t: Date.now() }, signal }),
  );
  if (!Array.isArray(data.groups)) throw new ApiError('invalid');
  return data.groups.map(tagGroupOf).filter((group): group is TagGroup => group !== null);
}

/**
 * `POST save_tag_group {id|0, name, tags, type:'collection'}` — the original front end's body.
 * Resolves with the saved group's id when the backend names it.
 */
export async function saveTagGroup(
  token: string,
  input: { id?: number | null; name: string; tags: readonly string[] },
): Promise<{ id: number | null }> {
  const data = await readEnvelope<{ id?: unknown; group_id?: unknown }>(
    await picponyPostJson('save_tag_group', {
      id: input.id ?? 0,
      name: input.name,
      tags: [...input.tags],
      type: 'collection',
    }, { token }),
  );
  const id = Number(data.id ?? data.group_id);
  return { id: Number.isSafeInteger(id) && id > 0 ? id : (input.id ?? null) };
}

export async function deleteTagGroup(token: string, id: number): Promise<void> {
  await readEnvelope(await picponyPostJson('delete_tag_group', { id }, { token }));
}

/**
 * One tag as a search term. Most are written as they are; a tag whose name holds query syntax —
 * a parenthesis, a quote, a backslash, or a leading `-` / `!` / `~` — is quoted, or Philomena
 * would read `princess luna (season 1)` as a tag and a group.
 */
export function tagTerm(tag: string): string {
  return /[()"\\]/.test(tag) || /^[-!~]/.test(tag) ? `"${tag.replace(/["\\]/g, '\\$&')}"` : tag;
}

/**
 * A group as one search: its tags joined by Philomena's AND (the comma), as the original
 * 搜搜这个组合 built it. Empty for a group with no tags.
 */
export function tagGroupQuery(tags: readonly string[]): string {
  return tags.map(tagTerm).join(', ');
}
