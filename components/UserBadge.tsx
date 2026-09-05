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
 * A user's earned badge, in three places. Shape, size and type role come from
 * `Badge` (the same primitive `RoleBadge` renders); only the fill — an
 * author-chosen hex, outside the token scale — and its ink are computed here.
 *
 * The ink is picked from the fill's relative luminance rather than pinned to
 * white, which was unreadable on pale fills.
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
