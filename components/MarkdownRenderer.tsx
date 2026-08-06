'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

interface MarkdownRendererProps {
  content: string;
}

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className="rich-text-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
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
            <code className="bg-surface-container-high rounded px-1.5 py-0.5 text-body-m">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="bg-surface-container-high rounded-md p-4 overflow-x-auto my-2">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-3 border-outline pl-4 my-2 text-on-surface-variant italic">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-2">
              <table className="min-w-full border-collapse border border-outline-variant">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-outline-variant px-3 py-2 bg-surface-container-low font-semibold">
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
    </div>
  );
}
