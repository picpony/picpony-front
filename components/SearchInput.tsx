'use client';

import { MdSearch } from 'react-icons/md';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export default function SearchInput({
  value,
  onChange,
  placeholder = '搜索...',
  className = '',
}: SearchInputProps) {
  return (
    <div className={`relative ${className}`}>
      <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm"
      />
    </div>
  );
}
