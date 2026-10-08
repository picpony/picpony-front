'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { MdEdit, MdForum, MdSearchOff } from 'react-icons/md';
import PageHeader from '@/components/PageHeader';
import Button from '@/components/Button';
import Chip from '@/components/Chip';
import Select from '@/components/Select';
import SearchInput from '@/components/SearchInput';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import ForumPostList, { ForumListSkeleton } from '@/components/ForumPostList';
import { CategoryIcon } from '@/components/forum/ForumBadges';
import { useAuthModal } from '@/components/AuthModal';
import { SKIP, useResource } from '@/lib/resource';
import { forumPosts } from '@/lib/resources';
import { useScreenState } from '@/lib/screenState';
import { useSession } from '@/lib/hooks';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import {
  FORUM_CATEGORIES,
  FORUM_SORTS,
  categoryLabel,
  type ForumCategoryFilter,
  type ForumSort,
} from '@/lib/forumModel';
import { clearForumReturn, playForumReturn, readForumReturn } from '@/lib/forumTransition';
import { rememberForumList } from '@/lib/forumCache';
import { getAppScroller } from '@/lib/appScroller';
import { scrollAppToElement } from '@/lib/scrollTo';
import { ICON } from '@/lib/icons';
import type { ForumPostsResponse } from '@/lib/types/forum';

/** The first page of the default list, rendered by the server for a cold `/?tab=forum`. */
export interface ForumSeed {
  key: string;
  data: ForumPostsResponse;
  generatedAt: number;
}

const CATEGORY_FILTERS: { value: ForumCategoryFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  ...FORUM_CATEGORIES,
];

/** How long typing rests before the search runs. An IME's composition never searches. */
const SEARCH_DEBOUNCE_MS = 450;

/**
 * The home route's 论坛 destination: its header, the search, category and order controls, and
 * the list they drive.
 *
 * **Every control here is local state, and none of it is in the address** (decision 18: in-page
 * controls never write history). The page, category, order and search live in screen state, so
 * they survive a visit to a thread and back but not a reload — the forum opens where a newcomer
 * expects it, the first page of everything by recent activity, which is also the one list the
 * server can render into a cold `/?tab=forum` (`seed`). A link to a filtered list is not a thing
 * the original front end had either.
 */
