import { PICPONY_API_BASE } from '@/lib/constants';
import type { ForumCategory, ForumPostDetailResponse, ForumPostsResponse } from '@/lib/types/forum';
import { ApiError, statusMessage, toApiError } from './errors';
import { envelopeMessage, listOf, pageCount, picponyPostJson, picponyRequest, readEnvelope } from './http';
import {
  commentOf,
  num,
  postOf,
  records,
  type SharedBlockGroup,
  type SharedTagGroup,
  type ForumCategoryFilter,
  type ForumSort,
} from '@/lib/forumModel';

export * from '@/lib/forumModel';

/**
 * The forum's whole backend contract, as the original front end speaks it (its bundle is the
 * reference: `loadForumPosts`, `submitForumPost`, `openEditForumPostModal`, the tag-group share
 * and import, `deleteForumPost` / `deleteForumComment`). Reads normalise at this boundary and
 * every failure — a write's refusal included — is an `ApiError` whose message is the sentence to
 * show; no screen reads an envelope itself.
 */

const str = (value: unknown): string => (typeof value === 'string' ? value : value == null ? '' : String(value));
const flag = (value: unknown): boolean => value === true || value === 1 || value === '1';
const strings = (value: unknown): string[] =>
  listOf<unknown>(value).filter((item): item is string => typeof item === 'string' && item.trim() !== '');

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ForumListQuery {
  page: number;
  category?: ForumCategoryFilter;
  sort?: ForumSort;
  /** Title, body or author — the backend searches all three. */
  search?: string;
  /** The viewer's session: a signed-in read carries their like and unread state. */
  token?: string | null;
}

export async function getForumPosts(query: ForumListQuery, signal?: AbortSignal): Promise<ForumPostsResponse> {
  const search = query.search?.trim();
  const data = await readEnvelope<{ posts?: unknown; total?: unknown; total_pages?: unknown }>(
    await picponyRequest('get_forum_posts', {
      query: {
        page: query.page,
        category: query.category ?? 'all',
        sort: query.sort ?? 'updated_at',
        search: search || undefined,
      },
      token: query.token ?? undefined,
      cache: 'no-store',
      signal,
    }),
  );
  if (data.posts !== undefined && !Array.isArray(data.posts)) throw new ApiError('invalid');
  const posts = records(data.posts).map(postOf);
  return {
    posts,
    total: Math.max(num(data.total), posts.length),
    totalPages: pageCount(data.total_pages),
    signedIn: Boolean(query.token),
  };
}

/**
 * One thread and one page of its replies. The backend answers an unknown id with an HTML 404 and
 * a malformed one with a 400 (`无效的帖子ID`) — both are "this thread does not exist", so both
 * are `notFound`. A page past the end is answered with the last page, which is how a new reply is
 * found without knowing the reply page size.
 */
