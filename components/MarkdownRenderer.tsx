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
    <div className="bbcode-content">
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
            return <img src={src} alt={alt || ''} className="max-w-full rounded-lg my-2" />;
          },
          code: ({ children }) => (
            <code className="bg-slate-100 dark:bg-slate-800 rounded px-1.5 py-0.5 text-sm">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="bg-slate-100 dark:bg-slate-800 rounded-lg p-4 overflow-x-auto my-2">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-3 border-slate-300 dark:border-slate-600 pl-4 my-2 text-slate-600 dark:text-slate-400 italic">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-2">
              <table className="min-w-full border-collapse border border-slate-200 dark:border-slate-700">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-slate-200 dark:border-slate-700 px-3 py-2 bg-slate-50 dark:bg-slate-800 font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-slate-200 dark:border-slate-700 px-3 py-2">
              {children}
            </td>
          ),
          hr: () => <hr className="my-4 border-slate-200 dark:border-slate-700" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}