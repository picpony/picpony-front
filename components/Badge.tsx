'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type BadgeTone =
  | 'neutral'
  | 'primary'
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  /** Sits on a photograph — the media roles, not the surface ones. */
  | 'media'
  /** Colour supplied by `style` — see `UserBadge`, whose fill is author-chosen. */
  | 'custom';
export type BadgeSize = 'sm' | 'md';

interface BadgeProps {
  children?: ReactNode;
  tone?: BadgeTone;
  size?: BadgeSize;
  icon?: ReactNode;
  /** Container/ink pair as raw utilities, for a scale this component cannot know
   *  about — `lib/roles.ts` hands out categorical `accent-*` pairs this way. */
  colors?: string;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}

/**
 * A small, non-interactive label attached to something else.
 *
 * Not a `Chip`: a chip is a control — it has a state layer, a tab stop and usually
 * a dismiss cross. This is a *mark*. The two were used interchangeably, which is
 * how a role badge and a filter chip came to be the same width and radius while
 * meaning different things.
 *
 * `rounded-xs` (4dp) — a rounded rectangle, not a pill. The pill is M3's shape for
 * the *numeric* badge (a bare count, which `CountBadge` below renders and should);
 * a badge carrying a word is a short block of text, and at pill radius it reads as
 * a button that has lost its handler. 4dp rather than the chip's 8dp because these
 * are small: at `sm` the box is ~20px tall, where an 8dp corner is 40% of the
 * height and already reads as a capsule again — pick the radius against the box.
 *
 * Sizes exist because the enclosure differs, not because the object does: `sm`
 * beside a username, `md` standing alone in a table cell or metadata row.
 */
const TONES: Record<Exclude<BadgeTone, 'custom'>, string> = {
  neutral: 'bg-surface-container-high text-on-surface-variant',
  primary: 'bg-primary-container text-on-primary-container',
  success: 'bg-success-container text-on-success-container',
  warning: 'bg-warning-container text-on-warning-container',
  error: 'bg-error-container text-on-error-container',
  /* The one filled tone. A count is a graphic, not text on a surface, so it
     takes the scheme-independent `*-fill` pair for the same reason a progress
     bar does — see the semantic-fills block in globals.css. */
  info: 'bg-info-fill text-on-fill',
  /* A mark on a picture: the plate/ink pair the media roles exist for, same
     reasoning as `IconButton`'s `media` variant.
     **No backdrop blur.** The legibility figure that justifies the plate was
     measured without it, and the cost is real: three of these ride every gallery
     thumbnail, so a 50-card grid held ~150 backdrop-filter regions, each
     re-sampling a moving backdrop (the grid moves in the hero flight, the tab
     shared axis and every route cross-fade). Removed rather than suppressed per
     transition. */
  media: 'bg-media-plate text-on-media',
};

const SIZES: Record<BadgeSize, string> = {
  sm: 'text-label-s-emphasized gap-1 px-2 py-0.5',
  md: 'text-label-m-emphasized gap-1 px-2.5 py-1',
};

/* **The glyph size belongs to the badge**, and here it is load-bearing: a badge is
 * 20 or 24px tall with a 16px line box, so an 18dp glyph makes the box 2px taller
 * than the same badge without one — visible as a role badge standing taller beside
 * its neighbour, and as count pills reading "all icon, no number". 14 at `sm`, 16
 * at `md`, both inside the line box, so a badge with an icon is exactly as tall as
 * one without. These are **below the 18dp icon floor** on purpose: 18 is where a
 * Material Symbol stops resolving *as a control's only content*, while a badge's
 * glyph is paired with a digit or word and read as part of that phrase, not aimed
 * at. Call sites pass no size — one is ignored, as on the other primitives. */
const ICON_SIZES: Record<BadgeSize, string> = {
  sm: '[&>svg]:size-3.5',
  md: '[&>svg]:size-4',
};

/* Same guard as `Skeleton`'s conditional radius: `cn` is a plain join, so a call
 * site capping the badge's width would emit its cap *and* the default, leaving
 * Tailwind's emission order to decide. The default only stops a long name from
 * overflowing its row; a caller naming its own cap has already answered that. */
const HAS_MAX_WIDTH = /(?:^|\s)max-w-\S+/;

export default function Badge({
  children,
  tone = 'neutral',
  size = 'sm',
  icon,
  colors,
  className = '',
  style,
  title,
}: BadgeProps) {
  return (
    <span
      title={title}
      style={style}
      className={cn(
        'inline-flex items-center rounded-xs align-middle',
        !HAS_MAX_WIDTH.test(className) && 'max-w-full',
        SIZES[size],
        // `colors` outranks `tone` so a categorical pair can be passed straight
        // through without inventing a tone for every hue in the accent scale.
        colors ?? (tone === 'custom' ? '' : TONES[tone]),
        className,
      )}
    >
      {icon && (
        <span className={cn('shrink-0 [&>svg]:block', ICON_SIZES[size])} aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="truncate">{children}</span>
    </span>
  );
}

type MediaBadgeCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/* An 8dp inset inside a 16dp thumbnail leaves an 8dp corner next to the frame.
   The other corners retain Badge's 4dp shape. Keep placement with shape so
   profile thumbnails and gallery thumbnails cannot pick different recipes. */
const MEDIA_CORNERS: Record<MediaBadgeCorner, string> = {
  'top-left': 'top-2 left-2 rounded-tl-sm',
  'top-right': 'top-2 right-2 rounded-tr-sm',
  'bottom-left': 'bottom-2 left-2 rounded-bl-sm',
  'bottom-right': 'bottom-2 right-2 rounded-br-sm',
};

/** A thumbnail's corner mark: one size, plate, inset and concentric corner. */
export function MediaBadge({
  corner,
  ...props
}: Pick<BadgeProps, 'children' | 'icon'> & { corner: MediaBadgeCorner }) {
  return <Badge {...props} tone="media" size="sm" className={cn('absolute', MEDIA_CORNERS[corner])} />;
}

/**
 * The unread count pill.
 *
 * The one shared copy (there were two, identical down to the clamp and the pop).
 * The pop is the shared `animate-control-pop` token — M3's expressive fast
 * spatial spring, the one curve in the system with a visible overshoot, and the
 * right one for a mark landing in place.
 *
 * Fixed 16dp box with `min-w`, not padding-driven: a run of counts down a tab row
 * has to line up, and `1` next to `12` next to `99+` cannot if each is sized by
 * its own content. `tabular-nums` for the same reason. 16dp is M3's large-badge
 * size.
 *
 * Renders nothing at zero, so callers do not each need their own guard.
 */
export function CountBadge({
  count,
  className = '',
  label,
}: {
  count: number;
  className?: string;
  /** Accessible name, e.g. "3 条未读". Without it a bare number reads as noise. */
  label?: string;
}) {
  if (!count) return null;
  return (
    <span
      aria-label={label}
      className={cn(
        'bg-error-fill text-on-fill text-label-s-emphasized',
        'flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1',
        'leading-none tabular-nums',
        'animate-control-pop',
        className,
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
