'use client';

/**
 * Settings cloud sync: the account's copy of this app's preferences, adopted and written from
 * every screen — not only while /settings is open.
 *
 * ## The contract, as the backend has it
 *
 * `get_user` (and the public `get_user_profile`) carry the account's settings as one object,
 * `user.settings` (a JSON string on some rows), and `update_settings { settings }` **replaces**
 * the stored object whole; it does not merge. Measured on the live backend: no account holds both
 * a key only old versions of the original front end wrote (`videoPreview`) and one only its current
 * version writes (`hideIpLocation`), and the accounts this app's earlier one-key writes reached were
 * left holding that one key. The backend reads some keys itself: `hideIpLocation` makes the profile's
 * `ip_location` answer 该用户已隐藏 to everybody, the four `show*` close profile tabs to visitors, the
 * two `emailNotif*` drive the account's email columns (`email_notif_message` / `email_notif_reply`).
 *
 * So a write is always the whole object: the last cloud copy — keys this app does not manage (the
 * original front end's mascot settings, until that feature lands here) ride through untouched —
 * with this device's changes laid over it.
 *
 * ## When
 *
 * The engine starts once the app has mounted (`components/SettingsSync.tsx`, in the root layout)
 * and follows the session from then on. The cloud copy is adopted whenever the account is read:
 * `sessionUser`'s fetch calls `adoptCloudSettings`, which covers signing in (`establishSession`),
 * every load (the shell's own read) and every return to a tab left for a minute
 * (`bindResourceRefresh`). A change made here is stored at once and written after a short pause,
 * so a run of toggles costs one request.
 *
 * ## Which copy wins
 *
 * - **A local change the account has not confirmed is newer than any cloud copy.** Until its write
 *   succeeds it is *pending* — persisted, so a change made offline, or in a tab that closed before
 *   its write landed, is still pending on the next load — and a cloud read skips it.
 * - **A read that started before a local change cannot speak for it** (its answer may predate the
 *   change), so it is skipped for that key as well, even once the write has landed.
 * - Otherwise the cloud copy wins: signing in on a new device restores the account's settings, and a
 *   change made on another device arrives with the next read.
 * - Before writing, a cloud copy older than `BASE_MAX_AGE_MS` is read again, so a change another
 *   device made meanwhile is not written back over with the stale copy of it.
 * - A write that fails keeps the local value, says so **once** per run of failures (and the settings
 *   screen shows it in place), and is retried: when the network returns, when the tab comes back, on
 *   the next change or read, and on a backoff.
 *
 * ## Device settings and account settings
 *
 * Most entries describe how this device browses (the content filter, the lines, the sorts, the
 * palette): a device value survives signing out, and one the account has never stored is filled in
 * from the device on the next write. The privacy and email entries describe the **account**: signed
 * out they return to their defaults — a device must not carry one account's privacy choices into the
 * next account's writes — a key the account lacks reads as the backend's default, and they are
 * written only when changed here.
 *
 * ## Adding a setting
 *
 * One entry in `SYNCED_SETTINGS` below — `storedBoolean` / `storedChoice` cover a value kept in
 * `localStorage` — and the screen that shows it reads `useSyncedSetting(id)` and writes
 * `changeSyncedSetting(id, value)`. A value its own module writes calls `noteSettingChanged(id)`
 * after writing it (the palette and 配色方案 are noticed through `lib/appearance`'s subscription instead).
 * Nothing in /settings, the shell or the resource layer changes. The original front end's keys
 * are the contract: use its names.
 */

import { useMemo, useSyncExternalStore } from 'react';

import { COOKIE_KEYS, LS_KEYS } from './constants';
import { mascotSettings } from './mascot/settings';
import { readToken, readUserInfo, type StoredUserInfo } from './hooks';
import { updateSettings } from './api/picpony';
import { readEnvelope } from './api/http';
import { isAborted } from './api/errors';
import { syncLinePrefs } from './route';
import { parseSortField } from './searchQuery';
import { defaultSearchSort } from './searchState';
import { queueSettingsUpdate } from './settingsUpdates';
import {
  CUSTOM_PALETTE,
  DEFAULT_PALETTE,
  PALETTES,
  commitCustomPalette,
  commitPalette,
  commitPaletteHues,
  subscribeAppearance,
  type PaletteId,
} from './appearance';
import { isPaletteHues, parseAccent, parseCustomSpec, type AccentChoice, type PaletteHues } from './paletteSpec';
import {
  DEFAULT_PRIVACY_UNLOCK_SECONDS,
  MAIN_FOLDER_NAME,
  NO_DEFAULT_FOLDER,
  parseUnlockSeconds,
  type DefaultFolder,
} from './favorites';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** What a change needs beyond its own storage: the browsing cookie, or the request lines. */
export type SettingEffect = 'browsing' | 'lines';

type CloudObject = Record<string, unknown>;
type AccountRecord = Record<string, unknown>;

