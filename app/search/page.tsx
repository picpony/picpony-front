import { Suspense } from 'react';
import type { Metadata } from 'next';
import ImageGridSkeleton from '@/components/ImageGridSkeleton';
import Skeleton from '@/components/Skeleton';
import { QuickTagsSkeleton } from './QuickTags';
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
function SearchFallback({ hasQuery, hasImage, hasFrom }: { hasQuery: boolean; hasImage: boolean; hasFrom: boolean }) {
  return (
    <div className="mx-auto max-w-7xl" aria-busy="true" data-page-loading>
      <div className="mx-auto mb-6 max-w-2xl">
        <Skeleton className="h-14 w-full rounded-full" />
        {hasQuery && <Skeleton className="mx-auto mt-4 h-10 w-80 max-w-full rounded-full" />}
      </div>
      {hasImage ? (
        <>
          <div className="mb-6 flex items-center gap-3 sm:gap-4" aria-hidden="true">
            <Skeleton className="size-14 shrink-0 rounded-md" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-44" delay={60} />
            </div>
          </div>
          <ImageGridSkeleton />
        </>
      ) : hasQuery ? (
        <>
          {hasFrom && <Skeleton className="mb-3 h-10 w-full max-w-2xl rounded-md" />}
          <div className="mb-3 flex h-10 items-center" aria-hidden="true">
            <Skeleton className="h-4 w-24" />
          </div>
          <ImageGridSkeleton />
        </>
      ) : (
        <div className="mx-auto max-w-2xl" aria-hidden="true">
          <div className="mb-8">
            <Skeleton className="mb-2 h-6 w-20" />
            <QuickTagsSkeleton />
          </div>
        </div>
      )}
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
    <Suspense
      fallback={
        <SearchFallback
          hasQuery={Boolean(first(params.q).trim())}
          hasImage={Boolean(first(params.image))}
          hasFrom={Boolean(first(params.from))}
        />
      }
    >
      <SearchScreen semantic={semantic} />
    </Suspense>
  );
}
