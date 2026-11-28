/**
 * Browser-native HTML fragment sanitizer for backend-authored announcement prose.
 *
 * Uses the browser's own HTML5 parser (`DOMParser`) inside an inert document — zero parser
 * bundle bytes and exact agreement with the rendering engine's HTML5 parsing rules — then
 * walks the DOM through prototype getters (immune to `<form>` DOM clobbering) and emits only
 * strictly allowlisted HTML elements and attributes via an escaping serializer (never reading
 * `innerHTML`). Keep the allowlist aligned with `picpony-rust/src/sanitize.rs`
 * (`announcement_html`) and `lib/sanitizeHtml.ts`.
 */

const HTML_NS = 'http://www.w3.org/1999/xhtml';

/** Elements whose entire subtree (tags and text/children) is discarded. */
export const ANNOUNCEMENT_STRIP_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'template',
  'noscript',
  'textarea',
  'title',
  'xmp',
  'noembed',
  'noframes',
  'plaintext',
]);

/** Disallowed elements whose children are also ignored (replaced/void form/media controls). */
const DROP_VOID_TAGS = new Set(['input', 'source', 'track', 'param', 'area', 'base', 'link', 'meta', 'keygen']);

export const ANNOUNCEMENT_ALLOWED_TAGS = new Set([
  'p',
  'br',
  'hr',
  'div',
  'span',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'code',
  'details',
  'summary',
  'section',
  'figure',
  'figcaption',
  'b',
  'i',
  'u',
  's',
  'strong',
  'em',
  'del',
  'ins',
  'mark',
  'small',
  'sub',
  'sup',
  'kbd',
  'samp',
  'var',
  'abbr',
  'cite',
  'q',
  'ruby',
  'rp',
  'rt',
  'wbr',
  'dfn',
  'time',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'a',
  'img',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'colgroup',
  'col',
]);

const VOID_TAGS = new Set(['br', 'hr', 'img', 'wbr', 'col']);

const TITLE_ONLY = new Set(['title']);
const TABLE_CELL_ATTRS = new Set(['colspan', 'rowspan', 'align', 'valign', 'scope']);

export const ANNOUNCEMENT_TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'title']),
  img: new Set(['src', 'alt', 'title', 'width', 'height', 'loading', 'decoding']),
  td: TABLE_CELL_ATTRS,
  th: TABLE_CELL_ATTRS,
  table: new Set(['cellpadding', 'cellspacing', 'border']),
  ol: new Set(['start', 'type', 'reversed']),
  li: new Set(['value']),
  col: new Set(['span']),
  colgroup: new Set(['span']),
  details: new Set(['open']),
  time: new Set(['datetime']),
  abbr: TITLE_ONLY,
  dfn: TITLE_ONLY,
  span: TITLE_ONLY,
  div: TITLE_ONLY,
  p: TITLE_ONLY,
  blockquote: TITLE_ONLY,
  code: TITLE_ONLY,
  pre: TITLE_ONLY,
  h1: TITLE_ONLY,
  h2: TITLE_ONLY,
  h3: TITLE_ONLY,
  h4: TITLE_ONLY,
  h5: TITLE_ONLY,
  h6: TITLE_ONLY,
};

const ALIGN_VALUES = new Set(['left', 'center', 'right', 'justify']);
const VALIGN_VALUES = new Set(['top', 'middle', 'bottom', 'baseline']);
const SCOPE_VALUES = new Set(['row', 'col', 'rowgroup', 'colgroup']);
const LOADING_VALUES = new Set(['lazy', 'eager']);
const DECODING_VALUES = new Set(['async', 'sync', 'auto']);
const OL_TYPE_VALUES = new Set(['1', 'a', 'A', 'i', 'I']);

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/* Native prototype getters saved at load time so `<form><input name="attributes">`-style
   DOM clobbering on parsed nodes can never hijack or crash traversal. */
const nodeTypeOf =
  typeof Node !== 'undefined' ? Object.getOwnPropertyDescriptor(Node.prototype, 'nodeType')?.get : undefined;
const nodeValueOf =
  typeof Node !== 'undefined' ? Object.getOwnPropertyDescriptor(Node.prototype, 'nodeValue')?.get : undefined;
const firstChildOf =
  typeof Node !== 'undefined' ? Object.getOwnPropertyDescriptor(Node.prototype, 'firstChild')?.get : undefined;
const nextSiblingOf =
  typeof Node !== 'undefined' ? Object.getOwnPropertyDescriptor(Node.prototype, 'nextSibling')?.get : undefined;
const localNameOf =
  typeof Element !== 'undefined' ? Object.getOwnPropertyDescriptor(Element.prototype, 'localName')?.get : undefined;
const namespaceOf =
  typeof Element !== 'undefined' ? Object.getOwnPropertyDescriptor(Element.prototype, 'namespaceURI')?.get : undefined;
const attributesOf =
  typeof Element !== 'undefined' ? Object.getOwnPropertyDescriptor(Element.prototype, 'attributes')?.get : undefined;
const bodyOf =
  typeof Document !== 'undefined'
    ? (Object.getOwnPropertyDescriptor(Document.prototype, 'body')?.get ??
      (typeof HTMLDocument !== 'undefined'
        ? Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'body')?.get
        : undefined))
    : undefined;

/** Validates a URL attribute (`href`: http/https/mailto or safe relative; `src`: http/https or safe relative).
 *  Strips ASCII/C1 control characters and trims outer whitespace while preserving internal spaces
 *  (e.g. `mailto:hi@picpony.top?subject=Hello World`), matching `picpony-rust/src/sanitize.rs`. */
