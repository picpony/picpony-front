'use client';

import Badge, { type BadgeSize } from './Badge';
import { cn } from '@/lib/utils';

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
 * **The ink is whichever of the two contrasts more with the fill**, computed, not a
 * luminance threshold. The threshold said 0.42 and called it the crossover; the real
 * crossover between white and this near-black (luminance ≈ 0.011) is ≈ 0.20, so
 * every fill between the two — most greens, cyans, oranges and pinks an admin picks —
 * got the worse ink: 「伪天角」 on `#22c55e` measured 2.28:1 in white where the dark ink
 * gives ≈ 8:1. Something that is not a hex (the admin swatch only produces hex) falls
 * back to the neutral badge rather than white ink on an unknown fill.
 */
const DARK_INK = '#1e1a1c';
const LIGHT_INK = '#ffffff';

function luminance(hex: string): number | null {
  const m = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const ch = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const DARK_L = luminance(DARK_INK) as number;
const LIGHT_L = luminance(LIGHT_INK) as number;

/**
 * A badge's fill and the ink that reads on it, or `null` for a colour that is not a hex — the
 * caller then takes the neutral tone. Shared with the badge wall's pressable chips
 * (`components/BadgeWall.tsx`), so a mark and the control that opens it are one colour pair.
 */
export function badgePaint(color: string): { backgroundColor: string; color: string } | null {
  const fill = luminance(color);
  if (fill === null) return null;
  const hex = color.trim();
  return {
    backgroundColor: hex.startsWith('#') ? hex : `#${hex}`,
    color: contrast(fill, DARK_L) >= contrast(fill, LIGHT_L) ? DARK_INK : LIGHT_INK,
  };
}

export default function UserBadge({ name, color, size = 'sm', className = '' }: UserBadgeProps) {
  const paint = badgePaint(color);
  if (paint === null) {
    return (
      <Badge size={size} className={className}>
        {name}
      </Badge>
    );
  }
  return (
    <Badge
      size={size}
      tone="custom"
      /* The fill is the author's; under forced colors the system edge keeps the mark's
         bounds (the mode repaints the fill). */
      className={cn('forced-boundary', className)}
      style={paint}
    >
      {name}
    </Badge>
  );
}
