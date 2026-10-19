import { DERPIBOORU_API_BASE } from '@/lib/constants';
import { getRawImageUrl } from '@/lib/imageLoader';
import { randomId } from '@/lib/utils';
import type { PonyImage } from '@/lib/types/image';
import type { ProfileFaveFolder } from '@/lib/types/user';
import { applyImageLine, proxyFetch } from './client';
import { ApiError } from './errors';
import { api, readObject, seg } from './http';

/**
 * Favourites — the account's folders, the privacy space and other people's public folders, on
 * the Rust backend's `/api/v1` resources (`src/pg/favorites.rs`, `collections.rs`, `privacy.rs`).
 *
 * Every function here resolves with a normalised value or throws `ApiError` (the backend's
 * `error.code` and its sentence travel on it). None of these retries: a mutation is sent once.
 * The writes the backend replays (`toggle_fave`, the transfers, the merge, the import) carry a
 * fresh `Idempotency-Key` per call — the backend requires one.
 */

/** A favourite folder of the signed-in account. */
export interface FaveFolder extends ProfileFaveFolder {
  /** ISO 8601 (UTC), as the backend wrote it. */
  createdAt: string | null;
}

/** The privacy space as the folder list reports it (`privacy_space`). */
export interface PrivacyFolderSummary {
  hasPassword: boolean;
  unlocked: boolean;
  /** Whether the owner shows the space on /favorites (`showPrivacyFaves`). */
  visible: boolean;
  /** `null` while the space is locked — the backend does not count a locked space. */
  itemCount: number | null;
}

export interface FaveFolderList {
  folders: FaveFolder[];
  privacy: PrivacyFolderSummary;
}

/**
 * One folder's favourites (folder 0: every folder's) — the ids newest first, when each was saved,
 * and the folders each is in. The "is it favourited" question is `ids.includes(id)` on folder 0.
 */
export interface FaveIndex {
  ids: number[];
  /** Id → when it was favourited (ISO 8601, UTC). */
  dates: Record<number, string>;
  /** Id → the folders it is in. */
  folders: Record<number, number[]>;
}

/** One target folder's outcome of a batch move or copy (`formatCloudFaveTransferSummary`). */
export interface TransferTargetResult {
  folderId: number;
  folderName: string;
  requested: number;
  succeeded: number;
  failed: number;
  /** Reason → count, the backend's own words. */
  reasons: Record<string, number>;
}

export interface TransferResult {
  affected: number | null;
  targets: TransferTargetResult[];
}

export type TransferMode = 'move' | 'copy';

/** The page size every list endpoint here allows at most. */
const PAGE_LIMIT = 100;

/** Pages of a list read until `total` is covered (each endpoint caps a page at 100). */
async function readAllPages<Row>(
  readPage: (page: number) => Promise<{ rows: Row[]; total: number }>,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let page = 1; ; page += 1) {
    const answer = await readPage(page);
    rows.push(...answer.rows);
    if (answer.rows.length < PAGE_LIMIT || rows.length >= answer.total) return rows;
  }
}

// ---------------------------------------------------------------------------
// Wire shapes (src/pg)
// ---------------------------------------------------------------------------

interface OwnFolderRow {
  id: number;
  name: string;
  is_main: boolean;
  created_at: string;
  image_count: number;
  /** The cover: newest favourite not blocked site-wide (as the public list picks it); `null` for an empty folder. */
  latest_image_id: number | null;
}

interface PublicFolderRow {
  id: number;
  name: string;
  is_main: boolean;
  created_at: string;
  image_count: number;
  latest_image_id: number | null;
}

interface PrivacyState {
  owner_id: number;
  has_password: boolean;
  unlock_seconds: number;
  active: boolean;
  unlocked: boolean;
  expires_at: string | null;
}

interface TransferAnswer {
  affected_count: number;
  inserted_count: number;
  failed_count: number;
  failed_items: { image_id: number; folder_id: number; code: string; reason: string }[];
  target_results: {
    folder_id: number;
    requested_count: number;
    inserted_count: number;
    duplicate_count: number;
    blocked_count: number;
  }[];
}

