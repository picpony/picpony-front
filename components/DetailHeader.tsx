'use client';

import Link from 'next/link';
import { MdPerson } from 'react-icons/md';
import type { ReactNode } from 'react';
import type { ImagePreview } from '@/lib/types/image';
import Skeleton from '@/components/Skeleton';
import { ICON } from '@/lib/icons';
import { formatBytes, formatCompactDateTime, formatDate, formatDateTime } from '@/lib/format';
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
      <Skeleton data-image-detail-meta-loading className={cn('inline-block h-[0.9em] rounded-xs align-[-0.1em]', width)} />
    );
  }
  return (
    <span>
      <span aria-hidden="true">—</span>
      <span className="sr-only">未知</span>
    </span>
  );
}

/** The thin dot between two values on one row — ink, not a character a reader hears. */
function Dot() {
  return (
    <span aria-hidden="true" className="shrink-0 text-outline">
      ·
    </span>
  );
}

/**
 * The strip above the image: who uploaded it and when, then what the file is.
 *
 * There is no visible title — a Derpibooru image has no name of its own, and
 * printing the id in the largest type on the page was not worth the machinery it
 * carried (a one-line clamp, a measured expand toggle). The picture's description
 * made of its tags (`describeImage`, never the upload's file name) is the document's
 * `<h1>` for assistive tech; it is simply not something to look at.
 *
 * **A byline and a caption**, the shape a list item's headline and supporting text take
 * everywhere else in the app: the uploader and the date in `label-l`, then the file's
 * measurements in `body-s`, joined by dots rather than each wearing a glyph — six icons in
 * two lines of type were louder than the values, and an SD card for 文件大小 read as a
 * storage setting. The format is a word in that caption, not a `Badge`: a filled box in a
 * row of plain values was the heaviest thing in the strip and said the least. The score is
 * not here: `DetailVotes`, under the picture, prints the same number with its two halves.
 *
 * **In a wide column, one row spanning it**: the byline at the leading edge, the caption at
 * the trailing one — the same span and the same split as the votes row and the action row
 * under the picture, whose edges it now shares. A short centred block over a full-width body
 * read as a stray caption; this reads as the column's first row. **In a narrow one, two centred
 * rows** (`.image-detail-header-rows` switches on the column's own width, not the viewport's),
 * since the halves no longer fit one line, and on a phone the byline shares its band with the
 * pinned back affordance and step arrows (`image-detail-header-byline` keeps it clear of them;
 * it used to run under the back button with a long name).
 *
 * **Each row one line, never wrapped**, which is a geometry contract rather than a layout
 * preference: the strip's height is `--image-detail-header-height` (the rows' line boxes, from
 * the same tokens as the classes below, per breakpoint), frozen during a hero flight so the
 * Stage and the route land the picture at the same place. A row that wrapped grew the header
 * right after the landing and moved the picture down under the reader, so the byline truncates
 * its one long value (the uploader's name) instead.
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
     non-focusable element, so they take an `sr-only` label instead. */
  const {
    anchorRef: uploaderRef,
    anchorProps: uploaderProps,
    tooltip: uploaderTooltip,
  } = useTooltip('上传者');

  const size = typeof image.size === 'number' && image.size > 0 ? formatBytes(image.size) : null;
  const created =
    typeof image.created_at === 'string' && image.created_at ? image.created_at : null;
  /* `null` is an anonymous upload (Derpibooru sends no name and no id); `undefined` is a row
     that did not carry the field. */
  const anonymous = image.uploader === null || (image.uploader !== undefined && !image.uploader_id);
  const uploaderKnown = image.uploader !== undefined;

  const row = 'flex min-w-0 max-w-full items-center justify-center gap-x-2';

  return (
    <div
      data-image-detail-reveal="header"
      className={cn(
        'bg-transparent px-4 py-3 sm:px-6',
        isStage
          ? 'image-detail-header-stage overflow-hidden'
          : layout === 'overlay' && 'image-detail-header-route',
      )}
    >
      <h1 className="sr-only">{describeImage(image)}</h1>
      <div className="image-detail-header-rows">
        <div className={cn(row, 'image-detail-header-byline text-label-l text-on-surface')}>
          {uploaderKnown && !anonymous ? (
            <Link
              href={`/derpi/user/${image.uploader_id}`}
              prefetch={isStage ? false : undefined}
              scroll={false}
              ref={uploaderRef as React.Ref<HTMLAnchorElement>}
              {...uploaderProps}
              className="group relative flex min-w-0 shrink items-center gap-1.5 rounded-xs touch-target transition-ui hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-ring"
            >
              <MdPerson
                size={ICON.dense}
                className="shrink-0 text-on-surface-variant group-hover:text-primary"
                aria-hidden="true"
              />
              <span className="truncate decoration-1 underline-offset-2 group-hover:underline">
                {image.uploader}
              </span>
              {uploaderTooltip}
            </Link>
          ) : (
            <div className="flex min-w-0 shrink items-center gap-1.5">
              <span className="sr-only">上传者</span>
              <MdPerson
                size={ICON.dense}
                className="shrink-0 text-on-surface-variant"
                aria-hidden="true"
              />
              <MetaValue
                value={anonymous ? <span className="truncate">匿名用户</span> : null}
                pending={pending}
                width="w-20"
              />
            </div>
          )}
          <Dot />
          <div className="shrink-0 text-on-surface-variant">
            <span className="sr-only">上传日期</span>
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
        <div className={cn(row, 'shrink-0 text-body-s text-on-surface-variant tabular-nums')}>
          <span className="min-w-0 truncate">
            <span className="sr-only">尺寸</span>
            {image.width} × {image.height} px
          </span>
          <Dot />
          <span className="shrink-0">
            <span className="sr-only">大小</span>
            <MetaValue value={size} pending={pending} width="w-12" />
          </span>
          <Dot />
          <span className="shrink-0">
            <span className="sr-only">格式</span>
            {getImageFormat(image)}
          </span>
        </div>
      </div>
    </div>
  );
}
