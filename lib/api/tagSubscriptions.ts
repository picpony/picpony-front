/**
 * 标签订阅 (decision 15): the original front end's six actions and the Derpibooru count lookup
 * its subscribe step depends on.
 *
 * A subscription is a tag and the picture count recorded for it. The backend learns about new
 * pictures only from the front end: a **sync** reads the live counts from Derpibooru, reports them
 * (`sync_tag_subscriptions`, in batches under one `sync_token`), then **finalises** — the backend
 * compares, raises each subscription's `unread_new_count`, and writes a system notification per
 * updated tag (`[tag_subscription|tag]`). Opening a subscription marks it **seen**.
 * `components/subscriptions/sync.ts` owns when that runs; this module only speaks the wire.
 */

import { DERPIBOORU_API_BASE } from '@/lib/constants';
import { escapeTag } from '@/lib/searchQuery';
import { randomId } from '@/lib/utils';
import type { ApiResponse } from '@/lib/types/image';
import { proxyFetch } from './client';
import { searchDerpiImages } from './derpi';
import { ApiError } from './errors';
import { listOf, picponyPostJson, picponyRequest, readEnvelope, readObject } from './http';

export interface TagSubscription {
  /** The tag as the backend stores it — the name the sync reports under. */
  tagName: string;
  /** The count recorded at the last sync (or at subscribing). */
  imageCount: number;
  /** Pictures added since the subscription was last opened. */
  newCount: number;
}

/**
 * A whole, non-negative number off the wire, or `null` for anything else — `lib/api/shop.ts`'s
 * rule. A missing, blank, boolean or non-numeric count is *unknown*, never 0: an explicit `0` is a
 * real tag with no pictures and has to stay distinguishable from a count nobody could read.
 */
