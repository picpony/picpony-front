'use client';

import type { DerivedTheme } from '@/lib/paletteRule';

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
export default function PalettePreview({ derived, caption }: { derived: DerivedTheme; caption: string }) {
  return (
    <div
      className="border-outline-variant overflow-hidden rounded-md border"
      style={{ background: derived.light.surface }}
    >
      <div
        className="flex h-12 items-center justify-between px-4"
        style={{ background: derived.light.primary, color: derived.light['on-primary'] }}
      >
        <span className="text-title-s">PicPony</span>
        <span className="text-label-m">{caption}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <span
          className="size-4 shrink-0 rounded-full"
          style={{ background: derived.light['primary-ink'] }}
        />
        <span className="text-body-s" style={{ color: derived.light['on-surface-variant'] }}>
          图标与标记 {derived.light['primary-ink']}
        </span>
        <span
          className="text-label-s ml-auto rounded-full px-3 py-1"
          style={{ background: derived.dark.primary, color: derived.dark['on-primary'] }}
        >
          深色方案 {derived.dark.primary}
        </span>
      </div>
    </div>
  );
}
