'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import Chip from '@/components/Chip';
import EmptyState from '@/components/EmptyState';
import FollowHeight from '@/components/FollowHeight';
import { DETAIL_TAG_SECTIONS, DetailTagPlaceholder, DetailTagSection } from '@/components/detail/DetailTagSections';
import { useTooltip } from '@/components/Tooltip';
import { formatCount } from '@/lib/format';
import { tagCategoryChip } from '@/lib/tagCategories';
import { tagTranslationKey } from '@/lib/tagTranslations';

const TAG_BATCH_SIZE = 120;
const RELATION_TAG_BATCH_SIZE = 64;

export type TagGroups = { artists: string[]; ocs: string[]; regularTags: string[] };
export const EMPTY_TAG_GROUPS: TagGroups = { artists: [], ocs: [], regularTags: [] };

export function groupTags(tags: string[] | undefined): TagGroups {
  if (!tags?.length) return EMPTY_TAG_GROUPS;
  const groups: TagGroups = { artists: [], ocs: [], regularTags: [] };
  tags.forEach((tag) => {
    if (tag.startsWith('artist:')) groups.artists.push(tag.slice(7));
    else if (tag.startsWith('oc:')) groups.ocs.push(tag.slice(3));
    else if (!tag.startsWith('spoiler:') && !tag.startsWith('suggestion:')) {
      groups.regularTags.push(tag);
    }
  });
  return groups;
}

export type TagSection = 'artists' | 'ocs' | 'regular';

export interface VisibleTagLimits {
  imageId: number;
  artists: number;
  ocs: number;
  regular: number;
}

export const BATCH_SIZES: Record<TagSection, number> = {
  artists: RELATION_TAG_BATCH_SIZE,
  ocs: RELATION_TAG_BATCH_SIZE,
  regular: TAG_BATCH_SIZE,
};

/** The tags a section shows under the given limits — also what the next batch would add. */
export function visibleTagsOf(groups: TagGroups, limits: VisibleTagLimits): string[] {
  return [
    ...groups.artists.slice(0, limits.artists).map((tag) => `artist:${tag}`),
    ...groups.ocs.slice(0, limits.ocs).map((tag) => `oc:${tag}`),
    ...groups.regularTags.slice(0, limits.regular),
  ];
}

interface TagListProps {
  tags: string[] | undefined;
  /** Keep only the regular heading on screen while values wait for publication. */
  pending?: boolean;
  visibleTagLimits: VisibleTagLimits;
  /**
   * The glossary's Chinese names as far as they are known (keys as `tagTranslationKey` makes
   * them), or `undefined` when the reader turned them off.
   */
  translations?: Record<string, string | null>;
  /** Picture counts per tag as far as they are known, or `undefined` when the reader hid them. */
  counts?: Record<string, number | null>;
  onTagClick: (tag: string) => void;
  /** Reveal a section's next batch — the caller fetches its names first, then widens the limit. */
  onShowMore: (section: TagSection) => void;
  /** The section whose next batch is being prepared. */
  preparing?: TagSection | null;
}

function TagChip({
  tag,
  label,
  count,
  colors,
  onClick,
}: {
  tag: string;
  label: string;
  count: number | null | undefined;
  colors?: string;
  onClick: () => void;
}) {
  const translated = label !== tag;
  /* The real tag, on demand: a translated chip shows the glossary's name, and two tags can share
     one (两个都叫 「碧琪」). Hover or focus shows it, a long press on touch; a long English name the
     chip truncates shows its whole self the same way. */
  const { anchorRef, anchorProps, tooltip } = useTooltip(translated || tag.length > 24 ? tag : undefined);
  return (
    <>
      <Chip ref={anchorRef as React.Ref<HTMLButtonElement>} {...anchorProps} colors={colors} onClick={onClick}>
        {/* The count sits outside the truncating label: a long tag used to lose its count first. */}
        <span className="flex min-w-0 items-baseline gap-1">
          <span className="truncate">{label}</span>
          {typeof count === 'number' && (
            <span className="shrink-0 text-label-s tabular-nums">{formatCount(count)}</span>
          )}
        </span>
      </Chip>
      {tooltip}
    </>
  );
}

/**
 * How long after the list appears (or its chips change) late names still apply at once: long
 * enough for the browser's cache to answer (a microtask and the two frames publication waits),
 * short enough that a glossary read from the network does not re-flow a list somebody is reading
 * — that one waits until the list is off screen. Measured: at a second, a direct load's late
 * names were a layout shift.
 */
