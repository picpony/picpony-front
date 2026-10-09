/**
 * What a PicPony profile shows, decided once — the profile screen, its tab reads in
 * `lib/resources.ts` and `scripts/testProfiles.mjs` all read these.
 *
 * The rules are the original front end's (`openPicPonyProfile`), which the backend still assumes:
 *
 * - **A tab the owner hides is hidden from everyone else.** The owner's `settings.showUploads` /
 *   `showFaves` / `showPosts` / `showComments` travel with the anonymous profile, and a `false`
 *   means visitors see 「该用户隐藏了该内容」 — the backend does not enforce it, so a hidden tab
 *   is never read at all. The owner always sees their own.
 * - **Uploads are the bound Derpibooru account's**, so a profile with no account bound (or with a
 *   name but no API key to prove it) has none to list.
 * - **The IP location** is shown when the backend sends one and it is not 「未知」. When its owner
 *   hides it (`settings.hideIpLocation`, the setting /settings writes) the backend answers
 *   「该用户已隐藏」 to everybody, and the line reads 已隐藏 — what /settings tells the owner
 *   visitors will see, and what the original front end printed.
 *
 * Plain module: the header renders on the server.
 */

import type { ProfileUser } from '@/lib/types/user';

export type ProfileTab = 'uploads' | 'faves' | 'posts' | 'comments';

/** The four tabs, in the order the tab row shows them. */
export const PROFILE_TABS: readonly ProfileTab[] = ['uploads', 'faves', 'posts', 'comments'];

const SHOW_SETTING: Record<ProfileTab, string> = {
  uploads: 'showUploads',
  faves: 'showFaves',
  posts: 'showPosts',
  comments: 'showComments',
};

/** The owner's settings as the profile carries them: an object, or on some rows its JSON text. */
function settingsOf(profile: ProfileUser): Record<string, unknown> | null {
  const raw: unknown = profile.settings;
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
}

/**
 * The profile with some of its owner's settings replaced — the owner's own view lays the choices
 * this device holds over the record, which is the server's and minutes old at worst.
 */
export function withSettings(profile: ProfileUser, overrides: Record<string, unknown>): ProfileUser {
  return { ...profile, settings: { ...settingsOf(profile), ...overrides } };
}

/** Whether the owner hides `tab` from visitors. The owner's own view always shows it. */
export function hiddenFromVisitors(profile: ProfileUser, tab: ProfileTab): boolean {
  return settingsOf(profile)?.[SHOW_SETTING[tab]] === false;
}

/** Whether a viewer (the owner or not) sees `tab`'s content rather than the hidden state. */
export function tabVisible(profile: ProfileUser, tab: ProfileTab, own: boolean): boolean {
  return own || !hiddenFromVisitors(profile, tab);
}

function derpiId(profile: ProfileUser): number | null {
  const id = Number(profile.derpi_user_id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function derpiName(profile: ProfileUser): string {
  return typeof profile.derpi_username === 'string' ? profile.derpi_username.trim() : '';
}

/**
 * The bound Derpibooru account as a search term — `uploader_id:N`, or the name when the id is
 * unknown — or `null` when there is no account to search. `has_api_key === false` is a name
 * typed without a key to prove it: the original front end listed no uploads for it either.
 */
export function uploaderTerm(profile: ProfileUser): string | null {
  if (profile.has_api_key === false) return null;
  const id = derpiId(profile);
  if (id !== null) return `uploader_id:${id}`;
  const name = derpiName(profile);
  if (!name) return null;
  /* A name is one literal term: every character the grammar treats as syntax is escaped — and so
     are the comma and whitespace (review P5-F4). A Derpibooru name is any text up to 50
     characters (`Users.User.validate_name` trims it and checks nothing else), and Philomena reads
     `,` as AND and ` OR ` / ` AND ` / ` || ` / ` && ` as operators even inside what was meant as
     one term: `uploader:a, b` listed `a`'s pictures tagged `b`, and `uploader:x OR y` everything
     tagged `y`. An escaped character is a literal one to the lexer, so `\ ` keeps a space. */
  return `uploader:${name.replace(/([+\-=&|><!(){}[\]^"~*?:\\/,\s])/g, '\\$1')}`;
}

/** Whether the profile has a Derpibooru account whose uploads can be listed. */
export function hasBoundAccount(profile: ProfileUser): boolean {
  return uploaderTerm(profile) !== null;
}

/**
 * The tab a profile opens on, from public data alone — so the server and the client choose the
 * same one, whoever is looking. Uploads when there are any to show a visitor, otherwise the first
 * tab the owner has not hidden; a profile hiding everything opens on uploads (its hidden state).
 */
export function defaultProfileTab(profile: ProfileUser): ProfileTab {
  if (hasBoundAccount(profile) && !hiddenFromVisitors(profile, 'uploads')) return 'uploads';
  for (const tab of ['faves', 'posts', 'comments'] as const) {
    if (!hiddenFromVisitors(profile, tab)) return tab;
  }
  return 'uploads';
}

/**
 * The IP location line's value: the location, 已隐藏 when its owner hides it (the setting, or the
 * backend's own 「该用户已隐藏」 in its place), or `null` when there is none to show.
 */
export function ipLocationOf(profile: ProfileUser): string | null {
  const location = typeof profile.ip_location === 'string' ? profile.ip_location.trim() : '';
  if (settingsOf(profile)?.hideIpLocation === true || location.includes('隐藏')) return '已隐藏';
  if (!location || location === '未知') return null;
  return location;
}

/** The in-app Derpibooru profile for the account the profile names, or `null` when none is. */
export function derpiProfileHref(profile: ProfileUser): string | null {
  const id = derpiId(profile);
  if (id !== null) return `/derpi/user/${id}`;
  const name = derpiName(profile);
  /* A binding with only a name (old data) cannot open `/derpi/user/<name>`: Derpibooru's JSON API
     finds a profile by id alone, so that page always said 用户不存在 (review P5-O4). The search
     for the name's uploads is what such a card can honestly lead to. */
  const term = name ? uploaderTerm(profile) : null;
  return term ? `/search?q=${encodeURIComponent(term)}` : null;
}

/** The profile's bio as it is printed: trimmed, or `''` when there is none. */
export function bioOf(profile: ProfileUser): string {
  return typeof profile.bio === 'string' ? profile.bio.trim() : '';
}

/** A profile id the backend can hold: a positive integer. Anything else is not found. */
export function isProfileId(id: string): boolean {
  return /^[1-9]\d{0,15}$/.test(id);
}
