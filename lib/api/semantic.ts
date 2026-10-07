/**
 * /search's own transports: the semantic parse (Chinese / natural-language search) and its
 * feedback, the quick tags, the dictionary reads behind suggestions and the single-tag caption,
 * and 以图搜图 by link. Only the search screen calls these; each keeps `lib/api/http.ts`'s
 * contract — a failure is an `ApiError`, a caller's own abort stays its `AbortError`.
 *
 * All of them are public. The dictionary answers without a session (checked read-only against
 * the live backend), so suggestions and tag names work signed out — they were gated on a token
 * and silently vanished for every visitor without one.
 */

import { applyImageLine } from './client';
import { ApiError, toApiError } from './errors';
import { envelopeMessage, listOf, picponyPostJson, picponyRequest, readEnvelope, readJson } from './http';
import type { PonyImage } from '@/lib/types/image';

// ---------------------------------------------------------------------------
// The semantic parse
// ---------------------------------------------------------------------------

export interface SemanticParse {
  /** `false` when the backend has the feature switched off; `tags` is then empty. */
  enabled: boolean;
  /** What the words became, in the order the backend gave them; may be empty. */
  tags: string[];
  /** Whether a model (cloud or local) produced them — only then is feedback offered. */
  modelUsed: boolean;
  engines: string[];
  /** The backend's mode (`qwen`, `legacy`), for the record. */
  mode: string;
}

/**
 * The ceiling when the caller names none: the backend's own cloud timeout (8s when last read)
 * plus the round trip. The screen passes one derived from `get_maintenance_status`.
 */
const DEFAULT_SEMANTIC_TIMEOUT_MS = 10_000;

