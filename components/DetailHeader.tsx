'use client';

import Link from 'next/link';
import { MdAccessTime, MdImage, MdPerson, MdSdStorage, MdThumbUp } from 'react-icons/md';
import type { ReactNode } from 'react';
import type { ImagePreview } from '@/lib/types/image';
import Skeleton from '@/components/Skeleton';
import Badge from '@/components/Badge';
import { ICON } from '@/lib/icons';
import { formatBytes, formatCompactDateTime, formatCount, formatDate, formatDateTime } from '@/lib/format';
import { describeImage } from '@/lib/imageDescription';
import { useNow } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { useTooltip } from '@/components/Tooltip';

type DetailHeaderProps = {
  image: ImagePreview;
  layout?: 'page' | 'overlay' | 'stage';
  /**
   * The picture's full record is still on its way. A field the row already carries shows
   * either way (a list's row has the size, score, uploader and date); a field it lacks shows a
   * placeholder while this is true, and a dash once it is false — the record failed, or never
   * had it — so the strip never holds a loading bar on a finished screen.
   */
  pending?: boolean;
  /**
   * "Now" for the date's year test while the page hydrates — the moment the server rendered.
   * The server and the browser must print the same characters, and the browser's own clock is
   * not read until hydration is over (`useNow`).
   */
  referenceNow?: number | null;
};

