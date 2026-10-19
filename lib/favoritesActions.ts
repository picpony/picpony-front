'use client';

/**
 * Every change to favourites, and what it does to the caches that know about it.
 *
 * A change goes to the backend once (`lib/api/favorites.ts` — never retried), and then everything
 * that holds the picture's or the folder's state is told: the favourites index it can correct in
 * place is written at once (`faveIds`: the "is it favourited" list the detail's 收藏 reads), and
 * the rest is expired, so every mounted screen re-reads underneath what it shows — the folder list
 * and its counts (`faveFolders`), a folder's own ids, the profile's public folders and the shared
 * routes (`profileFaveFolders`, `sharedFaveIds`).
 *
 * An answer that lands after the account changed corrects nothing: a different account's caches
 * are not its to write.
 */

import * as api from '@/lib/api/favorites';
import type { FaveIndex, TransferMode, TransferResult } from '@/lib/api/favorites';
import { ApiError, apiErrorMessage } from '@/lib/api/errors';
import { readToken } from '@/lib/hooks';
import { faveFolders, faveIds, favePictures, profileFaveFolders, sharedFaveIds, tasks } from '@/lib/resources';
import { changeSyncedSetting } from '@/lib/settingsSync';
import { readFavouriteSetting } from '@/lib/favoritesSettings';
import type { PonyImage } from '@/lib/types/image';
import { FAVE_PAGE_SIZE, NO_DEFAULT_FOLDER, type DefaultFolder } from '@/lib/favorites';

function requireSession(token: string) {
  if (readToken() !== token) throw new DOMException('session changed', 'AbortError');
}

/** Re-read everything a change may have moved, underneath what is on screen. */
export function favouritesChanged(token: string, { folders = true, acknowledged = true }: { folders?: boolean; acknowledged?: boolean } = {}) {
  if (readToken() !== token) return;
  if (acknowledged) tasks.expire({ token });
  faveIds.expire();
  if (folders) faveFolders.expire({ token });
  /* The public answers of your own account; keyed on the owner, so all of them (two small caches). */
  profileFaveFolders.expire();
  sharedFaveIds.expire();
}

/**
 * Correct the all-folders index in place. `null`: the picture left favourites. A list: it is
 * favourited, in those folders — an empty list when which ones is not known yet (the re-read that
 * follows every change fills it in; no folder id is ever invented here).
 */
function writeMembership(token: string, imageId: number, folders: readonly number[] | null, basis?: FaveIndex) {
  if (readToken() !== token) return;
  const cached = basis ?? faveIds.peek({ token }).data;
  if (!cached) return;
  faveIds.write({ token }, (previous) => {
    const index = previous ?? cached;
    const ids = index.ids.filter((id) => id !== imageId);
    const membership = { ...index.folders };
    const dates = { ...index.dates };
    if (folders) {
      if (folders.length > 0) membership[imageId] = [...folders];
      else delete membership[imageId];
      if (!dates[imageId]) dates[imageId] = new Date().toISOString();
      /* A new favourite goes first, as the backend lists them; a picture that only moved
         between folders keeps its place. */
      return { ids: index.ids.includes(imageId) ? index.ids : [imageId, ...ids], dates, folders: membership };
    }
    delete membership[imageId];
    delete dates[imageId];
    return { ids, dates, folders: membership };
  });
  /* A cached folder must lose a removed picture even when its confirming read fails. Only
     already-loaded keys are written, and unknown membership never clears another folder. */
  const folderIds = new Set([
    ...(cached.folders[imageId] ?? []), ...(folders ?? []),
    ...(faveFolders.peek({ token }).data?.folders.map((folder) => folder.id) ?? []),
  ]);
  for (const folderId of folderIds) {
    const args = { token, folderId };
    const shown = faveIds.peek(args).data;
    if (!shown) continue;
    const shift = { before: shown.ids, after: shown.ids };
    // Several replies may land before the next paint. Derive from the current value, not its
    // last published snapshot, or a second removal can put the first picture back.
    faveIds.write(args, (previous) => {
      const page = previous ?? shown;
      const belongs = folders === null ? false : folders.length > 0 ? folders.includes(folderId) : page.ids.includes(imageId);
      const has = page.ids.includes(imageId);
      const ids = belongs ? (has ? page.ids : [imageId, ...page.ids]) : page.ids.filter((id) => id !== imageId);
      const membership = { ...page.folders };
      const dates = { ...page.dates };
      if (belongs) {
        membership[imageId] = [...(folders ?? [])];
        if (cached.dates[imageId]) dates[imageId] = cached.dates[imageId];
      } else {
        delete membership[imageId];
        delete dates[imageId];
      }
      shift.before = page.ids;
      shift.after = ids;
      return { ids, folders: membership, dates };
    });
    shiftPicturePages(shift.before, shift.after);
  }
}

