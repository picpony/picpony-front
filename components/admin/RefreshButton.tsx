'use client';

import { MdRefresh } from 'react-icons/md';

interface RefreshButtonProps {
  onClick: () => void;
  label?: string;
  loading?: boolean;
}

export default function RefreshButton({ onClick, label = '刷新列表', loading = false }: RefreshButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary bg-primary/10 hover:bg-primary/20 rounded-lg transition-colors shrink-0 disabled:opacity-50"
    >
      <MdRefresh size={18} className={loading ? 'animate-spin' : ''} />
      {label}
    </button>
  );
}