export default function ForumPane({ seed }: { seed?: ForumSeed | null }) {
  const router = useRouter();
  const { openAuth } = useAuthModal();
  const { token, ready } = useSession();
  const [page, setPage] = useScreenState('home:forum:page', 1);
  const [category, setCategory] = useScreenState<ForumCategoryFilter>('home:forum:category', 'all');
  const [sort, setSort] = useScreenState<ForumSort>('home:forum:sort', 'updated_at');
  const [search, setSearch] = useScreenState('home:forum:search', '');
  const [typed, setTyped] = useState(search);
  const composing = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  /* A signed-in read waits for the session, except under a seed: the server rendered the
     visitor's list, and the hydrating render must ask for exactly that key to adopt it. The
     signed-in list then replaces it quietly — same rows, now with this reader's unread marks. */
  const query = { page, category, sort, search, token };
  const read = useResource(forumPosts, ready || seed ? query : SKIP, {
    /* Rows of another category must never stand under a chip that excludes them; a new page,
       order or search keeps the old rows dimmed until the answer lands. */
    keepPrevious: `forum:${category}`,
    initial: seed ?? undefined,
  });
  const data = read.data;

  /* The list a like, a reply or a deleted post in a thread corrects in place when the reader
     comes back to it (`lib/forumCache.ts`). */
  useEffect(() => {
    rememberForumList({ page, category, sort, search, token });
  }, [page, category, sort, search, token]);

  /* The view the rows on screen answer, so a read that only adds the session does not dim them. */
  const viewKey = `${page}|${category}|${sort}|${search}`;
  const [landedView, setLandedView] = useState(viewKey);
  if (data && !read.isPrevious && landedView !== viewKey) setLandedView(viewKey);
  const busy = read.isPrevious && read.isLoading && landedView !== viewKey;

  /* A view change starts the list from its top, where the reader can see it change. */
  const revealList = useCallback(() => {
    const root = rootRef.current;
    const scroller = getAppScroller();
    if (!root || !scroller) return;
    if (root.getBoundingClientRect().top < scroller.getBoundingClientRect().top) {
      scrollAppToElement(root, { offset: 8 });
    }
  }, []);

  const changeCategory = (next: ForumCategoryFilter) => {
    if (next === category) return;
    setCategory(next);
    setPage(1);
    revealList();
  };
  const changeSort = (next: ForumSort) => {
    if (next === sort) return;
    setSort(next);
    setPage(1);
    revealList();
  };
  const commitSearch = useCallback(
    (text: string) => {
      const next = text.trim();
      if (next === search) return;
      setSearch(next);
      setPage(1);
      revealList();
    },
    [search, setSearch, setPage, revealList],
  );

  /* Search as you type, once typing rests — never mid-composition, where a half-built syllable
     would be sent. Enter searches at once; clearing, too. */
  useEffect(() => {
    if (typed.trim() === search || composing.current) return;
    const timer = window.setTimeout(() => { if (!composing.current) commitSearch(typed); }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [typed, search, commitSearch]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!composing.current) commitSearch(typed);
  };

  const changePage = useCallback(
    (next: number) => {
      if (next >= 1 && (!data || next <= data.totalPages)) setPage(next);
    },
    [data, setPage],
  );

  const compose = () => {
    if (!token) {
      openAuth('login');
      return;
    }
    router.push('/forum/create', { scroll: false });
  };

  /* **The way back.** A thread that was left with its card on screen recorded which post it
     was; the card shrinks back into the row it opened from — a frame after the list is laid
     out, when the restored scroll offset has landed and the incoming page is still transparent.
     Read, not consumed, from an effect React may run twice; consumed when it plays. */
  useLayoutEffect(() => {
    const origin = readForumReturn();
    if (!origin) return;
    let stop: (() => void) | null = null;
    const frame = requestAnimationFrame(() => {
      const row = rootRef.current?.querySelector<HTMLElement>(`[data-forum-row="${CSS.escape(origin.id)}"]`);
      clearForumReturn();
      if (row) stop = playForumReturn(row, origin);
    });
    return () => {
      cancelAnimationFrame(frame);
      stop?.();
    };
  }, []);

  const filtered = category !== 'all' || search !== '';
  let body: React.ReactNode;
  if (!data) {
    body = read.error ? (
      <ErrorRetry
        size="pane"
        title="论坛加载失败"
        message={apiErrorMessage(read.error)}
        onRetry={isRetryable(read.error) ? read.refresh : undefined}
      />
    ) : (
      <ForumListSkeleton />
    );
  } else if (data.posts.length === 0 && !read.isPrevious) {
    body = search ? (
      <EmptyState
        size="pane"
        icon={<MdSearchOff size={ICON.display} />}
        title="没有找到相关帖子"
        description={category === 'all' ? `没有标题、正文或作者包含「${search}」的帖子` : `「${categoryLabel(category)}」中没有包含「${search}」的帖子`}
        action={
          <Button
            variant="tonal"
            onClick={() => {
              setTyped('');
              commitSearch('');
            }}
          >
            清除搜索
          </Button>
        }
      />
    ) : category !== 'all' ? (
      <EmptyState
        size="pane"
        icon={<CategoryIcon category={category} size={ICON.display} />}
        title={`「${categoryLabel(category)}」还没有帖子`}
        action={
          <Button variant="tonal" onClick={() => changeCategory('all')}>
            查看全部帖子
          </Button>
        }
      />
    ) : page > 1 ? (
      <EmptyState
        size="pane"
        title="这一页没有帖子"
        action={
          <Button variant="tonal" onClick={() => setPage(1)}>
            回到第一页
          </Button>
        }
      />
    ) : (
      <EmptyState
        size="pane"
        icon={<MdForum size={ICON.display} />}
        title="暂无帖子"
        description="还没有人开过话题，来发第一个吧。"
        action={
          <Button variant="tonal" icon={<MdEdit />} onClick={compose}>
            发帖
          </Button>
        }
      />
    );
  } else {
    const failedTurn = read.isPrevious && Boolean(read.error);
    body = (
      <>
        {failedTurn && (
          /* The request failed and the rows below answer the previous one: say so, rather than
             leave the controls describing a list that is not on screen. */
          <div className="mb-4">
            <ErrorRetry
              size="inline"
              title={landedView.split('|')[0] !== String(page) ? `第 ${page} 页加载失败` : '帖子加载失败'}
              message={apiErrorMessage(read.error)}
              onRetry={isRetryable(read.error) ? read.refresh : undefined}
            />
          </div>
        )}
        <ForumPostList
          posts={data.posts}
          page={page}
          totalPages={data.totalPages}
          onPageChange={changePage}
          onPrefetchPage={(next) => forumPosts.prefetch({ ...query, page: next })}
          signedIn={data.signedIn}
          token={token}
          busy={busy}
        />
      </>
    );
  }

  return (
    /* The reading column: a list of rows takes the list width, not the gallery's. */
    <div ref={rootRef} className="mx-auto max-w-4xl">
      <PageHeader
        level={2}
        title="论坛"
        actions={
          <Button variant="filled" icon={<MdEdit />} onClick={compose}>
            发帖
          </Button>
        }
      />
      <form role="search" aria-label="搜索帖子" className="mb-3 flex items-center gap-2" onSubmit={onSubmit}>
        <SearchInput
          className="min-w-0 flex-1"
          value={typed}
          onChange={(value) => {
            setTyped(value);
            /* The clear control empties the field: that search runs at once. */
            if (!value) commitSearch('');
          }}
          placeholder="搜索标题、正文或作者"
          enterKeyHint="search"
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={(event) => {
            composing.current = false;
            setTyped(event.currentTarget.value);
            commitSearch(event.currentTarget.value);
          }}
        />
        <Select size="sm" shape="pill" value={sort} options={[...FORUM_SORTS]} onChange={changeSort} aria-label="排序" />
      </form>
      <div
        role="group"
        aria-label="分类"
        /* One row that scrolls on a narrow phone rather than wrapping a chip onto a line of its
           own; edge to edge there, inside the page gutter from `sm`. */
        className="scrollbar-hide -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0"
      >
        {CATEGORY_FILTERS.map((option) => (
          <Chip
            key={option.value}
            variant="filter"
            selected={category === option.value}
            onClick={() => changeCategory(option.value)}
            className="shrink-0"
          >
            {option.label}
          </Chip>
        ))}
      </div>
      {filtered && data && !read.isPrevious && data.total > 0 && (
        <p className="mb-3 text-body-s text-on-surface-variant" aria-live="polite">
          共 {data.total} 个帖子
        </p>
      )}
      {body}
    </div>
  );
}
