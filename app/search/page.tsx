import { Suspense } from 'react';
import type { Metadata } from 'next';
import ImageGridSkeleton from '@/components/ImageGridSkeleton';
import Skeleton from '@/components/Skeleton';
import SearchScreen from './SearchScreen';
import { readSemanticConfig } from './semantic.server';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? '';

/** The first document's title names the search; the screen keeps it in step afterwards. */
export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const params = await searchParams;
  if (first(params.image)) return { title: '以图搜图结果' };
  const query = first(params.q).trim();
  return { title: query ? `搜索：${query.slice(0, 40)}` : '搜索' };
}

/**
 * The screen's own shape while it has nothing — the search bar's pill and a grid — so the page
 * does not rearrange when it arrives. `data-page-loading` holds the footer back while it is up,
 * with or without the grid under it.
 */
function SearchFallback({ hasQuery }: { hasQuery: boolean }) {
  return (
    <div className="mx-auto max-w-7xl" aria-busy="true" data-page-loading>
      <div className="mx-auto mb-6 max-w-2xl">
        <Skeleton className="h-14 w-full rounded-full" />
        {hasQuery && <Skeleton className="mx-auto mt-4 h-10 w-80 max-w-full rounded-full" />}
      </div>
      {hasQuery ? <ImageGridSkeleton /> : null}
    </div>
  );
}

/**
 * Server shell for /search. What it adds to the client screen is one fact the screen needs
 * before its first render: whether Chinese / natural-language search is on and how long a parse
 * takes — read from the status document the layout has already fetched (`semantic.server.ts`),
 * so it costs no request of its own.
 */
export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const [semantic, params] = await Promise.all([readSemanticConfig(), searchParams]);
  return (
    <Suspense fallback={<SearchFallback hasQuery={Boolean(first(params.q))} />}>
      <SearchScreen semantic={semantic} />
    </Suspense>
  );
}
