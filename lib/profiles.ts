/**
 * What a PicPony profile shows, decided once — the profile screen, its tab reads in
 * `lib/resources.ts` and `scripts/testProfiles.mjs` all read these.
 *
 * The rules are the original front end's (`openPicPonyProfile`), which the backend still assumes:
 *
 * - **A tab the owner hides is hidden from everyone else.** The owner's four choices travel with
 *   the anonymous profile (`visibility`, kept as `settings.showUploads` / `showFaves` / `showPosts`
 *   / `showComments`), and a `false` means visitors see 「该用户隐藏了该内容」 — the backend also
 *   refuses those tabs (`PROFILE_PRIVATE`), so a hidden tab is never read at all. The owner always
 *   sees their own.
 * - **Uploads are the bound Derpibooru account's** — the identity the backend verified with the
 *   owner's API key (`upstream_identity`) — so a profile with none has no uploads to list.
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

/** The public profile as `GET /users/{id}` sends it (`profiles::public`). */
export interface WireProfile {
  id: number;
  username: string;
  avatar: string | null;
  banner: string | null;
  role: string;
  bio: string;
  gender: string;
  race: string;
  experience: number;
  level: number;
  created_on: string;
  last_online: string | null;
  ip_location: string;
  visibility: Record<'showUploads' | 'showFaves' | 'showPosts' | 'showComments', boolean>;
  badges: unknown;
  equipped_badges: unknown;
  upstream_identity: { id: number; name: string } | null;
}

/** The domain profile from the backend's record — one mapping for the server read and the client's. */
export function profileFromWire(user: WireProfile): ProfileUser {
  const identity = user.upstream_identity;
  return {
    id: user.id,
    username: user.username,
    avatar: user.avatar,
    banner: user.banner,
    role: user.role,
    bio: user.bio,
    gender: user.gender,
    race: user.race,
    experience: user.experience,
    level: user.level,
    created_at: user.created_on,
    last_online: user.last_online,
    ip_location: user.ip_location,
    derpi_user_id: identity ? identity.id : null,
    derpi_username: identity ? identity.name : null,
    has_api_key: identity !== null,
    badges: user.badges,
    equipped_badges: user.equipped_badges,
    settings: { ...user.visibility },
  };
}

/**
 * The profile with some of its owner's settings replaced — the owner's own view lays the choices
 * this device holds over the record, which is the server's and minutes old at worst.
 */
export function withSettings(profile: ProfileUser, overrides: Record<string, unknown>): ProfileUser {
  return { ...profile, settings: { ...profile.settings, ...overrides } };
}

/** Whether the owner hides `tab` from visitors. The owner's own view always shows it. */
export function hiddenFromVisitors(profile: ProfileUser, tab: ProfileTab): boolean {
  return profile.settings[SHOW_SETTING[tab]] === false;
}

/** Whether a viewer (the owner or not) sees `tab`'s content rather than the hidden state. */
export function tabVisible(profile: ProfileUser, tab: ProfileTab, own: boolean): boolean {
  return own || !hiddenFromVisitors(profile, tab);
}

/**
 * The bound Derpibooru account as a search term — `uploader_id:N` — or `null` when there is no
 * account to search. The backend names an account only once it has verified the key that owns it,
 * by id, so the name-only bindings older data held (and their escaped `uploader:` term) are gone.
 */
export function uploaderTerm(profile: ProfileUser): string | null {
  return profile.derpi_user_id !== null ? `uploader_id:${profile.derpi_user_id}` : null;
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
  const location = profile.ip_location.trim();
  if (profile.settings.hideIpLocation === true || location.includes('隐藏')) return '已隐藏';
  if (!location || location === '未知') return null;
  return location;
}

/** The in-app Derpibooru profile for the account the profile names, or `null` when none is. */
export function derpiProfileHref(profile: ProfileUser): string | null {
  return profile.derpi_user_id !== null ? `/derpi/user/${profile.derpi_user_id}` : null;
}

/** The profile's bio as it is printed: trimmed, or `''` when there is none. */
export function bioOf(profile: ProfileUser): string {
  return profile.bio.trim();
}

/** A profile id the backend can hold: a positive integer. Anything else is not found. */
export function isProfileId(id: string): boolean {
  return /^[1-9]\d{0,15}$/.test(id);
}