export function sanitizeAnnouncementUrl(attr: 'href' | 'src', raw: string): string | null {
  const cleaned = raw.replace(/[\u0000-\u001f\u007f-\u009f]+/g, '').trim();
  if (attr === 'src' && !cleaned) return null;
  if (cleaned.startsWith('//') || cleaned.startsWith('\\') || cleaned.startsWith('/\\')) return null;
  const authorityPrefix = cleaned.split(/[/?#]/, 1)[0];
  const colon = authorityPrefix.indexOf(':');
  if (colon !== -1) {
    const scheme = authorityPrefix.slice(0, colon).toLowerCase();
    if (attr === 'src') {
      if (scheme !== 'http' && scheme !== 'https') return null;
    } else if (scheme !== 'http' && scheme !== 'https' && scheme !== 'mailto') {
      return null;
    }
  }
  return cleaned;
}

/** Validates a single attribute for an allowlisted element. Returns `null` to drop it. */
export function sanitizeAnnouncementAttr(tag: string, name: string, value: string): string | null {
  const allowed = ANNOUNCEMENT_TAG_ATTRS[tag];
  if (!allowed || !allowed.has(name)) return null;
  if (name === 'href' || name === 'src') return sanitizeAnnouncementUrl(name, value);
  if (name === 'colspan' || name === 'rowspan' || name === 'span') {
    if (!/^\d+$/.test(value.trim())) return null;
    const n = Number(value.trim());
    return n >= 1 && n <= 1000 ? String(n) : null;
  }
  if (name === 'cellpadding' || name === 'cellspacing' || name === 'border') {
    if (!/^\d+$/.test(value.trim())) return null;
    const n = Number(value.trim());
    return n >= 0 && n <= 1000 ? String(n) : null;
  }
  if (name === 'width' || name === 'height') {
    if (!/^\d+$/.test(value.trim())) return null;
    const n = Number(value.trim());
    return n >= 0 && n <= 10_000 ? String(n) : null;
  }
  if (name === 'start' || name === 'value') {
    if (!/^-?\d+$/.test(value.trim())) return null;
    const n = Number(value.trim());
    return Number.isSafeInteger(n) && n >= -2_147_483_648 && n <= 2_147_483_647 ? String(n) : null;
  }
  if (name === 'align') {
    const lower = value.trim().toLowerCase();
    return ALIGN_VALUES.has(lower) ? lower : null;
  }
  if (name === 'valign') {
    const lower = value.trim().toLowerCase();
    return VALIGN_VALUES.has(lower) ? lower : null;
  }
  if (name === 'scope') {
    const lower = value.trim().toLowerCase();
    return SCOPE_VALUES.has(lower) ? lower : null;
  }
  if (name === 'loading') {
    const lower = value.trim().toLowerCase();
    return LOADING_VALUES.has(lower) ? lower : null;
  }
  if (name === 'decoding') {
    const lower = value.trim().toLowerCase();
    return DECODING_VALUES.has(lower) ? lower : null;
  }
  if (tag === 'ol' && name === 'type') {
    const trimmed = value.trim();
    return OL_TYPE_VALUES.has(trimmed) ? trimmed : null;
  }
  if (name === 'open' || name === 'reversed') return '';
  return value;
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function serializeChildren(parent: Node): string {
  let out = '';
  let child: Node | null = firstChildOf ? (firstChildOf.call(parent) as Node | null) : parent.firstChild;
  while (child) {
    out += serializeNode(child);
    child = nextSiblingOf ? (nextSiblingOf.call(child) as Node | null) : child.nextSibling;
  }
  return out;
}

function serializeNode(node: Node): string {
  const type = nodeTypeOf ? (nodeTypeOf.call(node) as number) : node.nodeType;
  if (type === TEXT_NODE) {
    const text = nodeValueOf ? (nodeValueOf.call(node) as string | null) : node.nodeValue;
    return text ? escapeText(text) : '';
  }
  if (type !== ELEMENT_NODE) return '';

  const el = node as Element;
  const ns = namespaceOf ? (namespaceOf.call(el) as string | null) : el.namespaceURI;
  if (ns !== HTML_NS) return '';

  const tag = (localNameOf ? (localNameOf.call(el) as string) : el.localName).toLowerCase();
  if (ANNOUNCEMENT_STRIP_TAGS.has(tag) || DROP_VOID_TAGS.has(tag)) return '';
  if (!ANNOUNCEMENT_ALLOWED_TAGS.has(tag)) return serializeChildren(el);

  const attrs = attributesOf ? (attributesOf.call(el) as NamedNodeMap) : el.attributes;
  let attrText = '';
  let hasHref = false;
  for (let i = 0; i < attrs.length; i += 1) {
    const attr = attrs[i];
    const name = attr.name.toLowerCase();
    const clean = sanitizeAnnouncementAttr(tag, name, attr.value);
    if (clean === null) continue;
    if (tag === 'a' && name === 'href') hasHref = true;
    attrText += ` ${name}="${escapeAttr(clean)}"`;
  }
  if (tag === 'a' && hasHref) attrText += ' rel="noopener noreferrer"';

  if (VOID_TAGS.has(tag)) return `<${tag}${attrText}>`;
  return `<${tag}${attrText}>${serializeChildren(el)}</${tag}>`;
}

let cachedParser: DOMParser | null = null;

export function sanitizeHtml(html: string): string {
  if (!html) return '';
  if (typeof DOMParser === 'undefined') {
    throw new Error('Browser HTML sanitizer requires DOMParser');
  }
  cachedParser ??= new DOMParser();
  const doc = cachedParser.parseFromString(html, 'text/html');
  const body = bodyOf ? (bodyOf.call(doc) as HTMLElement | null) : doc.body;
  return body ? serializeChildren(body) : '';
}