/**
 * A folder's pages as pictures move with its ids. A grid page is one `favePictures` read, keyed
 * on the page's own ids, so a picture leaving page 1 makes page 1 a new key — every later id moves
 * up one place — and that key had nothing cached: the grid dimmed over the previous page and
 * waited a round trip for pictures it was already showing (M1-001). So a page that was read is
 * written again under its new ids from what the cache already holds, and the screen paints it at
 * once. An id no cached page answered is left out of the written page's ids as well as its
 * pictures, so the stand-in never counts it as missing.
 *
 * Whole, the stand-in is marked stale, and a quiet re-read lands underneath. A picture short — the
 * one shifted in from a page nobody read — it is left fresh instead, and the screen showing it
 * reads it for real (`useFavePage`): that read is what brings the picture, and a background
 * refresh's failure is silent by design, which left the page a picture short with nothing on
 * screen to say so and no 重试.
 */
function shiftPicturePages(before: readonly number[], after: readonly number[]) {
  if (before === after) return;
  const known = new Map<number, PonyImage>();
  const answered = new Set<number>();
  const read: boolean[] = [];
  for (let start = 0; start < before.length; start += FAVE_PAGE_SIZE) {
    const page = favePictures.peek({ ids: before.slice(start, start + FAVE_PAGE_SIZE) }).data;
    read.push(Boolean(page));
    if (!page) continue;
    for (const id of page.ids) answered.add(id);
    for (const image of page.images) known.set(image.id, image);
  }
  for (let start = 0, page = 0; start < after.length; start += FAVE_PAGE_SIZE, page += 1) {
    const ids = after.slice(start, start + FAVE_PAGE_SIZE);
    const was = before.slice(start, start + FAVE_PAGE_SIZE);
    if (!read[page] || (ids.length === was.length && ids.every((id, at) => id === was[at]))) continue;
    if (favePictures.peek({ ids }).data) continue;
    const covered = ids.filter((id) => answered.has(id));
    const images = covered.map((id) => known.get(id)).filter((image): image is PonyImage => image !== undefined);
    favePictures.write({ ids }, { ids: covered, images });
    if (covered.length === ids.length) favePictures.expire({ ids });
  }
}

/** The all-folders index, read fresh: a change about membership must start from the server's word. */
export async function freshIndex(token: string): Promise<FaveIndex> {
  requireSession(token);
  return faveIds.read({ token }, { force: true });
}

// ---------------------------------------------------------------------------
// One picture
// ---------------------------------------------------------------------------

/**
 * Favourite a picture into `folderId` (0: the main folder). One that the index on screen already
 * holds resolves without a request; otherwise `toggle_fave {saved: true}` — idempotent on the
 * server — and the folders it answers are written through.
 */
export async function favouriteImage(token: string, imageId: number, folderId: number): Promise<{ folders: number[] }> {
  requireSession(token);
  const index = await faveIds.read({ token });
  requireSession(token);
  if (index.ids.includes(imageId)) return { folders: index.folders[imageId] ?? [] };
  const { folders } = await api.setFaved(token, imageId, true, { folderId });
  writeMembership(token, imageId, folders, index);
  favouritesChanged(token);
  return { folders };
}

/**
 * Take a picture out of favourites altogether — every folder (`toggle_fave {saved: false}`).
 * Resolves with the folders it was in, for 撤销.
 */
export async function unfavouriteImage(token: string, imageId: number): Promise<{ previous: number[] }> {
  requireSession(token);
  const index = faveIds.peek({ token }).data ?? (await freshIndex(token));
  requireSession(token);
  const previous = index.folders[imageId] ?? [];
  await api.setFaved(token, imageId, false);
  writeMembership(token, imageId, null, index);
  favouritesChanged(token);
  return { previous };
}

/**
 * The folders a picture is in, exactly (`set_image_fave_folders`): the picker's 保存, a removal
 * from one folder, and 撤销. An empty list unfavourites it.
 */
export async function setImageFolders(token: string, imageId: number, folderIds: readonly number[]): Promise<number[]> {
  requireSession(token);
  const index = await faveIds.read({ token });
  requireSession(token);
  const folders = await api.setImageFaveFolders(token, imageId, folderIds);
  writeMembership(token, imageId, folders.length > 0 ? folders : null, index);
  favouritesChanged(token);
  return folders;
}

/** Undo a removal: back into the folders it was in, or into the default folder when that is not known. */
export async function restoreFavourite(token: string, imageId: number, previous: readonly number[], fallbackFolder: number) {
  if (previous.length > 0 && previous.every((id) => id > 0)) return setImageFolders(token, imageId, previous);
  return (await favouriteImage(token, imageId, fallbackFolder)).folders;
}

