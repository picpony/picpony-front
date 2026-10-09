import { getAssetUrl } from '@/lib/utils';

/**
 * The forum's rich text, both ways: BBCode (what the backend stores, and what both front ends
 * read) to HTML for display and for the editor, the editor's HTML back to BBCode, and BBCode to
 * plain text for a teaser or a quote.
 *
 * **The vocabulary is the original front end's**, because the two front ends read one database:
 * `b i u s color= bg= url(=) img quote(=) code list(=1) * p div br center right h1–h6 table tr
 * td th`. What either one writes, the other renders — a centred paragraph, a highlight, a table.
 */

export function escapeHTML(str: string): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* `escapeHTML` alone is not enough for a value landing in an `href` or a `style`:
 * it leaves `;` and `:` untouched, so `[color=red;position:fixed]` is an injection.
 * URL schemes and CSS values are validated first, then escaped at their HTML
 * attribute sink by the shared renderer below. */

/** Allowlists the URL schemes that are safe in an `href`. Returns null to drop. */
export function safeUrl(raw: string): string | null {
  /* Browsers ignore tabs and newlines *inside* a URL before resolving the
     scheme, so `java\tscript:` executes: strip anything ignorable before
     testing, and return the stripped form, or the browser would still see
     the original. */
  const url = raw.trim().replace(/[\s\x00-\x1F\x7F]/g, '');
  if (!url) return null;
  /* A browser reads `\` as `/` in a URL, so `/\evil.example` is protocol-relative — another host
     — while it looks root-relative (review P2-F5's follow-up). Normalised here, the one boundary
     every rich-text link passes, so what is emitted says what the browser will do. */
  const normalised = /^[/\\]/.test(url) ? url.replace(/^[/\\]+/, (lead) => '/'.repeat(Math.min(lead.length, 2))) : url;
  // Root-relative (`/foo`) and protocol-relative (`//host/foo`) carry no scheme.
  if (normalised.startsWith('/')) return normalised;
  const scheme = /^([a-z][a-z0-9+.\-]*):/i.exec(url);
  if (!scheme) return url; // schemeless — a relative path
  return /^https?$/i.test(scheme[1]) ? url : null;
}

/** Allowlists a CSS colour: a hex literal, a bare named colour, or a numeric `rgb()`/`rgba()`/
 *  `hsl()`/`hsla()`. The functional forms are required because the editor reports colours as
 *  `rgb(…)` and the CSSOM keeps `rgba(…)` with an alpha; the argument list restricted to digits,
 *  units and separators is what keeps `url(...)` out. A bare function name (`rgba`, written by
 *  the original front end's regex when it met a colour with an alpha) is not a colour. */
export function safeColor(raw: string): string | null {
  const color = raw.trim();
  const ok =
    /^#[0-9a-f]{3,8}$/i.test(color) ||
    (/^[a-z]+$/i.test(color) && !/^(?:rgba?|hsla?)$/i.test(color)) ||
    /^rgba?\([\d.,%\s/]+\)$/i.test(color) ||
    /^hsla?\([\d.,%\s/deg]+\)$/i.test(color);
  return ok ? color : null;
}

/**
 * The editor's HTML as BBCode.
 *
 * **Self-contained on purpose**: `scripts/repairSecurityTest.mjs` runs this function's source
 * inside a browser page next to the real editor, so every helper lives inside it.
 *
 * Styles are read through the CSSOM, never matched as text: a regex for `color:` also matched
 * inside `background-color:` (a highlight was published as a text colour, replacing the colour
 * the author chose), and one for `text-align: center` missed the editor's own spelling and every
 * other alignment. Parsed with `DOMParser`, an inert document, so nothing in the HTML loads or
 * runs while it is read.
 *
 * A paragraph is `\n\n` and a line break inside one is `\n` — the renderer's two rules, so a
 * Shift+Enter break is not published as a paragraph break. A link target cannot end its own tag.
 */