function wholeNumber(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

/** Tag names compare as Derpibooru's do: case-insensitive, one space between words. */
export function normaliseTagName(tag: string): string {
  return tag.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** `GET get_tag_subscriptions` → the list, in the backend's order. A refusal throws. */
export async function getTagSubscriptions(token: string, signal?: AbortSignal): Promise<TagSubscription[]> {
  const data = await readEnvelope<{ subscriptions?: unknown }>(
    await picponyRequest('get_tag_subscriptions', { token, query: { _t: Date.now() }, signal }),
  );
  if (!Array.isArray(data.subscriptions)) throw new ApiError('invalid');
  const seen = new Set<string>();
  const list: TagSubscription[] = [];
  for (const row of listOf<Record<string, unknown>>(data.subscriptions)) {
    if (!row || typeof row !== 'object') continue;
    /* `tag` is the spelling the original front end's sync also accepted. */
    const raw = typeof row.tag_name === 'string' ? row.tag_name : typeof row.tag === 'string' ? row.tag : '';
    const tagName = raw.trim();
    const key = normaliseTagName(tagName);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    /* The list's numbers are the backend's own record, shown and never sent back (a sync reports
       Derpibooru's live counts, a subscription the looked-up one), so an unreadable one reads as
       none rather than failing the list. */
    list.push({
      tagName,
      imageCount: wholeNumber(row.image_count) ?? 0,
      newCount: wholeNumber(row.unread_new_count) ?? 0,
    });
  }
  return list;
}

/** The backend's answer to a second subscription of the same tag says 已订阅. */
export function isAlreadySubscribed(error: unknown): boolean {
  return error instanceof ApiError && /已订阅/.test(error.serverMessage ?? '');
}

/** `POST add_tag_subscription {tag_name, image_count}` — the count is the live one, looked up first. */
export async function addTagSubscription(token: string, tagName: string, imageCount: number): Promise<void> {
  await readEnvelope(
    await picponyPostJson('add_tag_subscription', { tag_name: tagName, image_count: imageCount }, { token }),
  );
}

/** `POST remove_tag_subscription {tag_name}`. */
export async function removeTagSubscription(token: string, tagName: string): Promise<void> {
  await readEnvelope(await picponyPostJson('remove_tag_subscription', { tag_name: tagName }, { token }));
}

/** `POST mark_tag_subscription_seen {tag_name}` — its new pictures have been looked at. */
export async function markTagSubscriptionSeen(token: string, tagName: string): Promise<void> {
  await readEnvelope(await picponyPostJson('mark_tag_subscription_seen', { tag_name: tagName }, { token }));
}

export interface TagCountUpdate {
  tag_name: string;
  image_count: number;
}

/**
 * `POST sync_tag_subscriptions {sync_token, updates}` — one batch of live counts. The original
 * front end never read this answer; a refusal still throws here, so the caller can count it.
 */
export async function syncTagSubscriptions(
  token: string,
  syncToken: string,
  updates: readonly TagCountUpdate[],
): Promise<void> {
  await readEnvelope(await picponyPostJson('sync_tag_subscriptions', { sync_token: syncToken, updates }, { token }));
}

/** `POST finalize_tag_subscription_sync {sync_token}` → how many subscriptions gained pictures. */
export async function finalizeTagSubscriptionSync(token: string, syncToken: string): Promise<{ updatedTags: number }> {
  const data = await readEnvelope<{ updated_tags?: unknown }>(
    await picponyPostJson('finalize_tag_subscription_sync', { sync_token: syncToken }, { token }),
  );
  /* An answer that names no count announced nothing. */
  return { updatedTags: wholeNumber(data.updated_tags) ?? 0 };
}

/** A fresh `sync_token`, in the original front end's alphabet. */
export function newSyncToken(): string {
  return randomId().replace(/[^A-Za-z0-9_-]/g, '');
}

// ---------------------------------------------------------------------------
// The live count a subscription starts from
// ---------------------------------------------------------------------------

interface DerpiTagRow {
  name: string;
  slug: string;
  /** `null` when the row carries no readable count — never taken for 0. */
  images: number | null;
  aliases: string[];
  /** The slug of the tag this one is an alias of. */
  aliasedTag: string | null;
}

function tagRows(data: { tags?: unknown }): DerpiTagRow[] {
  return listOf<Record<string, unknown>>(data.tags)
    .filter((row) => row && typeof row === 'object' && typeof row.name === 'string')
    .map((row) => ({
      name: String(row.name),
      slug: typeof row.slug === 'string' ? row.slug : '',
      images: wholeNumber(row.images),
      aliases: listOf<unknown>(row.aliases).filter((alias): alias is string => typeof alias === 'string'),
      aliasedTag: typeof row.aliased_tag === 'string' && row.aliased_tag ? row.aliased_tag : null,
    }));
}

async function searchTags(query: string, perPage: number, signal?: AbortSignal): Promise<DerpiTagRow[]> {
  const url = `${DERPIBOORU_API_BASE}/search/tags?q=${encodeURIComponent(query)}&per_page=${perPage}`;
  const data = await readObject<{ tags?: unknown }>(await proxyFetch(url, { cache: 'no-store', signal }));
  if (!Array.isArray(data.tags)) throw new ApiError('invalid');
  return tagRows(data);
}

/** The sentence for a tag Derpibooru does not have. */
export const TAG_NOT_FOUND_MESSAGE = 'Derpibooru 上没有此标签，无法订阅';

/** The sentence for a tag Derpibooru found but whose picture count it did not say. */
export const TAG_COUNT_UNREADABLE_MESSAGE = '未能读取该标签的收录量';

export interface DerpiTagCount {
  /** Derpibooru's own name for the tag — for an alias, the tag it stands for. */
  name: string;
  count: number;
  /** The name that was asked about, when it turned out to be an alias of `name`. */
  aliasOf: string | null;
}

/**
 * Philomena's slug for a tag name (`Philomena.Slug.slug/1`): its six reserved characters spelled
 * out, everything but the unreserved set percent-encoded, a space as `+`. A tag's `aliases` are
 * listed as slugs (`twiight+sparkle`), so an alias is compared in this form.
 */
export function tagSlug(name: string): string {
  const spelled = name
    .replace(/-/g, '-dash-')
    .replace(/\//g, '-fwslash-')
    .replace(/\\/g, '-bwslash-')
    .replace(/:/g, '-colon-')
    .replace(/\./g, '-dot-')
    .replace(/\+/g, '-plus-');
  let out = '';
  for (const char of spelled) {
    if (/[A-Za-z0-9\-._~]/.test(char)) out += char;
    else if (char === ' ') out += '+';
    else out += Array.from(new TextEncoder().encode(char), (byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`).join('');
  }
  return out;
}

const notFound = () => new ApiError('http', { status: 404, notFound: true, message: TAG_NOT_FOUND_MESSAGE });

/**
 * The count a subscription starts from, or a refusal. A count Derpibooru did not send cannot be
 * recorded as 0: the next sync would measure the whole tag against it, and the backend would
 * report every one of its pictures as new (the outcome the alias rule above exists to prevent).
 */
function countOf(row: DerpiTagRow): number {
  if (row.images === null) throw new ApiError('invalid', { message: TAG_COUNT_UNREADABLE_MESSAGE });
  return row.images;
}

/**
 * The live picture count for a tag, and the name to subscribe under.
 *
 * The original front end's two reads: `name:<tag>` (ten rows, the one whose name or slug is the
 * tag), then the tag as a query (fifty rows, matching an alias too). One step it did not take,
 * and it mattered: **an alias is a tag record of its own with 0 pictures** (`name:rd` answers the
 * record `rd`, `images: 0`, `aliased_tag: "rainbow+dash"` — read 2026-09-27), so subscribing to
 * an alias recorded 0 and no sync could ever raise it. An alias is followed to its tag here
 * (`slug:<aliased_tag>`), and the subscription is to the tag.
 *
 * A tag Derpibooru does not know is a not-found error with its own sentence, and one whose count
 * it did not send is an `invalid` refusal with its own (`countOf`); anything else — a rate limit,
 * a dead line — is the read's own `ApiError`, a 429 included.
 */
export async function lookupDerpiTag(tag: string, signal?: AbortSignal): Promise<DerpiTagCount> {
  const wanted = normaliseTagName(tag);
  if (!wanted) throw notFound();
  const wantedSlug = tagSlug(wanted);
  const same = (row: DerpiTagRow) => normaliseTagName(row.name) === wanted || row.slug === wantedSlug || row.slug === wanted;

  let hit = (await searchTags(`name:${escapeTag(wanted)}`, 10, signal)).find(same);
  /* Matched through a tag's list of aliases: already the tag the alias stands for. */
  let listedAlias = false;
  if (!hit) {
    const rows = await searchTags(escapeTag(wanted), 50, signal);
    hit = rows.find(same);
    if (!hit) {
      hit = rows.find((row) => row.aliases.some((alias) => alias === wantedSlug || alias === wanted));
      listedAlias = Boolean(hit);
    }
  }
  if (!hit) throw notFound();

  if (hit.aliasedTag) {
    const slug = hit.aliasedTag;
    const target = (await searchTags(`slug:${escapeTag(slug)}`, 10, signal)).find(
      (row) => row.slug === slug && !row.aliasedTag,
    );
    if (!target) throw notFound();
    return { name: target.name, count: countOf(target), aliasOf: hit.name };
  }
  return { name: hit.name, count: countOf(hit), aliasOf: listedAlias ? wanted : null };
}

/**
 * One page of a tag's pictures, newest first, inside the viewer's exclusions and the public
 * blacklist — the subscription's gallery. The tag is one literal term: a name like
 * `oc:nyx (pony)` would otherwise be read as a field, a group and an operator.
 */
export function searchTagImages(
  tag: string,
  page: number,
  perPage: number,
  signal?: AbortSignal,
  contentFilter?: string,
): Promise<ApiResponse> {
  return searchDerpiImages(escapeTag(normaliseTagName(tag)), page, perPage, signal, contentFilter);
}