const SETTLE_MS = 300;

/**
 * A picture's tags in three sections — artists, OCs, the rest — each a row of chips.
 *
 * **Chips never re-flow under the reader.** A translation (or a count) that arrives after the
 * chips are laid out changes every chip's width, and a whole block of rows re-wraps; so the
 * names and counts this list *shows* move to the latest known only when nobody can see the
 * move — while the list is off screen — or when its set of chips changes anyway (the next
 * batch, the next picture, names or counts switched on or off). What is already known when the
 * list first renders (the server's first paint) is simply there, and what the browser's cache
 * answers in the first moments after it appears (`SETTLE_MS`) is too.
 */
export default function TagList({
  tags,
  pending = false,
  visibleTagLimits,
  translations,
  counts,
  onTagClick,
  onShowMore,
  preparing = null,
}: TagListProps) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const { artists, ocs, regularTags } = groupTags(tags);
  const sections = DETAIL_TAG_SECTIONS.map((section) => ({
    ...section,
    tags: section.key === 'artists' ? artists : section.key === 'ocs' ? ocs : regularTags,
    colors: section.category ? tagCategoryChip(section.category) : undefined,
  }));

  /* Which chips, and in which mode: switching names or counts on or off is a new set, not a late
     arrival — it applies at once. */
  const chipSet = `${visibleTagLimits.imageId}|${visibleTagLimits.artists}|${visibleTagLimits.ocs}|${visibleTagLimits.regular}|${tags?.length ?? 0}|${translations ? 'cn' : 'en'}|${counts ? 'n' : '-'}|${pending}`;
  const [offscreen, setOffscreen] = useState(false);
  const [settledFor, setSettledFor] = useState<string | null>(null);
  const settling = settledFor !== chipSet;
  const [applied, setApplied] = useState({ chipSet, translations, counts });
  if (!pending && (
    applied.chipSet !== chipSet ||
    ((offscreen || settling) && (applied.translations !== translations || applied.counts !== counts))
  )) {
    setApplied({ chipSet, translations, counts });
  }

  useEffect(() => {
    if (pending) return;
    const timer = window.setTimeout(() => setSettledFor(chipSet), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [chipSet, pending]);

  useEffect(() => {
    if (pending) return;
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setOffscreen(!entry?.isIntersecting));
    observer.observe(root);
    return () => observer.disconnect();
  }, [pending]);

  const label = (name: string) => {
    const translation = applied.translations?.[tagTranslationKey(name)];
    return typeof translation === 'string' && translation ? translation : name;
  };

  return (
    <div ref={rootRef}>
      {sections.map((section) => {
        const visible = section.tags.slice(0, visibleTagLimits[section.key]);
        const remaining = section.tags.length - visible.length;
        const show = section.key === 'regular' || (!pending && visible.length > 0);
        // Measure only changes that can wrap a row, after the Hero publication gate opens.
        const layoutKey = !show ? 'empty' : pending
          ? 'pending'
          : JSON.stringify([visible.map((tag) => [label(tag), applied.counts?.[tag]]), remaining]);
        return (
          <FollowHeight key={section.key} watch={layoutKey}>
            {show && (
              <div className={section.key !== 'regular' ? 'pb-6' : undefined}>
                <DetailTagSection section={section}>
                  {pending ? <DetailTagPlaceholder /> : visible.length === 0 ? (
                    <EmptyState size="inline" title="暂无标签" entrance={false} />
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-2">
                        {visible.map((tag) => (
                          <TagChip
                            key={tag}
                            tag={tag}
                            label={label(tag)}
                            count={section.key === 'regular' ? applied.counts?.[tag] : undefined}
                            colors={section.colors}
                            onClick={() =>
                              section.prefix
                                ? router.push(`/search?q=${encodeURIComponent(section.prefix + tag)}`, { scroll: false })
                                : onTagClick(tag)
                            }
                          />
                        ))}
                      </div>
                      {remaining > 0 && (
                        <Button
                          variant="text"
                          size="xs"
                          className="mt-3"
                          loading={preparing === section.key}
                          onClick={() => onShowMore(section.key)}
                        >
                          {section.more}（剩余 {formatCount(remaining)}）
                        </Button>
                      )}
                    </>
                  )}
                </DetailTagSection>
              </div>
            )}
          </FollowHeight>
        );
      })}
    </div>
  );
}
