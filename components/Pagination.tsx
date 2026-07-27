'use client';

import { MdRefresh } from 'react-icons/md';

interface PaginationProps {
  currentPage: number;
  hasMore: boolean;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}

const navButtonClass =
  'px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 ease-[var(--ease-standard)] active:scale-95';

export default function Pagination({ currentPage, hasMore, onPageChange, disabled }: PaginationProps) {
  return (
    <div className="mt-12 flex justify-center items-center gap-1.5 sm:gap-2">
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1 || disabled}
        data-ripple
        className={navButtonClass}
      >
        上一页
      </button>

      <div className="flex items-center gap-1 sm:gap-2">
        {Array.from({ length: 5 }, (_, i) => {
          let pageNum;
          if (currentPage <= 3) {
            pageNum = i + 1;
          } else {
            pageNum = currentPage - 2 + i;
          }

          return (
            <button
              key={pageNum}
              onClick={() => onPageChange(pageNum)}
              disabled={disabled}
              data-ripple
              className={`w-8 sm:w-10 h-8 sm:h-10 rounded-lg flex items-center justify-center transition-all duration-200 ease-[var(--ease-standard)] text-xs sm:text-sm active:scale-90 ${
                currentPage === pageNum
                  ? 'bg-primary text-white font-medium scale-105 shadow-md shadow-primary/30'
                  : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 hover:-translate-y-0.5'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {pageNum}
            </button>
          );
        })}
      </div>

      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={!hasMore || disabled}
        data-ripple
        className={navButtonClass}
      >
        下一页
      </button>
    </div>
  );
}

interface LoadMoreButtonProps {
  onClick: () => void;
  isLoading: boolean;
  disabled?: boolean;
}

export function LoadMoreButton({ onClick, isLoading, disabled }: LoadMoreButtonProps) {
  return (
    <div className="mt-12 flex justify-center">
      <button
        onClick={onClick}
        disabled={isLoading || disabled}
        data-ripple
        className="px-8 py-3 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 font-medium rounded-full transition-all duration-200 ease-[var(--ease-standard)] flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 group"
      >
        {isLoading ? (
          <div className="flex gap-1 items-center">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-1.5 h-1.5 bg-primary rounded-full animate-[dot-bounce_1s_ease-in-out_infinite]"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </div>
        ) : (
          <MdRefresh size={20} className="group-hover:rotate-180 transition-transform duration-500 ease-[var(--ease-standard)]" />
        )}
        <span>{isLoading ? '正在加载' : '加载更多'}</span>
      </button>
    </div>
  );
}
