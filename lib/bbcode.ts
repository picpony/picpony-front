import { getAssetUrl } from '@/lib/utils';

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
  // Root-relative (`/foo`) and protocol-relative (`//host/foo`) carry no scheme.
  if (url.startsWith('/')) return url;
  const scheme = /^([a-z][a-z0-9+.\-]*):/i.exec(url);
  if (!scheme) return url; // schemeless — a relative path
  return /^https?$/i.test(scheme[1]) ? url : null;
}

/** Allowlists a CSS colour: a hex literal, a bare named colour, or a numeric
 *  `rgb()`/`rgba()`. The last is required because `htmlToBBCode` can itself emit
 *  `[color=rgb(1,2,3)]` from an editor round-trip; the argument list restricted
 *  to digits and separators is what keeps `url(...)` out. */
export function safeColor(raw: string): string | null {
  const color = raw.trim();
  const ok =
    /^#[0-9a-f]{3,8}$/i.test(color) ||
    /^[a-z]+$/i.test(color) ||
    /^rgba?\([\d.,%\s/]+\)$/i.test(color);
  return ok ? color : null;
}

export function htmlToBBCode(html: string | null | undefined): string {
  if (!html) return '';

  if (typeof window === 'undefined') {
    return html.replace(/<[^>]*>/g, '');
  }

  const div = document.createElement('div');
  div.innerHTML = html;

  function traverse(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || '';
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    let content = '';
    node.childNodes.forEach((child) => {
      content += traverse(child);
    });

    const el = node as HTMLElement;
    const style = el.getAttribute('style') || '';
    const tag = node.nodeName.toLowerCase();

    switch (tag) {
      case 'p':
        // The shared renderer treats one newline as <br> and two as a paragraph
        // boundary. Editor <p> siblings must remain separate after a round trip.
        return content + '\n\n';
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
        return `[s]${content}[/s]`;
      case 'span':
        if (style.includes('color:')) {
          const colorMatch = style.match(/color:\s*(#[0-9a-fA-F]{3,6}|rgb\([^)]+\)|[a-zA-Z]+)/);
          if (colorMatch) return `[color=${colorMatch[1]}]${content}[/color]`;
        }
        return content;
      case 'div':
        if (style.includes('text-align: center')) return `[center]${content}[/center]\n`;
        return content + '\n';
      case 'img':
        return `[img]${el.getAttribute('src')}[/img]`;
      case 'li':
        return `[*] ${content}\n`;
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
          if (who) return `[quote="${who.replace(/"/g, '')}"]${rest}[/quote]\n`;
        }
        return `[quote]${content}[/quote]\n`;
      }
      case 'pre':
        return `[code]${content}[/code]\n`;
      case 'a':
        return `[url=${el.getAttribute('href')}]${content}[/url]`;
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
      case 'table':
      case 'tr':
      case 'td':
      case 'th':
        return `[${tag}]${content}[/${tag}]`;
      default:
        return content;
    }
  }

  return traverse(div)
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
  'b', 'i', 'u', 's', 'color', 'center', 'url', 'quote', 'code', 'img', 'list',
  'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'table', 'tr', 'td', 'th',
]);

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
    if (!TAGS.has(tag) || (parameter !== undefined &&
      !['color', 'url', 'quote', 'list'].includes(tag))) {
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

function textPieces(text: string): Piece[] {
  return text.split(/(\n[ \t]*\n+)/).map((part, index) => index % 2
    ? { kind: 'paragraph', html: '' }
    : { kind: 'inline', html: escapeHTML(part).replace(/\n/g, '<br />') });
}

/** Keep paragraph boundaries outside inline wrappers, and block elements outside
 *  <p>. In particular, a code block's own newlines never become HTML breaks. */
function flow(pieces: Piece[], paragraphs = true): string {
  let output = '';
  let run = '';
  const flush = () => {
    const body = run.replace(/^(?:\s|<br \/>)+|(?:\s|<br \/>)+$/g, '');
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

function renderNodes(nodes: BBNode[], inLink = false, editor = false): Piece[] {
  return nodes.flatMap((node): Piece[] => {
    if (typeof node === 'string') return textPieces(node);
    if (!node.closed) return [...textPieces(node.opening), ...renderNodes(node.children, inLink, editor)];
    const { tag, parameter, children } = node;
    if (tag === 'br') return [{ kind: 'inline', html: '<br />' }];
    if (tag === 'code') {
      return [{ kind: 'block', html: `<pre><code>${escapeHTML(children.join(''))}</code></pre>` }];
    }
    if (tag === 'img') {
      const url = safeUrl(children.join(''));
      const src = url && safeUrl(getAssetUrl(url));
      return src ? [{ kind: 'block', html: `<img src="${escapeHTML(src)}" alt="" loading="lazy" />` }] : [];
    }
    if (tag === 'url') {
      const bare = parameter === undefined;
      const url = safeUrl(bare ? children.join('') : parameter);
      const content = bare ? textPieces(children.join('')) : renderNodes(children, true, editor);
      if (!url || inLink) return content;
      return wrapInline(content, `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">`, '</a>', true);
    }
    const content = tag === 'list' ? [] : renderNodes(children, inLink, editor);
    if (tag === 'color') {
      const color = safeColor(parameter || '');
      return color ? wrapInline(content, `<span style="color:${escapeHTML(color)};">`, '</span>') : content;
    }
    const inlineTag = ({ b: 'strong', i: 'em', u: 'u', s: 's', span: 'span' } as Record<string, string>)[tag];
    if (inlineTag) return wrapInline(content, `<${inlineTag}>`, `</${inlineTag}>`);
    if (tag === 'quote') {
      const who = parameter?.replace(/^"|"$/g, '').trim();
      /* wangEditor's existing quote parser accepts inline content. A nested <p>
         makes it flatten the whole blockquote, concatenating <cite> into the
         body. Keep its supported shape while the published view retains real
         paragraphs. The editor still does not preserve citation metadata. */
      return [{ kind: 'block', html: `<blockquote>${who ? `<cite>${escapeHTML(who)}</cite>` : ''}${flow(content, !editor)}</blockquote>` }];
    }
    if (tag === 'list') {
      const listTag = parameter === '1' ? 'ol' : 'ul';
      // Only items may be direct list children; preserve any text before [*].
      const items = children.flatMap((child) => {
        if (typeof child === 'string' && !child.trim()) return [];
        const rendered = flow(renderNodes([child], inLink, editor), false);
        return [typeof child !== 'string' && child.tag === 'li'
          ? rendered : `<li>${rendered}</li>`];
      }).join('');
      return [{ kind: 'block', html: `<${listTag}>${items}</${listTag}>` }];
    }
    if (tag === 'table') {
      return [{ kind: 'block', html: `<div class="popover-scrollbar overflow-x-auto"><table>${flow(content, false)}</table></div>` }];
    }
    if (tag === 'center') return [{ kind: 'block', html: `<div style="text-align:center;">${flow(content)}</div>` }];
    if (tag === 'p' || /^h[1-6]$/.test(tag)) {
      // Malformed input can place blocks inside a paragraph/heading. Lift those
      // blocks out rather than relying on the browser to repair nested <p>s.
      return wrapInline(content, `<${tag}>`, `</${tag}>`).map((piece) =>
        piece.kind === 'inline' ? { kind: 'block', html: piece.html } : piece);
    }
    return [{ kind: 'block', html: `<${tag}>${flow(content, tag === 'div')}</${tag}>` }];
  });
}

/** Both presentations share parsing, URL validation and every escaping boundary. */
function renderBBCode(bbcode: string | null | undefined, editor: boolean): string {
  return bbcode ? flow(renderNodes(parseBBCode(bbcode.replace(/\r\n?/g, '\n')), false, editor)) : '';
}

export function bbcodeToSafeHtml(bbcode: string | null | undefined): string {
  return renderBBCode(bbcode, false);
}

export function bbcodeToHtml(bbcode: string | null | undefined): string {
  return renderBBCode(bbcode, true) || '<p><br></p>';
}
