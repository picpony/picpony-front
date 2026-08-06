import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '浏览历史',
};

export default function HistoryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
