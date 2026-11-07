'use client';

import type { ComponentProps, ReactNode, Ref } from 'react';
import { MdDownload, MdFlag, MdLibraryAdd, MdOpenInNew, MdShare, MdStar, MdStarBorder, MdTranslate } from 'react-icons/md';
import Button from '@/components/Button';
import ButtonLink from '@/components/ButtonLink';
import IconButton, { iconButtonClasses } from '@/components/IconButton';
import { cn } from '@/lib/utils';

const DERPI_LABEL = '在 Derpibooru 查看';

/** An inert flight copy needs the primitive's geometry, without tooltip hooks or navigation. */
function ActionIconCopy(props: ComponentProps<typeof IconButton>) {
  return <span aria-hidden="true" className={iconButtonClasses(props)}>{props.icon}</span>;
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
  children,
}: DetailActionsProps) {
  const ActionIcon = passive ? ActionIconCopy : IconButton;
  return (
    <div
      data-image-detail-actions
      inert={passive || undefined}
      aria-hidden={passive || undefined}
      className="flex flex-wrap items-center gap-x-2 gap-y-3"
    >
      <div className="flex flex-wrap gap-2">
        <Button variant="filled" icon={<MdDownload />} loading={downloading} onClick={onDownload}>
          下载原图
        </Button>
        {passive ? (
          <Button variant="tonal" icon={<MdOpenInNew />}>{DERPI_LABEL}</Button>
        ) : (
          <ButtonLink
            href={imageId ? `https://trixiebooru.org/${imageId}` : 'https://trixiebooru.org/'}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="在 Derpibooru 查看（在新标签页打开）"
            variant="tonal"
            prefetch={false}
            icon={<MdOpenInNew />}
          >
            {DERPI_LABEL}
          </ButtonLink>
        )}
      </div>
      <div className="mx-auto flex items-center gap-1 sm:me-0 sm:ms-auto">
        <ActionIcon
          ref={faveRef}
          toggle
          selected={isFaved}
          selectedTone="tertiary"
          loading={faveBusy}
          aria-label="收藏"
          icon={isFaved ? <MdStar className={cn(faveFill && 'animate-reaction-fill')} /> : <MdStarBorder />}
          onClick={onFave}
        />
        <ActionIcon
          aria-label="收藏到…"
          aria-haspopup="dialog"
          aria-expanded={pickerOpen}
          icon={<MdLibraryAdd />}
          onClick={onPickFolder}
        />
        <ActionIcon
          ref={shareRef}
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
            toggle
            selected={translationShown}
            loading={translationBusy}
            aria-label="图片翻译"
            icon={<MdTranslate />}
            onClick={onTranslate}
          />
        )}
        <ActionIcon aria-label="举报" icon={<MdFlag />} onClick={onReport} />
      </div>
    </div>
  );
}
