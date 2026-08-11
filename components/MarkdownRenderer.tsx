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
            return <img src={src} alt={alt || ''} className="max-w-full rounded-md my-2" />;
          },
          code: ({ children }) => (
            <code className="bg-surface-container-high rounded-xs px-1.5 py-0.5 text-body-m">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="popover-scrollbar bg-surface-container-high rounded-md p-4 overflow-x-auto my-2">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-[3px] border-outline-variant pl-4 my-2 text-on-surface-variant italic">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="popover-scrollbar overflow-x-auto my-2">
              <table className="min-w-full border-collapse border border-outline-variant">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-outline-variant px-3 py-2 bg-surface-container-low text-title-s-emphasized">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-outline-variant px-3 py-2">{children}</td>
          ),
          hr: () => <hr className="my-4 border-outline-variant" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </Wrapper>
  );
}