/** The folders' names, for a transfer summary — the answer names folders by id only. */
function transferResult(data: TransferAnswer, names: ReadonlyMap<number, string>): TransferResult {
  const reasonsByFolder = new Map<number, Record<string, number>>();
  for (const item of data.failed_items) {
    const reasons = reasonsByFolder.get(item.folder_id) ?? {};
    reasons[item.reason] = (reasons[item.reason] ?? 0) + 1;
    reasonsByFolder.set(item.folder_id, reasons);
  }
  return {
    affected: data.affected_count,
    targets: data.target_results.map((row) => ({
      folderId: row.folder_id,
      folderName: names.get(row.folder_id) ?? '',
      requested: row.requested_count,
      succeeded: row.inserted_count,
      failed: row.duplicate_count + row.blocked_count,
      reasons: reasonsByFolder.get(row.folder_id) ?? {},
    })),
  };
}

// ---------------------------------------------------------------------------
// Folders and favourites
// ---------------------------------------------------------------------------

/** `GET /me/favorite-folders`: the account's folders (main first), and the privacy space's state. */
export async function getFaveFolders(token: string, signal?: AbortSignal): Promise<FaveFolderList> {
  const data = await api<{ folders: OwnFolderRow[]; privacy_space: PrivacyState & { visible: boolean; image_count: number | null } }>(
    'GET', '/me/favorite-folders', { token, signal, cache: 'no-store' },
  );
  return {
    folders: data.folders.map((row) => ({
      id: row.id,
      name: row.name,
      isMain: row.is_main,
      itemCount: row.image_count,
      latestImageId: row.latest_image_id,
      createdAt: row.created_at,
    })),
    privacy: {
      hasPassword: data.privacy_space.has_password,
      unlocked: data.privacy_space.unlocked,
      visible: data.privacy_space.visible,
      itemCount: data.privacy_space.image_count,
    },
  };
}

/**
 * `GET /me/favorites[?folder_id=]`: a folder's favourites (0: all of them), every page — the
 * backend pages at most 100 a request, and the screens need the whole index.
 */
export async function getFaves(token: string, folderId = 0, signal?: AbortSignal): Promise<FaveIndex> {
  type Item = { image_id: number; created_at: string; folder_ids: number[] };
  const items = await readAllPages<Item>(async (page) => {
    const data = await api<{ items: Item[]; total: number }>('GET', '/me/favorites', {
      token,
      signal,
      cache: 'no-store',
      query: { page, per_page: PAGE_LIMIT, folder_id: folderId > 0 ? folderId : undefined },
    });
    return { rows: data.items, total: data.total };
  });
  const ids: number[] = [];
  const dates: Record<number, string> = {};
  const folders: Record<number, number[]> = {};
  for (const item of items) {
    /* A favourite saved while the pages were being read can shift a row onto the next page. */
    if (item.image_id in dates) continue;
    ids.push(item.image_id);
    dates[item.image_id] = item.created_at;
    folders[item.image_id] = item.folder_ids;
  }
  return { ids, dates, folders };
}

/**
 * `PUT /me/favorites/{image_id} {saved, folder_id?}` — idempotent: `saved: true` favourites the
 * picture (into `folderId`, or the main folder when it is in none), `saved: false` takes it out of
 * every folder. Resolves with the folders it is in afterwards.
 */
export async function setFaved(
  token: string,
  imageId: number,
  saved: boolean,
  options: { folderId?: number } = {},
): Promise<{ faved: boolean; folders: number[] }> {
  const folderId = options.folderId && options.folderId > 0 ? options.folderId : undefined;
  const data = await api<{ image_id: number; folder_ids: number[]; favorited: boolean }>(
    'PUT', `/me/favorites/${seg(imageId)}`,
    { token, json: { saved, ...(folderId !== undefined ? { folder_id: folderId } : {}) }, idempotencyKey: randomId() },
  );
  return { faved: data.favorited, folders: data.folder_ids };
}