function getImageFormat(image: ImagePreview) {
  const source = image.format || (image.representations?.full || image.view_url || '').split(/[?#]/)[0];
  return source.split('.').pop()?.toUpperCase() || '未知';
}

/** A value the row has; otherwise a placeholder while the record is coming, else a dash. */
function MetaValue({
  value,
  pending,
  width,
}: {
  value: ReactNode | null;
  pending: boolean;
  width: string;
}) {
  if (value !== null) return value;
  if (pending) {
    return (
      <Skeleton data-image-detail-meta-loading className={cn('inline-block h-4 rounded-xs', width)} />
    );
  }
  return (
    <span>
      <span aria-hidden="true">—</span>
      <span className="sr-only">未知</span>
    </span>
  );
}

/**
 * The strip above the image: its measurements, uploader and date.
 *
 * There is no visible title — a Derpibooru image has no name of its own, and
 * printing the id in the largest type on the page was not worth the machinery it
 * carried (a one-line clamp, a measured expand toggle). The picture's description
 * made of its tags (`describeImage`, never the upload's file name) is the document's
 * `<h1>` for assistive tech; it is simply not something to look at.
 *
 * **Two rows at every width, each one line**, which is a geometry contract rather than a
 * layout preference: the strip's height is `--image-detail-header-height` (two metadata
 * lines), frozen during a hero flight so the Stage and the route land the picture at the same
 * place. A row that wrapped when the content was wider than the column (three lines on a
 * 320px phone, two in the 640–1279 band that promised one) grew the header right after the
 * landing and moved the picture down under the reader. So the two rows are fixed —
 * measurements, then who and when — and a long uploader name truncates instead of wrapping.
 *
 * Centred rather than left-aligned because it is the only thing in the strip: short items
 * ranged left under nothing at all read as a caption that lost its picture.
 */
export default function DetailHeader({
  image,
  layout = 'page',
  pending = false,
  referenceNow = null,
}: DetailHeaderProps) {
  const isStage = layout === 'stage';
  const now = useNow() ?? referenceNow;
  /* The uploader link is the one item here that is focusable, so it is the one
     that can carry a real tooltip (`useTooltip` hangs `aria-describedby` and
     shows on focus as well as hover). The other items name a *value* on a
     non-focusable `<div>`, so they take an `sr-only` label instead. */
  const {
    anchorRef: uploaderRef,
    anchorProps: uploaderProps,
    tooltip: uploaderTooltip,
  } = useTooltip('上传者');

  const size = typeof image.size === 'number' && image.size > 0 ? formatBytes(image.size) : null;
  const score = typeof image.score === 'number' ? formatCount(image.score) : null;
  const created = typeof image.created_at === 'string' && image.created_at ? image.created_at : null;
  /* `null` is an anonymous upload (Derpibooru sends no name and no id); `undefined` is a row
     that did not carry the field. */
  const anonymous = image.uploader === null || (image.uploader !== undefined && !image.uploader_id);
  const uploaderKnown = image.uploader !== undefined;

  const item = 'flex shrink-0 items-center gap-1.5';
  const row = 'flex min-w-0 max-w-full items-center justify-center gap-x-3 sm:gap-x-4';

  return (
    <div
      data-image-detail-reveal="header"
      className={cn(
        'bg-transparent px-4 py-3 sm:px-6',
        isStage ? 'image-detail-header-stage overflow-hidden' : layout === 'overlay' && 'image-detail-header-route',
      )}
    >
      <h1 className="sr-only">{describeImage(image)}</h1>
      <div className="flex min-w-0 flex-col items-center gap-y-1 text-body-m text-on-surface-variant">
        <div className={row}>
          <div className={cn(item, 'min-w-0 shrink')}>
            <span className="sr-only">尺寸</span>
            <MdImage size={ICON.dense} className="shrink-0 text-outline" aria-hidden="true" />
            <span className="truncate tabular-nums">
              {image.width} × {image.height} px
            </span>
          </div>
          <div className={item}>
            <span className="sr-only">大小</span>
            <MdSdStorage size={ICON.dense} className="text-outline" aria-hidden="true" />
            <MetaValue
              value={size && <span className="tabular-nums">{size}</span>}
              pending={pending}
              width="w-14"
            />
          </div>
          <div className={item}>
            <span className="sr-only">格式</span>
            <Badge>{getImageFormat(image)}</Badge>
          </div>
        </div>
        <div className={row}>
          {uploaderKnown && !anonymous ? (
            <Link
              href={`/derpi/user/${image.uploader_id}`}
              prefetch={isStage ? false : undefined}
              scroll={false}
              ref={uploaderRef as React.Ref<HTMLAnchorElement>}
              {...uploaderProps}
              className="group relative flex min-w-0 shrink items-center gap-1.5 rounded-xs touch-target transition-ui hover:text-on-surface focus-visible:outline-hidden focus-visible:ring-2 focus-ring"
            >
              <MdPerson size={ICON.dense} className="shrink-0 text-outline" aria-hidden="true" />
              <span className="truncate underline decoration-dotted underline-offset-2 group-hover:decoration-solid">
                {image.uploader}
              </span>
              {uploaderTooltip}
            </Link>
          ) : (
            <div className={cn(item, 'min-w-0 shrink')}>
              <span className="sr-only">上传者</span>
              <MdPerson size={ICON.dense} className="shrink-0 text-outline" aria-hidden="true" />
              <MetaValue
                value={anonymous ? <span className="truncate">匿名用户</span> : null}
                pending={pending}
                width="w-20"
              />
            </div>
          )}
          <div className={item}>
            <span className="sr-only">评分</span>
            <MdThumbUp size={ICON.dense} className="text-outline" aria-hidden="true" />
            <MetaValue
              value={score && <span className="tabular-nums">{score}</span>}
              pending={pending}
              width="w-8"
            />
          </div>
          <div className={item}>
            <span className="sr-only">上传日期</span>
            <MdAccessTime size={ICON.dense} className="text-outline" aria-hidden="true" />
            {/* The date is the widest field. Below `sm` it takes the compact shape — the
                clock of a day this year, the year of an older one, never a date that reads as
                this year's when it is not — and the full value is the `title` on it. */}
            <MetaValue
              value={
                created && (
                  <time dateTime={created} title={formatDateTime(created)} className="tabular-nums">
                    <span className="sm:hidden">
                      {now === null ? formatDate(created) : formatCompactDateTime(created, now)}
                    </span>
                    <span className="hidden sm:inline">{formatDateTime(created)}</span>
                  </time>
                )
              }
              pending={pending}
              width="w-20"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