export interface SyncedSetting<T> {
  id: string;
  /** The keys it owns in the account's settings object. */
  cloudKeys: readonly string[];
  /** The value with nothing stored — also every server render's value. */
  fallback: T;
  /**
   * `device`: how this device browses; kept through signing out, filled into the account's copy
   * when the account lacks it. `account`: a fact about the account; reset on signing out, written
   * only when changed here.
   */
  scope: 'device' | 'account';
  read(): T;
  /** Store on this device. No events: the engine publishes once per batch. */
  write(value: T): void;
  /** The account's value, or `undefined` for "the account says nothing usable". */
  fromCloud(settings: CloudObject, account: AccountRecord): T | undefined;
  toCloud(value: T, base: CloudObject): CloudObject;
  equals(a: T, b: T): boolean;
  effects?: readonly SettingEffect[];
  /** A cookie it is mirrored into, for a first paint that depends on it (`StoredOptions.cookie`). */
  cookie?: string;
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function readStored(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Mirror a setting for the *next* document, so the server can paint with it; `null` clears it (the
 * fallback needs no cookie). Cookies blocked, only a cold load's first paint falls back.
 */
function mirrorCookie(name: string, value: string | null) {
  if (typeof document === 'undefined') return;
  try {
    document.cookie = value === null
      ? `${name}=;path=/;max-age=0;samesite=lax`
      : `${name}=${encodeURIComponent(value)};path=/;max-age=${COOKIE_MAX_AGE};samesite=lax`;
  } catch {
    /* The live setting still governs every render after the first. */
  }
}

function writeStored(key: string, value: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* Storage can be disabled: the value holds for this page, and the account keeps its copy. */
  }
}

/** A boolean as the backend and the original front end have written it: `true`, `1`, `"true"`. */
function cloudBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return undefined;
}

function same<T>(a: T, b: T): boolean {
  return a === b;
}

interface StoredOptions<T> {
  scope?: 'device' | 'account';
  effects?: readonly SettingEffect[];
  /** Where an account whose settings object lacks the key keeps the value instead (a column). */
  column?: (account: AccountRecord) => T | undefined;
  /**
   * A `COOKIE_KEYS` name the value is mirrored into on every install — a change, the account's copy
   * adopted, the reset on signing out — and once when the sync starts, for a device that stored it
   * before the mirror existed: for a server render that has to draw what the screen will show.
   */
  cookie?: string;
}

/** A switch kept in `localStorage` as `"true"` / `"false"`, under the key the original front end used. */
export function storedBoolean(
  id: string,
  storageKey: string,
  fallback: boolean,
  { scope = 'device', effects, column, cookie }: StoredOptions<boolean> = {},
): SyncedSetting<boolean> {
  return {
    id,
    cloudKeys: [id],
    fallback,
    scope,
    effects,
    cookie,
    read: () => {
      const raw = readStored(storageKey);
      return raw === 'true' ? true : raw === 'false' ? false : fallback;
    },
    write: (value) => {
      writeStored(storageKey, scope === 'account' && value === fallback ? null : String(value));
      if (cookie) mirrorCookie(cookie, value === fallback ? null : String(value));
    },
    fromCloud: (settings, account) => {
      const value = cloudBoolean(settings[id]);
      if (value !== undefined) return value;
      const fromColumn = column?.(account);
      if (fromColumn !== undefined) return fromColumn;
      /* An account setting the account has never stored is the backend's default, not whatever
         this device last held — which may be another account's. */
      return scope === 'account' ? fallback : undefined;
    },
    toCloud: (value) => ({ [id]: value }),
    equals: same,
  };
}

/** One of a fixed set of strings, normalised the same way on the way in from either side. */
export function storedChoice(
  id: string,
  storageKey: string,
  fallback: string,
  parse: (raw: unknown) => string | undefined,
  { scope = 'device', effects }: Omit<StoredOptions<string>, 'column'> = {},
): SyncedSetting<string> {
  return {
    id,
    cloudKeys: [id],
    fallback,
    scope,
    effects,
    read: () => parse(readStored(storageKey)) ?? fallback,
    write: (value) => writeStored(storageKey, value),
    fromCloud: (settings) => parse(settings[id]) ?? (scope === 'account' ? fallback : undefined),
    toCloud: (value) => ({ [id]: value }),
    equals: same,
  };
}

// ---------------------------------------------------------------------------
// The content filter's gate
// ---------------------------------------------------------------------------

/** 中等限制 (spoilers) is for accounts whose saved birthday makes them at least this old. */
export const SPOILERS_MIN_AGE = 16;

const DAY_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * Whole years since a `YYYY-MM-DD` birthday, on the Beijing calendar (the one the backend's dates
 * and every date this app prints are on), or `null` when it is not a real date.
 */
