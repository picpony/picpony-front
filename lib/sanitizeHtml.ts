import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import { sanitizeHtml as sanitizeHtmlBrowser } from './sanitizeHtml.browser';

/** Backend-authored HTML is prose, never application code. Parse as HTML before
 * applying the established HAST allowlist, so malformed markup and encoded URL
 * schemes are checked in their browser interpretation rather than with regexes.
 *
 * Client bundles alias `@/lib/sanitizeHtml` to `lib/sanitizeHtml.browser.ts`
 * (`next.config.ts` `turbopack.resolveAlias`), using the browser's native
 * `DOMParser` instead of shipping `parse5`/`unified` (~228 KB raw / ~59 KB Brotli)
 * to browsers. This file remains the Node/SSR implementation. */
const processor = unified()
  .use(rehypeParse, { fragment: true })
  .use(rehypeSanitize, {
    ...defaultSchema,
    tagNames: defaultSchema.tagNames?.filter((tag) => tag !== 'input'),
    strip: [...(defaultSchema.strip ?? []), 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'noscript'],
    protocols: {
      ...defaultSchema.protocols,
      href: ['http', 'https', 'mailto'],
      src: ['http', 'https'],
    },
  })
  .use(rehypeStringify);

export function sanitizeHtml(html: string): string {
  if (!html) return '';
  if (typeof DOMParser !== 'undefined') return sanitizeHtmlBrowser(html);
  return String(processor.processSync(html));
}
