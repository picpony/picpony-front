'use client';

import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Input } from '@/components/Input';
import Popover, { estimateMenuHeight } from '@/components/Popover';
import { SKIP, useResource } from '@/lib/resource';
import { tagCategoryDot } from '@/lib/tagCategories';
import { useCombobox } from '@/lib/useCombobox';
import { formatCount } from '@/lib/format';
import { cn } from '@/lib/utils';
import { derpiTagSearch } from './resources';
import type { DerpiTagRow } from './model';

/** Long enough that a tag typed at speed asks Derpibooru once (R9-031). */
export const SUGGEST_DEBOUNCE_MS = 300;
const MIN_QUERY = 2;

const ROW =
  'flex min-h-10 pointer-coarse:min-h-12 w-full cursor-pointer items-center gap-3 rounded-sm px-3 py-1.5 text-left select-none';

/**
 * The create dialog's 英文标签 field, with Derpibooru's tags as suggestions — `useCombobox`
 * (R9-032): the arrows move a cursor through the list, Enter picks it (or, with none chosen,
 * submits the form), Escape closes the list and leaves the dialog open. A lookup waits for
 * typing to pause, a new one abandons the last, and an IME's composition asks nothing.
 */
export default function TagSuggestField({
  id,
  value,
  onChange,
  onPick,
  error,
  readOnly,
  label = '英文标签',
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onPick: (tag: DerpiTagRow) => void;
  error?: ReactNode;
  readOnly?: boolean;
  label?: string;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const read = useResource(derpiTagSearch, query ? { query } : SKIP, { keepPrevious: 'glossary-suggest' });
  const options = query ? (read.data ?? []) : [];

  const lookUp = (text: string) => {
    clearTimeout(timer.current);
    const term = text.trim();
    if (term.length < MIN_QUERY) {
      setQuery('');
      return;
    }
    setOpen(true);
    timer.current = setTimeout(() => setQuery(term), SUGGEST_DEBOUNCE_MS);
  };

  const box = useCombobox({
    options,
    open,
    onOpenChange: setOpen,
    onSelect: (tag) => {
      clearTimeout(timer.current);
      setQuery('');
      onPick(tag);
    },
    onCompositionEnd: (committed) => lookUp(committed),
    resetKey: query,
  });

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(event.target.value);
    if (box.isComposing()) return;
    lookUp(event.target.value);
  };

  return (
    <div ref={anchorRef}>
      <Input
        id={id}
        label={label}
        required
        value={value}
        readOnly={readOnly}
        error={error}
        placeholder="例如：twilight sparkle"
        className="font-mono"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        helper="输入两个以上字母后显示原站的标签建议"
        {...box.inputProps}
        onChange={handleChange}
        onBlur={() => setOpen(false)}
      />
      <Popover
        open={box.isOpen && !readOnly}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        maxHeight={288}
        estimatedHeight={estimateMenuHeight(options.length, 48)}
        className="p-2"
        {...box.listboxProps}
        aria-label="原站标签建议"
      >
        {options.map((tag, index) => (
          <div key={tag.name} {...box.getOptionProps(index)} className={cn(ROW, box.optionClassName(index))}>
            <span className="grid size-6 shrink-0 place-items-center" aria-hidden="true">
              <span className={cn('size-2.5 rounded-full', tagCategoryDot(tag.category))} />
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-label-l text-on-surface">{tag.name}</span>
            <span className="shrink-0 text-label-m tabular-nums text-on-surface-variant">
              {`${formatCount(tag.images)} 图`}
            </span>
          </div>
        ))}
      </Popover>
    </div>
  );
}
