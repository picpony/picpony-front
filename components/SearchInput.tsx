'use client';

import { MdSearch } from 'react-icons/md';
import { Input } from '@/components/Input';
import { ICON } from '@/lib/icons';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** Accessible name. Defaults to the placeholder — a placeholder alone is not
   *  a label, but it is the text the sighted user sees, so it is the right
   *  fallback rather than a generic "搜索". */
  'aria-label'?: string;
}

/**
 * The filter field: a magnifier, a placeholder, and whatever you type applied
 * immediately.
 *
 * `size="sm"` is baked in rather than offered as a prop, because this component *is*
 * the enclosure. Every one of its call sites is a filter bar above a data table, and
 * a filter bar's other controls are a 40dp `Select` and a 32dp chip — so the dense
 * step is not a choice to be made per site, it is what this object is. It rendered at
 * 56dp, the form-slot height, which made the filter the tallest thing on the densest
 * screens in the app.
 *
 * If a search field ever needs the 56dp box, that field is a form slot or a hero and
 * should reach for `Input` directly with the size it means.
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
