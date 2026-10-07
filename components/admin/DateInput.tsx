'use client';

import { useState, type ComponentProps } from 'react';
import { Input } from '@/components/Input';
import { cn } from '@/lib/utils';
import styles from './DateInput.module.css';

type DateInputProps = Omit<ComponentProps<typeof Input>, 'type'>;

/**
 * A native date field in the shared outlined shell. At rest an empty Chromium date editor shows
 * the local hint 年 / 月 / 日, not its mixed Windows placeholder yyyy/mm/日 (R9-039). Focus hands
 * the editor straight back to the platform: its date segments, calendar, keyboard and screen
 * reader contract stay native. The hint sits at the field's 16dp text inset and 14dp block inset
 * (the 56dp field less its 28px line, divided by two); CSS hides the native empty segments only
 * on engines that support that pseudo-element.
 */
export default function DateInput({ value, fieldClassName, onFocus, onBlur, ...props }: DateInputProps) {
  const [focused, setFocused] = useState(false);
  const empty = !value && !focused;
  return (
    <div className={cn(styles.field, 'relative', fieldClassName)} data-empty={empty ? '' : undefined}>
      <Input
        {...props}
        type="date"
        value={value}
        onFocus={(event) => { setFocused(true); onFocus?.(event); }}
        onBlur={(event) => { setFocused(false); onBlur?.(event); }}
      />
      {empty && <span aria-hidden="true" className={cn(styles.hint, 'pointer-events-none absolute start-4 top-3.5 text-body-l text-on-surface-variant')}>年 / 月 / 日</span>}
    </div>
  );
}
