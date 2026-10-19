import type { ForumCategory, ForumPostDetailResponse, ForumPostsResponse } from '@/lib/types/forum';
import { api, seg } from './http';
import { uploadMedia } from './upload';
import {
  commentOf,
  contentWire,
  forumListParams,
  forumPostsOf,
  postOf,
  type SharedBlockGroup,
  type SharedTagGroup,
  type ForumCategoryFilter,
  type ForumSort,
  type WireComment,
  type WirePost,
  type WirePostPage,
} from '@/lib/forumModel';

export * from '@/lib/forumModel';

/**
 * The forum over the Rust backend (src/pg/forum.rs): the list, a thread and its replies, the
 * writes, the picture upload, and the tag-group share's two halves. Reads normalise at this
 * boundary (`lib/forumModel.ts`) and every failure — a write's refusal included — is an
 * `ApiError` whose message is the sentence to show.
 *
 * Posting, editing and replying carry an `Idempotency-Key` (the backend requires it): one per
 * press, so an answer lost on the way back is not a second post when the same body is re-sent
 * under the same key, and a new press is a new post.
 */

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ForumListQuery {
  page: number;
  category?: ForumCategoryFilter;
  sort?: ForumSort;
  /** Title, body or author — the backend searches all three. */
  search?: string;
  /** The viewer's session: a signed-in read carries their like state. */
  token?: string | null;
}

export async function getForumPosts(query: ForumListQuery, signal?: AbortSignal): Promise<ForumPostsResponse> {
  const data = await api<WirePostPage>('GET', '/forum/posts', {
    query: forumListParams(query),
    token: query.token ?? undefined,
    cache: 'no-store',
    signal,
  });
  return forumPostsOf(data, Boolean(query.token));
}

/**
 * `POST /me/forum/read-receipts {up_to}` → 204 — the forum has been read up to `upTo` (ISO 8601):
 * `forum` in `GET /me/unread-counts` then counts only posts created after it. The backend never
 * moves the mark backwards nor past its own clock.
 */
export async function markForumRead(token: string, upTo: string): Promise<void> {
  await api('POST', '/me/forum/read-receipts', { token, json: { up_to: upTo } });
}

/** Replies to a page (the backend's default). */
export const FORUM_REPLY_PAGE = 20;

/**
 * One thread and one page of its replies — two reads, the post and its replies. A malformed id
 * is a 400 and an unknown one a 404: both are "this thread does not exist". A page past the end
 * is answered with the last page, which is how a new reply is found without knowing the page
 * count (`LAST_PAGE` in `threadActions`).
 *
 * The post read counts a view on the server, as it always did.
 */
