'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ImageLine } from '@/lib/route';

/**
 * The image line the **server** used when it rendered this document's `<img>` tags.
 *
 * `resolveImageLine()` reads `localStorage` and the fetched route policy, and the
 * server can see neither — so during SSR it answers with the *defaults*, and a
 * visitor who turned the proxy off got a hydration mismatch on every card (React
 * does not patch attributes, so their preference was ignored for the whole first
 * screen). `app/layout.tsx` reads the cookie and puts it here, so the client's
 * first render asks the same question and gets the same answer.
 *
 * `null` means "no cookie yet" — with nothing stored, both sides compute the
 * defaults, which is the correct answer.
 */
const ImageLineContext = createContext<ImageLine | null>(null);

/**
 * **The override is dropped once the document has hydrated, and that is the whole
 * of it.** The value only has to survive the hydrating render; after that the live
 * answer is the correct one, and holding the cookie's value is actively wrong —
 * `FadeInImage` seeds its layered attempts from this, so a fixed context keeps
 * handing out a line that may have been taken out of the running mid-session.
 * One state flip after mount fixes it.
 */
export function ImageLineProvider({
  value,
  children,
}: {
  value: ImageLine | null;
  children: ReactNode;
}) {
  const [line, setLine] = useState<ImageLine | null>(value);
  useEffect(() => {
    /* Out of the effect body: `react-hooks/set-state-in-effect` rejects a synchronous setState
       here, the same reason `HomeContent`'s fingerprint hand-off defers. */
    queueMicrotask(() => setLine(null));
  }, []);
  return <ImageLineContext.Provider value={line}>{children}</ImageLineContext.Provider>;
}

/**
 * The line to build an image's *first* attempt on.
 *
 * Only the first: once mounted, `resolveNextAttempt` owns the ladder and the live answer wins.
 * This exists purely so the first render agrees with the HTML it is hydrating.
 */
/**
 * The spoiler tags the **server** knew about when it rendered this document's cards.
 *
 * Unlike the image line this is *not* dropped after hydration, and the difference
 * is which render each has to be right for. The line only matters for the
 * hydrating pass; a spoiler cover has no ladder — `ImageCard` recomputes it from
 * `localStorage` on mount — so keeping the value means a card mounted later starts
 * covered instead of flashing uncovered for a frame.
 */
const SpoilerTagsContext = createContext<readonly string[]>([]);

export function SpoilerTagsProvider({
  value,
  children,
}: {
  value: readonly string[];
  children: ReactNode;
}) {
  return <SpoilerTagsContext.Provider value={value}>{children}</SpoilerTagsContext.Provider>;
}

/** The tags to assume on the first render, before the effect reads `localStorage`. */
export function useSsrSpoilerTags(): readonly string[] {
  return useContext(SpoilerTagsContext);
}

export function useSsrImageLine(): ImageLine | null {
  return useContext(ImageLineContext);
}
