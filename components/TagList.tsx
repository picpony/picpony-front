'use client';

import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import Chip from '@/components/Chip';
import Skeleton from '@/components/Skeleton';
import { tagCategoryChip } from '@/lib/tagCategories';

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
  imageId: number;
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
  const visibleArtists = artists.slice(0, visibleTagLimits.artists);
  const visibleOcs = ocs.slice(0, visibleTagLimits.ocs);
  const visibleRegularTags = regularTags.slice(0, visibleTagLimits.regular);
  /** 有翻译显示中文，否则回退英文。 */
  const display = (name: string) => tagTranslations?.[name.toLowerCase()] ?? name;

  return (
    <div className="space-y-6">
      {/* Artists */}
      {artists.length > 0 && (
        <div>
          <h3 className="text-label-m-emphasized text-on-surface-variant mb-2">
            艺术家
          </h3>
          <div className="flex flex-wrap gap-2">
            {visibleArtists.map((artist) => (
              <Chip
                key={artist}
                size="md"
                colors={tagCategoryChip('artist')}
                onClick={() =>
                  router.push(`/search?q=${encodeURIComponent(`artist:${artist}`)}`, {
                    scroll: false,
                  })
                }
              >
                {display(artist)}
              </Chip>
            ))}{' '}
          </div>{' '}
          {visibleArtists.length < artists.length && (
            <Button
              variant="text"
              size="sm"
              className="mt-3"
              onClick={() =>
                onShowMore({
                  ...visibleTagLimits,
                  artists: visibleTagLimits.artists + RELATION_TAG_BATCH_SIZE,
                })
              }
            >
              显示更多艺术家标签（剩余 {(artists.length - visibleArtists.length).toLocaleString()}）
            </Button>
          )}{' '}
        </div>
      )}{' '}
      {/* OCs */}{' '}
      {ocs.length > 0 && (
        <div>
          {' '}
          <h3 className="text-label-m-emphasized text-on-surface-variant mb-2">
            图中包含的 OC
          </h3>{' '}
          <div className="flex flex-wrap gap-2">
            {' '}
            {visibleOcs.map((oc) => (
              <Chip
                key={oc}
                size="md"
                colors={tagCategoryChip('oc')}
                onClick={() =>
                  router.push(`/search?q=${encodeURIComponent(`oc:${oc}`)}`, { scroll: false })
                }
              >
                {display(oc)}
              </Chip>
            ))}{' '}
          </div>{' '}
          {visibleOcs.length < ocs.length && (
            <Button
              variant="text"
              size="sm"
              className="mt-3"
              onClick={() =>
                onShowMore({
                  ...visibleTagLimits,
                  ocs: visibleTagLimits.ocs + RELATION_TAG_BATCH_SIZE,
                })
              }
            >
              显示更多 OC 标签（剩余 {(ocs.length - visibleOcs.length).toLocaleString()}）
            </Button>
          )}{' '}
        </div>
      )}{' '}
      {/* Regular Tags */}{' '}
      {regularTags.length > 0 && (
        <div>
          {' '}
          <h3 className="text-label-m-emphasized text-on-surface-variant mb-2">
            标签 (Tag)
          </h3>{' '}
          <div className="flex flex-wrap gap-2">
            {visibleRegularTags.map((tag) => (
              <Chip key={tag} size="md" onClick={() => onTagClick(tag)} title="点击查看词库信息">
                {display(tag)}
                {/* `on-surface-variant`, not `outline`: a count is supporting
                    *text*, and `outline` is the boundary role — 4.3:1 on the
                    light surface, under the AA floor. The placeholder keeps the
                    chip from growing when the number lands. */}
                {showTagCounts &&
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
          {visibleRegularTags.length < regularTags.length && (
            <Button
              variant="text"
              size="sm"
              className="mt-3"
              onClick={() =>
                onShowMore({
                  ...visibleTagLimits,
                  regular: visibleTagLimits.regular + TAG_BATCH_SIZE,
                })
              }
            >
              显示更多标签（剩余{' '}
              {(regularTags.length - visibleRegularTags.length).toLocaleString()}）
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
