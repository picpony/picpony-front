import { api, seg } from './http';

/**
 * 标签组 — a named set of tags kept on the account, searched as one (搜索这组标签) and shared as a
 * link (the original front end's 自定义标签收藏组). The forum's 标签组分享 imports other people's
 * into the same list (`import_shared_tag_group`). Rust: `src/pg/tag_groups.rs`.
 *
 * Strict at both ends, like every account list: a refusal is an `ApiError`, never an empty list
 * or a save that seemed to land. An edit carries the group's `revision`; a group changed
 * elsewhere meanwhile is refused (409 `GROUP_VERSION_CONFLICT`).
 */

export interface TagGroup {
  id: number;
  name: string;
  tags: string[];
  /** The backend's version of the group, sent back with an edit. */
  revision: number;
}

/** The original front end's limits: 50 groups of up to 50 tags (the backend's too). */
export const MAX_TAG_GROUPS = 50;
export const MAX_TAGS_PER_TAG_GROUP = 50;
export const MAX_TAG_GROUP_NAME = 30;

interface TagGroupRow {
  id: number;
  name: string;
  tags: string[];
  revision: number;
  created_at: string;
}

/** `GET /me/tag-groups` — oldest first. */
export async function getTagGroups(token: string, signal?: AbortSignal): Promise<TagGroup[]> {
  const data = await api<{ groups: TagGroupRow[] }>('GET', '/me/tag-groups', { token, signal, cache: 'no-store' });
  return data.groups.map(({ id, name, tags, revision }) => ({ id, name, tags, revision }));
}

/**
 * `POST /me/tag-groups {name, tags}` for a new group, `PUT /me/tag-groups/{id} {name, tags,
 * expected_revision}` for an edit. Resolves with the group's id and its new revision.
 */
export async function saveTagGroup(
  token: string,
  input: { id?: number | null; revision?: number; name: string; tags: readonly string[] },
): Promise<{ id: number; revision: number }> {
  const body = { name: input.name, tags: [...input.tags] };
  return input.id
    ? api<{ id: number; revision: number }>('PUT', `/me/tag-groups/${seg(input.id)}`, {
      token,
      json: { ...body, expected_revision: input.revision },
    })
    : api<{ id: number; revision: number }>('POST', '/me/tag-groups', { token, json: body });
}

/** `DELETE /me/tag-groups/{id}`. */
export async function deleteTagGroup(token: string, id: number): Promise<void> {
  await api('DELETE', `/me/tag-groups/${seg(id)}`, { token });
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
