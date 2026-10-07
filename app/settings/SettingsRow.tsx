'use client';

import { forwardRef, type ReactNode } from 'react';
import Button from '@/components/Button';
import ToggleSwitch from '@/components/ToggleSwitch';
import SectionHeading from '@/components/SectionHeading';
import { useTooltip } from '@/components/Tooltip';
import { useMediaQuery } from '@/lib/hooks';
import { MEDIA } from '@/lib/constants';
import { cn } from '@/lib/utils';

/**
 * The one row of /settings. A grouped-list row (`.m3-row` gives the run its cut corners and its
 * 2px seams) in the reading order M3's list has: **label column first, control at the trailing
 * edge, at every width**. The label column takes `min-w-0 flex-1`, so a long value wraps inside
 * it instead of pushing the control onto a line of its own.
 *
 * **Not a control, so no state layer.** The row used to wear the hover layer: hovering one lit it up
 * though nothing in it answered a click on the row, and a switch row lit twice (its own 40dp
 * circle as well). The controls inside carry their own feedback.
 *
 * **One type pairing, so one height.** The label is `label-l` on `on-surface` and the supporting
 * line `body-s` on `on-surface-variant` — `ToggleSwitch layout="row"`'s own pair — whether the
 * line is a value (an address, a username) or a description. A two-line row is 72dp beside a
 * 40dp control; a row with a 56dp avatar is 88.
 *
 * **No leading glyphs.** Six rows carried one and the rest did not; the section headings carry
 * the section's glyph, and a row's leading slot is for media only (the avatar, the banner).
 */
export const ROW_CLASS = 'm3-row flex items-center gap-4 bg-surface-container-low p-4';

export function SettingsRow({
  label,
  badge,
  supporting,
  leading,
  action,
  labelId,
  children,
  'aria-hidden': ariaHidden,
}: {
  label: ReactNode;
  /** A mark on the label's line — 已验证 beside an address. */
  badge?: ReactNode;
  /** One supporting line: the current value, or what the setting does. */
  supporting?: ReactNode;
  /** Media only: an avatar, a banner preview. */
  leading?: ReactNode;
  /** The trailing control, or a small group of them. */
  action?: ReactNode;
  /** For a control that names itself after the row (`aria-labelledby`). */
  labelId?: string;
  /** A block under the row's text that needs the full width (the palette chips). */
  children?: ReactNode;
  /**
   * For a placeholder row that stands in for a real one while its read is in flight. Declared, not
   * spread: TypeScript does not check a hyphenated JSX attribute against a component's props, so an
   * undeclared `aria-hidden` here compiled and was silently dropped.
   */
  'aria-hidden'?: boolean | 'true';
}) {
  const head = (
    <>
      {leading}
      <div className="min-w-0 flex-1">
        <p id={labelId} className="text-label-l text-on-surface flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 wrap-anywhere">{label}</span>
          {badge}
        </p>
        {supporting && <div className="text-body-s text-on-surface-variant mt-0.5 wrap-anywhere">{supporting}</div>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </>
  );
  if (!children) return <div className={ROW_CLASS} aria-hidden={ariaHidden || undefined}>{head}</div>;
  return (
    <div className={cn(ROW_CLASS, 'flex-col items-stretch')} aria-hidden={ariaHidden || undefined}>
      <div className="flex items-center gap-4">{head}</div>
      {children}
    </div>
  );
}

/** A switch row: the whole label is the switch's target, the reading order is the row's. */
export function SwitchRow(props: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={ROW_CLASS}>
      <ToggleSwitch layout="row" {...props} />
    </div>
  );
}

/**
 * A section: its heading, then one run of rows. **One run per parent** is `.m3-row`'s contract
 * (the last row's corners are found by counting rows from the end), so everything that is not a
 * row — a status line, a sign-in prompt — goes before the rows or outside the run.
 */
export function SettingsSection({
  title,
  icon,
  subtitle,
  actions,
  status,
  children,
}: {
  title: string;
  icon: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** An inline notice between the heading and the rows (a failed read). */
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-8">
      <SectionHeading icon={icon} subtitle={subtitle} actions={actions}>
        {title}
      </SectionHeading>
      {status}
      <div>{children}</div>
    </section>
  );
}

/**
 * A row's labelled action. Below `sm` it collapses to its glyph (`responsiveLabel`), and only then
 * does it show its label as a tooltip — on a wider screen the label is on the button, and a
 * tooltip repeating visible text is noise. `label` is also the accessible name, so a short visible
 * word (更换) can carry the whole action (更换头像) for a screen reader.
 */
export const RowButton = forwardRef<
  HTMLButtonElement,
  {
    label: string;
    children: string;
    icon: ReactNode;
    onClick: () => void;
    variant?: 'tonal' | 'filled' | 'text' | 'danger-text';
    loading?: boolean;
    disabled?: boolean;
    collapse?: boolean;
  }
>(function RowButton({ label, children, icon, onClick, variant = 'tonal', loading, disabled, collapse = true }, ref) {
  const wide = useMediaQuery(MEDIA.sm, true);
  const { anchorRef, anchorProps, tooltip } = useTooltip(collapse && !wide && !disabled ? label : undefined);
  return (
    <>
      <Button
        ref={(node) => {
          anchorRef.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
        {...anchorProps}
        variant={variant}
        icon={icon}
        onClick={onClick}
        loading={loading}
        disabled={disabled}
        responsiveLabel={collapse}
        aria-label={label === children ? undefined : label}
      >
        {children}
      </Button>
      {tooltip}
    </>
  );
});
