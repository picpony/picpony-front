'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { backendTimeValue } from '@/lib/format';
import { SKIP, useResource } from '@/lib/resource';
import { derpiComments, siteCommentCounts, siteComments } from '@/lib/resources';
import { DERPI_COMMENTS_PER_PAGE } from '@/lib/api/derpi';
import type { Comment } from '@/lib/types/image';

/**
 * A picture's comments from both of their homes, as one thread, newest first.
 *
 * PicPony's own comments (`siteComments`, the whole thread in one answer) and Derpibooru's
 * (`derpiComments`, fifty a page) are two reads on two upstreams, and **neither waits on the
 * other past a short grace**. The first used to be a `Promise.allSettled` over both, so PicPony's
 * own comments sat behind the relay's slowest answer. Rendered as each lands, though, a late
 * source interleaves by time and reshuffles rows under the reader — so the thread appears when
 * both are in, or `JOIN_GRACE_MS` after the first one is, whichever comes first; a source still
 * out after that gets a row of its own at the end, and merges in when it lands.
 *
 * Older Derpibooru pages load on request (`loadMore`); the thread stays in time order as they
 * arrive. A source that failed is its own inline error, not an empty thread: "no comments" is
 * only said when both answered with none.
 */

/** How long a source that has answered waits for the other before the thread is shown. */
const JOIN_GRACE_MS = 1500;

export interface CommentSource {
  /** It has not answered yet. */
  loading: boolean;
  /** Its read failed and nothing of it is on screen. */
  error: unknown;
  retry: () => void;
}

export interface ImageComments {
  /** Both sources merged, newest first — empty until the thread is shown. */
  comments: Comment[];
  /** The thread is on screen (both answered, or the grace ran out). */
  shown: boolean;
  site: CommentSource & { count: number | null };
  derpi: CommentSource & { total: number | null };
  /** Every comment there is, once both counts are known; otherwise what is known so far. */
  total: number | null;
  /** More Derpibooru comments exist than are loaded. */
  hasMore: boolean;
  loadingMore: boolean;
  moreError: unknown;
  loadMore: () => void;
  /** Take a deleted comment out at once, and re-read underneath. */
  removeSiteComment: (id: number) => void;
  /** Re-read PicPony's thread under what is shown (after a post). */
  refreshSite: () => void;
}

interface ExtraPages {
  imageId: number;
  pages: Comment[][];
  loading: boolean;
  error: unknown;
}

/** The older pages of a picture with none loaded — one array, so it is one dependency value. */
const NO_PAGES: Comment[][] = [];

const commentKey = (comment: Comment) => `${comment.source ?? 'picpony'}-${comment.id}`;

function merge(...lists: Comment[][]): Comment[] {
  const seen = new Set<string>();
  const out: Comment[] = [];
  for (const list of lists) {
    for (const comment of list) {
      const key = commentKey(comment);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(comment);
    }
  }
  /* The shared backend clock: PicPony's offset-less Beijing stamps and Derpibooru's UTC ones
     compare correctly (`lib/format.ts`). */
  return out.sort((a, b) => backendTimeValue(b.created_at) - backendTimeValue(a.created_at));
}

/**
 * Whether Derpibooru holds a page after the ones loaded — counted in pages, not rows (P3-F6). A
 * page can carry fewer rows than it was asked for (a row without a usable id is dropped), and a
 * row count then never reached the total: 加载更多 stayed offered at the end of the thread, and
 * every press read another empty page. An empty page is the end, whatever the total said.
 */
export function hasMoreDerpiComments(pages: readonly (readonly Comment[])[], total: number | null): boolean {
  if (total === null || pages.length === 0 || pages[pages.length - 1].length === 0) return false;
  return pages.length * DERPI_COMMENTS_PER_PAGE < total;
}

/**
 * What a reply tells the backend about the comment it answers (`post_comment`'s
 * `reply_to_user_id` / `reply_to_comment_id`). Both are PicPony's own ids (P3-F4): a Derpibooru
 * comment's id names nothing here — sent as `reply_to_comment_id` it named whichever PicPony
 * comment happens to share the number, and that comment's author could be told they were
 * answered. A Derpibooru author has no account here either, so a reply to one sends neither; the
 * quote in the body still says what it answers.
 */
