'use client';

import type { DerivedTheme } from '@/lib/paletteRule';

/**
 * What a colour *becomes*: the bar with its own ink, the mark colour, and the dark scheme.
 *
 * This is the reason both palette dialogs exist rather than an `<input type="color">`. What is
 * being chosen is not a colour, it is a `primary` fill, and everything that follows from it —
 * whether the bar takes white or dark text, what `primary-ink` comes out as, what the dark
 * scheme becomes — is invisible in a swatch. Shared by 选择颜色 and 从图片取色 so the two
 * cannot disagree about what a seed means.
 *
 * The colours are inline `style` rather than tokens on purpose, and it is the same reason the
 * chips are: every `--md-sys-color-*` is the *active* theme's, and this panel's whole job is
 * to show a theme that is not in force yet.
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
