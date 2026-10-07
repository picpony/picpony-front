'use client';

import { MdBookmarks, MdForum, MdPalette, MdPushPin } from 'react-icons/md';
import Badge, { type BadgeSize } from '@/components/Badge';
import { categoryLabel } from '@/lib/forumModel';
import type { ForumCategory } from '@/lib/types/forum';

/** The glyph each kind of post wears — the original front end's three (a speech bubble, a
 *  palette, bookmarks), as Material Symbols. */
export function CategoryIcon({ category, size }: { category: ForumCategory; size?: number }) {
  if (category === 'commission') return <MdPalette size={size} />;
  if (category === 'taggroups') return <MdBookmarks size={size} />;
  return <MdForum size={size} />;
}

/** Which kind of post this is: a mark beside the title, not a control. */
export function CategoryBadge({ category, size = 'sm' }: { category: ForumCategory; size?: BadgeSize }) {
  return (
    <Badge size={size} icon={<CategoryIcon category={category} />} className="shrink-0">
      {categoryLabel(category)}
    </Badge>
  );
}

/**
 * 置顶. The primary container pair: pinning is the forum's own emphasis, not a severity — it wore
 * the error pair, which says something is wrong (R6-024).
 */
export function PinnedBadge({ size = 'sm' }: { size?: BadgeSize }) {
  return (
    <Badge tone="primary" size={size} icon={<MdPushPin />} className="shrink-0">
      置顶
    </Badge>
  );
}
