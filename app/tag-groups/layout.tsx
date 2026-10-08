import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '标签组',
};

export default function TagGroupsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
