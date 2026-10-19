/**
 * /search's own transports: the semantic parse (Chinese / natural-language search) and its
 * feedback, the quick tags, the dictionary reads behind suggestions and the single-tag caption,
 * and 以图搜图 by link. Each keeps `lib/api/http.ts`'s contract — a failure is an `ApiError`, a
 * caller's own abort stays its `AbortError`.
 *
 * All of them are public: the dictionary and the parse answer without a session, so suggestions,
 * tag names and Chinese search work signed out. `semanticSearch` is also the assistant's entry
 * (`lib/api/assistant.ts`), with an `aiContext`.
 */

import { applyImageLine } from './client';
import { ApiError, isApiError, toApiError } from './errors';
import { api } from './http';
import type { PonyImage } from '@/lib/types/image';

// ---------------------------------------------------------------------------
// The semantic parse
// ---------------------------------------------------------------------------

/**
 * The ceiling when the caller names none: the backend's own cloud timeout plus the round trip.
 * The screen passes one derived from the public settings (`semantic.server.ts`).
 */
const DEFAULT_SEMANTIC_TIMEOUT_MS = 10_000;

/** How the assistant's model-written query relates to the one already shown. */
export interface SemanticAiContext {
  queryMode: 'new' | 'refine';
  querySource: 'user_message' | 'model_query';
  /** The query being refined (≤300 characters); only read for `refine`. */
  currentQuery?: string;
}

/** The backend's receipt of what it actually executed — field names exactly as it sends them. */
export interface SemanticAiReceipt {
  query_mode: 'new' | 'refine';
  query_source: 'user_message' | 'model_query';
  /** The query as received. */
  semantic_input: string;
  /** The tags it became; always equal to `tags`. */
  semantic_output: string[];
}

export interface SemanticTagDetail {
  /** The tag as it runs (`-tag` for an exclusion). */
  tag: string;
  /** Dictionary fields; absent for an English term the assistant wrote itself. */
  en?: string;
  cn?: string;
  category?: string;
  negative: boolean;
  /** `dictionary` (an exact name), `model` (the cloud model's pick), `query` (kept as written). */
  source: 'dictionary' | 'model' | 'query';
}

export interface SemanticSearchResult {
  query: string;
  mode: 'legacy' | 'qwen';
  /** What the words became, in the backend's order; exclusions as `-tag`. May be empty. */
  tags: string[];
  details: SemanticTagDetail[];
  /** Whether a model produced them — only then is feedback offered. */
  modelUsed: boolean;
  engines: string[];
  /** Served from the backend's 24h result cache. */
  cached: boolean;
  /** Present exactly when `aiContext` was sent. */
  aiReceipt: SemanticAiReceipt | null;
}

interface SemanticSearchBody {
  query: string;
  mode: 'legacy' | 'qwen';
  tags: string[];
  details: SemanticTagDetail[];
  model_used: boolean;
  model_engines: string[];
  cached: boolean;
  ai_receipt: SemanticAiReceipt | null;
}

/**
 * The backend's codes for "the parse is not available here", as opposed to a parse that failed:
 * the feature is switched off, or it needs the cloud model and none is configured. A screen
 * searches the words as typed and says so; pressing 重试 cannot change either.
 */
export const SEMANTIC_UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  'SEMANTIC_SEARCH_DISABLED',
  'SEMANTIC_CLOUD_NOT_CONFIGURED',
]);

/**
 * `POST /api/v1/semantic-searches {query, ai_context?}` — natural-language (Chinese) words to
 * Derpibooru tags. Public. Throws `ApiError`; its `code` tells the cases apart:
 * `SEMANTIC_SEARCH_DISABLED` / `SEMANTIC_CLOUD_NOT_CONFIGURED` (503, not available),
 * `SEMANTIC_SEARCH_BUSY` / `SEMANTIC_SEARCH_UNAVAILABLE` (503, try again later),
 * `QUERY_UNVERIFIED` (422, an `aiContext` query the dictionary cannot vouch for),
 * `AI_CONTEXT_INVALID` / `INVALID_INPUT` (400), `RATE_LIMITED` (429).
 *
 * A POST with a deadline, unlike every other write: nothing is created by it, so abandoning a
 * slow parse costs nothing.
 */
