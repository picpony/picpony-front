'use client';

import { defineResource } from '@/lib/resource';
import { readToken } from '@/lib/hooks';
import { ApiError } from '@/lib/api/errors';
import { pageCount } from '@/lib/api/http';
import { getDictionary, getDictionaryDuplicates, getDictionaryTagHistory, type DictionaryStats } from '@/lib/api/picpony';
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

function failed(data: { error?: string; message?: string }, fallback: string): never {
  const sentence = data.error || data.message;
  throw new ApiError('envelope', { serverMessage: sentence, message: sentence || fallback });
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
    if (!data.success) failed(data, '词库加载失败');
    return {
      tags: data.tags as GlossaryTag[],
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
    const data = await getDictionaryDuplicates(token, signal);
    if (!data.success) failed(data, '查重结果加载失败');
    return data.tags as GlossaryTag[];
  },
});

export interface TagHistoryRow {
  editor_username?: string;
  created_at?: string;
  en_name?: string;
  cn_name?: string;
  aliases?: unknown;
  category?: string;
  search_count?: number | null;
  description?: string;
}

export const tagHistory = defineResource<{ token: string; tagId: number }, TagHistoryRow[]>({
  name: 'admin-dictionary-history',
  key: ({ token, tagId }) => `${token}\n${tagId}`,
  ttl: 30_000,
  maxEntries: 6,
  fetch: async ({ token, tagId }, signal) => {
    signedIn(token);
    const data = await getDictionaryTagHistory(token, tagId, signal);
    if (!data.success) failed(data, '编辑历史加载失败');
    return data.history as TagHistoryRow[];
  },
});

export type FeedbackStatus = 'pending' | 'processed' | 'rejected';

export interface Feedback {
  id: number;
  user_id?: number;
  tag_name: string;
  content: string;
  username: string;
  status: FeedbackStatus;
  created_at: string;
  handled_by?: number | null;
  handled_by_name?: string | null;
  handled_at?: string | null;
  handling_note?: string;
}

export interface FeedbackPage {
  rows: Feedback[];
  summary: Record<FeedbackStatus, number>;
  totalPages: number;
}

export const FEEDBACK_PAGE_SIZE = 40;

export const tagFeedback = defineResource<
  { token: string; status: FeedbackStatus | 'all'; page: number; keyword: string },
  FeedbackPage
>({
  name: 'admin-tag-feedback',
  key: ({ token, status, page, keyword }) => `${token}\n${status}\n${page}\n${keyword}`,
  ttl: 30_000,
  maxEntries: 8,
  fetch: async ({ token, status, page, keyword }, signal) => {
    signedIn(token);
    const data = await adminApi.getTagFeedback(token, {
      status: status === 'all' ? undefined : status,
      keyword: keyword || undefined,
      page,
      limit: FEEDBACK_PAGE_SIZE,
    }, signal);
    if (data?.success !== true) failed(data ?? {}, '反馈加载失败');
    const summary = (data.summary ?? {}) as Partial<Record<FeedbackStatus, unknown>>;
    return {
      rows: data.feedbacks as Feedback[],
      summary: {
        pending: Number(summary.pending) || 0,
        processed: Number(summary.processed) || 0,
        rejected: Number(summary.rejected) || 0,
      },
      totalPages: pageCount(data.pagination?.pages),
    };
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
