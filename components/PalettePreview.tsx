'use client';

import { MdStar } from 'react-icons/md';

import type { PaletteHues } from '@/lib/appearance';
import { ICON } from '@/lib/icons';
import type { DerivedTheme } from '@/lib/paletteRule';
import { cn } from '@/lib/utils';
import Skeleton from '@/components/Skeleton';

/**
 * What a colour *becomes*: the bar with its own ink, a selected row and a favourite that is on —
 * the second colour and the accent under 多色, the primary's hue under 单色 — the mark colour,
 * and the dark scheme. The whole reason the palette dialogs exist instead of an OS colour picker,
 * since what is being chosen is a `primary` fill whose consequences are invisible in a swatch.
 * Shared by both dialogs so they cannot disagree about what a seed means.
 *
 * Colours are inline `style` rather than tokens on purpose: every colour token is the *active*
 * theme's, and this panel shows a theme not yet in force.
 */
export default function PalettePreview({
  derived,
  hues,
  caption,
}: {
  derived?: DerivedTheme;
  /** 配色方案 in force, which decides the two samples in the middle. */
  hues: PaletteHues;
  caption: string;
}) {
  // A cold picker has the same rows before its colour recipe loads. Hiding the
  // ink preserves the wrapping geometry; one shimmer marks the whole preview.
  const loading = !derived;
  /* Picked here rather than through the recipe's own helper: a type is all this file takes from
     it, so it can never be what carries HCT into a chunk. */
  const roles = derived ? (hues === 'mono' ? derived.mono : derived) : null;
  const light = roles?.light;
  return (
    <div
      aria-hidden={loading || undefined}
      className="border-outline-variant relative overflow-hidden rounded-md border"
      style={light ? { background: light.surface } : undefined}
    >
      {loading && (
        <div className="absolute inset-0">
          <Skeleton className="h-full rounded-none" />
        </div>
      )}
      <div
        className={cn('flex h-12 items-center justify-between px-4', loading && 'invisible')}
        style={light ? { background: light.primary, color: light['on-primary'] } : undefined}
      >
        <span className="text-title-s">PicPony</span>
        <span className="text-label-m font-mono tabular-nums">{caption}</span>
      </div>
      <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3', loading && 'invisible')}>
        {/* A selected row's pill, and a favourite that is on — the two things 配色方案 changes. */}
        <span
          className="text-label-m rounded-full px-3 py-1"
          style={light ? { background: light['secondary-container'], color: light['on-secondary-container'] } : undefined}
        >
          选中
        </span>
        <span
          className="grid size-8 shrink-0 place-items-center rounded-md"
          style={light ? { background: light['tertiary-container'], color: light['on-tertiary-container'] } : undefined}
        >
          <MdStar size={ICON.control} aria-hidden="true" />
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <span
            className="size-4 shrink-0 rounded-full"
            style={light ? { background: light['primary-ink'] } : undefined}
          />
          <span className="text-body-s" style={light ? { color: light['on-surface-variant'] } : undefined}>
            图标与标记
          </span>
        </span>
        {/* A mark carrying words, so a badge's rounded rectangle: a full pill around text
            reads as a button that has lost its handler, and this is not a control. */}
        <span
          className="text-label-s ml-auto rounded-xs px-2 py-0.5"
          style={roles ? { background: roles.dark.primary, color: roles.dark['on-primary'] } : undefined}
        >
          深色方案 <span className="font-mono tabular-nums">{roles?.dark.primary ?? caption}</span>
        </span>
      </div>
    </div>
  );
}
