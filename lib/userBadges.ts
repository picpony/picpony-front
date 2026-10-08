/**
 * A user's badges, read off the wire — one parser for every screen that shows them.
 *
 * The backend spells a badge two ways. A profile's **wall** (`get_user_profile`'s `badges`) is
 * `{ name, color, expires_at }`; the **equipped** set (`equipped_badges`, on a profile, a forum
 * post, a contact, `get_tasks`) and the owner's own list (`get_my_badges`) are
 * `{ badge_name, badge_color }` — the equipped set sometimes as a JSON *string* of that array.
 * Every reader used to re-parse it with its own `try { JSON.parse } catch {}`.
 *
 * **An expired badge is still held, and never worn.** The original front end hid an expired badge
 * from the equipped set (`getValidEquippedBadges`) and made it unselectable in the equip list;
 * the wall still lists it, marked 已过期. The expiry is a Beijing wall-clock stamp like every
 * other backend time (`parseBackendTime`).
 *
 * Plain module: the profile header renders on the server, and `scripts/testProfiles.mjs` tests it.
 */

import { formatDate, parseBackendTime } from '@/lib/format';

/** A badge a user holds, with its author-chosen colour and, if it lapses, when. */
export interface HeldBadge {
  name: string;
  /** Hex from the admin console's badge dictionary; arbitrary, so not a token. */
  color: string;
  expiresAt: string | null;
}

/** A badge as the equipped set carries it — the wire shape `equip_badge` takes back. */
export interface EquippedBadge {
  badge_name: string;
  badge_color: string;
}

/** The original front end's limit (「最多只能佩戴3个徽章」); the backend holds no other. */
export const MAX_EQUIPPED_BADGES = 3;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** An array, or a JSON string of one — anything else is an empty list. */
function listOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * The badges a user holds, in the backend's order, one per name. Reads both spellings, so the
 * profile's wall and `get_my_badges` go through the same function.
 */
export function parseHeldBadges(value: unknown): HeldBadge[] {
  const seen = new Set<string>();
  const badges: HeldBadge[] = [];
  for (const row of listOf(value)) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const name = text(record.name) || text(record.badge_name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    badges.push({
      name,
      color: text(record.color) || text(record.badge_color),
      expiresAt: text(record.expires_at) || null,
    });
  }
  return badges;
}

/** The equipped set, from an array or its JSON string; one entry per name. */
export function parseEquippedBadges(value: unknown): EquippedBadge[] {
  const seen = new Set<string>();
  const equipped: EquippedBadge[] = [];
  for (const row of listOf(value)) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const name = text(record.badge_name) || text(record.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    equipped.push({ badge_name: name, badge_color: text(record.badge_color) || text(record.color) });
  }
  return equipped;
}

/** Whether a badge's expiry has passed at `now`. A badge with no expiry never lapses. */
export function isBadgeExpired(expiresAt: string | null | undefined, now: number): boolean {
  const end = parseBackendTime(expiresAt);
  return end !== null && now > end.getTime();
}

/** What a badge's validity reads as: 永久有效, 有效期至 2026/10/01, or 已过期. */
export function badgeValidity(expiresAt: string | null | undefined, now: number): { expired: boolean; text: string } {
  const end = parseBackendTime(expiresAt);
  if (!end) return { expired: false, text: '永久有效' };
  if (now > end.getTime()) return { expired: true, text: '已过期' };
  return { expired: false, text: `有效期至 ${formatDate(end)}` };
}

/**
 * The equipped badges a screen shows beside a name: the equipped set without the ones whose
 * held copy has lapsed, capped at the limit. A badge the wall does not list is kept — the wall
 * is only known on a profile, and every other screen has the equipped set alone.
 */
export function wornBadges(equipped: readonly EquippedBadge[], held: readonly HeldBadge[], now: number): EquippedBadge[] {
  const expiry = new Map(held.map((badge) => [badge.name, badge.expiresAt]));
  return equipped
    .filter((badge) => !isBadgeExpired(expiry.get(badge.badge_name) ?? null, now))
    .slice(0, MAX_EQUIPPED_BADGES);
}

/** Two equipped sets name the same badges in the same order. */
export function sameEquipped(a: readonly EquippedBadge[], b: readonly EquippedBadge[]): boolean {
  return a.length === b.length && a.every((badge, index) => badge.badge_name === b[index]?.badge_name);
}