export function replyReference(replyTo: { id: number; source: 'picpony' | 'trixiebooru'; userId: number | null } | null): {
  userId: number;
  commentId: number | null;
} {
  if (!replyTo || replyTo.source !== 'picpony') return { userId: 0, commentId: null };
  return { userId: replyTo.userId ?? 0, commentId: replyTo.id };
}

export function useImageComments(imageId: number, enabled: boolean): ImageComments {
  const site = useResource(siteComments, enabled ? { imageId } : SKIP);
  const first = useResource(derpiComments, enabled ? { imageId, page: 1 } : SKIP);

  const siteSettled = site.data !== undefined || site.error !== undefined;
  const derpiSettled = first.data !== undefined || first.error !== undefined;

  /* The grace: once one source is in, the other gets `JOIN_GRACE_MS` before the thread shows. */
  const [graceOver, setGraceOver] = useState<number | null>(null);
  const waiting = enabled && siteSettled !== derpiSettled;
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setTimeout(() => setGraceOver(imageId), JOIN_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [imageId, waiting]);
  const shown = enabled && ((siteSettled && derpiSettled) || (graceOver === imageId && (siteSettled || derpiSettled)));

  const [extra, setExtra] = useState<ExtraPages>({ imageId, pages: NO_PAGES, loading: false, error: undefined });
  const ownPages = extra.imageId === imageId;
  const extraPages = ownPages ? extra.pages : NO_PAGES;
  const moreLoading = ownPages && extra.loading;
  const moreError = ownPages ? extra.error : undefined;

  const derpiTotal = first.data?.total ?? null;
  const hasMore = first.data !== undefined && hasMoreDerpiComments([first.data.comments, ...extraPages], derpiTotal);

  const pagesLoaded = extraPages.length;
  const loadMore = useCallback(() => {
    if (moreLoading || !hasMore) return;
    const page = pagesLoaded + 2;
    setExtra((state) => ({
      imageId,
      pages: state.imageId === imageId ? state.pages : NO_PAGES,
      loading: true,
      error: undefined,
    }));
    derpiComments.read({ imageId, page }).then(
      (result) =>
        setExtra((state) =>
          state.imageId === imageId && state.pages.length === page - 2
            ? { imageId, pages: [...state.pages, result.comments], loading: false, error: undefined }
            : state,
        ),
      (error: unknown) =>
        setExtra((state) => (state.imageId === imageId ? { ...state, loading: false, error } : state)),
    );
  }, [hasMore, imageId, moreLoading, pagesLoaded]);

  const siteData = site.data;
  const firstComments = first.data?.comments;
  const comments = useMemo(
    () => (shown ? merge(siteData ?? [], firstComments ?? [], ...extraPages) : []),
    [extraPages, firstComments, shown, siteData],
  );

  const siteCount = siteData ? siteData.length : null;
  const total = siteCount !== null || derpiTotal !== null ? (siteCount ?? 0) + (derpiTotal ?? 0) : null;

  const refreshSite = useCallback(() => {
    siteComments.invalidate({ imageId });
    /* The grids' `+n` beside Derpibooru's count reads this thread's size too. */
    siteCommentCounts.expire();
  }, [imageId]);

  const removeSiteComment = useCallback(
    (id: number) => {
      siteComments.write({ imageId }, (previous) => (previous ?? []).filter((comment) => comment.id !== id));
      refreshSite();
    },
    [imageId, refreshSite],
  );

  return {
    comments,
    shown,
    site: {
      loading: enabled && !siteSettled,
      error: site.data === undefined ? site.error : undefined,
      retry: site.refresh,
      count: siteCount,
    },
    derpi: {
      loading: enabled && !derpiSettled,
      error: first.data === undefined ? first.error : undefined,
      retry: first.refresh,
      total: derpiTotal,
    },
    total,
    hasMore,
    loadingMore: moreLoading,
    moreError,
    loadMore,
    removeSiteComment,
    refreshSite,
  };
}

/**
 * Unsent comments, per picture, for the life of the page — a draft survives a step to the next
 * picture and back, a sign-in, or the section re-mounting; a reload is a fresh start.
 */
const drafts = new Map<number, string>();

export function readCommentDraft(imageId: number): string {
  return drafts.get(imageId) ?? '';
}

export function writeCommentDraft(imageId: number, text: string) {
  if (text.trim()) drafts.set(imageId, text);
  else drafts.delete(imageId);
}