/** `PUT /me/favorites/{image_id}/folders {folder_ids}`: the folders a picture is in, exactly; empty unfavourites it. */
export async function setImageFaveFolders(token: string, imageId: number, folderIds: readonly number[]): Promise<number[]> {
  const data = await api<{ folder_ids: number[] }>('PUT', `/me/favorites/${seg(imageId)}/folders`, {
    token,
    json: { folder_ids: [...folderIds] },
  });
  return data.folder_ids;
}

/** `POST /me/favorite-imports {image_ids, folder_id?}` — up to 1,000 pictures into one folder (none: the main one). */
export async function batchAddFaves(
  token: string,
  imageIds: readonly number[],
  folderId?: number,
): Promise<{ folderId: number; inserted: number }> {
  const data = await api<{ folder_id: number; inserted_count: number }>('POST', '/me/favorite-imports', {
    token,
    json: { image_ids: [...imageIds], ...(folderId && folderId > 0 ? { folder_id: folderId } : {}) },
    idempotencyKey: randomId(),
  });
  return { folderId: data.folder_id, inserted: data.inserted_count };
}

/** `POST /me/favorite-folders {name}` → the new folder's id. */
export async function createFaveFolder(token: string, name: string): Promise<{ id: number }> {
  const data = await api<{ folder: { id: number } }>('POST', '/me/favorite-folders', { token, json: { name } });
  return { id: data.folder.id };
}

/**
 * `POST /me/favorite-folders/deletions {folder_ids}`. **The backend keeps the pictures**: a deleted
 * folder's favourites move to the main folder. The main folder is refused (409 `MAIN_FOLDER`).
 */
export async function deleteFaveFolders(token: string, folderIds: readonly number[]): Promise<void> {
  await api('POST', '/me/favorite-folders/deletions', { token, json: { folder_ids: [...folderIds] } });
}

/** `POST /me/favorite-folder-merges`: the sources' pictures into the target; the sources are deleted. */
export async function mergeFaveFolders(token: string, sourceIds: readonly number[], targetId: number): Promise<void> {
  await api('POST', '/me/favorite-folder-merges', {
    token,
    json: { source_folder_ids: [...sourceIds], target_folder_id: targetId },
    idempotencyKey: randomId(),
  });
}

/** `POST /me/favorite-folders/{source}/transfers`: pictures of one folder moved or copied into others. */
export async function batchTransferFaves(
  token: string,
  request: {
    imageIds: readonly number[];
    sourceFolderId: number;
    targetFolderIds: readonly number[];
    mode: TransferMode;
    /** Folder names for the summary (the answer carries ids only). */
    folderNames?: ReadonlyMap<number, string>;
  },
): Promise<TransferResult> {
  const data = await api<TransferAnswer>('POST', `/me/favorite-folders/${seg(request.sourceFolderId)}/transfers`, {
    token,
    json: { image_ids: [...request.imageIds], target_folder_ids: [...request.targetFolderIds], mode: request.mode },
    idempotencyKey: randomId(),
  });
  return transferResult(data, request.folderNames ?? new Map());
}

// ---------------------------------------------------------------------------
// The privacy space
// ---------------------------------------------------------------------------

/** `GET /me/privacy-space`: whether the space has a password, and whether this session holds it open. */
export async function checkHasPrivacyPassword(
  token: string,
  signal?: AbortSignal,
): Promise<{ hasPassword: boolean; unlocked: boolean }> {
  const data = await api<PrivacyState>('GET', '/me/privacy-space', { token, signal, cache: 'no-store' });
  return { hasPassword: data.has_password, unlocked: data.unlocked };
}

/** `POST /me/privacy-space/password {password}` — sets the first password and unlocks the space. */
export async function setPrivacyPassword(token: string, password: string): Promise<void> {
  await api('POST', '/me/privacy-space/password', { token, json: { password } });
}

/** `POST /me/privacy-space/unlock {password}`. A wrong one is 403 `PASSWORD_MISMATCH`. */
export async function verifyPrivacyPassword(token: string, password: string): Promise<void> {
  await api('POST', '/me/privacy-space/unlock', { token, json: { password } });
}

/** `PUT /me/privacy-space/password {old_password, new_password}`. */
export async function changePrivacyPassword(token: string, oldPassword: string, newPassword: string): Promise<void> {
  await api('PUT', '/me/privacy-space/password', { token, json: { old_password: oldPassword, new_password: newPassword } });
}

