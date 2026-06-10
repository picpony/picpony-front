'use client';

interface EmptyStateProps {
  message?: string;
  icon?: React.ReactNode;
  colSpan?: number;
}

export default function EmptyState({ message = '暂无数据', icon, colSpan = 1 }: EmptyStateProps) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-12 text-center text-slate-500 dark:text-slate-400">
        {icon && <div className="mb-2 flex justify-center">{icon}</div>}
        {message}
      </td>
    </tr>
  );
}