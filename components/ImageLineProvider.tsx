'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ImageLine } from '@/lib/route';

/**
 * The image line the **server** used when it rendered this document's `<img>` tags.
 *
 * `resolveImageLine()` reads `localStorage` and the fetched route policy, and the server can see
 * neither — so during SSR it answers with the *defaults* and emits the proxy line for everybody.
 * That was invisible while the home page rendered a skeleton. Now that it renders fifty cards, a
 * visitor who had turned the image proxy off got a hydration mismatch on every one of them, and
 * React does not patch attributes: the browser kept the server's URL, so their preference was
 * ignored for the entire first screen.
 *
 * `app/layout.tsx` reads `COOKIE_KEYS.imageLine` and puts it here, so the client's *first* render
 * asks the same question and gets the same answer. Everything after mount is unchanged — the
 * policy lands, the failover ladder runs, and `lib/route.ts` mirrors the new answer back into the
 * cookie for the next document.
 *
 * `null` means "no cookie yet" — a first visit, or a browser that blocks them — and the reader
 * falls back to `resolveImageLine()`, which is what every call site did before this existed. That
 * is also the correct answer in that case: with nothing stored, both sides compute the defaults.
 */
const ImageLineContext = createContext<ImageLine | null>(null);

/**
 * **The override is dropped once the document has hydrated, and that is the whole of it.**
 *
 * The value only has to survive one render — the hydrating one, where the client must ask the
 * same question the server did or React leaves a mismatched `src` alone. After that the live
 * answer is the correct one, and holding the cookie's value for the document's whole life is
 * actively wrong: `FadeInImage` re-runs `createInitialAttempt` in a `useState` initialiser on
 * every mount. A line that degrades mid-session (`recordWorkerFailure` after three failures, or
 * the user turning the proxy off in /settings) rewrites the cookie, but a fixed context keeps
 * handing out the old answer — so turning to gallery page 2 mounted fifty images that all
 * started on the line just taken out of the running, each failing, retrying in place, and only
 * then falling back: a hundred doomed requests and two rounds of skeleton per card. One state
 * flip after mount fixes it, at the cost of one re-render of a provider whose only consumer
 * reads it in a `useState` initialiser.
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
 * Unlike the image line this is *not* dropped after hydration, and the difference is which
 * render each one has to be right for. The line only matters for the hydrating pass, because
 * `resolveNextAttempt` owns the ladder afterwards and a stale answer actively hurts. A spoiler
 * cover has no ladder: `ImageCard`'s effect recomputes it from `localStorage` on mount and
 * overrides whatever this said, so keeping the value simply means a card mounted later — page
 * two, a tab switch — starts covered instead of flashing uncovered for a frame.
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