export async function getForumPostDetail(
  id: string,
  page: number = 1,
  signal?: AbortSignal,
  token?: string | null,
): Promise<ForumPostDetailResponse> {
  const data = await readEnvelope<{
    post?: unknown; comments?: unknown; total_comments?: unknown; total_pages?: unknown;
  }>(
    await picponyRequest('get_forum_post_detail', {
      query: { id, page },
      token: token ?? undefined,
      cache: 'no-store',
      signal,
    }),
    { notFoundStatuses: [400, 404] },
  );
  const raw = data.post as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object' || !Number.isFinite(Number(raw.id))) throw new ApiError('invalid');
  const comments = records(data.comments).map(commentOf);
  const totalPages = pageCount(data.total_pages);
  return {
    post: postOf(raw),
    comments,
    total_comments: Math.max(num(data.total_comments), comments.length),
    total_pages: totalPages,
    page: Math.min(Math.max(1, page), totalPages),
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface ForumPostInput {
  title: string;
  excerpt: string;
  content: string;
  category: ForumCategory;
  cover_image: string | null;
  /** A tag-group share's groups; `null` for the other kinds. */
  shared_groups: { tag_groups: SharedTagGroup[]; block_groups: SharedBlockGroup[] } | null;
  /** Every picture uploaded while writing — the backend keeps the ones the post uses. */
  draft_images: string[];
}

/** Publishes a post; resolves with its id. */
export async function createForumPost(token: string, body: ForumPostInput): Promise<number> {
  const data = await readEnvelope<{ post_id?: unknown; id?: unknown }>(
    await picponyPostJson('create_forum_post', { ...body }, { token }),
  );
  const id = Number(data.post_id ?? data.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new ApiError('invalid', { message: '已发布，但服务器没有返回帖子地址，请在论坛列表中查看' });
  }
  return id;
}

export async function updateForumPost(token: string, id: number, body: ForumPostInput): Promise<void> {
  await readEnvelope(await picponyPostJson('update_forum_post', { ...body, id }, { token }));
}

export async function deleteForumPost(token: string, id: number): Promise<void> {
  await readEnvelope(await picponyPostJson('delete_forum_post', { id }, { token }));
}

export interface ReplyBody {
  postId: number;
  content: string;
  replyToUserId?: number;
  replyToCommentId?: number;
}

export async function createForumComment(token: string, body: ReplyBody): Promise<void> {
  const payload: Record<string, unknown> = { post_id: body.postId, content: body.content };
  if (body.replyToUserId) payload.reply_to_user_id = body.replyToUserId;
  if (body.replyToCommentId) payload.reply_to_comment_id = body.replyToCommentId;
  await readEnvelope(await picponyPostJson('create_forum_comment', payload, { token }));
}

export async function deleteForumComment(token: string, id: number): Promise<void> {
  await readEnvelope(await picponyPostJson('delete_forum_comment', { id }, { token }));
}

/** Toggles the viewer's like; resolves with the server's own count and state. */
export async function toggleForumPostLike(token: string, postId: number): Promise<{ liked: boolean; count: number }> {
  const data = await readEnvelope<{ is_liked?: unknown; like_count?: unknown }>(
    await picponyPostJson('toggle_forum_post_like', { id: postId }, { token }),
  );
  return { liked: flag(data.is_liked), count: num(data.like_count) };
}

/**
 * Uploads one picture for a post; resolves with the path the backend stored it at (`url`, the
 * field the original front end reads — `image_url` is accepted from an older backend).
 *
 * Over XMLHttpRequest, because it is the one transport that reports upload progress: a cover
 * or a picture in a post is up to 5MB, and a bar that moves is the difference between waiting
 * and wondering. Every failure is an `ApiError`; the caller's abort stays an `AbortError`.
 */
export function uploadForumImage(
  token: string,
  file: Blob,
  options: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {},
): Promise<string> {
  const { signal, onProgress } = options;
  return new Promise<string>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('上传已取消', 'AbortError'));
      return;
    }
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const done = () => signal?.removeEventListener('abort', onAbort);
    xhr.open('POST', `${PICPONY_API_BASE}?action=upload_forum_image`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.responseType = 'text';
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(Math.min(1, event.loaded / event.total));
    };
    xhr.onload = () => {
      done();
      let data: Record<string, unknown> | null = null;
      try {
        const parsed: unknown = JSON.parse(xhr.responseText || 'null');
        data = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
      } catch {
        data = null;
      }
      const serverMessage = envelopeMessage(data);
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new ApiError('http', {
          status: xhr.status,
          serverMessage,
          message: xhr.status === 413 ? '图片太大，服务器拒绝了这次上传' : serverMessage ?? statusMessage(xhr.status),
        }));
        return;
      }
      if (!data) {
        reject(new ApiError('invalid', { status: xhr.status }));
        return;
      }
      if (data.success !== true) {
        reject(new ApiError('envelope', { status: xhr.status, serverMessage, message: serverMessage ?? '图片上传失败' }));
        return;
      }
      const url = str(data.url || data.image_url).trim();
      if (!url) {
        reject(new ApiError('invalid', { status: xhr.status }));
        return;
      }
      onProgress?.(1);
      resolve(url);
    };
    xhr.onerror = () => {
      done();
      reject(toApiError(new TypeError('Failed to fetch')));
    };
    xhr.ontimeout = () => {
      done();
      reject(new ApiError('timeout'));
    };
    xhr.onabort = () => {
      done();
      reject(new DOMException('上传已取消', 'AbortError'));
    };
    const form = new FormData();
    form.append('image', file, file instanceof File ? file.name : 'image');
    xhr.send(form);
  });
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
  const data = await readEnvelope<{ tag_groups?: unknown; block_groups?: unknown }>(
    await picponyRequest('get_my_shareable_groups', { token, signal }),
  );
  const tagGroups = records(data.tag_groups).map((group) => ({
    id: num(group.id),
    name: str(group.name).trim() || '未命名标签组',
    tags: strings(group.tags),
  }));
  const blockGroups = records(data.block_groups).map((group) => ({
    id: num(group.id),
    name: str(group.name).trim() || '未命名屏蔽组',
    hidden_tags: strings(group.hidden_tags),
    spoilered_tags: strings(group.spoilered_tags),
  }));
  return { tagGroups, blockGroups };
}

/** Saves a shared tag group as one of the viewer's own. */
export async function importSharedTagGroup(token: string, group: SharedTagGroup): Promise<void> {
  await readEnvelope(await picponyPostJson('import_shared_tag_group', { name: group.name, tags: group.tags }, { token }));
}

/** Saves a shared block group as one of the viewer's own (off until they enable it). */
export async function importSharedBlockGroup(token: string, group: SharedBlockGroup): Promise<void> {
  await readEnvelope(
    await picponyPostJson(
      'import_shared_block_group',
      { name: group.name, hidden_tags: group.hidden_tags, spoilered_tags: group.spoilered_tags },
      { token },
    ),
  );
}