export function htmlToBBCode(html: string | null | undefined): string {
  if (!html) return '';

  if (typeof window === 'undefined') {
    return html.replace(/<[^>]*>/g, '');
  }

  const doc = new DOMParser().parseFromString(html, 'text/html');

  /** A value the renderer may accept: nothing that could close the tag it sits in. */
  const colourValue = (value: string) => {
    const colour = value.trim();
    if (!colour || colour === 'initial' || colour === 'inherit' || colour === 'transparent') return '';
    return /^[#a-z0-9(),.%\s/-]+$/i.test(colour) ? colour : '';
  };
  /** `[`, `]`, quotes and whitespace percent-encoded: none of them may end an `[url=…]`. */
  const encodeTarget = (value: string) =>
    value.trim().replace(/[\s[\]"'<>]/g, (ch) => encodeURIComponent(ch));
  const allowedHref = (value: string) => /^(?:https?:|mailto:|\/(?!\/))/i.test(value.trim());
  const allowedSrc = (value: string) => /^(?:https?:|\/(?!\/))/i.test(value.trim());
  const align = (el: HTMLElement) => {
    const value = el.style.textAlign;
    return value === 'center' ? 'center' : value === 'right' || value === 'end' ? 'right' : '';
  };
  const aligned = (el: HTMLElement, inner: string) => {
    const side = align(el);
    return side ? `[${side}]${inner}[/${side}]` : inner;
  };
  /** A code block's text, with the editor's line breaks: nothing inside one is formatting. */
  const literal = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (node.nodeName.toLowerCase() === 'br') return '\n';
    let text = '';
    node.childNodes.forEach((child) => {
      text += literal(child);
    });
    return text;
  };

  function traverse(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || '';
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    const el = node as HTMLElement;
    const tag = el.nodeName.toLowerCase();
    if (tag === 'pre') return `[code]${literal(el)}[/code]\n\n`;
    if (tag === 'script' || tag === 'style' || tag === 'template') return '';

    let content = '';
    el.childNodes.forEach((child) => {
      content += traverse(child);
    });

    switch (tag) {
      case 'p':
        // The shared renderer treats one newline as <br> and two as a paragraph
        // boundary. Editor <p> siblings must remain separate after a round trip.
        return aligned(el, content) + '\n\n';
      case 'br':
        return '\n';
      case 'strong':
      case 'b':
        return `[b]${content}[/b]`;
      case 'em':
      case 'i':
        return `[i]${content}[/i]`;
      case 'u':
        return `[u]${content}[/u]`;
      case 'strike':
      case 's':
      case 'del':
        return `[s]${content}[/s]`;
      case 'span':
      case 'font': {
        let inner = content;
        const ink = colourValue(el.style.color || el.getAttribute('color') || '');
        const highlight = colourValue(el.style.backgroundColor);
        if (ink) inner = `[color=${ink}]${inner}[/color]`;
        if (highlight) inner = `[bg=${highlight}]${inner}[/bg]`;
        return inner;
      }
      case 'div':
        return aligned(el, content) + '\n';
      case 'img': {
        const src = el.getAttribute('src') || '';
        return allowedSrc(src) ? `[img]${encodeTarget(src)}[/img]` : '';
      }
      case 'li': {
        const item = `[*] ${content.trim()}\n`;
        const parent = el.parentElement?.nodeName.toLowerCase();
        if (parent === 'ul' || parent === 'ol') return item;
        /* Items with no list around them — the editor writes its list containers from state
           that a render fills in, so HTML read before one lacks them. A run of siblings is one
           list; without the container it is not said which kind, so it is a bulleted one. */
        const opens = el.previousElementSibling?.nodeName.toLowerCase() !== 'li';
        const closes = el.nextElementSibling?.nodeName.toLowerCase() !== 'li';
        return `${opens ? '[list]\n' : ''}${item}${closes ? '[/list]\n' : ''}`;
      }
      case 'ul':
        return `[list]\n${content}[/list]\n`;
      case 'ol':
        return `[list=1]\n${content}[/list]\n`;
      case 'blockquote': {
        /* Preserve the attribution: `[quote="username"]` is what the forum's reply
           composer writes and what `BBCodeRenderer` renders as a `<cite>`. */
        const cite = el.querySelector(':scope > cite');
        if (cite) {
          const who = (cite.textContent || '').trim();
          const rest = content.replace(who, '').trim();
          if (who) return `[quote="${who.replace(/["\]]/g, '')}"]${rest}[/quote]\n`;
        }
        return `[quote]${content.trim()}[/quote]\n`;
      }
      case 'a': {
        const href = el.getAttribute('href') || '';
        if (!allowedHref(href)) return content;
        return `[url=${encodeTarget(href)}]${content}[/url]`;
      }
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        return aligned(el, `[${tag}]${content.trim()}[/${tag}]`) + '\n\n';
      case 'table':
        return `[table]${content}[/table]\n`;
      case 'tr':
        return `[tr]${content}[/tr]\n`;
      case 'td':
      case 'th':
        return `[${tag}]${content.trim()}[/${tag}]`;
      default:
        return content;
    }
  }

  return traverse(doc.body)
    .replace(/[ \t]+\n/g, '\n')
    .trim()
    .replace(/\n{3,}/g, '\n\n');
}

interface BBElement {
  tag: string;
  parameter?: string;
  opening: string;
  children: BBNode[];
  closed: boolean;
}
type BBNode = string | BBElement;
type Piece = { kind: 'inline' | 'block' | 'paragraph'; html: string };

const TAGS = new Set([
  'b', 'i', 'u', 's', 'color', 'bg', 'center', 'right', 'url', 'quote', 'code', 'img', 'list',
  'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'table', 'tr', 'td', 'th',
]);
const PARAMETERISED = new Set(['color', 'bg', 'url', 'quote', 'list']);

/** Parse only the author's source. Generated HTML is never fed back through a
 *  BBCode replacement: an [url] inside an [img] used to escape its src attribute
 *  when the later replacement injected an <a> into an already-generated tag.
 *  Code, image URLs and bare links are literal leaves, even when they contain
 *  BBCode. Depth is bounded so adversarial nesting cannot exhaust the stack. */
function parseBBCode(source: string): BBNode[] {
  const root: BBElement = { tag: '', opening: '', children: [], closed: true };
  const stack = [root];
  const tokens = /\[(\/?)([a-z][a-z0-9]*|\*)(?:=([^\]\r\n]*))?\]/gi;
  let cursor = 0;
  for (const match of source.matchAll(tokens)) {
    let parent = stack[stack.length - 1];
    if (match.index > cursor) parent.children.push(source.slice(cursor, match.index));
    cursor = match.index + match[0].length;
    const [, closing, name, parameter] = match;
    const tag = name.toLowerCase();
    const literal = parent.tag === 'code' || parent.tag === 'img' ||
      (parent.tag === 'url' && parent.parameter === undefined);
    if (literal) {
      if (closing && tag === parent.tag && parameter === undefined) {
        parent.closed = true;
        stack.pop();
      } else {
        parent.children.push(match[0]);
      }
      continue;
    }
    if (!closing && tag === 'br' && parameter === undefined) {
      parent.children.push({ tag, opening: match[0], children: [], closed: true });
      continue;
    }
    if (!closing && tag === '*' && parameter === undefined) {
      const listIndex = stack.findLastIndex((node) => node.tag === 'list');
      if (listIndex > 0) {
        stack.length = listIndex + 1;
        parent = stack[listIndex];
        const item: BBElement = { tag: 'li', opening: '', children: [], closed: true };
        parent.children.push(item);
        stack.push(item);
      } else {
        parent.children.push(match[0]);
      }
      continue;
    }
    if (!TAGS.has(tag) || (parameter !== undefined && !PARAMETERISED.has(tag))) {
      parent.children.push(match[0]);
      continue;
    }
    if (closing) {
      const index = parameter === undefined ? stack.findLastIndex((node) => node.tag === tag) : -1;
      if (index > 0) {
        stack[index].closed = true;
        stack.length = index;
      } else {
        parent.children.push(match[0]);
      }
      continue;
    }
    if (stack.length >= 128) {
      parent.children.push(match[0]);
      continue;
    }
    const node: BBElement = { tag, parameter, opening: match[0], children: [], closed: false };
    parent.children.push(node);
    stack.push(node);
  }
  if (cursor < source.length) stack[stack.length - 1].children.push(source.slice(cursor));
  return root.children;
}

/** `style` wraps every line of text in one span carrying it — the editor presentation's marks. */
function textPieces(text: string, style = ''): Piece[] {
  return text.split(/(\n[ \t]*\n+)/).map((part, index) => index % 2
    ? { kind: 'paragraph', html: '' }
    : {
        kind: 'inline',
        html: part
          .split('\n')
          .map((line) => (line && style ? `<span style="${style}">${escapeHTML(line)}</span>` : escapeHTML(line)))
          .join('<br />'),
      });
}

/** Leading and trailing breaks and whitespace, which never carry meaning at a block's edge. */
const EDGE_BREAKS = /^(?:\s|<br \/>)+|(?:\s|<br \/>)+$/g;

/** Keep paragraph boundaries outside inline wrappers, and block elements outside
 *  <p>. In particular, a code block's own newlines never become HTML breaks. */
function flow(pieces: Piece[], paragraphs = true): string {
  let output = '';
  let run = '';
  const flush = () => {
    const body = run.replace(EDGE_BREAKS, '');
    if (body) output += paragraphs ? `<p>${body}</p>` : body;
    run = '';
  };
  for (const piece of pieces) {
    if (piece.kind === 'inline') run += piece.html;
    else {
      flush();
      if (piece.kind === 'block') output += piece.html;
      else if (!paragraphs) output += '<br /><br />';
    }
  }
  flush();
  return output;
}

function wrapInline(pieces: Piece[], open: string, close: string, links = false): Piece[] {
  const result: Piece[] = [];
  let run = '';
  const flush = () => {
    if (run) result.push({ kind: 'inline', html: open + run + close });
    run = '';
  };
  for (const piece of pieces) {
    if (piece.kind === 'inline') run += piece.html;
    else {
      flush();
      result.push(links && piece.kind === 'block'
        ? { kind: 'block', html: open + piece.html + close }
        : piece);
    }
  }
  flush();
  return result;
}

/** Everything the display presentation may ask of an image. */
export interface RichImageAttributes {
  src: string;
  srcSet?: string;
  sizes?: string;
}

export interface BBCodeRenderOptions {
  /**
   * Responsive sources for a picture, given its resolved URL — the display's hook for the image
   * optimizer (`getImageProps`), so a 2527px upload is not what a 789px column downloads.
   * Absent, the picture is its own URL.
   */
  image?: (src: string) => RichImageAttributes;
  /** A picture that is not inside a link is a button that opens it large. */
  zoomable?: boolean;
  /** Whether a link stays inside the app, where it navigates in place rather than in a new tab. */
  isInternal?: (href: string) => boolean;
}

type Presentation = { editor: boolean; options: BBCodeRenderOptions };

/** The colours in force on a run of text, for the editor: it keeps only the outermost span's
 *  styles when two are nested, so a colour inside a highlight came back without the colour. One
 *  span per run, carrying both, is the shape it writes itself. */
type Marks = { color?: string; bg?: string };

function markStyle(marks: Marks): string {
  return (
    (marks.color ? `color:${escapeHTML(marks.color)};` : '') +
    (marks.bg ? `background-color:${escapeHTML(marks.bg)};` : '')
  );
}

/** A colour the author chose, as the display presents it: the stylesheet keeps it legible on
 *  both schemes (`[data-ink]` / `[data-highlight]` in globals.css), which an inline `color:`
 *  could never do — it would outrank the rule that does. */
function inkSpan(tag: 'color' | 'bg', color: string): [string, string] {
  const value = escapeHTML(color);
  return tag === 'color'
    ? [`<span data-ink="" style="--rt-ink:${value};">`, '</span>']
    : [`<span data-highlight="" style="--rt-highlight:${value};">`, '</span>'];
}

function imageHtml(url: string, inLink: boolean, { editor, options }: Presentation): string {
  /* A paragraph around it: the editor throws on a picture at the top level of its document. */
  if (editor) return `<p><img src="${escapeHTML(url)}" alt="" /></p>`;
  const attributes = options.image?.(url) ?? { src: url };
  const src = safeUrl(attributes.src) ?? url;
  const srcSet = attributes.srcSet ? ` srcset="${escapeHTML(attributes.srcSet)}"` : '';
  const sizes = attributes.srcSet && attributes.sizes ? ` sizes="${escapeHTML(attributes.sizes)}"` : '';
  const img = `<img src="${escapeHTML(src)}"${srcSet}${sizes} alt="" loading="lazy" decoding="async" data-loading="" />`;
  return options.zoomable && !inLink
    ? `<button type="button" class="rt-image" data-rt-zoom="" aria-label="查看大图">${img}</button>`
    : img;
}

/** The flow's `<p>` / `<hN>` openings, given an alignment — the editor's own form for it. */
function alignOpenings(html: string, side: 'center' | 'right'): string {
  return html.replace(/<(p|h[1-6])>/g, `<$1 style="text-align:${side};">`);
}

function renderNodes(nodes: BBNode[], inLink: boolean, presentation: Presentation, marks: Marks = {}): Piece[] {
  const { editor, options } = presentation;
  const style = editor ? markStyle(marks) : '';
  return nodes.flatMap((node): Piece[] => {
    if (typeof node === 'string') return textPieces(node, style);
    if (!node.closed) {
      return [...textPieces(node.opening, style), ...renderNodes(node.children, inLink, presentation, marks)];
    }
    const { tag, parameter, children } = node;
    if (tag === 'br') return [{ kind: 'inline', html: '<br />' }];
    if (tag === 'code') {
      return [{ kind: 'block', html: `<pre><code>${escapeHTML(children.join(''))}</code></pre>` }];
    }
    if (tag === 'img') {
      const url = safeUrl(children.join(''));
      const src = url && safeUrl(getAssetUrl(url));
      return src ? [{ kind: 'block', html: imageHtml(src, inLink, presentation) }] : [];
    }
    if (tag === 'url') {
      const bare = parameter === undefined;
      const url = safeUrl(bare ? children.join('') : parameter);
      const content = bare ? textPieces(children.join(''), style) : renderNodes(children, true, presentation, marks);
      if (!url || inLink) return content;
      const internal = !editor && options.isInternal?.(url) === true;
      const attributes = internal ? '' : ' target="_blank" rel="noopener noreferrer"';
      return wrapInline(content, `<a href="${escapeHTML(url)}"${attributes}>`, '</a>', true);
    }
    if (tag === 'color' || tag === 'bg') {
      const color = safeColor(parameter || '');
      if (editor) return renderNodes(children, inLink, presentation, color ? { ...marks, [tag]: color } : marks);
      const content = renderNodes(children, inLink, presentation, marks);
      if (!color) return content;
      const [open, close] = inkSpan(tag, color);
      return wrapInline(content, open, close);
    }
    const content = tag === 'list' ? [] : renderNodes(children, inLink, presentation, marks);
    const inlineTag = ({ b: 'strong', i: 'em', u: 'u', s: 's', span: 'span' } as Record<string, string>)[tag];
    if (inlineTag) return wrapInline(content, `<${inlineTag}>`, `</${inlineTag}>`);
    if (tag === 'quote') {
      const who = parameter?.replace(/^"|"$/g, '').trim();
      /* wangEditor's existing quote parser accepts inline content. A nested <p>
         makes it flatten the whole blockquote, concatenating <cite> into the
         body. Keep its supported shape while the published view retains real
         paragraphs. The editor still does not preserve citation metadata. */
      const body = flow(content, !editor);
      if (!body && !who) return [];
      return [{ kind: 'block', html: `<blockquote>${who ? `<cite>${escapeHTML(who)}</cite>` : ''}${body}</blockquote>` }];
    }
    if (tag === 'list') {
      const listTag = parameter === '1' ? 'ol' : 'ul';
      // Only items may be direct list children; preserve any text before [*].
      const items = children.flatMap((child) => {
        if (typeof child === 'string' && !child.trim()) return [];
        const rendered = flow(renderNodes([child], inLink, presentation, marks), false);
        if (!rendered) return [];
        return [typeof child !== 'string' && child.tag === 'li'
          ? rendered : `<li>${rendered}</li>`];
      }).join('');
      return items ? [{ kind: 'block', html: `<${listTag}>${items}</${listTag}>` }] : [];
    }
    if (tag === 'li') {
      const body = flow(content, false);
      return [{ kind: 'block', html: `<li>${body}</li>` }];
    }
    if (tag === 'table') {
      const rows = flow(content, false);
      if (!rows) return [];
      return [{
        kind: 'block',
        html: editor
          ? `<table><tbody>${rows}</tbody></table>`
          : `<div class="popover-scrollbar overflow-x-auto"><table>${rows}</table></div>`,
      }];
    }
    if (tag === 'center' || tag === 'right') {
      const body = flow(content);
      if (!body) return [];
      return [{
        kind: 'block',
        html: editor ? alignOpenings(body, tag) : `<div style="text-align:${tag};">${body}</div>`,
      }];
    }
    if (tag === 'p' || /^h[1-6]$/.test(tag)) {
      // Malformed input can place blocks inside a paragraph/heading. Lift those
      // blocks out rather than relying on the browser to repair nested <p>s.
      // An empty one — the editor's blank line, `[p][br][/p]` — is dropped: the
      // paragraph rhythm already separates blocks, and a blank paragraph on top of
      // it read as a hole in the text.
      return wrapInline(content, '', '').flatMap((piece): Piece[] => {
        if (piece.kind !== 'inline') return [piece];
        const body = piece.html.replace(EDGE_BREAKS, '');
        return body ? [{ kind: 'block', html: `<${tag}>${body}</${tag}>` }] : [];
      });
    }
    if (tag === 'tr' || tag === 'td' || tag === 'th') {
      return [{ kind: 'block', html: `<${tag}>${flow(content, false)}</${tag}>` }];
    }
    const body = flow(content, tag === 'div');
    return body ? [{ kind: 'block', html: `<${tag}>${body}</${tag}>` }] : [];
  });
}

/** Both presentations share parsing, URL validation and every escaping boundary. */
function renderBBCode(bbcode: string | null | undefined, presentation: Presentation): string {
  return bbcode ? flow(renderNodes(parseBBCode(bbcode.replace(/\r\n?/g, '\n')), false, presentation)) : '';
}

/** The published presentation. */
export function bbcodeToSafeHtml(bbcode: string | null | undefined, options: BBCodeRenderOptions = {}): string {
  return renderBBCode(bbcode, { editor: false, options });
}

/** The editor's presentation — the HTML shapes wangEditor parses back into its own model. */
export function bbcodeToHtml(bbcode: string | null | undefined): string {
  return renderBBCode(bbcode, { editor: true, options: {} }) || '<p><br></p>';
}

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

export interface PlainTextOptions {
  /** Characters (code points, so an emoji is never split); an ellipsis marks the cut. */
  maxLength?: number;
  /** A picture as the words 「[图片]」 (the default), or nothing. */
  images?: 'marker' | 'drop';
  /** Quoted text is someone else's words: left out by default. */
  quotes?: boolean;
  /** One line (the default): every run of whitespace becomes one space. */
  singleLine?: boolean;
}

export const IMAGE_MARKER = '[图片]';

function plainNodes(nodes: BBNode[], options: PlainTextOptions): string {
  let text = '';
  for (const node of nodes) {
    if (typeof node === 'string') {
      text += node;
      continue;
    }
    if (!node.closed) {
      text += node.opening + plainNodes(node.children, options);
      continue;
    }
    switch (node.tag) {
      case 'br':
        text += '\n';
        break;
      case 'img':
        if (options.images !== 'drop') text += ` ${IMAGE_MARKER} `;
        break;
      case 'quote':
        if (options.quotes) text += `\n${plainNodes(node.children, options)}\n`;
        break;
      case 'code':
        text += `\n${node.children.join('')}\n`;
        break;
      case 'url':
        text += node.parameter === undefined ? node.children.join('') : plainNodes(node.children, options);
        break;
      case 'li':
      case 'p':
      case 'div':
      case 'center':
      case 'right':
      case 'tr':
      case 'list':
      case 'table':
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        text += `\n${plainNodes(node.children, options)}\n`;
        break;
      case 'td':
      case 'th':
        text += `${plainNodes(node.children, options)} `;
        break;
      default:
        text += plainNodes(node.children, options);
    }
  }
  return text;
}

/**
 * The words of a BBCode text, from its parse tree rather than by stripping patterns: a quote
 * built by deleting `<…>` and `[quote]…[/quote]` from the source kept every other tag — the
 * reply bar showed `[img]…[/img]`, the published quote re-embedded the picture, and a cut at a
 * fixed length landed inside an `[img]` and left it open. Pictures become 「[图片]」, links their
 * text, and the cut falls between characters.
 */
export function bbcodeToPlainText(bbcode: string | null | undefined, options: PlainTextOptions = {}): string {
  if (!bbcode) return '';
  const { maxLength, singleLine = true } = options;
  let text = plainNodes(parseBBCode(bbcode.replace(/\r\n?/g, '\n')), options);
  text = singleLine
    ? text.replace(/\s+/g, ' ').trim()
    : text.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (maxLength === undefined) return text;
  const chars = Array.from(text);
  return chars.length > maxLength ? `${chars.slice(0, maxLength).join('').trimEnd()}…` : text;
}

/** The first picture a text shows, as written — the original front end's "first image as cover". */
export function firstImageOf(bbcode: string | null | undefined): string | null {
  if (!bbcode) return null;
  const find = (nodes: BBNode[]): string | null => {
    for (const node of nodes) {
      if (typeof node === 'string') continue;
      if (node.closed && node.tag === 'img') {
        const url = safeUrl(node.children.join(''));
        if (url) return url;
        continue;
      }
      if (node.tag === 'code') continue;
      const inner = find(node.children);
      if (inner) return inner;
    }
    return null;
  };
  return find(parseBBCode(bbcode));
}
