'use client';

import { forwardRef, useRef, type InputHTMLAttributes } from 'react';
import { MdClose, MdSearch } from 'react-icons/md';
import IconButton from '@/components/IconButton';
import { Input } from '@/components/Input';
import { ICON } from '@/lib/icons';

interface SearchInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'size' | 'type' | 'className'> {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** Accessible name. Defaults to the placeholder — not a real label, but the
   *  text the sighted user sees is a better fallback than a generic one. */
  'aria-label'?: string;
}

/**
 * The filter field: a magnifier, a placeholder, and whatever you type applied
 * immediately. `size="sm"` (the 40dp dense step) is baked in rather than
 * offered, because every call site is a filter bar beside a 40dp dropdown and a
 * 32dp chip — the step is what this object *is*, not a per-site choice. A
 * search field that wants the 56dp box is a form slot and should use `Input`
 * directly.
 *
 * **It clears itself.** A 32dp clear control sits in the dense field's trailing slot
 * while there is text — the system's own, in place of the engine's cross (hidden in
 * globals.css: an off-token blue glyph with no hit area). Clearing keeps the caret in
 * the field, whether it was pressed or reached by Tab (it is gone once the field is
 * empty, so focus must not go with it). Escape still clears, as the engine does.
 *
 * Any other input attribute passes through to the field, and the ref reaches the input — so
 * a combobox (`useCombobox`'s `inputProps`, a keyboard handler) can be this field too.
 */
const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { value, onChange, placeholder = '搜索…', className = '', 'aria-label': ariaLabel, ...rest },
  ref,
) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <Input
      {...rest}
      ref={(node) => {
        inputRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      }}
      type="search"
      size="sm"
      icon={<MdSearch size={ICON.control} />}
      aria-label={ariaLabel ?? placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      fieldClassName={className}
      trailing={
        value ? (
          <IconButton
            size="sm"
            dismiss
            aria-label="清除"
            icon={<MdClose />}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              onChange('');
              inputRef.current?.focus();
            }}
          />
        ) : undefined
      }
    />
  );
});

export default SearchInput;
