'use client';

import Link from 'next/link';
import { MdAccessTime, MdImage, MdPerson, MdSdStorage, MdStar } from 'react-icons/md';
import type { ReactNode } from 'react';
import type { PonyImage } from '@/lib/types/image';
import Skeleton from '@/components/Skeleton';

type DetailHeaderProps = {
  image: PonyImage;
  layout?: 'page' | 'overlay' | 'stage';
  metadataReady?: boolean;
};

function getImageFormat(image: PonyImage) {
  const source = image.format || image.representations?.full || image.view_url || '';
  return source.split('.').pop()?.toUpperCase() || 'UNKNOWN';
}

function MetaValue({
  ready,
  children,
  width,
}: {
  ready: boolean;
  children: ReactNode;
  width: string;
}) {
  if (ready) return children;
  return (
    <Skeleton
      data-image-detail-meta-loading
      className={`inline-block h-4 rounded-xs ${width}`}
    />
  );
}

/**
 * The strip above the image: its measurements, uploader and date.
 *
 * There is no visible title. A Derpibooru image has no name of its own — the
 * field is either absent or the original filename — so `image.name || "Image
 * #123"` printed the id back at you in the largest type on the page, above the
 * one thing the page exists to show. It also carried real machinery: the title
 * was clamped to one line, measured against its own unclamped `scrollHeight` on
 * every resize and after `document.fonts.ready` to decide whether it needed an
 * expand toggle, and that whole path is gone with it.
 *
 * The name survives as the document's heading for assistive tech and as the tab
 * title's counterpart; it is simply not something to look at.
 *
 * The row is centred rather than left-aligned because it is now the only thing
 * in the strip: six short items ranged left under nothing at all read as a
 * caption that lost its picture.
 */
export default function DetailHeader({
  image,
  layout = 'page',
  metadataReady = true,
}: DetailHeaderProps) {
  const isStage = layout === 'stage';
  const title = image.name || `Image #${image.id}`;

  return (
    <div
      data-image-detail-reveal="header"
      className={`bg-transparent px-4 py-3 sm:px-6 ${
        isStage
          ? 'image-detail-header-stage overflow-hidden'
          : layout === 'overlay'
            ? 'image-detail-header-route'
            : ''
      }`}
    >
      <h1 className="sr-only">{title}</h1>
      <div className="flex min-w-0 flex-wrap items-center justify-center gap-x-4 gap-y-1 text-body-m text-on-surface-variant">
        <div title="尺寸" className="flex shrink-0 items-center gap-1.5">
          <MdImage size={18} className="text-outline" />
          <MetaValue ready={metadataReady} width="w-24">
            <span className="tabular-nums">
              {image.width} × {image.height} px
            </span>
          </MetaValue>
        </div>
        <div title="大小" className="flex shrink-0 items-center gap-1.5">
          <MdSdStorage size={18} className="text-outline" />
          <MetaValue ready={metadataReady} width="w-16">
            <span className="tabular-nums">{((image.size || 0) / 1024 / 1024).toFixed(2)} MB</span>
          </MetaValue>
        </div>
        <div title="格式" className="flex shrink-0 items-center gap-1.5">
          <span className="rounded-sm border border-outline-variant bg-surface-container-high px-1.5 py-0.5 text-label-m text-on-surface-variant">
            {getImageFormat(image)}
          </span>
        </div>
        <Link
          href={
            image.uploader && image.uploader !== '匿名用户' && image.uploader_id
              ? `/derpi/user/${image.uploader_id}`
              : '#'
          }
          prefetch={isStage ? false : undefined}
          onClick={(event) => {
            if (!image.uploader || image.uploader === '匿名用户' || !image.uploader_id)
              event.preventDefault();
          }}
          scroll={false}
          title="上传者"
          className="relative flex shrink-0 items-center gap-1.5 transition-ui hover:text-primary"
        >
          <MdPerson size={18} className="text-outline" />
          <span className="max-w-[8rem] truncate underline decoration-dotted underline-offset-2 sm:max-w-[150px]">
            {image.uploader || '匿名用户'}
          </span>
        </Link>
        <div title="评分" className="flex shrink-0 items-center gap-1.5">
          <MdStar size={18} className="text-outline" />
          <MetaValue ready={metadataReady} width="w-8">
            <span className="tabular-nums">{image.score}</span>
          </MetaValue>
        </div>
        <div title="上传日期" className="flex shrink-0 items-center gap-1.5">
          <MdAccessTime size={18} className="text-outline" />
          {/* The date is the widest field by far. Below `sm` it drops the year
              and the clock — enough to keep the row count at two — and the full
              value stays available on the wrapper's `title`. */}
          <span className="tabular-nums sm:hidden">
            {new Date(image.created_at).toLocaleString('zh-CN', {
              month: '2-digit',
              day: '2-digit',
            })}
          </span>
          <span className="hidden tabular-nums sm:inline">
            {new Date(image.created_at).toLocaleString('zh-CN', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
      </div>
    </div>
  );
}
