'use client';

import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import Chip from '@/components/Chip';
import Skeleton from '@/components/Skeleton';
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

interface VisibleTagLimits {
  imageId: number;
  artists: number;
  ocs: number;
  regular: number;
}

interface TagListProps {
  tags: string[] | undefined;
  visibleTagLimits: VisibleTagLimits;
  showTagCounts: boolean;
  tagCounts: Record<string, number | null>;
  /** 词库中文翻译，key 为剥离前缀后的小写标签名；null = 未收录（见 lib/tagTranslations）。 */
  tagTranslations?: Record<string, string | null>;
  onTagClick: (tag: string) => void;
  onShowMore: (limits: VisibleTagLimits) => void;
}

export default function TagList({
  tags,
  visibleTagLimits,
  showTagCounts,
  tagCounts,
  tagTranslations,
  onTagClick,
  onShowMore,
}: TagListProps) {
  const router = useRouter();
  const { artists, ocs, regularTags } = groupTags(tags);
  const sections = [
    {
      key: 'artists', title: '艺术家', tags: artists, prefix: 'artist:',
      colors: tagCategoryChip('artist'), more: '显示更多艺术家标签', batch: RELATION_TAG_BATCH_SIZE,
    },
    {
      key: 'ocs', title: '图中包含的 OC', tags: ocs, prefix: 'oc:',
      colors: tagCategoryChip('oc'), more: '显示更多 OC 标签', batch: RELATION_TAG_BATCH_SIZE,
    },
    {
      key: 'regular', title: '标签 (Tag)', tags: regularTags, prefix: '',
      colors: undefined, more: '显示更多标签', batch: TAG_BATCH_SIZE,
    },
  ] as const;
  /** 有翻译显示中文，否则回退英文。 */
  const display = (name: string) => {
    const translation = tagTranslations?.[tagTranslationKey(name)];
    return typeof translation === 'string' ? translation : name;
  };

  return (
    <div className="space-y-6">
      {sections.map((section) => {
        if (section.tags.length === 0) return null;
        const visible = section.tags.slice(0, visibleTagLimits[section.key]);
        const remaining = section.tags.length - visible.length;
        return (
          <div key={section.key}>
            <h3 className="text-label-m-emphasized text-on-surface-variant mb-2">
              {section.title}
            </h3>
            <div className="flex flex-wrap gap-2">
              {visible.map((tag) => (
                <Chip
                  key={tag}
                  colors={section.colors}
                  onClick={() => section.prefix
                    ? router.push(`/search?q=${encodeURIComponent(section.prefix + tag)}`, { scroll: false })
                    : onTagClick(tag)}
                >
                  {display(tag)}
                  {/* Reserve the count's space while it loads so the chip stays put. */}
                  {section.key === 'regular' && showTagCounts &&
                    (typeof tagCounts[tag] === 'number' ? (
                      <span className="ml-1 text-label-s text-on-surface-variant tabular-nums">
                        {tagCounts[tag].toLocaleString()}
                      </span>
                    ) : tagCounts[tag] === undefined ? (
                      <span className="ml-1 text-label-s">
                        <Skeleton className="inline-block h-3 w-6 align-baseline" />
                      </span>
                    ) : null)}
                </Chip>
              ))}
            </div>
            {remaining > 0 && (
              <Button
                variant="text"
                size="xs"
                className="mt-3"
                onClick={() => onShowMore({
                  ...visibleTagLimits,
                  [section.key]: visibleTagLimits[section.key] + section.batch,
                })}
              >
                {section.more}（剩余 {remaining.toLocaleString()}）
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
