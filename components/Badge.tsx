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
 * Not a `Chip`: a chip is a control — it has a state layer, a tab stop and
 * usually a dismiss cross. This is a *mark*. The two were being used
 * interchangeably, which is why a role badge and a filter chip were the same
 * width and the same radius while meaning completely different things.
 *
 * One profile header carried three of these and they did not agree:
 *
 *   role badge      `rounded-sm px-2 py-1 text-label-m`
 *   已核验 badge     `rounded-sm px-2 py-1 text-label-m`   (matched the role)
 *   earned badges   `rounded-full px-2 py-0.5 text-label-s-emphasized`
 *
 * — so the row went square, square, round. In the admin user table the same role
 * badge was `rounded` (4dp) instead, and in a forum thread it was `rounded-xs`
 * with `uppercase tracking-wider` on top. Four shapes for one object.
 *
 * `rounded-xs` (4dp) — a rounded rectangle, not the pill this used to be.
 *
 * The pill is M3's shape for the *numeric* badge: a bare count, no wider than it
 * is tall, which `CountBadge` below still renders and should. A badge carrying a
 * word (Lv.13, 已核验, 创始人, an earned badge's name) is a short block of text,
 * and at pill radius it reads as a button that has lost its handler — the same
 * confusion `Chip` exists on the other side of. It also stops a level badge
 * competing with the genuinely circular things it sits between, the avatar and
 * the icon buttons.
 *
 * 4dp rather than the chip's 8dp because these are small: at `sm` the box is
 * about 20px tall, where an 8dp corner is 40% of the height and already reads
 * as a capsule again. The radius has to be picked against the box, not copied
 * from a bigger relative.
 *
 * Sizes exist because the enclosure differs, not because the object does:
 *
 *   sm  beside a username, where a `headline-s` sits next to it and a chunky
 *       pill competes with the name it is annotating.
 *   md  standing alone in a table cell or a metadata row, where 11px reads as
 *       a footnote.
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
  /* A mark on a picture. None of the surface roles apply over a photograph, so
     this is the plate/ink pair the media roles exist for — the same reasoning
     as `IconButton`'s `media` variant, and the pair a score pill over a gallery
     thumbnail was writing out by hand. `backdrop-blur-sm` because the plate is
     translucent and a busy photograph reads through it otherwise. */
  media: 'bg-media-plate text-on-media backdrop-blur-sm',
};

const SIZES: Record<BadgeSize, string> = {
  sm: 'text-label-s-emphasized gap-1 px-2 py-0.5',
  md: 'text-label-m-emphasized gap-1 px-2.5 py-1',
};

/* **The glyph size belongs to the badge**, the way it already does to `Button` and
 * `IconButton`, and here it is load-bearing rather than tidy: a badge is 20 or 24px
 * tall and its own line box is 16px, so an 18dp glyph — `ICON.dense`, the smallest
 * step the icon scale offers — makes the box 2px taller than the same badge without
 * one. That is measurable and it was visible: a profile's role badge stood at 24px
 * beside a 已核验 badge at 26, and the gallery thumbnail's three count pills each
 * carried an 18px glyph against 11px digits, which is what reads as "the icons are
 * too big".
 *
 * 14 at `sm` and 16 at `md`, both inside the 16px line box, so a badge with an icon is
 * exactly as tall as one without. These are **below the 18dp floor** the icon scale
 * sets, and the reason that floor does not apply is what the floor is for: 18 is where
 * a Material Symbol stops resolving *as a control's only content*. A badge's glyph is
 * paired with a digit or a word at 11–12px and is read as part of that phrase, not
 * aimed at. Call sites pass no size — one is ignored, as on the other two primitives. */
const ICON_SIZES: Record<BadgeSize, string> = {
  sm: '[&>svg]:size-3.5',
  md: '[&>svg]:size-4',
};

/* Same guard, and for the same reason, as `Skeleton`'s conditional radius: `cn`
 * is a plain join, so a call site capping the badge's width would emit its
 * `max-w-*` *and* the default `max-w-full`, leaving Tailwind's emission order to
 * decide which applied. The default only exists to stop a long name from
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

/**
 * The unread count pill.
 *
 * `Tabs` and the header's notification link each had their own copy of this,
 * identical down to the `99+` clamp and the spring pop, which is exactly the
 * kind of duplication that survives until one of them is changed. The pop is
 * the shared `animate-control-pop` token, which carries M3's expressive fast
 * spatial spring — the one curve in the system with a visible overshoot, and
 * the right one for a mark landing in place.
 *
 * Fixed 16dp box with `min-w`, not padding-driven: a run of counts down a tab
 * row has to line up, and `1` next to `12` next to `99+` cannot if each is
 * sized by its own content. `tabular-nums` for the same reason. 16dp is M3's
 * large-badge size; it was an arbitrary 18px, which is both off the spacing
 * grid and off the spec.
 *
 * Renders nothing at zero, so callers do not each need their own `!!count &&`.
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
