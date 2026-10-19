'use client';

import { defineResource } from '@/lib/resource';
import { readToken } from '@/lib/hooks';
import { ApiError } from '@/lib/api/errors';
import { getDictionary, getDictionaryDuplicates, getDictionaryTagHistory, type DictionaryHistoryRow, type DictionaryStats } from '@/lib/api/picpony';
import { searchDerpiTags } from '@/lib/api/derpi';
import * as adminApi from '@/lib/api/admin';
import type { DerpiTagRow, GlossaryTag } from './model';

/*
 * The glossary's reads, on the resource layer (R9-043): cancellation, account isolation, paging
 * with the previous page held, and a refresh that re-reads under what is shown. They live with the
 * panel rather than in `lib/resources.ts`, so none of them reaches a public route's bundle.
 */

function signedIn(token: string) {
  if (readToken() !== token) throw new ApiError('http', { status: 401, message: '登录状态已失效，请重新登录' });
}

export interface DictionaryArgs {
  token: string;
  page: number;
  limit: number;
  keyword: string;
  sort: string;
  category: string;
  untranslated: boolean;
}

export interface DictionaryPage {
  tags: GlossaryTag[];
  total: number;
  stats: DictionaryStats | null;
}

export const dictionaryPage = defineResource<DictionaryArgs, DictionaryPage>({
  name: 'admin-dictionary',
  key: (args) => [args.token, args.page, args.limit, args.keyword, args.sort, args.category, args.untranslated ? 1 : 0].join('\n'),
  ttl: 60_000,
  maxEntries: 8,
  fetch: async (args, signal) => {
    signedIn(args.token);
    const data = await getDictionary(args.token, {
      page: args.page,
      limit: args.limit,
      keyword: args.keyword,
      sort: args.sort,
      category: args.category,
      untranslated: args.untranslated ? 1 : 0,
    }, signal);
    return {
      tags: data.tags as GlossaryTag[],
      /* `total_matches` is the backend's count of the filtered list (`null` only when it did not
         count it); the page's own rows are then all that is known. */
      total: data.total_matches ?? data.tags.length,
      stats: data.stats ?? null,
    };
  },
});

export const duplicateTags = defineResource<string, GlossaryTag[]>({
  name: 'admin-dictionary-duplicates',
  key: (token) => token,
  ttl: 60_000,
  maxEntries: 2,
  fetch: async (token, signal) => {
    signedIn(token);
    return (await getDictionaryDuplicates(token, signal)).tags as GlossaryTag[];
  },
});

export type TagHistoryRow = DictionaryHistoryRow;

export const tagHistory = defineResource<{ token: string; tagId: number }, TagHistoryRow[]>({
  name: 'admin-dictionary-history',
  key: ({ token, tagId }) => `${token}\n${tagId}`,
  ttl: 30_000,
  maxEntries: 6,
  fetch: async ({ token, tagId }, signal) => {
    signedIn(token);
    return (await getDictionaryTagHistory(token, tagId, signal)).history;
  },
});

export type FeedbackStatus = 'pending' | 'processed' | 'rejected';

/** A row of `GET /editor/dictionary/feedback` (`tag_feedback` plus the two user names). */
export type Feedback = adminApi.TagFeedbackRow;

export interface FeedbackPage {
  rows: Feedback[];
  /** The cursor of the next page (`next_cursor`), `null` on the last one. */
  next: number | null;
}

export const FEEDBACK_PAGE_SIZE = 40;

/**
 * One cursor page of the feedback queue: the backend answers `before` → `next_cursor` and never
 * how many pages or rows there are, so neither the pager nor the filter chips can show a total.
 */
export const tagFeedback = defineResource<
  { token: string; status: FeedbackStatus | 'all'; before?: number; keyword: string },
  FeedbackPage
>({
  name: 'admin-tag-feedback',
  key: ({ token, status, before, keyword }) => `${token}\n${status}\n${before ?? ''}\n${keyword}`,
  ttl: 30_000,
  maxEntries: 8,
  fetch: async ({ token, status, before, keyword }, signal) => {
    signedIn(token);
    const data = await adminApi.getTagFeedback(token, {
      status: status === 'all' ? undefined : status,
      keyword: keyword || undefined,
      before,
      limit: FEEDBACK_PAGE_SIZE,
    }, signal);
    return { rows: data.feedback, next: data.next };
  },
});

/**
 * Derpibooru's tag search, for the create dialog's suggestions and the 搜原站标签 dialog. On the
 * Derpibooru lane, keyed by the query: a new query moves the reader off the old key, which
 * abandons a first read nobody is waiting for (R9-031 — eleven requests for 12 typed characters,
 * then five 429s).
 */
export const derpiTagSearch = defineResource<{ query: string }, DerpiTagRow[]>({
  name: 'admin-derpi-tag-search',
  lane: 'derpi',
  key: ({ query }) => query,
  ttl: 5 * 60_000,
  maxEntries: 16,
  fetch: async ({ query }, signal) => (await searchDerpiTags(query, signal)).tags,
});
