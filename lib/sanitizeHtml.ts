import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';

/** Backend-authored HTML is prose, never application code. Parse as HTML before
 * applying the established HAST allowlist, so malformed markup and encoded URL
 * schemes are checked in their browser interpretation rather than with regexes.
 * Keep this module behind import() at client call sites: its HTML parser is only
 * needed once a response actually contains rich HTML. */
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
  return String(processor.processSync(html));
}
