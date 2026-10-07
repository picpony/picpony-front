'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ImageLine } from '@/lib/route';

/**
 * The image line the **server** used when it rendered this document's `<img>` tags.
 *
 * `resolveImageLine()` reads `localStorage` and the fetched route policy, and in Node it
 * sees neither — so during SSR it answers with the *defaults*, and a visitor who turned the
 * proxy off got a hydration mismatch on every card (React does not patch attributes, so
 * their preference was ignored for the whole first screen). `app/layout.tsx` resolves the
 * same question the client's first render will — a line the administrator **forces** first,
 * the device's cookie only under `auto` (`lib/imageLine.server.ts`) — and puts the answer
 * here.
 *
 * `null` means "the defaults": under `auto` with no cookie yet, both sides compute them,
 * which is the correct answer. (Under a forced policy the answer is never null — a first
 * visit rendered on the defaults while the client applied the forced line.)
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
 * The spoiler tags the **server** knew about when it rendered this document's cards.
 *
 * Unlike the image line this is *not* dropped after hydration, and the difference
 * is which render each has to be right for. The line only matters for the
 * hydrating pass; a spoiler cover has no ladder — `lib/spoilers.ts` answers from
 * `localStorage` once hydrated — and the hydrating render of every cover reads this.
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

/**
 * The line to build an image's *first* attempt on.
 *
 * Only the first: once mounted, `resolveNextAttempt` owns the ladder and the live answer wins.
 * This exists purely so the first render agrees with the HTML it is hydrating — and only a
 * browser-direct first attempt reads it, since the optimizer's is line-free.
 */
export function useSsrImageLine(): ImageLine | null {
  return useContext(ImageLineContext);
}
