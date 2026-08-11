import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '搜索',
};

export default function SearchLayout({ children }: { children: React.ReactNode }) {
  return children;
}
