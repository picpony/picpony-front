import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

/* An unknown path is the 404, and its tab says so — it read the root default before. */
export const metadata: Metadata = { title: '页面不存在' };

export default function NotFoundCatchAll() {
  notFound();
}
