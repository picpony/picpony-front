'use client';

import { MdSearch } from 'react-icons/md';
import { Input } from '@/components/Input';

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

export default function SearchInput({
  value,
  onChange,
  placeholder = '搜索...',
  className = '',
  'aria-label': ariaLabel,
}: SearchInputProps) {
  return (
    <Input
      type="search"
      icon={<MdSearch size={20} />}
      aria-label={ariaLabel ?? placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      fieldClassName={className}
    />
  );
}
