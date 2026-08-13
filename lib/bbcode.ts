export function escapeHTML(str: string): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* `escapeHTML` is not enough on its own for a value that lands in an `href` or a
 * `style`, and both converters in this repo interpolate BBCode attributes into
 * exactly those two places. It escapes `& < > " '` — none of which appear in
 * `javascript:alert(document.cookie)`, and neither `;` nor `:` is touched, so
 * `[color=red;position:fixed;inset:0;background:#000]` was a full-viewport
 * overlay authored from a post body.
 *
 * These two live here, next to `escapeHTML`, because the display converter
 * (`BBCodeRenderer`) and the editor converter (`bbcodeToHtml` below) both need
 * them and have already drifted apart on four other tags. A validator that is
 * defined once cannot be fixed in one copy and forgotten in the other. */

/** Allowlists the URL schemes that are safe in an `href`. Returns null to drop. */
export function safeUrl(raw: string): string | null {
  /* Browsers ignore tabs and newlines *inside* a URL before resolving the
     scheme, so `java&#9;script:` executes. The attribute patterns use `.`, which
     excludes \n but matches \t — strip anything ignorable before testing, and
     return the stripped form, or the browser would still see the original. */
  const url = raw.trim().replace(/[\s\x00-\x1F\x7F]/g, '');
  if (!url) return null;
  // Root-relative (`/foo`) and protocol-relative (`//host/foo`) carry no scheme.
  if (url.startsWith('/')) return url;
  const scheme = /^([a-z][a-z0-9+.\-]*):/i.exec(url);
  if (!scheme) return url; // schemeless — a relative path
  return /^https?$/i.test(scheme[1]) ? url : null;
}

/** Allowlists a CSS colour: a hex literal, a bare named colour, or a numeric
 *  `rgb()`/`rgba()`. The last one is required because `htmlToBBCode` below can
 *  itself emit `[color=rgb(1,2,3)]` from an editor round-trip, so rejecting it
 *  would silently drop colours the app authored. The argument list is restricted
 *  to digits and separators, which is what keeps `url(...)` out. */
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
        return content + '\n';
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
        /* Preserve the attribution. `[quote="username"]` is what the forum's
           reply composer writes and what `BBCodeRenderer` renders as a
           `<cite>`, so dropping it here silently rewrote every quoted reply to
           an anonymous one the first time its author edited the post. */
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
      default:
        return content;
    }
  }

  return traverse(div)
    .trim()
    .replace(/\n{3,}/g, '\n\n');
}

export function bbcodeToHtml(bbcode: string | null | undefined): string {
  if (!bbcode) return '<p><br></p>';

  let html = escapeHTML(bbcode);

  html = html.replace(/\[img\](.*?)\[\/img\]/gi, (_m, url: string) => {
    const src = safeUrl(url);
    /* `alt=""`, not a missing attribute. A BBCode `[img]` carries no
       description, and an `<img>` with no `alt` at all is read out by its URL —
       a screen reader announcing 60 characters of CDN path in the middle of a
       post. Empty marks it decorative and lets the surrounding text carry the
       meaning, which is what every other remote image in this app does.
       `loading="lazy"` because a forum post can hold a dozen of these. */
    return src ? `<img src="${src}" alt="" loading="lazy" style="max-width:100%;" />` : '';
  });
  html = html.replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '<strong>$1</strong>');
  html = html.replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '<em>$1</em>');
  html = html.replace(
    /\[u\]([\s\S]*?)\[\/u\]/gi,
    '<span style="text-decoration:underline;">$1</span>',
  );
  html = html.replace(/\[s\]([\s\S]*?)\[\/s\]/gi, '<strike>$1</strike>');
  /* `safeColor`, not `$1`: `;` and `:` survive `escapeHTML`, so an unvalidated
     capture let a post body inject arbitrary declarations into this `style`. */
  html = html.replace(/\[color=(.*?)\]([\s\S]*?)\[\/color\]/gi, (_m, c: string, text: string) => {
    const color = safeColor(c);
    return color ? `<span style="color:${color};">${text}</span>` : text;
  });
  html = html.replace(
    /\[center\]([\s\S]*?)\[\/center\]/gi,
    '<div style="text-align:center;">$1</div>',
  );
  /* `safeUrl` blocks `javascript:`, and `rel` matches `BBCodeRenderer` — this
     copy omitted it, so the same link was tabnabbing-safe in a thread and not in
     the editor's preview. */
  html = html.replace(/\[url=(.*?)\]([\s\S]*?)\[\/url\]/gi, (_m, href: string, text: string) => {
    const url = safeUrl(href);
    return url
      ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`
      : text;
  });
  /* Named quotes first, or the bare-quote pattern below matches the same span
     and leaves `="username"` stranded as literal text in the editor. The
     attribute is already `&quot;`-escaped by `escapeHTML` above, same as in
     `BBCodeRenderer` — the two converters have to agree on the tag set or a
     post renders one way in a thread and another way when you open it to edit. */
  html = html.replace(
    /\[quote=&quot;(.*?)&quot;\]([\s\S]*?)\[\/quote\]/gi,
    (_m, who: string, text: string) =>
      `<blockquote><cite>${who.trim()}</cite>${text.trim()}</blockquote>`,
  );
  html = html.replace(/\[quote\]([\s\S]*?)\[\/quote\]/gi, '<blockquote>$1</blockquote>');
  html = html.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, '<pre><code>$1</code></pre>');
  html = html.replace(/\[list\]([\s\S]*?)\[\/list\]/gi, '<ul>$1</ul>');
  html = html.replace(/\[list=1\]([\s\S]*?)\[\/list\]/gi, '<ol>$1</ol>');
  html = html.replace(/\[\*\] /gi, '<li>');
  html = html.replace(/\[\*\]([\s\S]*?)(?=\[\*\]|\[\/list\]|$)/gi, '<li>$1</li>');

  const paragraphs = html.split('\n').filter((line) => line.trim() !== '');
  if (paragraphs.length === 0) return '<p><br></p>';

  return `<p>${paragraphs.join('</p><p>')}</p>`;
}
