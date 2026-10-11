'use client';

import { createContext, useContext } from 'react';

/** Server seed shared by the provider and the spoiler store's hydrating snapshot. */
export const SpoilerTagsContext = createContext<readonly string[]>([]);

/** The tags to assume on the first render, before the store reads localStorage. */
export function useSsrSpoilerTags(): readonly string[] {
  return useContext(SpoilerTagsContext);
}
