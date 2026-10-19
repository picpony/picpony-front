/**
 * 标签订阅 (decision 15): the backend's subscription resources (`src/pg/subscriptions.rs`) and the
 * Derpibooru count lookup the subscribe step depends on.
 *
 * A subscription is a tag and the picture count recorded for it. The backend learns about new
 * pictures only from the front end: a **sync** reads the live counts from Derpibooru, reports them
 * (`sync_tag_subscriptions`, in batches of at most 50 under one `sync_id`, a UUID), then
 * **finalises** — the backend has compared each count as it arrived, raised each subscription's
 * `unread_count`, and now writes one system notification for the tags that gained pictures.
 * Opening a subscription marks it **seen**. `components/subscriptions/sync.ts` owns when that
 * runs; this module only speaks the wire.
 *
 * The backend addresses a subscription by its id; the screens by its tag. The id of each tag is
 * remembered per token from every list read and subscribe, and a tag not yet known is looked up.
 */

import { DERPIBOORU_API_BASE } from '@/lib/constants';
import { escapeTag } from '@/lib/searchQuery';
import type { ApiResponse } from '@/lib/types/image';
import { proxyFetch } from './client';
import { searchDerpiImages } from './derpi';
import { ApiError } from './errors';
import { api, readObject, seg } from './http';

export interface TagSubscription {
  /** The backend's id for the subscription. */
  id: number;
  /** The tag as the backend stores it — the name the sync reports under. */
  tagName: string;
  /** The count recorded at the last sync (or at subscribing). */
  imageCount: number;
  /** Pictures added since the subscription was last opened. */
  newCount: number;
}

/**
 * A whole, non-negative number off a Derpibooru answer, or `null` for anything else. A missing,
 * blank, boolean or non-numeric count is *unknown*, never 0: an explicit `0` is a real tag with no
 * pictures and has to stay distinguishable from a count nobody could read.
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

interface SubscriptionRow {
  id: number;
  tag: string;
  image_count: number;
  unread_count: number;
  checked_at: string;
  created_at: string;
}

/** Token → (normalised tag → subscription id). */
const knownIds = new Map<string, Map<string, number>>();

function remember(token: string, tag: string, id: number) {
  let ids = knownIds.get(token);
  if (!ids) knownIds.set(token, (ids = new Map()));
  ids.set(normaliseTagName(tag), id);
}

/** `GET /me/tag-subscriptions` → the list, in the backend's order (most unread first). A refusal throws. */
export async function getTagSubscriptions(token: string, signal?: AbortSignal): Promise<TagSubscription[]> {
  const data = await api<{ subscriptions: SubscriptionRow[] }>('GET', '/me/tag-subscriptions', { token, signal, cache: 'no-store' });
  const ids = new Map<string, number>();
  knownIds.set(token, ids);
  return data.subscriptions.map((row) => {
    ids.set(normaliseTagName(row.tag), row.id);
    return { id: row.id, tagName: row.tag, imageCount: row.image_count, newCount: row.unread_count };
  });
}

/** A tag's subscription id: remembered, or the list read again. Not subscribed: a `notFound` `ApiError`. */
async function subscriptionId(token: string, tagName: string): Promise<number> {
  const key = normaliseTagName(tagName);
  const known = knownIds.get(token)?.get(key);
  if (known !== undefined) return known;
  const list = await getTagSubscriptions(token);
  const hit = list.find((entry) => normaliseTagName(entry.tagName) === key);
  if (!hit) throw new ApiError('http', { status: 404, notFound: true, code: 'SUBSCRIPTION_NOT_FOUND', message: '订阅不存在' });
  return hit.id;
}

/** A second subscription of the same tag (one per tag, case-insensitively) is 409 `ALREADY_EXISTS`. */
export function isAlreadySubscribed(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'ALREADY_EXISTS';
}

/** `POST /me/tag-subscriptions {tag, image_count}` → the new subscription's id. The count is the live one, looked up first. */
export async function addTagSubscription(token: string, tagName: string, imageCount: number): Promise<{ id: number }> {
  const data = await api<{ id: number }>('POST', '/me/tag-subscriptions', { token, json: { tag: tagName, image_count: imageCount } });
  remember(token, tagName, data.id);
  return { id: data.id };
}

/** `DELETE /me/tag-subscriptions/{id}`, by tag. */
export async function removeTagSubscription(token: string, tagName: string): Promise<void> {
  await api('DELETE', `/me/tag-subscriptions/${seg(await subscriptionId(token, tagName))}`, { token });
  knownIds.get(token)?.delete(normaliseTagName(tagName));
}

/** `POST /me/tag-subscriptions/{id}/read-receipts`, by tag — its new pictures have been looked at. */
export async function markTagSubscriptionSeen(token: string, tagName: string): Promise<void> {
  await api('POST', `/me/tag-subscriptions/${seg(await subscriptionId(token, tagName))}/read-receipts`, { token });
}

export interface TagCountUpdate {
  subscription_id: number;
  image_count: number;
}

/** The most updates one sync request may carry. */
export const SYNC_BATCH_LIMIT = 50;

/**
 * `POST /me/tag-subscription-syncs {sync_id, updates}` — one batch (≤ 50) of live counts. A
 * refusal throws, so the caller can count it.
 */
export async function syncTagSubscriptions(
  token: string,
  syncId: string,
  updates: readonly TagCountUpdate[],
): Promise<void> {
  await api('POST', '/me/tag-subscription-syncs', { token, json: { sync_id: syncId, updates } });
}

/** `POST /me/tag-subscription-syncs/{sync_id}/completion` → how many subscriptions gained pictures. */
export async function finalizeTagSubscriptionSync(token: string, syncId: string): Promise<{ updatedTags: number }> {
  const data = await api<{ updated_tags: number }>('POST', `/me/tag-subscription-syncs/${seg(syncId)}/completion`, { token });
  return { updatedTags: data.updated_tags };
}

/** A fresh `sync_id`: a version-4 UUID, as the backend requires. */
export function newSyncToken(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes);
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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
  return (Array.isArray(data.tags) ? (data.tags as Record<string, unknown>[]) : [])
    .filter((row) => row && typeof row === 'object' && typeof row.name === 'string')
    .map((row) => ({
      name: String(row.name),
      slug: typeof row.slug === 'string' ? row.slug : '',
      images: wholeNumber(row.images),
      aliases: (Array.isArray(row.aliases) ? (row.aliases as unknown[]) : []).filter((alias): alias is string => typeof alias === 'string'),
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
