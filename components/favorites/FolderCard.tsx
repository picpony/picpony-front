'use client';

import { memo, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { MdFolder, MdFolderSpecial, MdLock } from 'react-icons/md';
import { useSpoilerMatch } from '@/lib/spoilers';
import { formatCount } from '@/lib/format';
import { ICON } from '@/lib/icons';
import { folderLabel } from '@/lib/favorites';
import { useFolderLongPress } from '@/lib/favoritesSelection';
import { rememberFolderOrigin } from '@/lib/folderTransit';
import { cn } from '@/lib/utils';
import type { PonyImage } from '@/lib/types/image';
import type { ProfileFaveFolder } from '@/lib/types/user';
import Badge from '@/components/Badge';
import Card from '@/components/Card';
import CheckGlyph from '@/components/CheckGlyph';
import FadeInImage from '@/components/FadeInImage';
import Skeleton from '@/components/Skeleton';

/* Two columns on a phone, three from `sm`, four from `lg` — the gallery's own steps and its
   8/16px gaps, as the profile's 收藏夹 tab lays its folders out. */
export const FOLDER_GRID = 'grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4';
const COVER_SIZES = '(min-width: 1024px) 248px, (min-width: 640px) 33vw, 50vw';

/**
 * A folder's cover: its newest picture, or `null` for the plain face. Nothing the viewer's
 * settings withhold arrives (the read is a search); a spoilered picture is not drawn, since a
 * cover has no reveal; a video has no still Derpibooru serves; a GIF's own small rendition is
 * its cover.
 */
export function folderCoverSource(image: PonyImage | undefined, spoilered: boolean): string | null {
  if (!image || spoilered) return null;
  const format = (image.format || '').toUpperCase();
  if (format === 'WEBM' || format === 'MP4') return null;
  const representations = image.representations;
  return (format === 'GIF' ? representations?.thumb : representations?.medium || representations?.small) || null;
}

export interface FolderCardSelection {
  active: boolean;
  selected: boolean;
  /** The main folder is protected: it cannot be deleted or merged, so it cannot be selected. */
  selectable: boolean;
  onToggle: (id: number, range: boolean) => void;
  onLongPress?: (id: number) => void;
}

/**
 * One folder of a folder grid: its cover, its name and how many pictures it holds — a real link
 * to the folder's page, so it can be middle-clicked, copied and long-pressed like any link. The
 * one folder card in the app: /favorites' grid and a profile's 收藏夹 tab both render it.
 *
 * Two controls can sit over it, both **siblings** of the link and never inside it (AGENTS: no
 * interactive element inside another): `menu`, the folder's own commands at the caption's
 * trailing edge, and in the folder batch mode the card's checkbox, laid over the whole card while
 * the link under it is `inert`. The card is their containing block, wherever it is rendered —
 * render it inside an `li` of `FOLDER_GRID`.
 *
 * **The mode cross-fades them** rather than swapping them in a frame (M1-002): both stay mounted,
 * the one out of use `inert`, on the effects spring — the selection bar's clock. A selected card
 * keeps its face while the mode leaves, and the tick draws itself and the disc pops on a selection
 * made on screen, as `Checkbox`'s do (M1-003).
 *
 * **It opens as a container transform** (`lib/folderTransit.ts`): a plain press records the card,
 * marked `data-folder-card` with the page's address, and the page's column grows out of it; Back
 * shrinks the page into it again. A press in the mode toggles instead and records nothing.
 */
export const FolderCard = memo(function FolderCard({
  folder,
  href,
  cover,
  coverPending,
  badges,
  menu,
  selection,
}: {
  folder: ProfileFaveFolder;
  href: string;
  cover: PonyImage | undefined;
  /** The covers are still being read: the box shimmers rather than showing the plain face first. */
  coverPending: boolean;
  /** Marks beside the count — 默认, 不公开. */
  badges?: ReactNode;
  /** The folder's own commands: an icon button and its menu. */
  menu?: ReactNode;
  selection?: FolderCardSelection;
}) {
  const router = useRouter();
  const spoilers = useSpoilerMatch(cover?.tags);
  const src = folderCoverSource(cover, spoilers.length > 0);
  const name = folderLabel(folder);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const checkboxRef = useRef<HTMLButtonElement>(null);
  const selecting = selection?.active ?? false;
  const selected = selection?.selected ?? false;
  const longPress = useFolderLongPress(selection?.selectable && !selecting ? () => selection.onLongPress?.(folder.id) : undefined);

  /* The face the mode leaves with; brought up to date once the fade is over, out of sight. */
  const [shownSelected, setShownSelected] = useState(selected);
  if (selecting && shownSelected !== selected) setShownSelected(selected);
  const ticked = selecting ? selected : shownSelected;
  const [seen, setSeen] = useState(selected);
  const [popped, setPopped] = useState(false);
  if (seen !== selected) {
    setSeen(selected);
    setPopped(selected && selecting);
  }

  /* A plain click navigates in the app, without the router's own scroll (AGENTS: one owner), and
     names the card the page grows out of. */
  const navigate = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const card = event.currentTarget.closest<HTMLElement>('[data-folder-card]');
    if (card) rememberFolderOrigin(href, card);
    router.push(href, { scroll: false });
  };

  /* The link is out of reach under its checkbox; a focus that was on it moves to the checkbox. */
  useLayoutEffect(() => {
    const link = linkRef.current;
    if (!selecting || !link) return;
    const hadFocus = link.contains(document.activeElement);
    link.inert = true;
    if (hadFocus) checkboxRef.current?.focus({ preventScroll: true });
    return () => {
      link.inert = false;
    };
  }, [selecting]);

  return (
    <div {...longPress} data-folder-card={href} className="relative">
      <Card
        ref={linkRef}
        as="a"
        href={href}
        onClick={navigate}
        variant="filled"
        padding="none"
        interactive
        className="overflow-hidden"
      >
        <span className="relative block aspect-4/3 w-full bg-surface-container-high">
          {src ? (
            <FadeInImage src={src} alt="" fill sizes={COVER_SIZES} className="object-cover" />
          ) : coverPending ? (
            <Skeleton className="absolute inset-0 rounded-none" />
          ) : (
            <span className="flex h-full items-center justify-center text-on-surface-variant" aria-hidden="true">
              {folder.isMain ? <MdFolderSpecial size={ICON.large} /> : <MdFolder size={ICON.large} />}
            </span>
          )}
        </span>
        <span className={cn('flex flex-col gap-0.5 py-2.5 pl-3', menu ? 'pr-12' : 'pr-3')}>
          <span className="truncate text-title-s text-on-surface" title={name}>
            {name}
          </span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-body-s text-on-surface-variant">
            <span className="tabular-nums">{formatCount(folder.itemCount)} 张</span>
            {badges}
          </span>
        </span>
      </Card>
      {/* The caption's own trailing action: its glyph on the caption's 12dp text inset (4dp to
          the 40dp control's edge, 8dp more to the glyph's), and the control centred on the
          caption's two lines — the 10dp under them is the caption's own padding. One inset all
          round put the glyph 16dp in, off the text column it belongs to. */}
      {menu && (
        <div
          inert={selecting}
          className={cn('absolute right-1 bottom-2.5 transition-opacity spring-fast-effects', selecting && 'opacity-0')}
        >
          {menu}
        </div>
      )}
      {selection && (
        <button
          ref={checkboxRef}
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={selection.selectable ? name : `${name}（不能删除或合并）`}
          disabled={!selection.selectable}
          inert={!selecting}
          data-ripple=""
          onClick={(event) => selection.onToggle(folder.id, event.shiftKey)}
          onTransitionEnd={(event) => {
            if (!selecting && event.target === event.currentTarget && event.propertyName === 'opacity') setShownSelected(selected);
          }}
          className={cn(
            'group absolute inset-0 z-10 block overflow-hidden rounded-md select-none touch-manipulation',
            'focus-visible:outline-hidden focus-visible:ring-2 focus-ring state-layer',
            'transition-[opacity,box-shadow] spring-fast-effects disabled:cursor-not-allowed',
            selecting ? 'cursor-pointer' : 'pointer-events-none opacity-0',
            ticked && 'inset-ring-4 inset-ring-surface',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'absolute top-2 left-2 flex size-6 items-center justify-center rounded-full border-2',
              'transition-[background-color,border-color,scale] spring-fast-effects',
              !selection.selectable
                ? 'border-transparent bg-media-plate text-on-media'
                : ticked
                  ? 'border-primary bg-primary text-on-primary forced-selected forced-colors:border-[color:Highlight]'
                  : 'border-on-media bg-media-plate forced-boundary',
              !selecting && 'scale-80',
              popped && 'animate-control-pop',
            )}
          >
            {!selection.selectable ? (
              <MdLock className="size-4" />
            ) : (
              <CheckGlyph
                className="size-4"
                pathProps={{
                  strokeDasharray: '10.5',
                  strokeDashoffset: ticked ? 0 : 10.5,
                  className: 'spring-fast-effects transition-[stroke-dashoffset]',
                  style: { transitionDelay: ticked ? 'var(--transition-duration-press)' : '0ms' },
                }}
              />
            )}
          </span>
        </button>
      )}
    </div>
  );
});

/** The marks a folder of your own carries: the default, and hidden from your profile. */
export function FolderBadges({ isDefault, isPublic }: { isDefault: boolean; isPublic: boolean }) {
  return (
    <>
      {isDefault && (
        <Badge size="sm" tone="primary">
          默认
        </Badge>
      )}
      {!isPublic && <Badge size="sm">不公开</Badge>}
    </>
  );
}

/** The cards' own shape while the list loads: a 4:3 cover and two lines. */
export function FolderGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <ul className={FOLDER_GRID} data-page-loading="" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <li key={index} className="overflow-hidden rounded-md bg-surface-container-highest">
          <Skeleton className="aspect-4/3 w-full rounded-none" delay={index * 80} />
          <div className="flex flex-col gap-1.5 px-3 py-3">
            <Skeleton className="h-4 w-3/5" delay={index * 80 + 40} />
            <Skeleton className="h-3.5 w-2/5" delay={index * 80 + 80} />
          </div>
        </li>
      ))}
    </ul>
  );
}