export function ageFrom(birthday: unknown, now: number = Date.now()): number | null {
  if (typeof birthday !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthday.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const today = new Date(now + DAY_OFFSET_MS);
  let age = today.getUTCFullYear() - year;
  const months = today.getUTCMonth() + 1 - month;
  if (months < 0 || (months === 0 && today.getUTCDate() < day)) age -= 1;
  return age;
}

/** Today on the Beijing calendar as `YYYY-MM-DD` — a birthday field's `max`. */
export function todayOnBeijingCalendar(now: number = Date.now()): string {
  return new Date(now + DAY_OFFSET_MS).toISOString().slice(0, 10);
}

/** Whether this device has developer mode on — the one thing that makes 开发者模式 selectable. */
export function developerModeEnabled(): boolean {
  return readStored(LS_KEYS.developer) === 'true';
}

/**
 * Why 中等限制 cannot be chosen right now, or `null` when it can. `account` is the saved record:
 * a birthday typed into the profile editor and not yet saved unlocks nothing.
 */
export function spoilersBlockedBy(account: AccountRecord | null): 'signed-out' | 'no-birthday' | 'too-young' | null {
  if (!account) return 'signed-out';
  const age = ageFrom(account.birthday);
  if (age === null) return 'no-birthday';
  return age < SPOILERS_MIN_AGE ? 'too-young' : null;
}

/**
 * The filter a device may actually use: the gate the original front end applied at every load.
 * The developer filter also needs a signed-in account, so a developer flag left behind by an
 * earlier session can never let a signed-out visitor keep it.
 */
function gatedContentFilter(value: string, account: AccountRecord | null): string {
  if (value === 'spoilers' && spoilersBlockedBy(account) !== null) return 'safe';
  if (value === 'developer' && (!account || !developerModeEnabled())) return 'safe';
  return value;
}

/** A full account record — a sign-in response carries only a few fields until `get_user` lands. */
const isFullRecord = (account: AccountRecord | null) => !account || 'birthday' in account;

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

const BUILT_IN_PALETTES: readonly string[] = PALETTES.map((palette) => palette.id);

interface PaletteChoice {
  id: PaletteId;
  seed: string | null;
  /** The custom palette's 副色相 — `null` for 自动, and for a built-in theme. */
  accent: AccentChoice;
}

function seedOf(value: unknown): string | null {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
}

/**
 * 主题配色, as the original front end's `theme`. Its ten character themes are this app's ten
 * palettes, id for id; its `auto` (the default in light, 露娜 in dark) has no palette that changes
 * with the scheme, so it reads as the default — and is written back as `auto` while the default is
 * what is chosen, so a visit here does not rewrite a choice that still means the same. The custom
 * palette travels as `custom` plus its seed in `themeCustomSeed` and its 副色相 in
 * `themeCustomAccent` (`null` for 自动, written out so an older choice cannot ride through a
 * change back to 自动): the original front end shows its default for a theme it does not know,
 * and keeps the values when it next writes.
 *
 * 配色方案 travels beside it (`paletteHuesSetting`), as part of what "my theme" means. The other
 * four appearance preferences stay on the device: they describe the screen (its lighting, its
 * motion budget), not the person.
 */
let paletteVersion = 0;
const paletteSetting: SyncedSetting<PaletteChoice> = {
  id: 'palette',
  cloudKeys: ['theme'],
  fallback: { id: DEFAULT_PALETTE, seed: null, accent: null },
  scope: 'device',
  /* The *stored* choice, not the attribute in force: restoring a custom palette whose cookie was
     lost (`recoverCustomPalette`) changes what is painted, not what was chosen, and must not read
     as a change to send. */
  read: () => {
    const stored = readStored(LS_KEYS.palette);
    const spec = parseCustomSpec(readStored(LS_KEYS.paletteCustom));
    if (stored === CUSTOM_PALETTE && spec) return { id: CUSTOM_PALETTE, seed: spec.seed, accent: spec.accent };
    return {
      id: stored && BUILT_IN_PALETTES.includes(stored) ? (stored as PaletteId) : DEFAULT_PALETTE,
      seed: null,
      accent: null,
    };
  },
  write: (value) => {
    const version = ++paletteVersion;
    const token = readToken();
    if (value.id !== CUSTOM_PALETTE) {
      adopting(() => commitPalette(value.id));
      return;
    }
    const seed = value.seed;
    if (!seed) return;
    const asked = Date.now();
    void import('./paletteLazy')
      .then(({ resolveCustomPalette }) => resolveCustomPalette({ seed, accent: value.accent }))
      .then((install) => {
        /* The user picked something else while the recipe was on its way: theirs is newer. */
        if (!install || version !== paletteVersion || readToken() !== token
          || (changedAt.get('palette') ?? 0) >= asked) return;
        adopting(() => commitCustomPalette(install));
      })
      .catch(() => {
        /* The recipe chunk failed; the palette on screen stays, as it would have anyway. */
      });
  },
  fromCloud: (settings) => {
    const theme = settings.theme;
    if (theme === 'auto') return { id: DEFAULT_PALETTE, seed: null, accent: null };
    if (theme === CUSTOM_PALETTE) {
      const seed = seedOf(settings.themeCustomSeed);
      return seed ? { id: CUSTOM_PALETTE, seed, accent: parseAccent(settings.themeCustomAccent) ?? null } : undefined;
    }
    return typeof theme === 'string' && BUILT_IN_PALETTES.includes(theme)
      ? { id: theme as PaletteId, seed: null, accent: null }
      : undefined;
  },
  toCloud: (value, base) => {
    if (value.id === CUSTOM_PALETTE) {
      return { theme: CUSTOM_PALETTE, themeCustomSeed: value.seed, themeCustomAccent: value.accent };
    }
    if (value.id === DEFAULT_PALETTE && base.theme === 'auto') return { theme: 'auto' };
    return { theme: value.id };
  },
  equals: (a, b) => a.id === b.id && (a.id !== CUSTOM_PALETTE || (a.seed === b.seed && a.accent === b.accent)),
};

/**
 * 配色方案, as `themeHues` — this app's own key; the original front end has no such choice and
 * keeps the value when it next writes. With the palette, it is what "my theme" means, so it
 * follows the account the same way: a device value, filled into an account that has none.
 */
const paletteHuesSetting: SyncedSetting<PaletteHues> = {
  id: 'paletteHues',
  cloudKeys: ['themeHues'],
  fallback: 'multi',
  scope: 'device',
  read: () => (readStored(LS_KEYS.paletteHues) === 'mono' ? 'mono' : 'multi'),
  write: (value) => adopting(() => commitPaletteHues(value)),
  fromCloud: (settings) => (isPaletteHues(settings.themeHues) ? settings.themeHues : undefined),
  toCloud: (value) => ({ themeHues: value }),
  equals: (a, b) => a === b,
};

const contentFilterSetting: SyncedSetting<string> = {
  ...storedChoice('contentFilter', LS_KEYS.contentFilter, 'safe', (raw) =>
    raw === 'safe' || raw === 'spoilers' || raw === 'developer' ? raw : undefined, { effects: ['browsing'] }),
  /* The gate the original front end applied to a restored filter: 中等限制 needs a saved birthday
     that makes the account 16, 开发者模式 needs developer mode on this device. The account's own
     value is left as it is — only a change made here writes the filter back. */
  fromCloud: (settings, account) => {
    const raw = settings.contentFilter;
    if (raw !== 'safe' && raw !== 'spoilers' && raw !== 'developer') return undefined;
    return gatedContentFilter(raw, account);
  },
};

/** The account's email columns, for a settings object written before it carried the two keys. */
const emailColumn = (name: string) => (account: AccountRecord) => cloudBoolean(account[name]);

/* Favourites. Every one is the account's: the folders are the account's, and so is the privacy
   space — a device must not carry one account's default folder or privacy switches into the next
   account's writes. Folder ids and names as the original front end wrote them. */

/** 默认收藏夹 — one entry owning both keys, so the id and the name it was shown under travel together. */
const defaultFaveFolderSetting: SyncedSetting<DefaultFolder> = {
  id: 'defaultFaveFolder',
  cloudKeys: ['defaultFaveFolderId', 'defaultFaveFolderName'],
  fallback: NO_DEFAULT_FOLDER,
  scope: 'account',
  read: () => {
    const id = Number.parseInt(readStored(LS_KEYS.defaultFaveFolderId) ?? '', 10);
    const name = readStored(LS_KEYS.defaultFaveFolderName)?.trim();
    return { id: Number.isSafeInteger(id) && id > 0 ? id : 0, name: name || MAIN_FOLDER_NAME };
  },
  write: (value) => {
    writeStored(LS_KEYS.defaultFaveFolderId, value.id > 0 ? String(value.id) : null);
    writeStored(LS_KEYS.defaultFaveFolderName, value.name && value.name !== MAIN_FOLDER_NAME ? value.name : null);
  },
  fromCloud: (settings) => {
    const named = typeof settings.defaultFaveFolderName === 'string' ? settings.defaultFaveFolderName.trim() : '';
    if (settings.defaultFaveFolderId === undefined && !named) return NO_DEFAULT_FOLDER;
    const id = Number.parseInt(String(settings.defaultFaveFolderId ?? ''), 10);
    return { id: Number.isSafeInteger(id) && id > 0 ? id : 0, name: named || MAIN_FOLDER_NAME };
  },
  toCloud: (value) => ({ defaultFaveFolderId: value.id, defaultFaveFolderName: value.name || MAIN_FOLDER_NAME }),
  equals: (a, b) => a.id === b.id && a.name === b.name,
};

function folderIdsOf(value: unknown): number[] | null | undefined {
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  return [...new Set(value.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
}

/** 在个人主页公开 — the folders a profile lists; `null` (written out, as the original did) is every one. */
const publicFaveFoldersSetting: SyncedSetting<number[] | null> = {
  id: 'publicFaveFolderIds',
  cloudKeys: ['publicFaveFolderIds'],
  fallback: null,
  scope: 'account',
  read: () => {
    try {
      return folderIdsOf(JSON.parse(readStored(LS_KEYS.publicFaveFolderIds) ?? 'null')) ?? null;
    } catch {
      return null;
    }
  },
  write: (value) => writeStored(LS_KEYS.publicFaveFolderIds, value === null ? null : JSON.stringify(value)),
  fromCloud: (settings) => folderIdsOf(settings.publicFaveFolderIds) ?? null,
  toCloud: (value) => ({ publicFaveFolderIds: value }),
  equals: (a, b) => a === b || (a !== null && b !== null && a.length === b.length && a.every((id) => b.includes(id))),
};

/** 解锁时长 — how long the privacy space stays unlocked once left; the original front end's seven steps. */
const privacyUnlockSetting: SyncedSetting<number> = {
  id: 'privacyUnlockDurationSeconds',
  cloudKeys: ['privacyUnlockDurationSeconds'],
  fallback: DEFAULT_PRIVACY_UNLOCK_SECONDS,
  scope: 'account',
  read: () => parseUnlockSeconds(readStored(LS_KEYS.privacyUnlockSeconds)) ?? DEFAULT_PRIVACY_UNLOCK_SECONDS,
  write: (value) =>
    writeStored(LS_KEYS.privacyUnlockSeconds, value === DEFAULT_PRIVACY_UNLOCK_SECONDS ? null : String(value)),
  fromCloud: (settings) => parseUnlockSeconds(settings.privacyUnlockDurationSeconds) ?? DEFAULT_PRIVACY_UNLOCK_SECONDS,
  toCloud: (value) => ({ privacyUnlockDurationSeconds: value }),
  equals: same,
};

/**
 * Every synced setting, including the mascot's device preferences and the original intro
 * preference, which uses the existing entrance-motion store and cookie.
 */
export const SYNCED_SETTINGS: readonly SyncedSetting<unknown>[] = [
  ...mascotSettings,
  contentFilterSetting,
  storedBoolean('banAnthro', LS_KEYS.banAnthro, false, { effects: ['browsing'] }),
  storedBoolean('banDiscomfort', LS_KEYS.banDiscomfort, true, { effects: ['browsing'] }),
  storedBoolean('onlyPony', LS_KEYS.onlyPony, false, { effects: ['browsing'] }),
  storedBoolean('showTagCounts', LS_KEYS.showTagCounts, false),
  storedBoolean('showChineseTags', LS_KEYS.showChineseTags, true),
  storedChoice('defaultHomeSort', LS_KEYS.homeSort, 'created_at',
    (raw) => (typeof raw === 'string' && raw ? parseSortField(raw) : undefined), { effects: ['browsing'] }),
  storedChoice('defaultSearchSort', LS_KEYS.searchSort, 'created_at',
    (raw) => (typeof raw === 'string' && raw ? defaultSearchSort(raw) : undefined)),
  storedBoolean('useCdn', LS_KEYS.useCdn, false, { effects: ['lines'] }),
  storedBoolean('usePicponyProxy', LS_KEYS.usePicponyProxy, true, { effects: ['lines'] }),
  storedBoolean('useApiAccel', LS_KEYS.useApiAccel, true, { effects: ['lines'] }),
  storedBoolean('useHongKongRelay', LS_KEYS.useHongKongRelay, true, { effects: ['lines'] }),
  paletteSetting,
  paletteHuesSetting,
  storedBoolean('showUploads', LS_KEYS.showUploads, true, { scope: 'account' }),
  storedBoolean('showFaves', LS_KEYS.showFaves, true, { scope: 'account' }),
  storedBoolean('showPosts', LS_KEYS.showPosts, true, { scope: 'account' }),
  storedBoolean('showComments', LS_KEYS.showComments, true, { scope: 'account' }),
  storedBoolean('hideIpLocation', LS_KEYS.hideIpLocation, false, { scope: 'account' }),
  storedBoolean('emailNotifMessage', LS_KEYS.emailNotifMessage, true,
    { scope: 'account', column: emailColumn('email_notif_message') }),
  storedBoolean('emailNotifReply', LS_KEYS.emailNotifReply, true,
    { scope: 'account', column: emailColumn('email_notif_reply') }),
  storedBoolean('defaultFaveToMain', LS_KEYS.defaultFaveToMain, true, { scope: 'account' }),
  defaultFaveFolderSetting,
  publicFaveFoldersSetting,
  storedBoolean('showPrivacyFaves', LS_KEYS.showPrivacyFaves, false, { scope: 'account', cookie: COOKIE_KEYS.showPrivacyFaves }),
  storedBoolean('autoPrivacyFaves', LS_KEYS.autoPrivacyFaves, true, { scope: 'account' }),
  privacyUnlockSetting,
];

/** The ids `SYNCED_SETTINGS` holds, with the value each one carries. */
export interface SyncedValues {
  contentFilter: string;
  banAnthro: boolean;
  banDiscomfort: boolean;
  onlyPony: boolean;
  showTagCounts: boolean;
  showChineseTags: boolean;
  defaultHomeSort: string;
  defaultSearchSort: string;
  useCdn: boolean;
  usePicponyProxy: boolean;
  useApiAccel: boolean;
  useHongKongRelay: boolean;
  palette: PaletteChoice;
  paletteHues: PaletteHues;
  showUploads: boolean;
  showFaves: boolean;
  showPosts: boolean;
  showComments: boolean;
  hideIpLocation: boolean;
  emailNotifMessage: boolean;
  emailNotifReply: boolean;
  defaultFaveToMain: boolean;
  defaultFaveFolder: DefaultFolder;
  publicFaveFolderIds: number[] | null;
  showPrivacyFaves: boolean;
  autoPrivacyFaves: boolean;
  privacyUnlockDurationSeconds: number;
}
export type SyncedId = keyof SyncedValues;

function entryOf<K extends SyncedId>(id: K): SyncedSetting<SyncedValues[K]> {
  const entry = SYNCED_SETTINGS.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Unknown synced setting: ${id}`);
  return entry as unknown as SyncedSetting<SyncedValues[K]>;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** How long a debounced write waits for the next toggle. */
const WRITE_DELAY_MS = 600;
/** A cloud copy older than this is read again before it becomes the base of a write. */
const BASE_MAX_AGE_MS = 60_000;
const RETRY_BASE_MS = 15_000;
const RETRY_MAX_MS = 5 * 60_000;

export interface SettingsSyncBridge {
  /** Read the account again, bypassing the cache; `adoptCloudSettings` runs on its answer. */
  refreshSession(token: string): Promise<unknown>;
  /** Our own write landed: the cached account now carries this settings object. */
  writeSession(token: string, settings: CloudObject): void;
  /** The browsing fingerprint's inputs moved: mirror the cookie the server keys its feed on. */
  afterBrowsingChange(): void;
}

let bridge: SettingsSyncBridge | null = null;

/** The session the state below belongs to. */
let session: { token: string; account: string } | null = null;
/** The account's latest cloud copy: its settings, and when the read that produced it started. */
let base: { token: string; settings: CloudObject; startedAt: number; at: number } | null = null;
/** When each setting last changed on this device, confirmed or not. */
const changedAt = new Map<string, number>();
/** Changes the account has not confirmed: id → when it was made. Persisted per account. */
let pending = new Map<string, number>();

export type SettingsSyncState = 'idle' | 'saving' | 'failed';
let state: SettingsSyncState = 'idle';
let failures = 0;
let flushing = false;
let flushAgain = false;
let timer: ReturnType<typeof setTimeout> | null = null;
const stateListeners = new Set<() => void>();

/**
 * The palette and 配色方案 are written by their own module (`changePalette` / `changePaletteHues`,
 * through the theme wipe), so a change made here is seen through `lib/appearance`'s subscription:
 * a stored choice that differs from the last one seen is a change to send — unless this engine is
 * the one adopting it.
 */
const APPEARANCE_ENTRIES = [paletteSetting, paletteHuesSetting] as readonly SyncedSetting<unknown>[];
const lastSeen = new Map<string, unknown>();
let adoptingAppearance = false;

function rememberAppearance() {
  for (const entry of APPEARANCE_ENTRIES) lastSeen.set(entry.id, entry.read());
}

function adopting(commit: () => void) {
  adoptingAppearance = true;
  try {
    commit();
  } finally {
    adoptingAppearance = false;
    rememberAppearance();
  }
}

function appearanceMaybeChanged() {
  if (adoptingAppearance) return;
  for (const entry of APPEARANCE_ENTRIES) {
    const now = entry.read();
    if (lastSeen.has(entry.id) && entry.equals(now, lastSeen.get(entry.id))) continue;
    lastSeen.set(entry.id, now);
    markChanged(entry.id);
  }
}

type Notifier = (message: string) => void;
let notifier: Notifier = (message) => {
  void import('@/components/Toast')
    .then(({ showToast }) => showToast(message, 'warning'))
    .catch(() => {});
};

/** One notice per run of failures — the settings screen also shows it where the change was made. */
export const SYNC_FAILED_MESSAGE = '设置已保存在本设备，同步到账号失败';

/** For tests, and for a screen that wants to own the notice. */
export function setSettingsSyncNotifier(next: Notifier) {
  notifier = next;
}

function setState(next: SettingsSyncState) {
  if (state === next) return;
  state = next;
  for (const listener of stateListeners) listener();
}

function accountOf(user: StoredUserInfo): string {
  const id = user.id ?? user.username;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : '';
}

function loadPending(account: string): Map<string, number> {
  try {
    const record: unknown = JSON.parse(readStored(LS_KEYS.settingsSyncPending) ?? 'null');
    if (!record || typeof record !== 'object') return new Map();
    const { account: owner, pending: entries } = record as { account?: unknown; pending?: unknown };
    if (owner !== account || !entries || typeof entries !== 'object') return new Map();
    const known = new Set(SYNCED_SETTINGS.map((entry) => entry.id));
    return new Map(
      Object.entries(entries as Record<string, unknown>).filter(
        (pair): pair is [string, number] => known.has(pair[0]) && typeof pair[1] === 'number',
      ),
    );
  } catch {
    return new Map();
  }
}

function persistPending() {
  if (!session || pending.size === 0) {
    writeStored(LS_KEYS.settingsSyncPending, null);
    return;
  }
  writeStored(
    LS_KEYS.settingsSyncPending,
    JSON.stringify({ account: session.account, pending: Object.fromEntries(pending) }),
  );
}

function clearTimer() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

/** Tell every reader once: storage-backed readers listen for this event, the fingerprint too. */
function publish(effects: Iterable<SettingEffect>) {
  const needed = new Set(effects);
  if (needed.has('lines')) syncLinePrefs();
  if (needed.has('browsing')) bridge?.afterBrowsingChange();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('settings_updated'));
}

/**
 * Put the content filter back inside its gate: signing out drops 中等限制, and so does a saved
 * birthday that no longer allows it. Returns whether anything changed; the caller publishes.
 */
function gateLocalContentFilter(account: AccountRecord | null): boolean {
  if (!isFullRecord(account)) return false;
  const current = contentFilterSetting.read();
  const allowed = gatedContentFilter(current, account);
  if (allowed === current) return false;
  contentFilterSetting.write(allowed);
  return true;
}

/**
 * Re-check the content filter against the saved account — after the profile editor saves a
 * birthday, for one. Publishes when it had to change.
 */
export function enforceContentGate(account: AccountRecord | null = readUserInfo()) {
  if (gateLocalContentFilter(account)) publish(['browsing']);
}

/** The backend's word on developer mode, mirrored the way the original front end did it. */
function mirrorDeveloperState(value: unknown): boolean {
  const on = cloudBoolean(value);
  if (on === undefined || on === developerModeEnabled()) return false;
  writeStored(LS_KEYS.developer, on ? 'true' : null);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('developer_mode_changed'));
  return true;
}

function parseSettingsObject(value: unknown): CloudObject {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return {};
    }
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...(parsed as CloudObject) } : {};
}

// ---------------------------------------------------------------------------
// The session
// ---------------------------------------------------------------------------

/** Follow the stored session: a new account starts clean; signing out resets account settings. */
function sessionChanged() {
  const user = readUserInfo();
  const next = user ? { token: user.token, account: accountOf(user) } : null;
  if (next?.token === session?.token) {
    /* Same session, a new record (a profile save, the shell's merge): the gate may have moved. */
    enforceContentGate(user);
    return;
  }
  clearTimer();
  paletteVersion += 1;
  flushAgain = false;
  base = null;
  changedAt.clear();
  failures = 0;
  setState('idle');
  const previous = session;
  session = next;
  if (previous && previous.account !== next?.account) {
    /* The previous account's unconfirmed changes leave with it. */
    pending = new Map();
    writeStored(LS_KEYS.settingsSyncPending, null);
  }
  pending = next ? loadPending(next.account) : new Map();
  const effects = new Set<SettingEffect>();
  if (!next) {
    /* Developer mode is the account's, not the device's: the backend grants it per account
       (`is_developer`), and a signed-out visitor is not a developer. The original front end kept
       the flag through a sign-out, so the developer filter stayed on for whoever used the device
       next. The gate below then puts the filter back to 完全安全. */
    mirrorDeveloperState(false);
    for (const entry of SYNCED_SETTINGS) {
      if (entry.scope !== 'account' || entry.equals(entry.read(), entry.fallback)) continue;
      entry.write(entry.fallback);
      entry.effects?.forEach((effect) => effects.add(effect));
    }
  }
  const gated = gateLocalContentFilter(user);
  if (gated) effects.add('browsing');
  if (gated || effects.size || !next) publish(effects);
}

/**
 * The account's settings, as a read of it answered. `startedAt` is when that read was *sent* — a
 * change made after it is newer than anything it can say.
 */
export function adoptCloudSettings(token: string, user: AccountRecord, startedAt: number) {
  if (typeof window === 'undefined' || readToken() !== token) return;
  if (session?.token !== token) sessionChanged();
  /* A record with no `settings` field at all says nothing about them — unlike `null`, which is
     an account that has never stored any. Writing on top of "nothing" would erase every key this
     app does not manage, so without a copy there is no base, and a write waits for one. */
  if (!('settings' in user)) return;
  const settings = parseSettingsObject(user.settings);
  base = { token, settings, startedAt, at: Date.now() };
  paletteVersion += 1;
  const effects = new Set<SettingEffect>();
  let changed = mirrorDeveloperState(user.is_developer);
  for (const entry of SYNCED_SETTINGS) {
    if (pending.has(entry.id) || (changedAt.get(entry.id) ?? 0) >= startedAt) continue;
    const next = entry.fromCloud(settings, user);
    if (next === undefined || entry.equals(next, entry.read())) continue;
    entry.write(next);
    changed = true;
    entry.effects?.forEach((effect) => effects.add(effect));
  }
  if (gateLocalContentFilter(user)) {
    changed = true;
    effects.add('browsing');
  }
  if (changed) publish(effects);
  if (pending.size) schedule(0);
}

// ---------------------------------------------------------------------------
// Local changes and the write
// ---------------------------------------------------------------------------

function markChanged(id: string) {
  const now = Date.now();
  changedAt.set(id, now);
  if (!session || readToken() !== session.token) return;
  pending.set(id, now);
  persistPending();
  schedule(WRITE_DELAY_MS);
}

/** Change a synced setting on this device and queue it for the account. */
export function changeSyncedSetting<K extends SyncedId>(id: K, value: SyncedValues[K]) {
  const entry = entryOf(id);
  if (entry.equals(value, entry.read())) return;
  entry.write(value);
  markChanged(id);
  publish(entry.effects ?? []);
}

/** A synced value its own module has already written (the palette, through the theme wipe). */
export function noteSettingChanged(id: SyncedId) {
  markChanged(id);
}

function schedule(delay: number) {
  if (flushing) {
    flushAgain = true;
    return;
  }
  clearTimer();
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, delay);
}

/** The object a write sends: the base, the changes made here, and device values the account lacks. */
function composePayload(settings: CloudObject, changed: ReadonlySet<string>): CloudObject {
  const payload: CloudObject = { ...settings };
  for (const entry of SYNCED_SETTINGS) {
    const lacking = entry.scope === 'device' && entry.cloudKeys.some((key) => !(key in settings));
    if (!changed.has(entry.id) && !lacking) continue;
    Object.assign(payload, entry.toCloud(entry.read(), settings));
  }
  return payload;
}

async function flush() {
  const token = session?.token;
  if (!token || readToken() !== token || pending.size === 0) {
    if (pending.size === 0) setState('idle');
    return;
  }
  flushing = true;
  flushAgain = false;
  setState('saving');
  try {
    if (!base || base.token !== token || Date.now() - base.at > BASE_MAX_AGE_MS) {
      await bridge?.refreshSession(token);
    }
    if (readToken() !== token) return;
    const current = base;
    if (!current || current.token !== token) throw new Error('云端设置读取失败');
    const sent = new Map(pending);
    const payload = composePayload(current.settings, new Set(sent.keys()));
    await queueSettingsUpdate(token, async () => {
      await readEnvelope(await updateSettings(token, { settings: payload }));
    });
    if (readToken() !== token) return;
    for (const [id, at] of sent) if (pending.get(id) === at) pending.delete(id);
    persistPending();
    base = { ...current, settings: payload, at: Date.now() };
    bridge?.writeSession(token, payload);
    failures = 0;
    setState(pending.size ? 'saving' : 'idle');
    if (pending.size) flushAgain = true;
  } catch (error) {
    if (readToken() !== token || isAborted(error)) return;
    failures += 1;
    setState('failed');
    if (failures === 1) notifier(SYNC_FAILED_MESSAGE);
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (failures - 1)));
  } finally {
    flushing = false;
    if (flushAgain) {
      flushAgain = false;
      if (session && readToken() === session.token && pending.size) schedule(0);
    }
  }
}

/** Try the unconfirmed changes again now — the settings screen's 重试. */
export function retrySettingsSync() {
  if (pending.size) schedule(0);
}

function retrySoon() {
  if (state === 'failed' && pending.size) schedule(0);
}

/**
 * Connect the engine to the account read (`settingsSyncBridge`, beside `sessionUser`) and start
 * following the session and the network. The shell's `SettingsSync` calls it once it mounts —
 * never a module's evaluation, which the Node suites run under stubbed globals. Returns the unbind.
 */
export function bindSettingsSync(next: SettingsSyncBridge): () => void {
  bridge = next;
  if (typeof window === 'undefined') return () => {};
  const global = globalThis as { __picponySettingsSyncUnbind?: () => void };
  /* A hot reload evaluates this module again: the previous instance's listeners must go. */
  global.__picponySettingsSyncUnbind?.();
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === LS_KEYS.userInfo) sessionChanged();
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') retrySoon();
  };
  window.addEventListener('user_info_updated', sessionChanged);
  window.addEventListener('storage', onStorage);
  window.addEventListener('online', retrySoon);
  document.addEventListener('visibilitychange', onVisible);
  rememberAppearance();
  /* A device that stored a mirrored setting before its cookie existed gets the cookie now. */
  for (const entry of SYNCED_SETTINGS) {
    if (!entry.cookie) continue;
    const value = entry.read();
    mirrorCookie(entry.cookie, entry.equals(value, entry.fallback) ? null : String(value));
  }
  const stopPalette = subscribeAppearance(appearanceMaybeChanged);
  const unbind = () => {
    if (global.__picponySettingsSyncUnbind !== unbind) return;
    global.__picponySettingsSyncUnbind = undefined;
    window.removeEventListener('user_info_updated', sessionChanged);
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('online', retrySoon);
    document.removeEventListener('visibilitychange', onVisible);
    stopPalette();
    clearTimer();
  };
  global.__picponySettingsSyncUnbind = unbind;
  sessionChanged();
  return unbind;
}

// ---------------------------------------------------------------------------
// React
// ---------------------------------------------------------------------------

function subscribeValues(listener: () => void) {
  window.addEventListener('settings_updated', listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener('settings_updated', listener);
    window.removeEventListener('storage', listener);
  };
}

/**
 * A synced setting's value on this device, re-rendering on every change — here, from another
 * tab, or adopted from the account. Server renders see the fallback, and so does the hydration
 * pass; the stored value follows in the next render.
 */
export function useSyncedSetting<K extends SyncedId>(id: K): SyncedValues[K] {
  const entry = entryOf(id);
  const raw = useSyncExternalStore(
    subscribeValues,
    () => JSON.stringify(entry.read()),
    () => JSON.stringify(entry.fallback),
  );
  return useMemo(() => JSON.parse(raw) as SyncedValues[K], [raw]);
}

function subscribeState(listener: () => void) {
  stateListeners.add(listener);
  return () => {
    stateListeners.delete(listener);
  };
}

/** `failed` while a change made here has not reached the account after a failed attempt. */
export function useSettingsSyncState(): SettingsSyncState {
  return useSyncExternalStore(subscribeState, () => state, () => 'idle' as SettingsSyncState);
}

/** For tests: the engine's view, without React. */
export function settingsSyncSnapshot() {
  return {
    state,
    pending: Object.fromEntries(pending),
    base: base ? { ...base.settings } : null,
    account: session?.account ?? null,
  };
}