/** `POST /me/password-verification {password}`: the **account** password — step one of resetting a forgotten privacy password. */
export async function verifyAccountPassword(token: string, password: string): Promise<void> {
  await api('POST', '/me/password-verification', { token, json: { password } });
}

/** `POST /me/privacy-space/reset {password}` (the account password): empties the space and clears its password. */
export async function resetPrivacySpace(token: string, accountPassword: string): Promise<void> {
  await api('POST', '/me/privacy-space/reset', { token, json: { password: accountPassword } });
}

/** `DELETE /me/privacy-space/unlock`. The caller does not wait on it: the space is locked on this side already. */
export async function lockPrivacySpace(token: string, options: { keepalive?: boolean } = {}): Promise<void> {
  await api('DELETE', '/me/privacy-space/unlock', { token, keepalive: options.keepalive });
}

/**
 * `PUT /me/privacy-space/presence {active}` — the owner is looking at the space (sent every 5s while
 * it is on screen), or has left it. `keepalive` lets the leaving one outlive a closing page.
 */
export async function setPrivacyFavesPresence(
  token: string,
  active: boolean,
  options: { keepalive?: boolean } = {},
): Promise<void> {
  await api('PUT', '/me/privacy-space/presence', { token, json: { active }, keepalive: options.keepalive });
}

interface PrivacyItem {
  image_id: number;
  /** The snapshot stored with the picture (`add_privacy_fave`'s `image`). */
  image: PonyImage;
  revision: number;
  created_at: string;
}

/** The stored picture records, on the current image line. */
function storedImages(items: readonly PrivacyItem[]): PonyImage[] {
  const seen = new Set<number>();
  const images: PonyImage[] = [];
  for (const item of items) {
    /* A picture added while the pages were being read can shift a row onto the next page. */
    if (seen.has(item.image_id)) continue;
    seen.add(item.image_id);
    images.push(applyImageLine({ ...item.image, id: item.image_id }));
  }
  return images;
}

async function readSpace(token: string, path: string, signal?: AbortSignal): Promise<PonyImage[]> {
  const items = await readAllPages<PrivacyItem>(async (page) => {
    const data = await api<{ items: PrivacyItem[]; total: number }>('GET', path, {
      token,
      signal,
      cache: 'no-store',
      query: { page, limit: PAGE_LIMIT },
    });
    return { rows: data.items, total: data.total };
  });
  return storedImages(items);
}

/** `GET /me/privacy-space/favorites`: the space's pictures (every page). Locked: 403 `PRIVACY_LOCKED`. */
export function getPrivacyFaves(token: string, signal?: AbortSignal): Promise<PonyImage[]> {
  return readSpace(token, '/me/privacy-space/favorites', signal);
}

/** Whether an error is the backend saying the space is locked (or its unlock lapsed). */
export function isPrivacyLocked(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'PRIVACY_LOCKED';
}

/**
 * `PUT /me/privacy-space/favorites/{image_id} {image}` — the picture's whole record travels with it
 * (the space is read without Derpibooru). Stored as the source gave it: the image line is this
 * device's, so it is taken off before sending.
 */
export async function addPrivacyFave(token: string, image: PonyImage): Promise<void> {
  const raw = (url: unknown) => (typeof url === 'string' ? getRawImageUrl(url) : url);
  const representations = Object.fromEntries(
    Object.entries(image.representations ?? {}).map(([name, url]) => [name, raw(url)]),
  );
  const snapshot = { ...image, representations, view_url: raw(image.view_url) };
  await api('PUT', `/me/privacy-space/favorites/${seg(image.id)}`, { token, json: { image: snapshot } });
}

/** `DELETE /me/privacy-space/favorites/{image_id}` — out of the space altogether. */
export async function removePrivacyFave(token: string, imageId: number): Promise<void> {
  await api('DELETE', `/me/privacy-space/favorites/${seg(imageId)}`, { token });
}

