'use client';

import type { DerivedTheme } from '@/lib/paletteRule';
import { cn } from '@/lib/utils';
import Skeleton from '@/components/Skeleton';

/**
 * What a colour *becomes*: the bar with its own ink, the mark colour, and the
 * dark scheme — the whole reason the palette dialogs exist instead of an OS
 * colour picker, since what is being chosen is a `primary` fill whose
 * consequences are invisible in a swatch. Shared by both dialogs so they cannot
 * disagree about what a seed means.
 *
 * Colours are inline `style` rather than tokens on purpose: every colour token
 * is the *active* theme's, and this panel shows a theme not yet in force.
 */
export default function PalettePreview({ derived, caption }: { derived?: DerivedTheme; caption: string }) {
  // A cold picker has the same rows before its colour recipe loads. Hiding the
  // ink preserves the wrapping geometry; one shimmer marks the whole preview.
  const loading = !derived;
  return (
    <div
      aria-hidden={loading || undefined}
      className="border-outline-variant relative overflow-hidden rounded-md border"
      style={derived ? { background: derived.light.surface } : undefined}
    >
      {loading && (
        <div className="absolute inset-0">
          <Skeleton className="h-full rounded-none" />
        </div>
      )}
      <div
        className={cn('flex h-12 items-center justify-between px-4', loading && 'invisible')}
        style={derived ? { background: derived.light.primary, color: derived.light['on-primary'] } : undefined}
      >
        <span className="text-title-s">PicPony</span>
        <span className="text-label-m font-mono tabular-nums">{caption}</span>
      </div>
      <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3', loading && 'invisible')}>
        <span
          className="size-4 shrink-0 rounded-full"
          style={derived ? { background: derived.light['primary-ink'] } : undefined}
        />
        <span className="text-body-s" style={derived ? { color: derived.light['on-surface-variant'] } : undefined}>
          图标与标记 <span className="font-mono tabular-nums">{derived?.light['primary-ink'] ?? caption}</span>
        </span>
        <span
          className="text-label-s ml-auto rounded-full px-3 py-1"
          style={derived ? { background: derived.dark.primary, color: derived.dark['on-primary'] } : undefined}
        >
          深色方案 <span className="font-mono tabular-nums">{derived?.dark.primary ?? caption}</span>
        </span>
      </div>
    </div>
  );
}
