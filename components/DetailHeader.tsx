'use client';

import Link from 'next/link';
import { MdAccessTime, MdImage, MdPerson, MdSdStorage, MdStar } from 'react-icons/md';
import type { ReactNode } from 'react';
import type { ImagePreview } from '@/lib/types/image';
import Skeleton from '@/components/Skeleton';
import Badge from '@/components/Badge';
import { ICON } from '@/lib/icons';
import { formatDateTime, formatMonthDay } from '@/lib/format';
import { useTooltip } from '@/components/Tooltip';

type DetailHeaderProps = {
  image: ImagePreview;
  layout?: 'page' | 'overlay' | 'stage';
  metadataReady?: boolean;
};

function getImageFormat(image: ImagePreview) {
  const source = image.format || (image.representations?.full || image.view_url || '').split(/[?#]/)[0];
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
 * There is no visible title — a Derpibooru image has no name of its own, and
 * printing the id in the largest type on the page was not worth the machinery it
 * carried (a one-line clamp, a measured expand toggle). The name survives as the
 * document's `<h1>` for assistive tech and as the tab title's counterpart; it is
 * simply not something to look at.
 *
 * The row is centred rather than left-aligned because it is the only thing in
 * the strip: six short items ranged left under nothing at all read as a caption
 * that lost its picture.
 */
export default function DetailHeader({
  image,
  layout = 'page',
  metadataReady = true,
}: DetailHeaderProps) {
  const isStage = layout === 'stage';
  const title = image.name || `图片 #${image.id}`;
  /* The uploader link is the one row here that is focusable, so it is the one
     that can carry a real tooltip (`useTooltip` hangs `aria-describedby` and
     shows on focus as well as hover). The other rows name a *value* on a
     non-focusable `<div>`, so they take an `sr-only` label instead. */
  const {
    anchorRef: uploaderRef,
    anchorProps: uploaderProps,
    tooltip: uploaderTooltip,
  } = useTooltip('上传者');

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
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="sr-only">尺寸</span>
          <MdImage size={ICON.dense} className="text-outline" aria-hidden="true" />
          <MetaValue ready={metadataReady} width="w-24">
            <span className="tabular-nums">
              {image.width} × {image.height} px
            </span>
          </MetaValue>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="sr-only">大小</span>
          <MdSdStorage size={ICON.dense} className="text-outline" aria-hidden="true" />
          <MetaValue ready={metadataReady} width="w-16">
            <span className="tabular-nums">{((image.size || 0) / 1024 / 1024).toFixed(2)} MB</span>
          </MetaValue>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="sr-only">格式</span>
          <Badge>{getImageFormat(image)}</Badge>
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
          ref={uploaderRef as React.Ref<HTMLAnchorElement>}
          {...uploaderProps}
          className="relative flex shrink-0 items-center gap-1.5 transition-ui hover:text-primary-ink"
        >
          <MdPerson size={ICON.dense} className="text-outline" aria-hidden="true" />
          <MetaValue ready={image.uploader != null} width="w-20">
            <span className="max-w-32 truncate underline decoration-dotted underline-offset-2 sm:max-w-38">
              {image.uploader || '匿名用户'}
            </span>
          </MetaValue>
          {uploaderTooltip}
        </Link>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="sr-only">评分</span>
          <MdStar size={ICON.dense} className="text-outline" aria-hidden="true" />
          <MetaValue ready={metadataReady} width="w-8">
            <span className="tabular-nums">{image.score}</span>
          </MetaValue>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="sr-only">上传日期</span>
          <MdAccessTime size={ICON.dense} className="text-outline" aria-hidden="true" />
          {/* The date is the widest field by far. Below `sm` it drops the year
              and the clock — enough to keep the row count at two — and the full
              value stays available on the wrapper's `title`. */}
          <MetaValue ready={Boolean(image.created_at)} width="w-24">
            <span className="tabular-nums sm:hidden">
              {image.created_at ? formatMonthDay(image.created_at) : ''}
            </span>
            <span className="hidden tabular-nums sm:inline">
              {image.created_at ? formatDateTime(image.created_at) : ''}
            </span>
          </MetaValue>
        </div>
      </div>
    </div>
  );
}
