'use client';

import { MdSearch } from 'react-icons/md';
import { Input } from '@/components/Input';
import { ICON } from '@/lib/icons';

interface SearchInputProps {
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
 */
export default function SearchInput({
  value,
  onChange,
  placeholder = '搜索…',
  className = '',
  'aria-label': ariaLabel,
}: SearchInputProps) {
  return (
    <Input
      type="search"
      size="sm"
      icon={<MdSearch size={ICON.control} />}
      aria-label={ariaLabel ?? placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      fieldClassName={className}
    />
  );
}