function stringList(value: unknown): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of listOf<unknown>(value)) {
    if (typeof item !== 'string') continue;
    const text = item.trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

/**
 * `POST api.php?action=semantic_search {query}` — turn Chinese or natural-language words into
 * Derpibooru tags. No session. Answers `{success, enabled, mode, tags, details, model_used,
 * model_engines}`, or HTTP 400 `{error}` for an empty or over-long query.
 *
 * A POST with a deadline, unlike every other write: nothing is created by it, so abandoning a
 * slow parse costs nothing, and the screen falls back to searching the words as typed.
 */
export async function parseSemanticQuery(
  query: string,
  { signal, timeoutMs = DEFAULT_SEMANTIC_TIMEOUT_MS }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<SemanticParse> {
  const res = await picponyPostJson('semantic_search', { query }, { signal, timeoutMs, cache: 'no-store' });
  const data = await readJson<Record<string, unknown>>(res);
  if (!res.ok) throw new ApiError('http', { status: res.status, serverMessage: envelopeMessage(data) });
  if (data.enabled === false) {
    return { enabled: false, tags: [], modelUsed: false, engines: [], mode: 'off' };
  }
  if (data.success !== true) throw new ApiError('envelope', { status: res.status, serverMessage: envelopeMessage(data) });
  return {
    enabled: true,
    tags: stringList(data.tags),
    modelUsed: data.model_used === true,
    engines: stringList(data.model_engines),
    mode: typeof data.mode === 'string' ? data.mode : '',
  };
}

/**
 * `POST api.php?action=submit_semantic_feedback` — "this conversion was wrong", for the
 * administrators' feedback archive. `cfToken` is the slider captcha's, the same challenge as
 * sign-in. The body is the original front end's, field for field (`mode` included: it sent the
 * empty string, and the archive never shows the field).
 */
export async function submitSemanticFeedback(
  input: { query: string; tags: readonly string[]; engines: readonly string[]; cfToken: string },
  token?: string | null,
): Promise<void> {
  const res = await picponyPostJson(
    'submit_semantic_feedback',
    {
      query: input.query,
      result: input.tags.join(', '),
      engine: input.engines.join('/'),
      mode: '',
      cf_token: input.cfToken,
    },
    { token: token || undefined },
  );
  await readEnvelope(res);
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

/** The dictionary's two spellings of "not translated yet". */
const UNTRANSLATED = new Set(['未翻', '未翻译']);

const chineseName = (value: unknown) =>
  typeof value === 'string' && !UNTRANSLATED.has(value.trim()) ? value.trim() : '';

/** `GET api.php?action=get_quick_tags` → `{success, tags: {rating, species, character, general}}`. */
export async function getQuickTags(signal?: AbortSignal): Promise<Record<QuickTagGroup, QuickTag[]>> {
  const data = await readEnvelope<{ tags?: unknown }>(await picponyRequest('get_quick_tags', { signal }));
  const groups = data.tags && typeof data.tags === 'object' ? (data.tags as Record<string, unknown>) : {};
  const out = {} as Record<QuickTagGroup, QuickTag[]>;
  for (const group of QUICK_TAG_GROUPS) {
    const seen = new Set<string>();
    out[group] = listOf<Record<string, unknown>>(groups[group])
      .filter((row) => row && typeof row === 'object' && typeof row.en === 'string' && row.en.trim())
      .map((row) => ({ en: String(row.en).trim(), cn: chineseName(row.cn) }))
      .filter((row) => !seen.has(row.en.toLowerCase()) && Boolean(seen.add(row.en.toLowerCase())));
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

/**
 * The name of several to show: the dictionary's `cn` can hold alternatives (`小蝶，柔柔`), and the
 * one containing the typed text is the one the person was thinking of.
 */
function pickChineseName(cn: string, typed: string): string {
  const names = cn.split(/[,，、]/).map((name) => name.trim()).filter(Boolean);
  if (names.length === 0) return '';
  return (typed && names.find((name) => name.includes(typed))) || names[0];
}

function suggestionRows(value: unknown, typed = ''): TagSuggestion[] {
  const seen = new Set<string>();
  const out: TagSuggestion[] = [];
  for (const row of listOf<Record<string, unknown>>(value)) {
    if (!row || typeof row !== 'object' || typeof row.en !== 'string') continue;
    const en = row.en.trim();
    const key = en.toLowerCase();
    if (!en || seen.has(key)) continue;
    seen.add(key);
    const cn = chineseName(row.cn);
    out.push({
      id: Number.isFinite(Number(row.id)) ? Number(row.id) : out.length,
      en,
      cn: pickChineseName(cn, typed),
      aliases: [
        ...cn.split(/[,，、]/).map((name) => name.trim()).filter(Boolean),
        ...listOf<unknown>(row.aliases).filter((alias): alias is string => typeof alias === 'string' && Boolean(alias.trim())),
      ].filter((name, index, all) => all.indexOf(name) === index),
      category: typeof row.cat === 'string' ? row.cat : '',
      count: Number.isFinite(Number(row.count)) ? Number(row.count) : 0,
      description: typeof row.description === 'string' ? row.description : '',
      restricted: Number(row.is_restricted) === 1,
      sensitive: Number(row.is_sensitive) === 1,
    });
  }
  return out;
}

/**
 * Suggestions for what is being typed — the original front end's call, parameter for parameter
 * (`mode=suggest`, artists and OCs included). Sensitive tags are dropped here rather than shown
 * as an unusable row: the site does not name them, and a row nobody can pick is noise.
 */
export async function suggestTags(keyword: string, signal?: AbortSignal): Promise<TagSuggestion[]> {
  const res = await picponyRequest('get_dictionary', {
    query: { mode: 'suggest', keyword, limit: 15, filter_artist: 0, filter_oc: 0, _t: Date.now() },
    signal,
  });
  const data = await readEnvelope<{ tags?: unknown }>(res);
  return suggestionRows(data.tags, keyword).filter((row) => !row.sensitive);
}

/** The dictionary's entry for exactly this tag, or `null` if it has none. */
export async function lookupTag(tag: string, signal?: AbortSignal): Promise<TagSuggestion | null> {
  const res = await picponyRequest('get_dictionary', { query: { keyword: tag, limit: 5, _t: Date.now() }, signal });
  const data = await readEnvelope<{ tags?: unknown }>(res);
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
 * second 以图搜图 mode: the service fetches the picture from its link. Same answer as the upload:
 * `{images, total}`, or `{error}` with a non-2xx status.
 */
export async function searchImageByUrl(
  targetImageUrl: string,
  distance: number,
  signal?: AbortSignal,
): Promise<ImageSearchAnswer> {
  let response: Response;
  try {
    response = await fetch(SEARCH_IMAGE_BY_URL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetImageUrl, distance }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw toApiError(error);
  }
  const data = await readJson<Record<string, unknown>>(response);
  if (!response.ok) {
    throw new ApiError('http', { status: response.status, serverMessage: envelopeMessage(data) });
  }
  if (data.success === false) throw new ApiError('envelope', { serverMessage: envelopeMessage(data) });
  if (!Array.isArray(data.images) && !(typeof data.searchQuery === 'string' && data.searchQuery.trim())) {
    throw new ApiError('invalid');
  }
  const images = listOf<PonyImage>(data.images)
    .filter((image) => image && typeof image === 'object' && Number.isFinite(Number(image.id)))
    .map(applyImageLine);
  return {
    images,
    total: Number.isFinite(Number(data.total)) ? Number(data.total) : images.length,
    searchQuery: typeof data.searchQuery === 'string' && data.searchQuery.trim() ? data.searchQuery.trim() : undefined,
  };
}
