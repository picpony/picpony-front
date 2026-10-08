/**
 * Favourites, as the screens need them: where each one lives, what a page of favourites shows
 * after the device's content settings, the words a batch move ends with, which folder a tap on
 * 收藏 fills, and when a new favourite goes to the privacy space instead.
 *
 * Plain module — no `'use client'`, no React — so the tests and any screen can reach it. The
 * backend contract is `lib/api/favorites.ts`; the caches are the favourites region of
 * `lib/resources.ts`; the privacy space's unlocked state is `lib/favoritesPrivacy.ts`.
 */

import type { FaveFolder, TransferMode, TransferResult } from '@/lib/api/favorites';
import type { PonyImage } from '@/lib/types/image';
import { isWithheldBy } from '@/lib/imageFilters';
import type { BlockFilters } from '@/lib/blockFilters';
import type { QuerySettings } from '@/lib/searchQuery';

/** One page of a favourites grid: one Derpibooru lookup (its page size is fifty). */
export const FAVE_PAGE_SIZE = 50;

export const MAIN_FOLDER_NAME = '主收藏夹';
const UNNAMED_FOLDER = '未命名收藏夹';

/** A folder's name as it is shown: the main folder keeps its name when the row carries none. */
export function folderLabel(folder: { name: string; isMain: boolean }): string {
  return folder.name || (folder.isMain ? MAIN_FOLDER_NAME : UNNAMED_FOLDER);
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

export type FavoritesTab = 'folders' | 'derpibooru' | 'privacy';

export function isFavoritesTab(value: unknown): value is FavoritesTab {
  return value === 'folders' || value === 'derpibooru' || value === 'privacy';
}

/** /favorites on a tab; the bare address is 收藏夹. */
export function favoritesHref(tab?: FavoritesTab): string {
  return tab && tab !== 'folders' ? `/favorites?tab=${tab}` : '/favorites';
}

/** One of your own folders. */
export function faveFolderHref(folderId: number, page = 1): string {
  return page > 1 ? `/favorites/folder/${folderId}?page=${page}` : `/favorites/folder/${folderId}`;
}

/** Somebody's public folder (0: their main one) — what a profile's 收藏夹 tab and a share card open. */
export function sharedFolderHref(username: string, folderId: number): string {
  return `/favorites/shared/${encodeURIComponent(username)}/${folderId}`;
}

/** Somebody's privacy space, behind its password — what a privacy share card opens. */
export function sharedPrivacyHref(ownerId: number): string {
  return `/favorites/privacy/${ownerId}`;
}

/** A `?page=` value, as a page number: anything but a positive whole number is page 1. */
export function pageParam(value: string | null | undefined): number {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 1 ? n : 1;
}

/**
 * The original front end's favourites links, as this app's routes — for a link saved or sent
 * before the move (its share cards and its 复制链接 copied these): a shared folder
 * (`#mode=shared_faves&user=<name>[&folder=<id>][&page=<n>]`), a shared privacy space
 * (`#shared_privacy:<ownerId>:<name>`) and the own favourites (`#mode=cloud_faves`). `null` for any
 * other fragment.
 */
export function legacyFavoritesHref(hash: string): string | null {
  const fragment = hash.replace(/^#/, '');
  const privacy = /^shared_privacy:(\d{1,10})(?::|$)/.exec(fragment);
  if (privacy) {
    const owner = Number(privacy[1]);
    return owner > 0 ? sharedPrivacyHref(owner) : null;
  }
  if (fragment.startsWith('mode=cloud_faves')) return favoritesHref();
  if (!fragment.startsWith('mode=shared_faves')) return null;
  const params = new URLSearchParams(fragment);
  const user = (params.get('user') ?? '').trim();
  if (!user) return null;
  const folder = Number(params.get('folder'));
  const href = sharedFolderHref(user, Number.isSafeInteger(folder) && folder > 0 ? folder : 0);
  const page = pageParam(params.get('page'));
  return page > 1 ? `${href}?page=${page}` : href;
}

// ---------------------------------------------------------------------------
// A page of favourites, after the device's settings (C11)
// ---------------------------------------------------------------------------

export interface FilteredPage {
  /** The page's pictures the device's settings let through, in the favourites' order. */
  images: PonyImage[];
  /** Pictures on the page the device's content settings withheld. */
  filtered: number;
  /** Pictures on the page Derpibooru no longer returns: deleted, or pulled from the site. */
  missing: number;
}

/**
 * Put a lookup's answer back in the favourites' order and apply the device's content settings —
 * the same rules every search writes into its query (`isWithheldBy`, built on
 * `excludedTagsFrom`). Done after the read rather than in it, so the page can say how many it
 * withheld and, separately, how many no longer exist (C11). A picture on the site's public
 * blacklist is pulled from favourites too, and counts as one that cannot be reached.
 */
export function withholdFromDevice(
  found: readonly PonyImage[],
  asked: readonly number[],
  settings: QuerySettings,
  filters: BlockFilters,
  blacklist: readonly number[] = [],
): FilteredPage {
  const pulled = new Set(blacklist);
  const byId = new Map(found.map((image) => [image.id, image]));
  const ordered: PonyImage[] = [];
  for (const id of asked) {
    const image = byId.get(id);
    if (image && !pulled.has(id)) ordered.push(image);
  }
  const images = ordered.filter((image) => !isWithheldBy(image.tags, settings, filters));
  return { images, filtered: ordered.length - images.length, missing: asked.length - ordered.length };
}

/** 本页有 3 张收藏因当前的内容筛选设置未显示，2 张已被删除或无法访问 */
export function withheldSentence(filtered: number, missing: number): string {
  if (filtered > 0 && missing > 0) {
    return `本页有 ${filtered} 张收藏因当前的内容筛选设置未显示，${missing} 张已被删除或无法访问`;
  }
  if (filtered > 0) return `本页有 ${filtered} 张收藏因当前的内容筛选设置未显示`;
  return `本页有 ${missing} 张收藏已被删除或无法访问`;
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const VERB: Record<TransferMode, string> = { move: '移动', copy: '复制' };

/**
 * What a batch move or copy ends with — the original front end's `formatCloudFaveTransferSummary`
 * in this app's register: per target folder, how many arrived and, when some did not, why (the
 * backend's own reasons). `partial` asks for the warning tone and its longer dwell.
 */
export function transferSummary(
  result: TransferResult,
  mode: TransferMode,
  count: number,
): { text: string; partial: boolean } {
  const verb = VERB[mode];
  if (result.targets.length === 0) {
    const done = result.affected ?? count;
    return { text: `已${verb} ${done} 张${done < count ? `，${count - done} 张未完成` : ''}`, partial: done < count };
  }
  const partial = result.targets.some((target) => target.failed > 0 || target.succeeded < target.requested);
  if (!partial) {
    const names = result.targets.map((target) => `「${target.folderName || '收藏夹'}」`);
    const where = names.length <= 3 ? names.join('') : `${names.length} 个收藏夹`;
    const counts = new Set(result.targets.map((target) => target.succeeded));
    if (counts.size === 1) return { text: `已${verb} ${result.targets[0].succeeded} 张到${where}`, partial: false };
  }
  const lines = result.targets.map((target) => {
    const name = `「${target.folderName || '收藏夹'}」`;
    const unfinished = Math.max(target.failed, target.requested - target.succeeded);
    if (unfinished === 0) return `${name}成功 ${target.succeeded} 张`;
    const reasons = Object.entries(target.reasons)
      .map(([reason, n]) => `${reason} ${n} 张`)
      .join('、');
    const shortfall = target.failed > 0 ? `失败 ${target.failed} 张` : `${unfinished} 张未完成`;
    return `${name}成功 ${target.succeeded} 张，${shortfall}${reasons ? `（${reasons}）` : ''}`;
  });
  return { text: `${verb}完成：${lines.join('；')}`, partial };
}

// ---------------------------------------------------------------------------
// Which folder a tap on 收藏 fills
// ---------------------------------------------------------------------------

export interface DefaultFolder {
  /** 0 when none is chosen: the backend's own default, the main folder. */
  id: number;
  name: string;
}

export const NO_DEFAULT_FOLDER: DefaultFolder = { id: 0, name: MAIN_FOLDER_NAME };

/**
 * The default folder as the folder list knows it: the stored one while it exists, otherwise the
 * main folder (the original front end's `updateDefaultFaveFolderLabel`). `corrected` says the
 * stored choice no longer names a folder of this account and should be written back.
 */
export function resolveDefaultFolder(
  folders: readonly FaveFolder[],
  stored: DefaultFolder,
): DefaultFolder & { corrected: boolean } {
  const chosen = stored.id > 0 ? folders.find((folder) => folder.id === stored.id) : undefined;
  if (chosen) {
    const name = folderLabel(chosen);
    return { id: chosen.id, name, corrected: name !== stored.name };
  }
  const main = folders.find((folder) => folder.isMain);
  if (!main) return { ...NO_DEFAULT_FOLDER, corrected: stored.id !== 0 || stored.name !== MAIN_FOLDER_NAME };
  return { id: main.id, name: folderLabel(main), corrected: true };
}

// ---------------------------------------------------------------------------
// Auto-privacy
// ---------------------------------------------------------------------------

/**
 * Whether a new favourite goes to the privacy space instead (`autoPrivacyFaves`) — exactly the
 * original front end's rule (`handleFaveClick`): a picture not yet favourited, the switch on,
 * the device on 开发者模式 (the one filter that shows explicit pictures), and the `explicit` tag.
 */
export function goesToPrivacySpace(input: {
  alreadyFaved: boolean;
  autoPrivacy: boolean;
  contentFilter: string;
  tags: readonly string[] | undefined;
}): boolean {
  if (input.alreadyFaved || !input.autoPrivacy || input.contentFilter !== 'developer') return false;
  return (input.tags ?? []).some((tag) => typeof tag === 'string' && tag.trim().toLowerCase() === 'explicit');
}

/** The unlock durations the privacy space offers, in seconds — the original front end's set. */
export const PRIVACY_UNLOCK_SECONDS = [15, 30, 60, 300, 600, 1800, 3600] as const;
export type PrivacyUnlockSeconds = (typeof PRIVACY_UNLOCK_SECONDS)[number];
export const DEFAULT_PRIVACY_UNLOCK_SECONDS: PrivacyUnlockSeconds = 15;

export function parseUnlockSeconds(value: unknown): PrivacyUnlockSeconds | undefined {
  const n = typeof value === 'string' ? Number.parseInt(value, 10) : Number(value);
  return (PRIVACY_UNLOCK_SECONDS as readonly number[]).includes(n) ? (n as PrivacyUnlockSeconds) : undefined;
}

/** 15 秒, 1 分钟, 1 小时 — the duration's label. */
export function unlockLabel(seconds: PrivacyUnlockSeconds): string {
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${seconds / 60} 分钟`;
  return `${seconds / 3600} 小时`;
}

// ---------------------------------------------------------------------------
// Settling a write
// ---------------------------------------------------------------------------

export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * A promise's outcome as a value, never a throw — so a screen can await a write and branch on the
 * answer without a `try` statement, which the React Compiler cannot lower inside a component
 * (a `finally` clause, or a conditional inside a `try`, makes it skip the whole component).
 */
export function settled<T>(work: Promise<T>): Promise<Settled<T>> {
  return work.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}
