import { DERPIBOORU_API_BASE } from '@/lib/constants';
import { getRawImageUrl } from '@/lib/imageLoader';
import type { PonyImage, SharedFavesResponse } from '@/lib/types/image';
import type { ProfileFaveFolder } from '@/lib/types/user';
import { applyImageLine, proxyFetch } from './client';
import { ApiError } from './errors';
import { envelopeMessage, listOf, picponyPostJson, picponyRequest, readEnvelope, readObject } from './http';

/**
 * Favourites — the whole backend contract, as the original front end speaks it (its bundle is
 * the reference: `Ne` / `loadMyCloudFaves`, `handleFaveClick`, `openFaveFolderSelector`, the
 * folder batch mode, `applyCloudFaveTransfer`, the privacy space and the shared routes; the
 * request and response of each action are tabled in the D1 handoff).
 *
 * Every function here resolves with a normalised value or throws `ApiError`, a write's refusal
 * included — its message is the backend's own sentence, the one a screen shows. No screen reads
 * an envelope itself, and none of these retries: a mutation is sent once.
 *
 * Folder ids travel as the original front end sent them. Two actions sent its checkboxes'
 * values — strings — and so do these (`delete_fave_folders`, `merge_fave_folders`); the others
 * sent numbers.
 */

/** A favourite folder of the signed-in account. */
export interface FaveFolder extends ProfileFaveFolder {
  /** `YYYY-MM-DD hh:mm:ss`, Beijing time, as the backend wrote it. */
  createdAt: string | null;
}

/** The privacy space's own card in the folder list: how much it holds, and whether it is locked. */
export interface PrivacyFolderSummary {
  itemCount: number;
  locked: boolean;
}

export interface FaveFolderList {
  folders: FaveFolder[];
  /** `null` when the list carries no privacy card. */
  privacy: PrivacyFolderSummary | null;
}

/**
 * One folder's favourites (folder 0: every folder's) — the ids newest first, when each was saved,
 * and the folders each is in. The "is it favourited" question is `ids.includes(id)` on folder 0.
 */
export interface FaveIndex {
  ids: number[];
  /** Id → when it was favourited, as the backend wrote it. */
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
  /** `null` when the answer carried no count. */
  affected: number | null;
  targets: TransferTargetResult[];
}

export type TransferMode = 'move' | 'copy';

// ---------------------------------------------------------------------------
// Normalising
// ---------------------------------------------------------------------------

