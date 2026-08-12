'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

interface MarkdownRendererProps {
  content: string;
  /**
   * Render as a run of inline content rather than as a block of prose.
   *
   * A direct message is a sentence, not a document, and it is frequently a
   * sentence with emoji embedded in it. Rendered as blocks, every text run
   * between two emoji became its own `<p>` — so `hello 🐴 world` came out as
   * three stacked lines with the emoji alone in the middle. Dropping the
   * paragraph wrapper puts the whole message back into one inline flow, where
   * text and emoji sit on the same line and wrap together.
   */
  inline?: boolean;
}

export default function MarkdownRenderer({ content, inline = false }: MarkdownRendererProps) {
  const Wrapper = inline ? 'span' : 'div';
  return (
    <Wrapper className={inline ? 'rich-text-content rich-text-inline' : 'rich-text-content'}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          // In inline mode a paragraph is the message itself, so it contributes
          // nothing but a line break it should not have.
          ...(inline ? { p: ({ children }: { children?: React.ReactNode }) => <>{children}</> } : {}),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          img: ({ src, alt }) => {
            if (!src) return null;
            // eslint-disable-next-line @next/next/no-img-element -- remote/dynamic markdown images
            return <img src={src} alt={alt || ''} />;
          },
          /* The only override left is the table's *wrapper*, and it is here
             because the element has to exist: a wide table has to scroll inside
             its own box rather than widen the page, and `react-markdown` gives no
             way to add a parent from CSS. Everything about how any of this looks
             — the listing, the quote, the cell borders, the rule — is described
             once in globals.css, alongside the BBCode path's, because the two
             renderers were producing two appearances of the same document. */
          table: ({ children }) => (
            <div className="popover-scrollbar overflow-x-auto">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </Wrapper>
  );
}
