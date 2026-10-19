/**
 * The user editor's rules, as plain functions (no React, no browser): who may grant which role,
 * what a save sends, a user's badges off the wire and a generated password.
 *
 * **Role rules are the backend's** (`admin_users::profile`): 创始人 is never granted here and account
 * #1 keeps it; only 创始人 may make someone a 管理员. Nobody changes their own role.
 *
 * **A save sends what changed**, never the whole form (R9-008): untouched fields used to travel on
 * every save, and a cleared 「-- 不修改 --」 gender went out as an empty value indistinguishable
 * from clearing the field.
 */

import type { Role } from '@/lib/roles';
import { roleInfo } from '@/lib/roles';
import { normalizeGender } from '@/lib/profileFields';
import type { AdminUserChanges } from '@/lib/api/admin';

/** The site's first account — the original console's 创世神, the one account that may grant 创始人. */
export const ROOT_ACCOUNT_ID = 1;

const ROLE_ORDER: readonly Role[] = ['user', 'editor', 'admin', 'super_admin'];

export function roleOf(value: unknown): Role {
  const role = typeof value === 'string' ? value.toLowerCase() : '';
  return (ROLE_ORDER as readonly string[]).includes(role) ? (role as Role) : 'user';
}

export interface RoleChoice {
  /** The roles offered, in order; always includes the target's current role. */
  options: { value: Role; label: string }[];
  /** Why the role cannot be changed at all, or `null` when it can. */
  locked: string | null;
  /** A line under the field about what this viewer may not grant, when that is not obvious. */
  note: string | null;
}

/** What the role field offers `viewer` for `target`. */
export function roleChoice(
  viewer: { id: number; role: Role },
  target: { id: number; role: unknown },
): RoleChoice {
  const current = roleOf(target.role);
  const root = viewer.id === ROOT_ACCOUNT_ID;
  const option = (role: Role) => ({ value: role, label: roleInfo(role).label });
  const lockedTo = (reason: string): RoleChoice => ({ options: [option(current)], locked: reason, note: null });

  if (target.id === viewer.id) return lockedTo('不能修改自己的角色');
  /* The backend's rules: account #1 stays 创始人 and nobody is made 创始人 through the console
     (`ROLE_GRANT_FORBIDDEN`); only 创始人 may grant 管理员. */
  if (target.id === ROOT_ACCOUNT_ID) return lockedTo('站点 1 号账号的创始人角色不能修改');
  if (current === 'super_admin' && !root) return lockedTo('创始人的角色只能由站点的 1 号账号修改');
  if (current === 'admin' && viewer.role !== 'super_admin') return lockedTo('仅创始人可以修改管理员的角色');

  const grantable = ROLE_ORDER.filter((role) => {
    if (role === 'super_admin') return false;
    if (role === 'admin') return viewer.role === 'super_admin';
    return true;
  });
  const roles = grantable.includes(current) ? grantable : [...grantable, current];
  return {
    options: ROLE_ORDER.filter((role) => roles.includes(role)).map(option),
    locked: null,
    note: viewer.role === 'super_admin' ? '创始人角色不能通过后台授予' : '仅创始人可以授予管理员角色',
  };
}

/** A badge a user holds, as the account view carries it — with the id the badge endpoints take. */
export interface AdminUserBadge {
  id: number;
  name: string;
  color: string;
  /** Kept so a rename does not make an expiring badge permanent. */
  expires_at: string | null;
}

/** The account view's `badges` (already the shape the editor needs). */
export function userBadges(value: readonly AdminUserBadge[] | undefined): AdminUserBadge[] {
  return value ? [...value] : [];
}

/** The fields the editor holds, as strings, and the user they were read from. */
export interface UserFormValues {
  username: string;
  email: string;
  password: string;
  /** A new Derpibooru key; empty keeps the current binding. The stored key is never readable. */
  apiKey: string;
  /** Unbind the current key. */
  clearKey: boolean;
  role: Role;
  bio: string;
  gender: string;
  birthday: string;
}

export interface EditableUser {
  id: number;
  username?: string | null;
  email?: string | null;
  role?: unknown;
  bio?: string | null;
  gender?: string | null;
  birthday?: string | null;
}

/** The form as it opens for `user`: the stored values, gender in its canonical spelling. */
export function initialUserForm(user: EditableUser): UserFormValues {
  return {
    username: user.username ?? '',
    email: user.email ?? '',
    password: '',
    apiKey: '',
    clearKey: false,
    role: roleOf(user.role),
    bio: user.bio ?? '',
    gender: normalizeGender(user.gender),
    birthday: validDate(user.birthday),
  };
}

/** A stored birthday a date field can hold, or `''`. */
function validDate(value: unknown): string {
  const text = typeof value === 'string' ? value.trim().slice(0, 10) : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

/**
 * What a save sends (`adminUpdateUser`): each field that differs from what the editor opened with.
 * The role travels only when the viewer may change it. `null` when nothing changed — the save is
 * then a no-op rather than a request.
 */
export function userUpdatePayload(
  user: EditableUser,
  form: UserFormValues,
  roleEditable: boolean,
): AdminUserChanges | null {
  const before = initialUserForm(user);
  const changes: AdminUserChanges = {};
  const username = form.username.trim();
  const email = form.email.trim();
  const apiKey = form.apiKey.trim();
  if (username !== before.username) changes.username = username;
  if (email !== before.email) changes.email = email;
  if (form.password) changes.password = form.password;
  if (form.clearKey) changes.apiKey = null;
  else if (apiKey) changes.apiKey = apiKey;
  if (roleEditable && form.role !== before.role) changes.role = form.role;
  if (form.bio !== before.bio) changes.bio = form.bio;
  if (form.gender !== before.gender) changes.gender = form.gender;
  if (form.birthday !== before.birthday) changes.birthday = form.birthday;
  return Object.keys(changes).length > 0 ? changes : null;
}

const LETTERS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const ALPHABET = LETTERS + DIGITS;

/**
 * A 12-character password meeting the account rule (8–20 characters, a letter and a non-letter),
 * from the platform's cryptographic generator. Look-alike characters (0/O, 1/l/I) are left out:
 * an administrator reads this to somebody.
 */
export function randomPassword(random: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes)): string {
  /* Rejection sampling: a byte at or above the largest multiple of the alphabet's size would
     favour the alphabet's first characters. */
  const limit = 256 - (256 % ALPHABET.length);
  for (;;) {
    let password = '';
    while (password.length < 12) {
      for (const byte of random(new Uint8Array(16))) {
        if (byte < limit && password.length < 12) password += ALPHABET[byte % ALPHABET.length];
      }
    }
    if (/[A-Za-z]/.test(password) && /[^A-Za-z]/.test(password)) return password;
  }
}
