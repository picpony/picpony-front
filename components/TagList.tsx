'use client';

import { useRouter } from 'next/navigation';

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
  imageId: number;
  onTagClick: (tag: string) => void;
  onShowMore: (limits: VisibleTagLimits) => void;
}

export default function TagList({
  tags,
  visibleTagLimits,
  showTagCounts,
  tagCounts,
  onTagClick,
  onShowMore,
}: TagListProps) {
  const router = useRouter();
  const { artists, ocs, regularTags } = groupTags(tags);
  const visibleArtists = artists.slice(0, visibleTagLimits.artists);
  const visibleOcs = ocs.slice(0, visibleTagLimits.ocs);
  const visibleRegularTags = regularTags.slice(0, visibleTagLimits.regular);

  return (
    <div className="space-y-4">
      {/* Artists */}
      {artists.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">艺术家</h3>
          <div className="flex flex-wrap gap-2">
            {visibleArtists.map((artist, index) => (
              <span
                key={index}
                onClick={() => router.push(`/search?q=${encodeURIComponent(`artist:${artist}`)}`)}
                className="px-3 py-1.5 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-sm font-medium rounded-lg border border-blue-100 dark:border-blue-800/30 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
              >
                {artist}
              </span>
            ))}
          </div>
          {visibleArtists.length < artists.length && (
            <button
              type="button"
              onClick={() => onShowMore({
                ...visibleTagLimits,
                artists: visibleTagLimits.artists + RELATION_TAG_BATCH_SIZE,
              })}
              className="mt-3 rounded-lg px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
            >
              显示更多艺术家标签（剩余 {(artists.length - visibleArtists.length).toLocaleString()}）
            </button>
          )}
        </div>
      )}

      {/* OCs */}
      {ocs.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">图中包含的 OC</h3>
          <div className="flex flex-wrap gap-2">
            {visibleOcs.map((oc, index) => (
              <span
                key={index}
                onClick={() => router.push(`/search?q=${encodeURIComponent(`oc:${oc}`)}`)}
                className="px-3 py-1.5 bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 text-sm font-medium rounded-lg border border-purple-100 dark:border-purple-800/30 cursor-pointer hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors"
              >
                {oc}
              </span>
            ))}
          </div>
          {visibleOcs.length < ocs.length && (
            <button
              type="button"
              onClick={() => onShowMore({
                ...visibleTagLimits,
                ocs: visibleTagLimits.ocs + RELATION_TAG_BATCH_SIZE,
              })}
              className="mt-3 rounded-lg px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
            >
              显示更多 OC 标签（剩余 {(ocs.length - visibleOcs.length).toLocaleString()}）
            </button>
          )}
        </div>
      )}

      {/* Regular Tags */}
      <div>
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">标签 (Tag)</h3>
        <div className="flex flex-wrap gap-2">
          {visibleRegularTags.map((tag, index) => (
            <span
              key={index}
              onClick={() => onTagClick(tag)}
              className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-sm rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer border border-transparent hover:border-primary/30 max-w-full truncate"
              title="点击查看词库信息"
            >
              {tag}
              {showTagCounts && typeof tagCounts[tag] === 'number' && (
                <span className="ml-1 text-[10px] text-slate-400 dark:text-slate-500 font-normal">
                  {tagCounts[tag].toLocaleString()}
                </span>
              )}
            </span>
          ))}
        </div>
        {visibleRegularTags.length < regularTags.length && (
          <button
            type="button"
            onClick={() => onShowMore({
              ...visibleTagLimits,
              regular: visibleTagLimits.regular + TAG_BATCH_SIZE,
            })}
            className="mt-3 rounded-lg px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
          >
            显示更多标签（剩余 {(regularTags.length - visibleRegularTags.length).toLocaleString()}）
          </button>
        )}
      </div>
    </div>
  );
}
