'use client';

import { lazy, Suspense } from 'react';

/**
 * A Markdown text — a Derpibooru description or comment, a tag's description.
 *
 * **The renderer is loaded where a Markdown text is on screen, and nowhere else** (R12-005). It
 * was a static import, so its ~28KB brotli (remark, micromark, the sanitiser) was in the first
 * document of every route that merely *could* show one — /search for a tag block most searches
 * never open, /pic for comments below the fold. `React.lazy` rather than `next/dynamic`, because
 * the placeholder needs the text: it lays the words out, unseen, so the text arriving formatted
 * does not move what is under it. A server-rendered text keeps the server's HTML while the chunk
 * arrives — hydration waits at this boundary rather than showing the placeholder.
 */
const MarkdownDocument = lazy(() => import('./MarkdownDocument'));

function Placeholder({ content }: { content: string }) {
  return (
    <div className="rich-text-content invisible whitespace-pre-line" aria-hidden="true">
      {content}
    </div>
  );
}

export default function MarkdownRenderer({ content }: { content: string }) {
  return (
    <Suspense fallback={<Placeholder content={content} />}>
      <MarkdownDocument content={content} />
    </Suspense>
  );
}
