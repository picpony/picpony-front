'use client';

import type { ReactNode } from 'react';
import SectionHeading from '@/components/SectionHeading';
import { ICON } from '@/lib/icons';
import RefreshButton from './RefreshButton';
import { ADMIN_SECTIONS, type AdminSectionId } from './sections';

interface SectionHeaderProps {
  /** The section this panel is: its name and mark are the rail tab's own (`ADMIN_SECTIONS`). */
  section: AdminSectionId;
  subtitle?: ReactNode;
  /** Re-reads the panel's list. Omit where there is nothing to re-read (a form-only section). */
  onRefresh?: () => void;
  refreshLabel?: string;
  /** The refresh is itself running — its spinner, never a second label. */
  isLoading?: boolean;
  actions?: ReactNode;
}

/**
 * The console's panel header: `SectionHeading` (type role, tinted glyph, subtitle) plus the
 * console's trailing actions. The title and the glyph are the section's own, read from the same
 * source as the rail, so the tab pressed and the heading it opens cannot disagree (G4-010).
 *
 * **The action row is always there, at 40dp** — the height of the refresh button — whether or not
 * the panel has anything to put in it. A panel with no refresh used to render a bare heading 9px
 * shorter, so every switch into or out of 概览 and 其他功能 moved the heading (R9-005).
 *
 * **The panel's own rhythm spaces it.** The header is always one plain wrapper, and the heading
 * inside drops its margin: Tailwind 4's `space-y-*` is a `margin-block-end` on every child but the
 * last, at zero specificity, so a `mb-0` on the header's own root cancelled the panel's gap rather
 * than standing in for it, and the header sat flush on whatever followed (0px where `space-y-6`
 * asks for 24 — D1-007).
 */
export default function SectionHeader({
  section,
  subtitle,
  onRefresh,
  refreshLabel,
  isLoading,
  actions,
}: SectionHeaderProps) {
  const { label, glyph: Glyph } = ADMIN_SECTIONS[section];
  return (
    <div>
      <SectionHeading
        icon={<Glyph size={ICON.standard} />}
        className="mb-0"
        actions={
          <div className="flex min-h-10 flex-wrap items-center justify-end gap-2">
            {actions}
            {onRefresh && <RefreshButton onClick={onRefresh} label={refreshLabel} loading={isLoading} />}
          </div>
        }
      >
        {label}
      </SectionHeading>
      {/* The subtitle sits under the title row rather than inside it: in the row it made the
          title's block taller than the 40dp action row, which moved the title up by 8px on exactly
          the panels that had one. */}
      {subtitle && <p className="mt-1 text-body-m text-on-surface-variant wrap-anywhere">{subtitle}</p>}
    </div>
  );
}
