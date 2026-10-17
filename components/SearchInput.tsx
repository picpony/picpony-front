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
  /** A compact toolbar filter, or a standalone 56dp search bar. */
  variant?: 'filter' | 'search';
  /** Accessible name. Defaults to the placeholder — not a real label, but the
   *  text the sighted user sees is a better fallback than a generic one. */
  'aria-label'?: string;
}

/**
 * A magnifier, a placeholder, and a clear control. A toolbar's `filter` uses
 * the 40dp dense field beside its dropdowns. A standalone `search` (finding a
 * person in the share dialog) uses the 56dp pill and body-l text. The compact
 * message rail keeps `filter`, matching its adjacent 40dp collapse control.
 * Both are immediate actions, so neither borrows a form field's outlined label.
 *
 * **`shape="pill"` is baked in**, because this is /search's bar: the same corner,
 * the same magnifier, the same clear control. Keyed on the shape rather than the size.
 * The clear button needs no corner of its own: it is round, and a centred circle in a
 * pill is concentric at any radius.
 *
 * **It clears itself.** A 32/40dp clear control sits in the matching trailing slot
 * while there is text — the system's own, in place of the engine's cross (hidden in
 * globals.css: an off-token blue glyph with no hit area). Clearing keeps the caret in
 * the field, whether it was pressed or reached by Tab (it is gone once the field is
 * empty, so focus must not go with it). Escape still clears, as the engine does.
 *
 * Any other input attribute passes through to the field, and the ref reaches the input — so
 * a combobox (`useCombobox`'s `inputProps`, a keyboard handler) can be this field too.
 */
const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { value, onChange, placeholder = '搜索…', className = '', variant = 'filter', 'aria-label': ariaLabel, ...rest },
  ref,
) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const search = variant === 'search';
  return (
    <Input
      {...rest}
      ref={(node) => {
        inputRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      }}
      type="search"
      size={search ? 'lg' : 'sm'}
      shape="pill"
      icon={<MdSearch size={search ? ICON.standard : ICON.control} />}
      aria-label={ariaLabel ?? placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      fieldClassName={className}
      trailing={
        value ? (
          <IconButton
            size={search ? 'md' : 'sm'}
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
