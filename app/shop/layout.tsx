import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '金币商店',
};

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return children;
}
