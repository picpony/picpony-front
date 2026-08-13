'use client';

import Badge, { type BadgeSize } from './Badge';
import { roleInfo } from '@/lib/roles';

/**
 * The badge beside a username, from the one definition of what that role is.
 *
 * `lib/roles.ts` already existed to stop exactly this drifting, and its own
 * comment says so: "One definition means the badge beside a username is the same
 * badge wherever you meet that user." It delivered the *colour* and nothing
 * else, so the shape drifted anyway — `rounded-sm px-2 py-1 text-label-m` on a
 * profile, `rounded px-2 py-0.5 text-label-m` in the admin table.
 *
 * Worse, two of the four call sites never reached it at all. A forum post's
 * author and every reply in the thread hand-rolled
 * `bg-primary` at 10% with `text-primary`, uppercased and letter-spaced, so a founder's badge
 * was purple on their profile and brand-pink in a thread — and `uppercase
 * tracking-wider` on a Chinese role label does nothing but widen it, since the
 * label roles already carry a tracking token deliberately halved for Han glyphs
 * (the same conclusion `PicDetail` reached and commented at its 简介 heading).
 *
 * So the component owns the whole mark, not just its hue. There is no `role`
 * variant to get wrong and no shape to retype.
 *
 * Ordinary users render nothing. `roleInfo` maps them to a neutral grey pill,
 * which is correct for the admin table — where the column must say *something*
 * in every row — and noise everywhere else, because "this person is a person" is
 * not an annotation. `showUser` opts the table back in.
 */
export default function RoleBadge({
  role,
  size = 'sm',
  showUser = false,
  className = '',
}: {
  role: string | undefined | null;
  size?: BadgeSize;
  /** Render the neutral pill for ordinary users too — for a table column. */
  showUser?: boolean;
  className?: string;
}) {
  const info = roleInfo(role);
  const isPlainUser = info === roleInfo(null);
  if (isPlainUser && !showUser) return null;

  return (
    <Badge size={size} colors={info.chip} className={className}>
      {info.label}
    </Badge>
  );
}