// ---------------------------------------------------------------------------
// Several pictures
// ---------------------------------------------------------------------------

export interface BatchOutcome {
  succeeded: number[];
  failed: { id: number; error: unknown }[];
  /** Folders each picture was in before, for 撤销. */
  previous: Map<number, number[]>;
}

/**
 * Detach pictures from one folder. A picture in no other folder leaves favourites altogether —
 * the backend's rule for an empty folder list. One request a picture, in order; the caller may
 * stop between them.
 */
export interface RunOptions {
  signal?: AbortSignal;
  /** Heard after each picture, done or failed. */
  onProgress?: (done: number, total: number) => void;
}

export async function removeFromFolder(
  token: string,
  imageIds: readonly number[],
  folderId: number,
  { signal, onProgress }: RunOptions = {},
): Promise<BatchOutcome> {
  const index = await freshIndex(token);
  const outcome: BatchOutcome = { succeeded: [], failed: [], previous: new Map() };
  for (const id of imageIds) {
    if (signal?.aborted || readToken() !== token) break;
    const before = index.folders[id];
    try {
      /* Not in the fresh index: it left favourites since the screen was drawn. */
      if (!before) throw new ApiError('invalid', { message: '该图片已不在收藏中，请刷新后再试', retryable: false });
      const after = await api.setImageFaveFolders(token, id, before.filter((folder) => folder !== folderId));
      writeMembership(token, id, after.length > 0 ? after : null, index);
      outcome.previous.set(id, before);
      outcome.succeeded.push(id);
    } catch (error) {
      outcome.failed.push({ id, error });
    }
    onProgress?.(outcome.succeeded.length + outcome.failed.length, imageIds.length);
  }
  favouritesChanged(token, { acknowledged: outcome.succeeded.length > 0 });
  return outcome;
}

/** The account's folder names, from the list on screen — a transfer's answer names folders by id. */
function folderNames(token: string): Map<number, string> {
  return new Map((faveFolders.peek({ token }).data?.folders ?? []).map((folder) => [folder.id, folder.name]));
}

/** Move or copy pictures of one folder into others (`batch_transfer_faves`). */
export async function transferPictures(
  token: string,
  request: { imageIds: readonly number[]; sourceFolderId: number; targetFolderIds: readonly number[]; mode: TransferMode },
): Promise<TransferResult> {
  requireSession(token);
  const result = await api.batchTransferFaves(token, { ...request, folderNames: folderNames(token) });
  favouritesChanged(token);
  return result;
}

/** Move or copy pictures of the privacy space into ordinary folders (`batch_transfer_privacy_faves`). */
export async function transferFromPrivacy(
  token: string,
  request: { imageIds: readonly number[]; targetFolderIds: readonly number[]; mode: TransferMode },
): Promise<TransferResult> {
  requireSession(token);
  const result = await api.batchTransferPrivacyFaves(token, { ...request, folderNames: folderNames(token) });
  favouritesChanged(token);
  return result;
}

/** The space has no password yet: nothing can be moved into it until one is set. */
export class NoPrivacyPasswordError extends Error {
  constructor() {
    super('请先进入隐私空间设置密码');
    this.name = 'NoPrivacyPasswordError';
  }
}

/**
 * Move pictures into the privacy space — the original front end's `moveToPrivacyFaves`: the space
 * must have a password, then for each picture `add_privacy_fave` with its record and, once that
 * landed, `toggle_fave {saved: false}`. In order; the caller may stop between pictures.
 */
export async function moveToPrivacy(
  token: string,
  images: readonly PonyImage[],
  { signal, onProgress }: RunOptions = {},
): Promise<BatchOutcome & { added: number[] }> {
  requireSession(token);
  const { hasPassword } = await api.checkHasPrivacyPassword(token, signal);
  if (!hasPassword) throw new NoPrivacyPasswordError();
  const index = faveIds.peek({ token }).data ?? (await freshIndex(token));
  const outcome: BatchOutcome & { added: number[] } = { succeeded: [], failed: [], previous: new Map(), added: [] };
  for (const image of images) {
    if (signal?.aborted || readToken() !== token) break;
    try {
      await api.addPrivacyFave(token, image);
      outcome.added.push(image.id);
      requireSession(token);
      await api.setFaved(token, image.id, false);
      outcome.previous.set(image.id, index.folders[image.id] ?? []);
      writeMembership(token, image.id, null, index);
      outcome.succeeded.push(image.id);
    } catch (error) {
      outcome.failed.push({ id: image.id, error: outcome.added.includes(image.id)
        ? new ApiError('invalid', { message: `已存入隐私空间，原收藏未能移除：${apiErrorMessage(error)}`, retryable: false, cause: error })
        : error });
    }
    onProgress?.(outcome.succeeded.length + outcome.failed.length, images.length);
  }
  favouritesChanged(token, { acknowledged: outcome.added.length > 0 });
  return outcome;
}

