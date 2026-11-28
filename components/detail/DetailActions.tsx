'use client';

import { useLayoutEffect, useRef, type ComponentProps, type ReactNode, type Ref } from 'react';
import {
  MdDownload,
  MdFlag,
  MdLibraryAdd,
  MdOpenInNew,
  MdShare,
  MdStar,
  MdStarBorder,
  MdTranslate,
} from 'react-icons/md';
import Button from '@/components/Button';
import IconButton, { iconButtonClasses } from '@/components/IconButton';
import { useTooltip } from '@/components/Tooltip';
import { cn } from '@/lib/utils';

const DERPI_LABEL = '在 Derpibooru 查看';

/** An inert flight copy needs the primitive's geometry, without tooltip hooks or navigation. */
function ActionIconCopy(props: ComponentProps<typeof IconButton>) {
  return (
    <span aria-hidden="true" className={iconButtonClasses(props)}>
      {props.icon}
    </span>
  );
}

interface DetailActionsProps {
  imageId?: number;
  passive?: boolean;
  isFaved?: boolean;
  faveFill?: boolean;
  faveBusy?: boolean;
  downloading?: boolean;
  sharing?: boolean;
  pickerOpen?: boolean;
  shareOpen?: boolean;
  canTranslate?: boolean;
  translationShown?: boolean;
  translationBusy?: boolean;
  faveRef?: Ref<HTMLButtonElement>;
  shareRef?: Ref<HTMLButtonElement>;
  onDownload?: () => void;
  onFave?: () => void;
  onPickFolder?: () => void;
  onShare?: () => void;
  onTranslate?: () => void;
  onReport?: () => void;
  /** Compact read-only metadata centered between primary and secondary actions on wide rows. */
  center?: ReactNode;
  children?: ReactNode;
}

/** Shared by the Stage, loading view and live detail; see docs/hero.md#data-and-handoff. */
export default function DetailActions({
  imageId,
  passive = false,
  isFaved = false,
  faveFill = false,
  faveBusy = false,
  downloading = false,
  sharing = false,
  pickerOpen = false,
  shareOpen = false,
  canTranslate = true,
  translationShown = false,
  translationBusy = false,
  faveRef,
  shareRef,
  onDownload,
  onFave,
  onPickFolder,
  onShare,
  onTranslate,
  onReport,
  center,
  children,
}: DetailActionsProps) {
  const ActionIcon = passive ? ActionIconCopy : IconButton;
  const rootRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLDivElement>(null);
  const {
    anchorRef: derpiRef,
    anchorProps: derpiProps,
    tooltip: derpiTooltip,
  } = useTooltip(passive ? undefined : DERPI_LABEL);

  /* Match the wide-row secondary capsule to the primary actions' total width.
     Both favourite labels share one grid cell so toggling never shifts the row.
     The capsule's inset controls follow docs/design/layout.md#rows-and-responsive-regions. */
  useLayoutEffect(() => {
    const root = rootRef.current;
    const primary = primaryRef.current;
    if (!root || !primary) return;
    let last = '';
    const sync = () => {
      const width = primary.offsetWidth;
      if (width <= 0) return;
      const next = `${width}px`;
      if (next === last) return;
      last = next;
      root.style.setProperty('--detail-primary-w', next);
    };
    sync();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(sync);
    observer.observe(primary);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={rootRef}
      data-image-detail-actions
      inert={passive || undefined}
      aria-hidden={passive || undefined}
      className="@container w-full"
    >
      <div className="flex flex-col gap-3 @3xl:grid @3xl:grid-cols-[1fr_minmax(16rem,26rem)_1fr] @3xl:items-center @3xl:gap-x-4">
        <div
          ref={primaryRef}
          className="grid grid-cols-2 gap-2 @3xl:flex @3xl:items-center @3xl:justify-self-start"
        >
          <Button
            variant="filled"
            icon={<MdDownload />}
            loading={downloading}
            onClick={onDownload}
            className="w-full @3xl:w-auto"
          >
            下载原图
          </Button>
          <Button
            ref={faveRef}
            variant={isFaved ? 'tertiary' : 'tonal'}
            aria-label={passive ? undefined : '收藏'}
            aria-pressed={passive ? undefined : isFaved}
            loading={faveBusy}
            className={cn(
              'w-full @3xl:w-auto',
              isFaved && 'rounded-md data-pressed:rounded-sm forced-selected',
            )}
            icon={
              isFaved ? (
                <MdStar className={cn(faveFill && 'animate-reaction-fill')} />
              ) : (
                <MdStarBorder />
              )
            }
            onClick={onFave}
          >
            <span className="grid place-items-center">
              <span
                aria-hidden={!isFaved || undefined}
                className={cn('col-start-1 row-start-1', !isFaved && 'invisible')}
              >
                已收藏
              </span>
              <span
                aria-hidden={isFaved || undefined}
                className={cn('col-start-1 row-start-1', isFaved && 'invisible')}
              >
                收藏
              </span>
            </span>
          </Button>
        </div>
        {center && (
          <div className="order-last flex w-full justify-center @3xl:order-none @3xl:justify-self-center">
            {center}
          </div>
        )}
        <div className="flex h-10 w-full items-center justify-evenly rounded-full bg-surface-container-highest px-1 @3xl:col-start-3 @3xl:w-[var(--detail-primary-w,14.125rem)] @3xl:min-w-fit @3xl:justify-between @3xl:justify-self-end pointer-coarse:@3xl:gap-4">
          <ActionIcon
            size="sm"
            aria-label="收藏到…"
            aria-haspopup="dialog"
            aria-expanded={pickerOpen}
            icon={<MdLibraryAdd />}
            onClick={onPickFolder}
          />
          <ActionIcon
            ref={shareRef}
            size="sm"
            aria-label="分享"
            aria-haspopup="menu"
            aria-expanded={shareOpen}
            loading={sharing}
            icon={<MdShare />}
            onClick={onShare}
          />
          {children}
          {canTranslate && (
            <ActionIcon
              size="sm"
              toggle
              selected={translationShown}
              loading={translationBusy}
              aria-label="图片翻译"
              icon={<MdTranslate />}
              onClick={onTranslate}
            />
          )}
          {passive ? (
            <ActionIconCopy size="sm" aria-label={DERPI_LABEL} icon={<MdOpenInNew />} />
          ) : (
            <>
              <a
                ref={derpiRef as Ref<HTMLAnchorElement>}
                {...derpiProps}
                href={imageId ? `https://trixiebooru.org/${imageId}` : 'https://trixiebooru.org/'}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="在 Derpibooru 查看（在新标签页打开）"
                data-ripple="inner"
                className={iconButtonClasses({ variant: 'standard', size: 'sm' })}
              >
                <span data-ripple-host="" aria-hidden="true" />
                <MdOpenInNew aria-hidden="true" />
              </a>
              {derpiTooltip}
            </>
          )}
          <ActionIcon size="sm" aria-label="举报" icon={<MdFlag />} onClick={onReport} />
        </div>
      </div>
    </div>
  );
}
