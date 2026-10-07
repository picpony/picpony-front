'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { remarkHardBreaks } from '@/lib/markdownBreaks';
import { inAppHref, isInternalHref } from '@/lib/richTextLinks';

/**
 * The Markdown renderer itself — remark, micromark and the sanitiser, ~28KB brotli — loaded
 * only where a Markdown text is on screen (`MarkdownRenderer` is the lazy boundary; R12-005).
 */

/** A picture holds a placeholder's box until it has arrived (the same rule as BBCode's). */
function MarkdownImage({ src, alt }: { src: string; alt: string }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote/dynamic markdown images
    <img
      src={src}
      alt={state === 'failed' ? '图片加载失败' : alt}
      loading="lazy"
      decoding="async"
      data-loading={state === 'loading' ? '' : undefined}
      data-failed={state === 'failed' ? '' : undefined}
      ref={(img) => {
        /* A picture already in the cache arrives before React attaches its handlers. */
        if (img?.complete && state === 'loading') setState(img.naturalWidth > 0 ? 'loaded' : 'failed');
      }}
      onLoad={() => setState('loaded')}
      onError={() => setState('failed')}
    />
  );
}

function MarkdownLink({ href, children }: { href?: string; children?: ReactNode }) {
  if (!href) return <>{children}</>;
  /* Into the app: navigate in place, like every other link in it. Elsewhere: beside it. */
  const route = isInternalHref(href) ? inAppHref(href) : null;
  if (route) {
    return (
      <Link href={route} scroll={false}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

export default function MarkdownDocument({ content }: { content: string }) {
  return (
    <div className="rich-text-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkHardBreaks]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          a: ({ href, children }) => <MarkdownLink href={href}>{children}</MarkdownLink>,
          img: ({ src, alt }) => (typeof src === 'string' && src ? <MarkdownImage src={src} alt={alt || ''} /> : null),
          /* The only structural override: a wide table scrolls inside its own box rather than
             widening the page, and `react-markdown` gives no way to add a parent from CSS.
             Everything about how any of this looks is described once in globals.css, alongside
             the BBCode path's, so the two renderers produce one appearance. */
          table: ({ children }) => (
            <div className="popover-scrollbar overflow-x-auto">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
