'use client';

import Badge, { type BadgeSize } from './Badge';

interface UserBadgeProps {
  name: string;
  /** Author-chosen hex from the admin panel; arbitrary, so not a token. */
  color: string;
  size?: BadgeSize;
  className?: string;
}

/**
 * A user's earned badge.
 *
 * Rendered in three places (profile, task page, admin list) from three
 * near-identical inline spans that had drifted in radius and weight. The colour
 * is picked per badge in the admin panel and cannot come from the token scale,
 * which is exactly why the *rest* of it needs to be shared: the one arbitrary
 * value should not drag the whole appearance out of the system with it.
 *
 * That is now literal — the shape, size and type role come from `Badge`, the
 * same primitive `RoleBadge` renders, so the two marks in a profile header are
 * one silhouette instead of a round pill under two square ones. Only the fill
 * and its ink are computed here, because only they are outside the system.
 *
 * The ink is chosen from the fill's relative luminance rather than pinned to
 * white — a badge set to a pale yellow was previously white-on-pale and
 * unreadable.
 */
function inkFor(hex: string): string {
  const m = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(hex.trim());
  if (!m) return '#ffffff';
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const ch = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  // Crossover where white and near-black text are equally legible on the fill.
  return luminance > 0.42 ? '#1e1a1c' : '#ffffff';
}

export default function UserBadge({ name, color, size = 'sm', className = '' }: UserBadgeProps) {
  return (
    <Badge
      size={size}
      tone="custom"
      className={className}
      style={{ backgroundColor: color, color: inkFor(color) }}
    >
      {name}
    </Badge>
  );
}