/** `POST /me/privacy-space/transfers`: pictures of the space moved or copied into ordinary folders. */
export async function batchTransferPrivacyFaves(
  token: string,
  request: {
    imageIds: readonly number[];
    targetFolderIds: readonly number[];
    mode: TransferMode;
    folderNames?: ReadonlyMap<number, string>;
  },
): Promise<TransferResult> {
  const data = await api<TransferAnswer>('POST', '/me/privacy-space/transfers', {
    token,
    json: { image_ids: [...request.imageIds], target_folder_ids: [...request.targetFolderIds], mode: request.mode },
    idempotencyKey: randomId(),
  });
  return transferResult(data, request.folderNames ?? new Map());
}

// ---------------------------------------------------------------------------
// Somebody else's favourites
// ---------------------------------------------------------------------------

/**
 * `GET /users/by-username/{username}` — somebody's username → their id, for an old link that names
 * the owner by username (a folder share card carries the username). Public. No such user: 404
 * (`notFound`).
 */
export async function resolveUsername(username: string, signal?: AbortSignal): Promise<number> {
  const data = await api<{ id: number; username: string }>('GET', `/users/by-username/${seg(username)}`, { signal });
  return data.id;
}

/**
 * `GET /users/{owner}/favorites[?folder_id=]` — a folder of somebody's (no folder: every public
 * folder of theirs), every page. Anonymous. An unknown owner is 404 `USER_NOT_FOUND`; a folder
 * that does not exist or is not public is 404 `FOLDER_NOT_FOUND`; an owner who hides favourites
 * answers an empty list.
 */
export async function getSharedFaves(ownerId: number, folderId = 0, signal?: AbortSignal): Promise<number[]> {
  const ids = await readAllPages<number>(async (page) => {
    const data = await api<{ image_ids: number[]; total: number }>('GET', `/users/${seg(ownerId)}/favorites`, {
      signal,
      query: { page, limit: PAGE_LIMIT, folder_id: folderId > 0 ? folderId : undefined },
    });
    return { rows: data.image_ids, total: data.total };
  });
  return [...new Set(ids)];
}

/**
 * `GET /users/{owner}/favorite-folders` — the owner's public folders (anonymous; the backend
 * applies `showFaves` and `publicFaveFolderIds`). An unknown owner is a `notFound` `ApiError`.
 */
export async function getProfileFaveFolders(ownerId: number, signal?: AbortSignal): Promise<ProfileFaveFolder[]> {
  const data = await api<{ folders: PublicFolderRow[] }>('GET', `/users/${seg(ownerId)}/favorite-folders`, { signal });
  return data.folders.map((row) => ({
    id: row.id,
    name: row.name,
    isMain: row.is_main,
    itemCount: row.image_count,
    latestImageId: row.latest_image_id,
  }));
}

/** What somebody's privacy space answered: open (its pictures), or behind its password. */
export type SharedPrivacyAnswer =
  | { state: 'open'; images: PonyImage[] }
  /**
   * Not unlocked for this session. The backend does not say whether the owner has a password at
   * all (it refuses to disclose it), so an owner without one also reads as locked.
   */
  | { state: 'locked'; message: string | null };

/**
 * `GET /users/{owner}/privacy-space/favorites` (signed in): the pictures once this session has
 * unlocked the space, 403 `PRIVACY_LOCKED` until then, 404 for an owner who does not exist.
 */
export async function getSharedPrivacyFaves(
  token: string,
  ownerId: number,
  signal?: AbortSignal,
): Promise<SharedPrivacyAnswer> {
  try {
    return { state: 'open', images: await readSpace(token, `/users/${seg(ownerId)}/privacy-space/favorites`, signal) };
  } catch (error) {
    if (isPrivacyLocked(error)) return { state: 'locked', message: null };
    throw error;
  }
}

/**
 * `POST /users/{owner}/privacy-space/unlock {password}`. A wrong password (or an owner without
 * one — the backend answers both alike) is 403 `PASSWORD_MISMATCH`.
 */
export async function verifySharedPrivacyPassword(token: string, ownerId: number, password: string): Promise<void> {
  await api('POST', `/users/${seg(ownerId)}/privacy-space/unlock`, { token, json: { password } });
}

