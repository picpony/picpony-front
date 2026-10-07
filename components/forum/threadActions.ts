'use client';

import { showToast } from '@/components/Toast';
import {
  createForumComment,
  deleteForumComment,
  deleteForumPost,
  getForumPostDetail,
  toggleForumPostLike,
  type ReplyBody,
} from '@/lib/api/forum';
import { apiErrorMessage } from '@/lib/api/errors';
import { createShareLink, trackShare } from '@/lib/api/share';
import { firstImageOf } from '@/lib/bbcode';
import { forumTeaser } from '@/lib/forumText';
import type { ForumPost, ForumPostDetailResponse } from '@/lib/types/forum';
import { copyText, getAssetUrl } from '@/lib/utils';

/**
 * The thread's writes, at module scope: each resolves with an outcome rather than throwing, so
 * the screen's handlers need no `try` — the React Compiler does not lower one with a `finally`
 * inside a component, and a component it cannot compile is one it does not optimise.
 */

export type Outcome = { ok: true } | { ok: false; message: string };

export async function sendLike(
  token: string,
  postId: number,
): Promise<{ ok: true; liked: boolean; count: number } | { ok: false; message: string }> {
  try {
    const { liked, count } = await toggleForumPostLike(token, postId);
    return { ok: true, liked, count };
  } catch (error) {
    return { ok: false, message: apiErrorMessage(error, '点赞失败') };
  }
}

export async function removePost(token: string, postId: number): Promise<Outcome> {
  try {
    await deleteForumPost(token, postId);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: apiErrorMessage(error, '删除失败') };
  }
}

export async function removeComment(token: string, commentId: number): Promise<Outcome> {
  try {
    await deleteForumComment(token, commentId);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: apiErrorMessage(error, '删除失败') };
  }
}

/** A page past any thread's end, which the backend answers with the last page (measured). */
const LAST_PAGE = 9999;

/**
 * Sends a reply, then reads the thread's last page — the backend answers a page past the end with
 * its last one — which is where the reply now is (R6-032). `last` is `null` when only that read
 * failed: the reply was still sent.
 */
export async function sendReply(
  token: string,
  threadId: string,
  body: ReplyBody,
): Promise<{ ok: true; last: ForumPostDetailResponse | null } | { ok: false; message: string }> {
  try {
    await createForumComment(token, body);
  } catch (error) {
    return { ok: false, message: apiErrorMessage(error, '回复发送失败') };
  }
  try {
    return { ok: true, last: await getForumPostDetail(threadId, LAST_PAGE, undefined, token) };
  } catch {
    return { ok: true, last: null };
  }
}

// ---------------------------------------------------------------------------
// Sharing — the image detail's two actions, for a post
// ---------------------------------------------------------------------------

const shareLinks = new Map<number, string>();

function shareTextOf(post: ForumPost): string {
  return forumTeaser(post, 40) || '点击链接查看帖子';
}

/** The short link for the post (the long one when the backend cannot make one). */
async function postShareLink(post: ForumPost, token: string | null): Promise<string> {
  const cached = shareLinks.get(post.id);
  if (cached) return cached;
  const picture = post.cover_image ?? firstImageOf(post.content);
  const link = await createShareLink(
    {
      targetUrl: new URL(`/forum/${post.id}`, window.location.origin).href,
      title: post.title,
      desc: shareTextOf(post),
      imageUrl: picture ? getAssetUrl(picture) : undefined,
    },
    { token },
  );
  if (link.short) shareLinks.set(post.id, link.url);
  return link.url;
}

async function copyLink(url: string, token: string | null): Promise<boolean> {
  if (!(await copyText(url))) return false;
  showToast('已复制分享链接', 'success');
  trackShare(token);
  return true;
}

/**
 * 复制链接. The link is made over the network first, and some browsers only allow a clipboard
 * write inside the gesture that asked for it — by the time the link exists that gesture can be
 * spent, so a copy that fails is offered again as a tap.
 */
export async function copyPostLink(post: ForumPost, token: string | null): Promise<void> {
  const url = await postShareLink(post, token);
  if (await copyLink(url, token)) return;
  showToast('分享链接已生成', 'info', {
    action: {
      label: '复制',
      onClick: () => {
        void copyLink(url, token).then((copied) => {
          if (!copied) showToast('复制失败，请检查浏览器的剪贴板权限', 'error');
        });
      },
    },
  });
}

/** 分享到其他应用: the system share sheet, with the same link and words. */
export async function sharePostNatively(post: ForumPost, token: string | null): Promise<void> {
  const url = await postShareLink(post, token);
  const data: ShareData = { title: post.title, text: shareTextOf(post), url };
  const open = () =>
    navigator.share(data).then(
      () => trackShare(token),
      (error: unknown) => {
        const name = error instanceof DOMException ? error.name : '';
        /* The reader closed the sheet: nothing to say. */
        if (name === 'AbortError') return;
        /* The gesture was spent waiting for the link: offer the sheet again, from a fresh tap. */
        if (name === 'NotAllowedError') {
          showToast('分享链接已生成', 'info', { action: { label: '分享', onClick: () => void open() } });
          return;
        }
        void copyPostLink(post, token);
      },
    );
  await open();
}