/** How many pictures one import request carries (`batch_add_faves` takes up to 1,000; smaller keeps progress moving). */
export const IMPORT_BATCH = 100;

/**
 * Import pictures into `folderId` (0: the main folder) — 导入本页到云端. The fresh index's
 * pictures are skipped; the rest go in `IMPORT_BATCH`-sized `batch_add_faves` requests, in order,
 * and `onProgress` hears each batch. A refused batch fails every picture in it; a dead session
 * stops the run.
 */
export async function importFavourites(
  token: string,
  imageIds: readonly number[],
  folderId: number,
  { signal, onProgress }: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ imported: number[]; skipped: number[]; failed: { id: number; error: unknown }[] }> {
  const index = await freshIndex(token);
  const known = new Set(index.ids);
  const unique = [...new Set(imageIds)];
  const wanted = unique.filter((id) => !known.has(id));
  const result = { imported: [] as number[], skipped: unique.filter((id) => known.has(id)), failed: [] as { id: number; error: unknown }[] };
  for (let start = 0; start < wanted.length; start += IMPORT_BATCH) {
    if (signal?.aborted || readToken() !== token) break;
    const batch = wanted.slice(start, start + IMPORT_BATCH);
    try {
      const answer = await api.batchAddFaves(token, batch, folderId);
      for (const id of batch) writeMembership(token, id, [answer.folderId], index);
      result.imported.push(...batch);
    } catch (error) {
      result.failed.push(...batch.map((id) => ({ id, error })));
      if (error instanceof ApiError && error.status === 401) break;
    }
    onProgress?.(Math.min(start + batch.length, wanted.length), wanted.length);
  }
  favouritesChanged(token, { acknowledged: result.imported.length > 0 });
  return result;
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

/** Create a folder and resolve with it, as the re-read list has it. */
export async function createFolder(token: string, name: string): Promise<api.FaveFolder | null> {
  requireSession(token);
  const { id } = await api.createFaveFolder(token, name);
  requireSession(token);
  const list = await faveFolders.read({ token }, { force: true }).catch(() => null);
  requireSession(token);
  favouritesChanged(token, { folders: false });
  if (!list) return null;
  return list.folders.find((folder) => folder.id === id) ?? null;
}

/**
 * The settings a folder's removal makes false: the default folder — which becomes `successor`
 * (a merge's target) or none, the main folder — and the public list.
 *
 * **Read when they are rewritten, not when the dialog asked** (G3-007). The public list is
 * rewritten whole, so a copy taken before a confirmation — or before the request — put back a
 * change that landed meanwhile: a folder made public in another tab, or adopted from the account
 * by the settings sync, went hidden again when an unrelated folder was deleted.
 */
function forgetFolders(removed: readonly number[], successor: DefaultFolder = NO_DEFAULT_FOLDER) {
  if (removed.includes(readFavouriteSetting('defaultFaveFolder').id)) changeSyncedSetting('defaultFaveFolder', successor);
  const publicIds = readFavouriteSetting('publicFaveFolderIds');
  if (publicIds && publicIds.some((id) => removed.includes(id))) {
    changeSyncedSetting('publicFaveFolderIds', publicIds.filter((id) => !removed.includes(id)));
  }
}

/**
 * The folder list without what a deletion or a merge took away, written at once from the answer
 * the screen already has, so the cards leave as the request lands rather than a re-read later.
 * The re-read still follows (`favouritesChanged`) and corrects the counts.
 */
function dropFolders(token: string, removed: readonly number[]) {
  const shown = faveFolders.peek({ token }).data;
  if (readToken() !== token || !shown) return;
  faveFolders.write({ token }, (current) => {
    const list = current ?? shown;
    return { ...list, folders: list.folders.filter((folder) => !removed.includes(folder.id)) };
  });
}

/** Delete folders. The settings that name them are read when they are rewritten (`forgetFolders`). */
export async function deleteFolders(token: string, folderIds: readonly number[]): Promise<void> {
  requireSession(token);
  await api.deleteFaveFolders(token, folderIds);
  if (readToken() === token) {
    forgetFolders(folderIds);
    dropFolders(token, folderIds);
  }
  favouritesChanged(token);
}

/** Merge folders into one of them; a default folder merged away hands its role to the target. */
export async function mergeFolders(token: string, sourceIds: readonly number[], target: DefaultFolder): Promise<void> {
  requireSession(token);
  await api.mergeFaveFolders(token, sourceIds, target.id);
  if (readToken() === token) {
    forgetFolders(sourceIds, target);
    dropFolders(token, sourceIds);
  }
  favouritesChanged(token);
}
