/**
 * A user's badges, read off the wire — one parser for every screen that shows them.
 *
 * The Rust backend spells every badge one way, `{ id, name, color, expires_at }` (a profile's wall
 * and worn set, `GET /me/badges`, a forum author's `equipped_badges`), with `position` on a worn
 * one. The worn set keeps this app's `{ badge_name, badge_color }` shape, with the badge's `id`,
 * which is what `PUT /me/badges/equipment` takes back.
 *
 * **An expired badge is still held, and never worn.** The original front end hid an expired badge
 * from the equipped set (`getValidEquippedBadges`) and made it unselectable in the equip list;
 * the wall still lists it, marked 已过期. The backend drops expired badges from a worn set itself.
 *
 * Plain module: the profile header renders on the server, and `scripts/testProfiles.mjs` tests it.
 */

import { formatDate, parseBackendTime } from '@/lib/format';

/** A badge a user holds, with its author-chosen colour and, if it lapses, when. */
export interface HeldBadge {
  id: number;
  name: string;
  /** Hex from the admin console's badge dictionary; arbitrary, so not a token. */
  color: string;
  expiresAt: string | null;
}

/** A badge as the equipped set carries it. `id` is the held badge's, when the source names it. */
export interface EquippedBadge {
  id?: number;
  badge_name: string;
  badge_color: string;
}

/** The original front end's limit (「最多只能佩戴3个徽章」); the backend allows five. */
export const MAX_EQUIPPED_BADGES = 3;

interface WireBadge {
  id: number;
  name: string;
  color: string;
  expires_at?: string | null;
}

function rows(value: unknown): WireBadge[] {
  return Array.isArray(value) ? (value as WireBadge[]) : [];
}

/** The badges a user holds, in the backend's order (newest first). */
export function parseHeldBadges(value: unknown): HeldBadge[] {
  return rows(value).map((badge) => ({
    id: badge.id,
    name: badge.name,
    color: badge.color,
    expiresAt: badge.expires_at ?? null,
  }));
}

/** The equipped set, in its order. A list that is not one (a source without badges) is empty. */
export function parseEquippedBadges(value: unknown): EquippedBadge[] {
  return rows(value).map((badge) => ({ id: badge.id, badge_name: badge.name, badge_color: badge.color }));
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
