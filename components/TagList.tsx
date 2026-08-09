'use client';

import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
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
    <div className="space-y-4">
      {/* Artists */}
      {artists.length > 0 && (
        <div>
          <h3 className="text-label-m-emphasized text-outline uppercase tracking-wider mb-2">
            艺术家
          </h3>
          <div className="flex flex-wrap gap-2">
            {visibleArtists.map((artist, index) => (
              <span
                key={index}
                onClick={() => router.push(`/search?q=${encodeURIComponent(`artist:${artist}`)}`)}
                className={`state-layer text-label-l cursor-pointer rounded-sm px-3 py-1.5 ${tagCategoryChip('artist')}`}
              >
                {' '}
                {display(artist)}{' '}
              </span>
            ))}{' '}
          </div>{' '}
          {visibleArtists.length < artists.length && (
            <Button
              variant="text"
              size="sm"
              className="mt-3 text-primary"
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
          <h3 className="text-label-m-emphasized text-outline uppercase tracking-wider mb-2">
            图中包含的 OC
          </h3>{' '}
          <div className="flex flex-wrap gap-2">
            {' '}
            {visibleOcs.map((oc, index) => (
              <span
                key={index}
                onClick={() => router.push(`/search?q=${encodeURIComponent(`oc:${oc}`)}`)}
                className={`state-layer text-label-l cursor-pointer rounded-sm px-3 py-1.5 ${tagCategoryChip('oc')}`}
              >
                {' '}
                {display(oc)}{' '}
              </span>
            ))}{' '}
          </div>{' '}
          {visibleOcs.length < ocs.length && (
            <Button
              variant="text"
              size="sm"
              className="mt-3 text-primary"
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
      <div>
        {' '}
        <h3 className="text-label-m-emphasized text-outline uppercase tracking-wider mb-2">
          标签 (Tag)
        </h3>{' '}
        <div className="flex flex-wrap gap-2">
          {' '}
          {visibleRegularTags.map((tag, index) => (
            <span
              key={index}
              onClick={() => onTagClick(tag)}
              className="state-layer px-2.5 py-1 bg-surface-container-high text-on-surface-variant text-label-l rounded-sm cursor-pointer max-w-full truncate"
              title="点击查看词库信息"
            >
              {' '}
              {display(tag)}{' '}
              {showTagCounts && typeof tagCounts[tag] === 'number' && (
                <span className="ml-1 text-label-s text-outline">
                  {tagCounts[tag].toLocaleString()}
                </span>
              )}
            </span>
          ))}
        </div>
        {visibleRegularTags.length < regularTags.length && (
          <Button
            variant="text"
            size="sm"
            className="mt-3 text-primary"
            onClick={() =>
              onShowMore({
                ...visibleTagLimits,
                regular: visibleTagLimits.regular + TAG_BATCH_SIZE,
              })
            }
          >
            显示更多标签（剩余 {(regularTags.length - visibleRegularTags.length).toLocaleString()}）
          </Button>
        )}
      </div>
    </div>
  );
}
