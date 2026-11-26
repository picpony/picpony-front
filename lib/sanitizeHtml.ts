import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import {
  ANNOUNCEMENT_ALLOWED_TAGS,
  ANNOUNCEMENT_STRIP_TAGS,
  ANNOUNCEMENT_TAG_ATTRS,
  sanitizeAnnouncementAttr,
  sanitizeAnnouncementUrl,
  sanitizeHtml as sanitizeHtmlBrowser,
} from './sanitizeHtml.browser';

const HTML_TO_HAST_PROP: Record<string, string> = {
  colspan: 'colSpan',
  rowspan: 'rowSpan',
  cellpadding: 'cellPadding',
  cellspacing: 'cellSpacing',
  datetime: 'dateTime',
};

const HAST_TO_HTML_ATTR: Record<string, string> = {
  colSpan: 'colspan',
  rowSpan: 'rowspan',
  cellPadding: 'cellpadding',
  cellSpacing: 'cellspacing',
  dateTime: 'datetime',
};

interface HastNode {
  type?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

const schemaAttributes: Record<string, string[]> = {};
for (const [tag, attrs] of Object.entries(ANNOUNCEMENT_TAG_ATTRS)) {
  schemaAttributes[tag] = [...attrs].map((name) => HTML_TO_HAST_PROP[name] ?? name);
}

/** Normalizes `href` / `src` before `rehypeSanitize` so outer whitespace around valid URLs
 *  (e.g. `href=" mailto:a@b.c?subject=Hello World "`) matches browser & Rust `clean_url`
 *  trimming instead of being dropped by `rehype-sanitize`'s untrimmed protocol check. */
function rehypeNormalizeAnnouncementUrls() {
  const visit = (node: HastNode) => {
    if (node.type === 'element' && node.properties) {
      for (const attr of ['href', 'src'] as const) {
        const raw = node.properties[attr];
        if (typeof raw === 'string') {
          const clean = sanitizeAnnouncementUrl(attr, raw);
          if (clean === null) delete node.properties[attr];
          else node.properties[attr] = clean;
        }
      }
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) visit(child);
    }
  };
  return (tree: HastNode) => {
    visit(tree);
  };
}

/** Validates every kept attribute through the exact same rules as `lib/sanitizeHtml.browser.ts`
 *  (stripping protocol-relative URLs `//` and `/\`, clamping numeric attributes, and adding
 *  `rel="noopener noreferrer"` on `<a href=…>`). */
function rehypeAnnouncementAttrs() {
  const visit = (node: HastNode) => {
    if (node.type === 'element' && typeof node.tagName === 'string' && node.properties) {
      const tag = node.tagName.toLowerCase();
      const next: Record<string, unknown> = {};
      let hasHref = false;
      for (const [prop, raw] of Object.entries(node.properties)) {
        if (raw === undefined || raw === null || raw === false) continue;
        const htmlName = HAST_TO_HTML_ATTR[prop] ?? prop.toLowerCase();
        const str = raw === true ? '' : Array.isArray(raw) ? raw.join(' ') : String(raw);
        const clean = sanitizeAnnouncementAttr(tag, htmlName, str);
        if (clean === null) continue;
        if (tag === 'a' && htmlName === 'href') hasHref = true;
        next[prop] = htmlName === 'open' || htmlName === 'reversed' ? true : clean;
      }
      if (tag === 'a' && hasHref) next.rel = ['noopener', 'noreferrer'];
      node.properties = next;
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) visit(child);
    }
  };
  return (tree: HastNode) => {
    visit(tree);
  };
}

/** Backend-authored HTML is prose, never application code. Parse as HTML before
 * applying the shared allowlist (aligned with `lib/sanitizeHtml.browser.ts` and
 * `picpony-rust/src/sanitize.rs`), so malformed markup, protocol-relative URLs and
 * encoded URL schemes are checked consistently on Node/SSR and browsers.
 *
 * Client bundles alias `@/lib/sanitizeHtml` to `lib/sanitizeHtml.browser.ts`
 * (`next.config.ts` `turbopack.resolveAlias`), using the browser's native
 * `DOMParser` instead of shipping `parse5`/`unified` (~228 KB raw / ~59 KB Brotli)
 * to browsers. This file remains the Node/SSR implementation. */
const processor = unified()
  .use(rehypeParse, { fragment: true })
  .use(rehypeNormalizeAnnouncementUrls)
  .use(rehypeSanitize, {
    tagNames: [...ANNOUNCEMENT_ALLOWED_TAGS],
    strip: [...ANNOUNCEMENT_STRIP_TAGS],
    attributes: schemaAttributes,
    protocols: {
      href: ['http', 'https', 'mailto'],
      src: ['http', 'https'],
    },
  })
  .use(rehypeAnnouncementAttrs)
  .use(rehypeStringify);

export function sanitizeHtml(html: string): string {
  if (!html) return '';
  if (typeof DOMParser !== 'undefined') return sanitizeHtmlBrowser(html);
  return String(processor.processSync(html));
}
