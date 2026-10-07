'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import MarkdownRenderer from '@/components/MarkdownRenderer';
import Button from '@/components/Button';

/**
 * Derpibooru's picture references — `>>123`, and the embed forms `>>123s` / `>>123t` / `>>123p`
 * — as links to the picture in this app. Outside a code span or block only.
 */
function linkImageReferences(markdown: string): string {
  return markdown
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(/(^|[^\w>[\]/])>>(\d{1,9})[stp]?(?![\w])/g, (_, lead: string, id: string) => `${lead}[>>${id}](/pic/${id})`),
    )
    .join('');
}

/* Six lines of `body-m` before the toggle is offered: a short profile reads whole, a long one
   stops at a paragraph's worth. */
const CLAMP = 'line-clamp-6';

/**
 * A Derpibooru profile's description (R7-022): Philomena writes Markdown, and printing it as text
 * put `>>997470p` and link syntax on the page. It renders through the shared Markdown renderer
 * with the picture references made links, in the page's own flow — not in a nested scroll box —
 * clamped, with 展开 offered only when the clamp actually hides something.
 */
export default function DerpiDescription({ markdown, id }: { markdown: string; id: string }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  /* Measured, not guessed from the length: a long description of short lines may fit, and a
     short one with a picture may not. Re-measured when the column changes width. */
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || expanded) return;
    const measure = () => setOverflows(body.scrollHeight > body.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, [markdown, expanded]);

  return (
    <div>
      <div
        ref={bodyRef}
        id={id}
        className={`text-body-m text-on-surface wrap-anywhere ${expanded ? '' : CLAMP}`}
      >
        <MarkdownRenderer content={linkImageReferences(markdown.replace(/\r\n?/g, '\n'))} />
      </div>
      {(overflows || expanded) && (
        <Button
          variant="text"
          size="xs"
          className="mt-1 -ml-4"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? '收起' : '展开'}
        </Button>
      )}
    </div>
  );
}
