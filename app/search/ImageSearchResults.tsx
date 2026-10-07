'use client';

import { useRouter } from 'next/navigation';
import { MdClose, MdImageSearch, MdTune } from 'react-icons/md';
import Button from '@/components/Button';
import EmptyState from '@/components/EmptyState';
import FadeInImage from '@/components/FadeInImage';
import IconButton from '@/components/IconButton';
import MasonryGrid from '@/components/MasonryGrid';
import { ICON } from '@/lib/icons';
import { useBrowsingFingerprint } from '@/lib/resources';
import { currentBlockFilters, currentPublicBlacklist } from '@/lib/blockFilters';
import { imageFilterFor, parseBrowsingFingerprint } from '@/lib/searchQuery';
import type { ImageSearchResult } from './imageSearchStore';

/**
 * A 以图搜图 result set: the picture searched with, how many were found, and the grid. Its own
 * history entry (`?image=`), so Back returns to the search before it; announced once, here —
 * the dialog and the page each used to raise their own toast on top of this line.
 */
export default function ImageSearchResults({
  result,
  onSearchAgain,
  onClose,
}: {
  /** `undefined` when the set is gone — the page was reloaded, or it aged out of the session. */
  result: ImageSearchResult | undefined;
  onSearchAgain: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const fp = useBrowsingFingerprint();

  if (!result) {
    return (
      <EmptyState
        size="pane"
        icon={<MdImageSearch size={ICON.display} />}
        title="以图搜图结果已失效"
        description="这组结果只保留在打开它的页面里。重新选择图片即可再次搜索。"
        action={
          <Button variant="tonal" icon={<MdImageSearch />} onClick={onSearchAgain}>
            以图搜图
          </Button>
        }
      />
    );
  }

  const images = result.images.filter(imageFilterFor(parseBrowsingFingerprint(fp), currentBlockFilters(), currentPublicBlacklist()));
  const hidden = result.found - images.length;

  return (
    <section aria-labelledby="image-search-heading">
      <div className="mb-6 flex items-center gap-4">
        {result.preview && (
          <div className="relative size-14 shrink-0 overflow-hidden rounded-md bg-surface-container-high">
            <FadeInImage src={result.preview} alt="用于搜索的图片" fill sizes="56px" className="object-cover" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h2 id="image-search-heading" className="text-title-m-emphasized text-on-surface">
            以图搜图结果
          </h2>
          <p className="text-body-m text-on-surface-variant" role="status">
            找到 {result.found} 张相似图片
            {hidden > 0 ? `，其中 ${hidden} 张因当前的内容筛选设置未显示` : ''}
          </p>
        </div>
        <Button variant="surface" icon={<MdImageSearch />} responsiveLabel onClick={onSearchAgain}>
          重新搜图
        </Button>
        <IconButton dismiss aria-label="关闭以图搜图结果" icon={<MdClose />} onClick={onClose} />
      </div>
      {images.length > 0 ? (
        <MasonryGrid images={images} listKey={`image-search:${fp}`} />
      ) : (
        <EmptyState
          size="pane"
          icon={<MdTune size={ICON.display} />}
          title="相似图片都被内容筛选隐藏了"
          description={`找到的 ${result.found} 张相似图片都不符合当前的内容筛选设置。`}
          action={
            <Button variant="tonal" onClick={() => router.push('/settings', { scroll: false })}>
              前往设置
            </Button>
          }
        />
      )}
    </section>
  );
}