export async function semanticSearch(
  query: string,
  { aiContext, signal, timeoutMs = DEFAULT_SEMANTIC_TIMEOUT_MS }: { aiContext?: SemanticAiContext; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<SemanticSearchResult> {
  const data = await api<SemanticSearchBody>('POST', '/semantic-searches', {
    json: {
      query,
      ...(aiContext
        ? {
            ai_context: {
              query_mode: aiContext.queryMode,
              query_source: aiContext.querySource,
              current_query: aiContext.queryMode === 'refine' ? (aiContext.currentQuery ?? '').slice(0, 300) : '',
            },
          }
        : {}),
    },
    signal,
    timeoutMs,
    cache: 'no-store',
  });
  return {
    query: data.query,
    mode: data.mode,
    tags: data.tags,
    details: data.details,
    modelUsed: data.model_used,
    engines: data.model_engines,
    cached: data.cached,
    aiReceipt: data.ai_receipt,
  };
}

export interface SemanticParse {
  /** `false` when the backend has the feature off (or unconfigured); `tags` is then empty. */
  enabled: boolean;
  /** What the words became, in the order the backend gave them; may be empty. */
  tags: string[];
  /** Whether a model produced them — only then is feedback offered. */
  modelUsed: boolean;
  engines: string[];
  /** The backend's mode (`qwen`, `legacy`), or `off`. */
  mode: string;
}

/** The search screen's reading of `semanticSearch`: "not available" is an answer, not an error. */
export async function parseSemanticQuery(
  query: string,
  { signal, timeoutMs = DEFAULT_SEMANTIC_TIMEOUT_MS }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<SemanticParse> {
  try {
    const result = await semanticSearch(query, { signal, timeoutMs });
    return { enabled: true, tags: result.tags, modelUsed: result.modelUsed, engines: result.engines, mode: result.mode };
  } catch (error) {
    if (isApiError(error) && error.code && SEMANTIC_UNAVAILABLE_CODES.has(error.code)) {
      return { enabled: false, tags: [], modelUsed: false, engines: [], mode: 'off' };
    }
    throw error;
  }
}

/**
 * `GET /api/v1/semantic-searches/context?query=` — whether the last conversion of these words
 * (within 24h) used a model. Reads the backend's record only; never runs a model. The search
 * screen does not need it (the parse's own answer says so); it is here for a caller that only
 * has the words, such as a search restored from a link.
 */
export async function getSemanticFeedbackContext(
  query: string,
  signal?: AbortSignal,
): Promise<{ found: boolean; modelUsed: boolean; engines: string[]; tags: string[] }> {
  const data = await api<{ found: boolean; model_used: boolean; model_engines: string[]; tags: string[] }>(
    'GET',
    '/semantic-searches/context',
    { query: { query }, signal, cache: 'no-store' },
  );
  return { found: data.found, modelUsed: data.model_used, engines: data.model_engines, tags: data.tags };
}

/**
 * `POST /api/v1/search/feedback` — "this conversion was wrong", for the administrators' feedback
 * archive. `captchaProof` is the slider captcha's one-use proof (same challenge as sign-in; the
 * challenge cookie rides along same-origin). Signed-in reports are attributed; guests may report.
 * A report of the same words and result within ten minutes is accepted as a duplicate.
 */
export async function submitSemanticFeedback(
  input: { query: string; tags: readonly string[]; engines: readonly string[]; captchaProof: string },
  token?: string | null,
): Promise<void> {
  await api('POST', '/search/feedback', {
    token: token || undefined,
    json: {
      captcha_proof: input.captchaProof,
      query: input.query,
      result: input.tags.join(', '),
      engine: input.engines.join('/'),
    },
  });
}

// ---------------------------------------------------------------------------
// Quick tags
// ---------------------------------------------------------------------------

export type QuickTagGroup = 'rating' | 'species' | 'character' | 'general';
export const QUICK_TAG_GROUPS: readonly QuickTagGroup[] = ['rating', 'species', 'character', 'general'];

export interface QuickTag {
  /** The Derpibooru tag. */
  en: string;
  /** Its Chinese name, `''` where the site has none. */
  cn: string;
}

/** The dictionary's "not translated yet" (the backend's own rule: empty or `未翻译`). */
const chineseName = (cn: string) => (cn.trim() === '未翻译' ? '' : cn.trim());

interface QuickTagRow {
  en: string;
  cn: string;
  category: string;
}

/**
 * `GET /api/v1/dictionary/quick-tags` → `{tags: {rating, species, character, general}}`, each the
 * five most searched entries. The dictionary may hold the same English tag twice (legacy rows are
 * kept, not merged), so a group is still de-duplicated by tag.
 */
export async function getQuickTags(signal?: AbortSignal): Promise<Record<QuickTagGroup, QuickTag[]>> {
  const data = await api<{ tags: Record<QuickTagGroup, QuickTagRow[]> }>('GET', '/dictionary/quick-tags', { signal });
  const out = {} as Record<QuickTagGroup, QuickTag[]>;
  for (const group of QUICK_TAG_GROUPS) {
    const seen = new Set<string>();
    out[group] = data.tags[group]
      .map((row) => ({ en: row.en.trim(), cn: chineseName(row.cn) }))
      .filter((row) => row.en && !seen.has(row.en.toLowerCase()) && Boolean(seen.add(row.en.toLowerCase())));
  }
  return out;
}

// ---------------------------------------------------------------------------
// The dictionary
// ---------------------------------------------------------------------------

export interface TagSuggestion {
  id: number;
  /** The Derpibooru tag. */
  en: string;
  /** The Chinese name to show — the one of several that matches what was typed. */
  cn: string;
  /** Every Chinese name and alias, for the single-tag caption. */
  aliases: string[];
  /** The dictionary's category key (`character`, `species`, …). */
  category: string;
  count: number;
  description: string;
  /** The dictionary marks tags the safe filter keeps out. */
  restricted: boolean;
  /** A tag the site will not name in a suggestion list. */
  sensitive: boolean;
}

/** One `dictionary_tags` row as `GET /api/v1/dictionary/tags` sends it (the fields read here). */
interface DictionaryRow {
  id: number;
  en: string;
  cn: string;
  aliases: string[];
  category: string;
  search_count: number;
  description: string;
  restricted: boolean;
  sensitive: boolean;
}

const splitNames = (cn: string) => cn.split(/[,，、]/).map((name) => name.trim()).filter(Boolean);

/**
 * The name of several to show: the dictionary's `cn` can hold alternatives (`小蝶，柔柔`), and the
 * one containing the typed text is the one the person was thinking of.
 */
function pickChineseName(cn: string, typed: string): string {
  const names = splitNames(cn);
  if (names.length === 0) return '';
  return (typed && names.find((name) => name.includes(typed))) || names[0];
}

/** Rows to suggestions; legacy duplicate English tags collapse to their first (most searched) row. */
function suggestionRows(rows: readonly DictionaryRow[], typed = ''): TagSuggestion[] {
  const seen = new Set<string>();
  const out: TagSuggestion[] = [];
  for (const row of rows) {
    const en = row.en.trim();
    const key = en.toLowerCase();
    if (!en || seen.has(key)) continue;
    seen.add(key);
    const cn = chineseName(row.cn);
    out.push({
      id: row.id,
      en,
      cn: pickChineseName(cn, typed),
      aliases: [...splitNames(cn), ...row.aliases.map((alias) => alias.trim()).filter(Boolean)].filter(
        (name, index, all) => all.indexOf(name) === index,
      ),
      category: row.category,
      count: row.search_count,
      description: row.description,
      restricted: row.restricted,
      sensitive: row.sensitive,
    });
  }
  return out;
}

/**
 * `GET /api/v1/dictionary/tags?suggest=true` — suggestion mode: one page, no totals or stats,
 * most searched first; artists and OCs included. Sensitive tags are dropped here rather than
 * shown as an unusable row: the site does not name them, and a row nobody can pick is noise.
 */
function dictionarySuggest(keyword: string, limit: number, signal?: AbortSignal) {
  return api<{ tags: DictionaryRow[] }>('GET', '/dictionary/tags', {
    query: { suggest: true, keyword, limit },
    signal,
    cache: 'no-store',
  });
}

/** Suggestions for what is being typed. */
export async function suggestTags(keyword: string, signal?: AbortSignal): Promise<TagSuggestion[]> {
  const data = await dictionarySuggest(keyword, 15, signal);
  return suggestionRows(data.tags, keyword).filter((row) => !row.sensitive);
}

/** The dictionary's entry for exactly this tag, or `null` if it has none. */
export async function lookupTag(tag: string, signal?: AbortSignal): Promise<TagSuggestion | null> {
  const data = await dictionarySuggest(tag, 5, signal);
  const wanted = tag.trim().toLowerCase();
  return suggestionRows(data.tags).find((row) => row.en.toLowerCase() === wanted && !row.sensitive) ?? null;
}

// ---------------------------------------------------------------------------
// 以图搜图 by link
// ---------------------------------------------------------------------------

/** The image-search service's by-link twin of `SEARCH_IMAGE_API` (the upload). */
const SEARCH_IMAGE_BY_URL_API = '/search-api/api/reverse-search';

export interface ImageSearchAnswer {
  images: PonyImage[];
  total: number;
  /** A query the service suggests running instead, when it found no pictures itself. */
  searchQuery?: string;
}

/**
 * `POST /search-api/api/reverse-search {targetImageUrl, distance}` — the original front end's
 * second 以图搜图 mode: the service fetches the picture from its link. This is the separate
 * image-search service, not the PicPony backend: it answers `{images, total}` or a
 * `searchQuery`, and `{error}` (sometimes with `success: false`) when it fails.
 */
export async function searchImageByUrl(
  targetImageUrl: string,
  distance: number,
  signal?: AbortSignal,
): Promise<ImageSearchAnswer> {
  let response: Response;
  let data: Record<string, unknown>;
  try {
    response = await fetch(SEARCH_IMAGE_BY_URL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetImageUrl, distance }),
      signal,
    });
    data = await response.json().then(
      (value: unknown) => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {}),
      () => ({}),
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    throw toApiError(error);
  }
  const serviceMessage = typeof data.error === 'string' ? data.error : undefined;
  if (!response.ok) throw new ApiError('http', { status: response.status, serverMessage: serviceMessage });
  if (data.success === false) throw new ApiError('envelope', { serverMessage: serviceMessage });
  const suggested = typeof data.searchQuery === 'string' && data.searchQuery.trim() ? data.searchQuery.trim() : undefined;
  if (!Array.isArray(data.images) && !suggested) throw new ApiError('invalid');
  const images = (Array.isArray(data.images) ? (data.images as PonyImage[]) : [])
    .filter((image) => image && typeof image === 'object' && Number.isFinite(Number(image.id)))
    .map(applyImageLine);
  return {
    images,
    total: Number.isFinite(Number(data.total)) ? Number(data.total) : images.length,
    searchQuery: suggested,
  };
}
