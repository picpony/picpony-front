'use client';

import { createContext, useContext, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';

const FrozenSearchParamsContext = createContext<string | null>(null);

export function BackgroundLocationProvider({
  frozenSearch,
  children,
}: {
  frozenSearch: string | null;
  children: React.ReactNode;
}) {
  return (
    <FrozenSearchParamsContext.Provider value={frozenSearch}>
      {children}
    </FrozenSearchParamsContext.Provider>
  );
}

export function useBackgroundSearchParams() {
  const frozenSearch = useContext(FrozenSearchParamsContext);
  const liveSearchParams = useSearchParams();

  return useMemo(
    () =>
      frozenSearch === null
        ? liveSearchParams
        : new URLSearchParams(frozenSearch),
    [frozenSearch, liveSearchParams]
  );
}