export async function getForumPostDetail(
  id: string,
  page: number = 1,
  signal?: AbortSignal,
  token?: string | null,
): Promise<ForumPostDetailResponse> {
  const path = `/forum/posts/${seg(id)}`;
  const replies = (at: number) =>
    api<{ comments: WireComment[]; total: number; total_pages: number }>('GET', `${path}/comments`, {
      query: { page: at, limit: FORUM_REPLY_PAGE },
      cache: 'no-store',
      signal,
      notFoundStatuses: [400],
    });
  const wanted = Math.max(1, Math.floor(page));
  const [post, first] = await Promise.all([
    api<{ post: WirePost }>('GET', path, {
      token: token ?? undefined,
      cache: 'no-store',
      signal,
      notFoundStatuses: [400],
    }),
    replies(wanted),
  ]);
  const totalPages = Math.max(1, first.total_pages);
  const comments = wanted > totalPages ? await replies(totalPages) : first;
  return {
    post: postOf(post.post),
    comments: comments.comments.map(commentOf),
    total_comments: comments.total,
    total_pages: totalPages,
    page: Math.min(wanted, totalPages),
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface ForumPostInput {
  title: string;
  excerpt: string;
  category: ForumCategory;
  /** The body's text: a discussion's BBCode, a commission's description, a share's note. */
  content: string;
  /** A commission's link, or `''`. */
  commission_link: string;
  cover_image: string | null;
  /** A tag-group share's groups; `null` for the other kinds. */
  shared_groups: { tag_groups: SharedTagGroup[]; block_groups: SharedBlockGroup[] } | null;
}

/** The body as the backend takes it. Pictures are bound by the `/api/v1/media/…` addresses the
 *  body and the cover hold — an upload the post no longer shows is simply left unbound. */
function postWire(body: ForumPostInput, expectedRevision?: number) {
  return {
    title: body.title,
    excerpt: body.excerpt,
    content: contentWire(body.category, body.content, body.commission_link, body.shared_groups),
    cover_image: body.cover_image,
    ...(expectedRevision !== undefined ? { expected_revision: expectedRevision } : {}),
  };
}

/** Publishes a post; resolves with its id. `idempotencyKey` names this one press. */
export async function createForumPost(token: string, body: ForumPostInput, idempotencyKey: string): Promise<number> {
  const data = await api<{ id: number; revision: number }>('POST', '/forum/posts', {
    token,
    json: postWire(body),
    idempotencyKey,
  });
  return data.id;
}

/**
 * Saves an edit made to revision `expectedRevision`; resolves with the new revision. An edit made
 * meanwhile elsewhere is refused (409 `POST_VERSION_CONFLICT`, 帖子已更新，请刷新后重试).
 */
export async function updateForumPost(
  token: string,
  id: number,
  body: ForumPostInput,
  expectedRevision: number,
  idempotencyKey: string,
): Promise<number> {
  const data = await api<{ id: number; revision: number }>('PUT', `/forum/posts/${seg(id)}`, {
    token,
    json: postWire(body, expectedRevision),
    idempotencyKey,
  });
  return data.revision;
}

export async function deleteForumPost(token: string, id: number): Promise<void> {
  await api('DELETE', `/forum/posts/${seg(id)}`, { token });
}

export interface ReplyBody {
  postId: number;
  content: string;
  /** Who the reply answers — notified directly. */
  replyToUserId?: number;
}

/** Posts a reply. `idempotencyKey` names this one press. */
export async function createForumComment(token: string, body: ReplyBody, idempotencyKey: string): Promise<void> {
  await api('POST', `/forum/posts/${seg(body.postId)}/comments`, {
    token,
    json: { content: body.content, ...(body.replyToUserId ? { reply_to_user_id: body.replyToUserId } : {}) },
    idempotencyKey,
  });
}

export async function deleteForumComment(token: string, id: number): Promise<void> {
  await api('DELETE', `/forum/comments/${seg(id)}`, { token });
}

/**
 * Sets the viewer's like to `liked` (a state, not a toggle, so a repeated request cannot undo
 * itself); resolves with the server's own count and state.
 */
export async function setForumPostLike(
  token: string,
  postId: number,
  liked: boolean,
): Promise<{ liked: boolean; count: number }> {
  const data = await api<{ liked: boolean; like_count: number }>('PUT', `/me/forum/posts/${seg(postId)}/like`, {
    token,
    json: { liked },
  });
  return { liked: data.liked, count: data.like_count };
}

/**
 * Uploads one picture for a post or a reply; resolves with its address, `/api/v1/media/<asset>`
 * — what the body and the cover reference, and what binds the picture when the post is saved.
 * Over XMLHttpRequest for its progress (`uploadMedia`). Every failure is an `ApiError`; the
 * caller's abort stays an `AbortError`.
 */
export async function uploadForumImage(
  token: string,
  file: Blob,
  options: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {},
): Promise<string> {
  const form = new FormData();
  form.append('image', file, file instanceof File && file.name ? file.name : 'image');
  const media = await uploadMedia('/me/uploads/forum-images', token, form, {
    ...options,
    tooLarge: '图片太大，服务器拒绝了这次上传',
  });
  return media.url;
}

// ---------------------------------------------------------------------------
// Tag-group sharing
// ---------------------------------------------------------------------------

export interface ShareableTagGroup extends SharedTagGroup {
  id: number;
}

export interface ShareableBlockGroup extends SharedBlockGroup {
  id: number;
}

/** The viewer's own tag groups and block groups, to choose from when sharing. */
export async function getMyShareableGroups(
  token: string,
  signal?: AbortSignal,
): Promise<{ tagGroups: ShareableTagGroup[]; blockGroups: ShareableBlockGroup[] }> {
  const data = await api<{
    tag_groups: { id: number; name: string; tags: string[]; revision: number }[];
    block_groups: { id: number; name: string; hidden_tags: string[]; spoilered_tags: string[]; revision: number }[];
  }>('GET', '/me/shareable-groups', { token, signal });
  return {
    tagGroups: data.tag_groups.map(({ id, name, tags }) => ({ id, name, tags })),
    blockGroups: data.block_groups.map(({ id, name, hidden_tags, spoilered_tags }) => ({ id, name, hidden_tags, spoilered_tags })),
  };
}

/** Saves a shared tag group as one of the viewer's own. */
export async function importSharedTagGroup(token: string, group: SharedTagGroup): Promise<void> {
  await api('POST', '/me/tag-group-imports', { token, json: { name: group.name, tags: group.tags } });
}

/** Saves a shared block group as one of the viewer's own (off until they enable it). */
export async function importSharedBlockGroup(token: string, group: SharedBlockGroup): Promise<void> {
  await api('POST', '/me/block-group-imports', {
    token,
    json: { name: group.name, hidden_tags: group.hidden_tags, spoilered_tags: group.spoilered_tags, active: false },
  });
}