function whole(value: unknown, fallback = 0): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function positiveId(value: unknown): number | null {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Positive ids, each once, first position kept (the live lists repeat ids). */
function idList(value: unknown): number[] {
  const seen = new Set<number>();
  const ids: number[] = [];
  for (const raw of listOf<unknown>(value)) {
    const id = positiveId(raw);
    if (id === null || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function records(value: unknown): Record<string, unknown>[] {
  return listOf<unknown>(value).filter(
    (row): row is Record<string, unknown> => row !== null && typeof row === 'object' && !Array.isArray(row),
  );
}

function folderOf(row: Record<string, unknown>): FaveFolder | null {
  const id = positiveId(row.id);
  if (id === null) return null;
  const cover = positiveId(row.latest_image_id);
  return {
    id,
    name: typeof row.name === 'string' ? row.name.trim() : '',
    isMain: Number(row.is_main) === 1 || row.is_main === true,
    itemCount: whole(row.item_count),
    latestImageId: cover,
    createdAt: typeof row.created_at === 'string' && row.created_at.trim() ? row.created_at.trim() : null,
  };
}

/**
 * A refusal of a public read (`success: false` on a 200) is the owner's choice — a hidden folder
 * list, a folder nobody may see — and pressing 重试 cannot change it; a fault arrives as an HTTP
 * status instead. The profile's tabs read the same way (`readProfileTab` in `lib/api/picpony.ts`).
 */
async function readRefusable<T extends object>(res: Response): Promise<T & { success: true }> {
  try {
    return await readEnvelope<T>(res);
  } catch (error) {
    if (error instanceof ApiError && error.kind === 'envelope') {
      throw new ApiError('envelope', { status: error.status, serverMessage: error.serverMessage, retryable: false });
    }
    throw error;
  }
}

/** A write's answer: success, or the backend's sentence as an `ApiError`. */
async function settle(res: Response): Promise<Record<string, unknown>> {
  return readEnvelope<Record<string, unknown>>(res);
}

/** The body as an object whatever the status, or `null` when it is not one (an error page). */
async function readAny(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return await readObject<Record<string, unknown>>(res);
  } catch (error) {
    if (error instanceof ApiError && error.kind === 'invalid') return null;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Folders and favourites
// ---------------------------------------------------------------------------

/** `get_fave_folders`: the account's folders, and the privacy space's card when the list has one. */
export async function getFaveFolders(token: string, signal?: AbortSignal): Promise<FaveFolderList> {
  const data = await readEnvelope<{ folders?: unknown }>(
    await picponyRequest('get_fave_folders', { token, cache: 'no-store', signal }),
  );
  if (!Array.isArray(data.folders)) throw new ApiError('invalid');
  const folders: FaveFolder[] = [];
  const seen = new Set<number>();
  let privacy: PrivacyFolderSummary | null = null;
  for (const row of records(data.folders)) {
    if (row.is_privacy === true || Number(row.is_privacy) === 1) {
      privacy = { itemCount: whole(row.item_count), locked: row.is_locked !== false && row.is_locked !== 0 && row.is_locked !== '0' };
      continue;
    }
    const folder = folderOf(row);
    if (!folder || seen.has(folder.id)) continue;
    seen.add(folder.id);
    folders.push(folder);
  }
  return { folders, privacy };
}

/** `get_faves&folder_id=`: a folder's favourites (0: all of them). A success without its list is a failure. */
export async function getFaves(token: string, folderId = 0, signal?: AbortSignal): Promise<FaveIndex> {
  const data = await readEnvelope<{ faves?: unknown; faves_dates?: unknown; faves_folders?: unknown }>(
    await picponyRequest('get_faves', { token, query: { folder_id: folderId }, cache: 'no-store', signal }),
  );
  /* A success without its list is not "no favourites": that answer would render 暂无收藏 over a
     server fault. */
  if (!Array.isArray(data.faves)) throw new ApiError('invalid');
  const ids = idList(data.faves);
  const dates: Record<number, string> = {};
  if (data.faves_dates && typeof data.faves_dates === 'object') {
    for (const [key, value] of Object.entries(data.faves_dates as Record<string, unknown>)) {
      const id = positiveId(key);
      if (id !== null && typeof value === 'string') dates[id] = value;
    }
  }
  const folders: Record<number, number[]> = {};
  if (data.faves_folders && typeof data.faves_folders === 'object') {
    for (const [key, value] of Object.entries(data.faves_folders as Record<string, unknown>)) {
      const id = positiveId(key);
      if (id !== null) folders[id] = idList(value);
    }
  }
  return { ids, dates, folders };
}

/**
 * `toggle_fave`. Adding sends `{image_id}` — with `folder_id` when a default folder is chosen — and
 * is a toggle on the server: send it only for a picture believed not to be favourited (the
 * original front end's rule). Removing sends `{image_id, fave: false}`, which cannot add.
 * `faved` is the backend's `is_faved`, `null` when the answer does not say.
 */
export async function toggleFave(
  token: string,
  imageId: number,
  options: { folderId?: number; remove?: boolean } = {},
): Promise<{ faved: boolean | null }> {
  const body: Record<string, unknown> = { image_id: imageId };
  if (options.remove) body.fave = false;
  else if (options.folderId && options.folderId > 0) body.folder_id = options.folderId;
  const data = await settle(await picponyPostJson('toggle_fave', body, { token }));
  const value = data.is_faved;
  if (value == null) return { faved: null };
  if ([true, false, 0, 1, '0', '1'].includes(value as boolean | number | string)) return { faved: value === true || value === 1 || value === '1' };
  throw new ApiError('invalid');
}

/** `set_image_fave_folders`: the folders a picture is in, exactly; an empty list unfavourites it. */
export async function setImageFaveFolders(token: string, imageId: number, folderIds: readonly number[]): Promise<number[]> {
  const data = await settle(
    await picponyPostJson('set_image_fave_folders', { image_id: imageId, folder_ids: [...folderIds] }, { token }),
  );
  return Array.isArray(data.folder_ids) ? idList(data.folder_ids) : [...folderIds];
}

/** `create_fave_folder {name}`. The answer names the new folder's id only on some backends. */
export async function createFaveFolder(token: string, name: string): Promise<{ id: number | null }> {
  const data = await settle(await picponyPostJson('create_fave_folder', { name }, { token }));
  const folder = data.folder && typeof data.folder === 'object' ? (data.folder as Record<string, unknown>) : null;
  return { id: positiveId(data.folder_id) ?? positiveId(data.id) ?? positiveId(folder?.id) };
}

/** `delete_fave_folders`: the folders and every favourite in them. The main folder is protected server-side. */
export async function deleteFaveFolders(token: string, folderIds: readonly number[]): Promise<void> {
  await settle(await picponyPostJson('delete_fave_folders', { folder_ids: folderIds.map(String) }, { token }));
}

/** `merge_fave_folders`: the sources' pictures into the target; the sources are deleted. */
export async function mergeFaveFolders(token: string, sourceIds: readonly number[], targetId: number): Promise<void> {
  await settle(
    await picponyPostJson(
      'merge_fave_folders',
      { source_folder_ids: sourceIds.map(String), target_folder_id: String(targetId) },
      { token },
    ),
  );
}

function transferResult(data: Record<string, unknown>): TransferResult {
  const targets = records(data.target_results).map((row): TransferTargetResult => {
    const reasons: Record<string, number> = {};
    if (row.failure_reasons && typeof row.failure_reasons === 'object') {
      for (const [reason, n] of Object.entries(row.failure_reasons as Record<string, unknown>)) {
        if (reason.trim()) reasons[reason.trim()] = whole(n);
      }
    }
    return {
      folderId: positiveId(row.folder_id) ?? 0,
      folderName: typeof row.folder_name === 'string' ? row.folder_name.trim() : '',
      requested: whole(row.requested_count),
      succeeded: whole(row.success_count),
      failed: whole(row.failed_count),
      reasons,
    };
  });
  const affected = data.affected_count === undefined || data.affected_count === null ? null : whole(data.affected_count);
  return { affected, targets };
}

/** `batch_transfer_faves`: pictures of one folder moved or copied into others. */
export async function batchTransferFaves(
  token: string,
  request: { imageIds: readonly number[]; sourceFolderId: number; targetFolderIds: readonly number[]; mode: TransferMode },
): Promise<TransferResult> {
  const data = await settle(
    await picponyPostJson(
      'batch_transfer_faves',
      {
        image_ids: [...request.imageIds],
        source_folder_id: request.sourceFolderId,
        target_folder_ids: [...request.targetFolderIds],
        mode: request.mode,
      },
      { token },
    ),
  );
  return transferResult(data);
}

// ---------------------------------------------------------------------------
// The privacy space
// ---------------------------------------------------------------------------

/**
 * `check_has_privacy_password`. The original front end read the two flags without looking at
 * `success`, so an answer that carries them counts even without it; an explicit refusal or an
 * HTTP failure is an error.
 */
export async function checkHasPrivacyPassword(
  token: string,
  signal?: AbortSignal,
): Promise<{ hasPassword: boolean; unlocked: boolean }> {
  const res = await picponyRequest('check_has_privacy_password', {
    token,
    query: { _t: Date.now() },
    cache: 'no-store',
    signal,
  });
  const data = await readAny(res);
  if (!res.ok) throw new ApiError('http', { status: res.status, serverMessage: envelopeMessage(data) });
  if (!data) throw new ApiError('invalid', { status: res.status });
  if (data.success === false) throw new ApiError('envelope', { status: res.status, serverMessage: envelopeMessage(data) });
  if (typeof data.has_password !== 'boolean') throw new ApiError('invalid');
  return { hasPassword: data.has_password, unlocked: data.unlocked === true };
}

export async function setPrivacyPassword(token: string, password: string): Promise<void> {
  await settle(await picponyPostJson('set_privacy_password', { password }, { token }));
}

export async function verifyPrivacyPassword(token: string, password: string): Promise<void> {
  await settle(await picponyPostJson('verify_privacy_password', { password }, { token }));
}

export async function changePrivacyPassword(token: string, oldPassword: string, newPassword: string): Promise<void> {
  await settle(
    await picponyPostJson('change_privacy_password', { old_password: oldPassword, new_password: newPassword }, { token }),
  );
}

/** `verify_password`: the **account** password — the first step of resetting a forgotten privacy password. */
export async function verifyAccountPassword(token: string, password: string): Promise<void> {
  await settle(await picponyPostJson('verify_password', { password }, { token }));
}

/** `reset_privacy_space`: empties the space and clears its password. Only after `verifyAccountPassword`. */
export async function resetPrivacySpace(token: string, currentPassword: string): Promise<void> {
  await settle(await picponyPostJson('reset_privacy_space', { current_password: currentPassword }, { token }));
}

/** `lock_privacy_space`, bodyless. The caller does not wait on it: the space is locked on this side already. */
export async function lockPrivacySpace(token: string, options: { keepalive?: boolean } = {}): Promise<void> {
  await settle(await picponyRequest('lock_privacy_space', { token, method: 'POST', keepalive: options.keepalive }));
}

/**
 * `set_privacy_faves_presence {active}` — the owner is looking at the space (sent every 5s while
 * it is on screen), or has left it. `keepalive` lets the leaving one outlive a closing page.
 */
export async function setPrivacyFavesPresence(
  token: string,
  active: boolean,
  options: { keepalive?: boolean } = {},
): Promise<void> {
  await settle(await picponyPostJson('set_privacy_faves_presence', { active }, { token, keepalive: options.keepalive }));
}

/** The stored picture records, on the current image line. A row without a usable id is dropped. */
function storedImages(value: unknown): PonyImage[] {
  const seen = new Set<number>();
  const images: PonyImage[] = [];
  for (const row of records(value)) {
    const id = positiveId(row.id ?? row.image_id);
    if (id === null || seen.has(id)) continue;
    const data = row.image_data && typeof row.image_data === 'object' ? (row.image_data as Record<string, unknown>) : row;
    if (!data.representations || typeof data.representations !== 'object') continue;
    seen.add(id);
    images.push(applyImageLine({ ...(data as unknown as PonyImage), id }));
  }
  return images;
}

/** `get_privacy_faves`: the space's pictures, as the records stored with each. */
export async function getPrivacyFaves(token: string, signal?: AbortSignal): Promise<PonyImage[]> {
  const data = await readEnvelope<{ faves?: unknown }>(
    await picponyRequest('get_privacy_faves', { token, query: { _t: Date.now() }, cache: 'no-store', signal }),
  );
  if (!Array.isArray(data.faves)) throw new ApiError('invalid');
  return storedImages(data.faves);
}

/**
 * `add_privacy_fave {image_id, image_data}` — the picture's whole record travels with it (the
 * space is read without Derpibooru). Stored as the source gave it: the image line is this
 * device's, so it is taken off before sending.
 */
export async function addPrivacyFave(token: string, image: PonyImage): Promise<void> {
  const raw = (url: unknown) => (typeof url === 'string' ? getRawImageUrl(url) : url);
  const representations = Object.fromEntries(
    Object.entries(image.representations ?? {}).map(([name, url]) => [name, raw(url)]),
  );
  const imageData = { ...image, representations, view_url: raw(image.view_url) };
  await settle(await picponyPostJson('add_privacy_fave', { image_id: image.id, image_data: imageData }, { token }));
}

/** `remove_privacy_fave {image_id}` — out of the space altogether. */
export async function removePrivacyFave(token: string, imageId: number): Promise<void> {
  await settle(await picponyPostJson('remove_privacy_fave', { image_id: imageId }, { token }));
}

/** `batch_transfer_privacy_faves`: pictures of the space moved or copied into ordinary folders. */
export async function batchTransferPrivacyFaves(
  token: string,
  request: { imageIds: readonly number[]; targetFolderIds: readonly number[]; mode: TransferMode },
): Promise<TransferResult> {
  const data = await settle(
    await picponyPostJson(
      'batch_transfer_privacy_faves',
      { image_ids: [...request.imageIds], target_folder_ids: [...request.targetFolderIds], mode: request.mode },
      { token },
    ),
  );
  return transferResult(data);
}

// ---------------------------------------------------------------------------
// Somebody else's favourites
// ---------------------------------------------------------------------------

/**
 * `get_shared_faves&username=[&folder_id=]` — a folder of somebody's (no folder: their main one).
 * Anonymous. A refusal is not retryable; an unknown username is an HTML 404 (`notFound`). **A
 * folder id that does not exist answers like an empty main folder**, so whether the folder is
 * public is read off `get_profile_fave_folders` instead.
 */
export async function getSharedFaves(
  username: string,
  folderId = 0,
  signal?: AbortSignal,
): Promise<SharedFavesResponse & { success: true }> {
  const data = await readRefusable<{ username?: unknown; folder_name?: unknown; faves?: unknown }>(
    await picponyRequest('get_shared_faves', {
      query: { username, folder_id: folderId > 0 ? folderId : undefined },
      signal,
    }),
  );
  if (!Array.isArray(data.faves)) throw new ApiError('invalid');
  return {
    success: true,
    username: typeof data.username === 'string' ? data.username : username,
    folder_name: typeof data.folder_name === 'string' ? data.folder_name : undefined,
    /* One entry per picture, first position kept: the live list repeats ids (a 1,193-entry
       folder held 1,145 pictures), which inflated every page count computed from its length. */
    faves: idList(data.faves),
  };
}

/**
 * A profile's public favourite folders (`get_profile_fave_folders`, anonymous) — only the ones
 * the owner made public; the backend applies that choice. An unknown username is an HTML 404 —
 * a `notFound` `ApiError` — and a refusal is not retryable.
 */
export async function getProfileFaveFolders(username: string, signal?: AbortSignal): Promise<ProfileFaveFolder[]> {
  const data = await readRefusable<{ folders?: unknown }>(
    await picponyRequest('get_profile_fave_folders', { query: { username }, signal }),
  );
  if (!Array.isArray(data.folders)) throw new ApiError('invalid');
  const folders: ProfileFaveFolder[] = [];
  const seen = new Set<number>();
  for (const row of records(data.folders)) {
    const folder = folderOf(row);
    if (!folder || seen.has(folder.id)) continue;
    seen.add(folder.id);
    folders.push({
      id: folder.id,
      name: folder.name,
      isMain: folder.isMain,
      itemCount: folder.itemCount,
      latestImageId: folder.latestImageId,
    });
  }
  return folders;
}

/** What somebody's privacy space answered: open (its pictures), or why not. */
export type SharedPrivacyAnswer =
  | { state: 'open'; images: PonyImage[] }
  /** Behind its password; `message` is the backend's sentence when it gave one. */
  | { state: 'locked'; message: string | null }
  /** The owner has not set a password, so there is nothing to open. */
  | { state: 'no-password'; message: string | null };

/**
 * `get_shared_privacy_faves&owner_id=` (signed in). The original front end showed its password
 * field for any answer but a success; this reads what the answer says when it says more — an
 * owner with no password (`has_password: false`), an owner who does not exist (a 404, or a
 * refusal saying so) — so the route can tell the three apart.
 */
export async function getSharedPrivacyFaves(
  token: string,
  ownerId: number,
  signal?: AbortSignal,
): Promise<SharedPrivacyAnswer> {
  const res = await picponyRequest('get_shared_privacy_faves', {
    token,
    query: { owner_id: ownerId, _t: Date.now() },
    cache: 'no-store',
    signal,
  });
  const data = await readAny(res);
  const message = envelopeMessage(data) ?? null;
  if (res.status === 404 || (message !== null && /不存在|未找到/.test(message))) {
    throw new ApiError('http', { status: 404, serverMessage: message ?? undefined, notFound: true });
  }
  if (res.ok && data?.success === true) {
    if (!Array.isArray(data.faves)) throw new ApiError('invalid');
    return { state: 'open', images: storedImages(data.faves) };
  }
  if (!data) throw new ApiError(res.ok ? 'invalid' : 'http', { status: res.status });
  if (res.status === 401 || res.status === 429 || res.status >= 500) {
    throw new ApiError('http', { status: res.status, serverMessage: message ?? undefined });
  }
  if (data.has_password === false || /未设置.*密码|尚未创建/.test(message ?? '')) return { state: 'no-password', message };
  return { state: 'locked', message };
}

/**
 * `verify_shared_privacy_password {owner_id, password}`. A refusal is a non-retryable `ApiError`
 * carrying the backend's sentence — 密码错误 when it gives none, the original front end's default.
 */
export async function verifySharedPrivacyPassword(token: string, ownerId: number, password: string): Promise<void> {
  const res = await picponyPostJson('verify_shared_privacy_password', { owner_id: ownerId, password }, { token });
  try {
    await readEnvelope<Record<string, unknown>>(res);
  } catch (error) {
    if (!(error instanceof ApiError) || error.kind !== 'envelope') throw error;
    throw new ApiError('envelope', { status: error.status, serverMessage: error.serverMessage ?? '密码错误', retryable: false });
  }
}

// ---------------------------------------------------------------------------
// Pictures, by id
// ---------------------------------------------------------------------------

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
  return records(data.images)
    .filter((row) => positiveId(row.id) !== null)
    .map((row) => applyImageLine(row as unknown as PonyImage));
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
  const images = records(data.images)
    .filter((row) => positiveId(row.id) !== null)
    .map((row) => applyImageLine(row as unknown as PonyImage));
  const total = typeof data.total === 'number' && Number.isFinite(data.total) ? Math.max(0, data.total) : images.length;
  return { images, total };
}