/**
 * Whether an error is the backend refusing *this input* — a name, a password, a limit reached
 * (400 `INVALID_INPUT`, 403 `PASSWORD_MISMATCH`, 409 such as `FOLDER_LIMIT`) — which a form shows
 * beside its field, rather than a fault a toast reports. A wrong password is told by its code: a
 * 403 is otherwise a permission refusal, not something the field can fix.
 */
export function isRefusal(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'http' && error.code !== undefined
    && (error.status === 400 || error.status === 409 || error.code === 'PASSWORD_MISMATCH');
}

/** Whether an error is the backend refusing a privacy password. */
export function isPasswordMismatch(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'PASSWORD_MISMATCH';
}

// ---------------------------------------------------------------------------
// Pictures, by id
// ---------------------------------------------------------------------------

/** Derpibooru's picture rows (a third-party answer, so each row is checked), on the current image line. */
function pictureRows(rows: unknown[]): PonyImage[] {
  return rows
    .filter((row): row is PonyImage => {
      const id = (row as { id?: unknown } | null)?.id;
      return typeof id === 'number' && Number.isSafeInteger(id) && id > 0;
    })
    .map((row) => applyImageLine(row));
}

/** Derpibooru's Everything filter — the one preset that withholds nothing (`withDerpiContentFilter`). */
const EVERYTHING_FILTER = 56027;

/** Derpibooru's page size, and so the most ids one lookup can ask for. */
export const LOOKUP_LIMIT = 50;

/**
 * The records of up to fifty pictures, by id, in Derpibooru's order — **through the Everything
 * filter**, so every picture that exists comes back and the device's own settings and the site's
 * public blacklist are applied after the read (`withholdFromDevice` in `lib/favorites.ts`): that
 * is what lets a page say how many pictures it withheld and, separately, how many no longer
 * exist. Derpibooru's default filter would silently drop some, indistinguishable from a deletion.
 * The request depends on the ids alone, so its cache key does too.
 */
export async function lookupImagesByIds(ids: readonly number[], signal?: AbortSignal): Promise<PonyImage[]> {
  if (ids.length > LOOKUP_LIMIT) throw new RangeError(`at most ${LOOKUP_LIMIT} ids a lookup`);
  if (ids.length === 0) return [];
  const query = ids.map((id) => `id:${id}`).join(' OR ');
  const res = await proxyFetch(
    `${DERPIBOORU_API_BASE}/search/images?q=${encodeURIComponent(query)}&page=1&per_page=${ids.length}&filter_id=${EVERYTHING_FILTER}`,
    { cache: 'no-store', signal },
  );
  const data = await readObject<{ images?: unknown }>(res);
  if (!Array.isArray(data.images)) throw new ApiError('invalid');
  return pictureRows(data.images);
}

/** One page of `my:faves` on Derpibooru, and how many the account has there. */
export interface DerpiFavesPage {
  images: PonyImage[];
  total: number;
}

/**
 * The account's Derpibooru favourites (`my:faves`, which only the account's own API key can
 * ask for), newest first — **through the Everything filter**, like every favourites lookup here,
 * so the device's settings are applied after the read and the page can say how many it withheld
 * (C11; the original front end wrote the device's exclusions into the query instead, so that tab
 * and the PicPony one disagreed, R5-024). The key travels in the query as Derpibooru requires.
 */
export async function getDerpiFaves(apiKey: string, page: number, perPage: number, signal?: AbortSignal): Promise<DerpiFavesPage> {
  const params = new URLSearchParams({
    q: 'my:faves',
    page: String(page),
    per_page: String(perPage),
    sf: 'created_at',
    sd: 'desc',
    key: apiKey,
    filter_id: String(EVERYTHING_FILTER),
  });
  const res = await proxyFetch(`${DERPIBOORU_API_BASE}/search/images?${params}`, { cache: 'no-store', signal });
  const data = await readObject<{ images?: unknown; total?: unknown }>(res);
  if (!Array.isArray(data.images)) throw new ApiError('invalid');
  const images = pictureRows(data.images);
  const total = typeof data.total === 'number' && Number.isFinite(data.total) ? Math.max(0, data.total) : images.length;
  return { images, total };
}
