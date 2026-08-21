'use client';

import React, { useMemo } from 'react';

import { safeColor, safeUrl } from '@/lib/bbcode';
import { getAssetUrl } from '@/lib/utils';

interface BBCodeRendererProps {
  content: string;
}

function escapeHTML(str: string): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function bbcodeToSafeHtml(bbcode: string): string {
  if (!bbcode) return '';

  // Step 1: escape HTML & special chars to prevent XSS
  let html = escapeHTML(bbcode);

  // Step 2: convert BBCode tags to HTML (order matters: more specific first)

  // Images — handle multiline URLs and resolve relative paths
  html = html.replace(/\[img\]([\s\S]*?)\[\/img\]/gi, (match, url: string) => {
    const src = url.trim();
    if (!src) return '';
    // Resolve relative paths
    const resolved = getAssetUrl(src);
    const safe = safeUrl(resolved);
    if (!safe) return '';
    /* `alt=""` marks it decorative — a BBCode `[img]` carries no description and
       an `<img>` with no `alt` at all is announced by its URL. No inline style:
       the size cap, the corner and the rhythm are one rule in globals.css, and an
       inline `margin` there beat it. */
    return `<img src="${safe}" alt="" loading="lazy" />`;
  });

  // Bold
  html = html.replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '<em>$1</em>');
  /* Underline and strikethrough are elements, not styled spans. `<u>` and `<s>`
     carry the decoration in every UA stylesheet, so the span pair was inline CSS
     restating what the semantics already said — and it left the editor's
     converter, which emits `<strike>`, describing the same BBCode differently. */
  html = html.replace(/\[u\]([\s\S]*?)\[\/u\]/gi, '<u>$1</u>');
  html = html.replace(/\[s\]([\s\S]*?)\[\/s\]/gi, '<s>$1</s>');

  /* Colour — validated, not interpolated. `escapeHTML` leaves `;` and `:` alone,
     so a raw capture here let `[color=red;position:fixed;inset:0;background:#000]`
     paint a full-viewport plate over the app from inside a post body. */
  html = html.replace(/\[color=(.*?)\]([\s\S]*?)\[\/color\]/gi, (_m, c: string, text: string) => {
    const color = safeColor(c);
    return color ? `<span style="color:${color};">${text}</span>` : text;
  });

  // Center alignment. `text-align` is the author's intent and stays; the margin
  // that rode along with it is the rhythm's job.
  html = html.replace(
    /\[center\]([\s\S]*?)\[\/center\]/gi,
    '<div style="text-align:center;">$1</div>',
  );

  /* URL with custom text [url=href]text[/url].
     `safeUrl` allowlists the scheme. `escapeHTML` escapes `& < > " '`, none of
     which occur in `javascript:alert(document.cookie)`, so an unvalidated capture
     here was a live script href authored from any post or comment. A rejected
     href degrades to its own link text rather than vanishing.
     No inline `text-decoration`: link appearance is one rule in globals.css, and
     stating it here meant a link in a thread was underlined at rest while the
     same link in the editor's preview was not. */
  html = html.replace(/\[url=(.*?)\]([\s\S]*?)\[\/url\]/gi, (_m, href: string, text: string) => {
    const url = safeUrl(href);
    return url ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>` : text;
  });

  // Bare URL [url]href[/url]
  html = html.replace(/\[url\]([\s\S]*?)\[\/url\]/gi, (_m, href: string) => {
    const url = safeUrl(href);
    return url ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>` : href;
  });

  // Quote with username [quote="username"]text[/quote]
  // Note: quotes are already escaped to &quot; by escapeHTML() above
  //
  // Semantic markup, no inline styles: both quote forms now emit a plain
  // `<blockquote>` and the appearance comes from the single rule in globals.css.
  // The inline version carried its own fill, its own border and a
  // `margin-top:-20px` fudge to pull the attribution back over the padding it had
  // just set — the sort of thing that only ever looks right in the one thread it
  // was tuned against.
  html = html.replace(
    /\[quote=&quot;(.*?)&quot;\]([\s\S]*?)\[\/quote\]/gi,
    (match, username: string, text: string) =>
      `<blockquote><cite>${username.trim()}</cite>${text.trim()}</blockquote>`,
  );

  // Quote (simple, no username)
  html = html.replace(
    /\[quote\]([\s\S]*?)\[\/quote\]/gi,
    '<blockquote>$1</blockquote>',
  );

  /* Code block (preserve inner content exactly). Bare `<pre><code>` — the fill,
     the corner, the padding and the rhythm are all in globals.css, which is also
     where `MarkdownRenderer`'s listings get theirs. Spelled inline here, the two
     renderers produced two different code blocks in the same thread. */
  html = html.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, '<pre><code>$1</code></pre>');

  // Ordered list [list=1]
  html = html.replace(/\[list=1\]([\s\S]*?)\[\/list\]/gi, '<ol>$1</ol>');

  // Unordered list [list]
  html = html.replace(/\[list\]([\s\S]*?)\[\/list\]/gi, '<ul>$1</ul>');

  // List items [*]
  html = html.replace(/\[\*\] /gi, '<li>');
  html = html.replace(
    /\[\*\]([\s\S]*?)(?=\[\*\]|\[\/list\]|\[\/ol\]|\[\/ul\]|$)/gi,
    '<li>$1</li>',
  );

  // HTML-mapped tags: div wrapper
  html = html.replace(/\[div\]([\s\S]*?)\[\/div\]/gi, '<div>$1</div>');

  /* Headings h1-h6, as bare elements. They used to carry hardcoded `font-size`
     and `font-weight` in rem — a sixteenth type scale, sitting outside the
     fifteen M3 roles and outside the `@layer base` rules that give h1-h6 theirs.
     Being inline, it also could not be overridden from anywhere. */
  for (const level of [1, 2, 3, 4, 5, 6]) {
    html = html.replace(
      new RegExp(`\\[h${level}\\]([\\s\\S]*?)\\[/h${level}\\]`, 'gi'),
      `<h${level}>$1</h${level}>`,
    );
  }

  // Paragraph
  html = html.replace(/\[p\]([\s\S]*?)\[\/p\]/gi, '<p>$1</p>');

  // Span
  html = html.replace(/\[span\]([\s\S]*?)\[\/span\]/gi, '<span>$1</span>');

  /* Table, in a scroll container.
     `width:100%` does not stop a 4-column table's *min-content* width from
     exceeding the post card — on a 360px phone the card's content box is ~296px,
     and any table with real cell text blows past it and takes the page's
     horizontal scrollbar with it. `MarkdownRenderer` already wraps its tables for
     this reason; the BBCode path did not. `.popover-scrollbar` because the gutter
     belongs to the table, not to the page.
     The cell borders and the header fill moved to globals.css, where the Markdown
     path's tables are described too — they were two different tables before. */
  html = html.replace(
    /\[table\]([\s\S]*?)\[\/table\]/gi,
    '<div class="popover-scrollbar overflow-x-auto"><table>$1</table></div>',
  );
  html = html.replace(/\[tr\]([\s\S]*?)\[\/tr\]/gi, '<tr>$1</tr>');
  html = html.replace(/\[td\]([\s\S]*?)\[\/td\]/gi, '<td>$1</td>');
  html = html.replace(/\[th\]([\s\S]*?)\[\/th\]/gi, '<th>$1</th>');

  // Line break [br] — before generic \n conversion
  html = html.replace(/\[br\]/gi, '<br />');

  // Step 3: paragraphs
  return paragraphise(html);
}

/* Block-level elements this converter can emit. `img` is one because globals.css
   renders post images as blocks. */
const BLOCK_OPEN = '(?:p|div|ul|ol|blockquote|pre|table|h[1-6]|img)';
const BLOCK_ANY =
  /<\/?(?:p|div|ul|ol|li|blockquote|pre|table|thead|tbody|tr|td|th|h[1-6]|img)\b/i;
/* The same set minus `img`. An image is a *void* element, so a run of text can
   be split on one with no question of where it ends; every other block may nest
   inside itself — a quote inside a quote, a list inside a list — and a regular
   expression cannot find the matching close tag for those. */
const BLOCK_EXCEPT_IMG =
  /<\/?(?:p|div|ul|ol|li|blockquote|pre|table|thead|tbody|tr|td|th|h[1-6])\b/i;
const IMG_SPLIT = /(<img\b[^>]*>)/i;

/** An inline run, as a paragraph — or nothing, if it was only whitespace and
 *  the author's newline *around* a block, which the block's own margin covers. */
function asParagraph(run: string): string {
  const text = run.replace(/^(?:<br \/>)+|(?:<br \/>)+$/g, '').trim();
  return text ? `<p>${text}</p>` : '';
}

/** Wraps the text either side of a picture, so a caption keeps its paragraph. */
function wrapAroundImages(body: string): string {
  return body
    .split(IMG_SPLIT)
    .map((part) => (/^<img\b/i.test(part) ? part : asParagraph(part)))
    .join('');
}

/**
 * Wraps the text *outside* a chunk's blocks — before the first one and after the
 * last — leaving the blocks and anything between them untouched.
 *
 * This is what the forum's own reply composer needs. It writes a quoted reply as
 * the quote followed by the answer, and without this the answer was emitted as a
 * bare text node hard against the bottom of the `<blockquote>`: no paragraph, no
 * margin, and — because the break beside a block is stripped as the author's
 * spacing — not even a line between them.
 *
 * The middle is left alone deliberately. Text sitting *between* two blocks can
 * only be reached by knowing where each block closes, and the blocks here nest:
 * a quote inside a quote, a list inside a list. The edges need no such knowledge.
 */
function wrapBlockEdges(body: string): string {
  const openAt = body.search(new RegExp(`<${BLOCK_OPEN}\\b`, 'i'));
  if (openAt < 0) return asParagraph(body);

  const closeRe = new RegExp(`(?:</${BLOCK_OPEN}>|<img\\b[^>]*>)`, 'gi');
  let lastEnd = openAt;
  for (let m = closeRe.exec(body); m; m = closeRe.exec(body)) lastEnd = m.index + m[0].length;

  return (
    asParagraph(body.slice(0, openAt)) +
    body.slice(openAt, lastEnd) +
    asParagraph(body.slice(lastEnd))
  );
}

/**
 * A blank line starts a paragraph; a single newline is a line break.
 *
 * This step used to be `html.replace(/\n/g, '<br />')` and nothing else, which
 * meant a BBCode post had no paragraphs at all — every gap in it, whether the
 * author had pressed Return once or twice, came out as the same one-line break.
 * A `<br>` also carries no margin, so a body's rhythm could not be described in
 * CSS: the prose spacing lived in the *content*, while the picture and the quote
 * beside it carried their own, unrelated, inline margins. That is the whole of
 * why a thread's spacing looked arbitrary.
 *
 * Real `<p>`s put the rhythm back under `.bbcode-content` in globals.css, where
 * `MarkdownRenderer`'s output already lived — so the two renderers now describe
 * the same document and one rule set governs both.
 *
 * A chunk that already contains a nesting block is emitted as it stands rather
 * than wrapped, because a `<p>` may not contain one: the browser would close the
 * paragraph early and the markup would stop being what this function returned.
 * Those blocks carry their own margins, which is the right spacing for them
 * anyway.
 */
function paragraphise(html: string): string {
  return (
    html
      .split(/\n[ \t]*\n+/)
      .map((chunk) => {
        const body = chunk.replace(/\n/g, '<br />').trim();
        if (!body) return '';
        if (!BLOCK_ANY.test(body)) return asParagraph(body);
        if (!BLOCK_EXCEPT_IMG.test(body)) return wrapAroundImages(body);
        return wrapBlockEdges(body);
      })
      .filter(Boolean)
      .join('')
      /* A break that lands against a block boundary was the author's newline
         *around* the block, not a blank line inside the text — and the block's
         own margin is already the gap. Left in, every quote and listing in a
         post sat in a space one line-height taller than the one below it. */
      .replace(new RegExp(`<br />\\s*(?=<${BLOCK_OPEN}\\b)`, 'gi'), '')
      .replace(new RegExp(`(</${BLOCK_OPEN}>|<img\\b[^>]*>)\\s*<br />`, 'gi'), '$1')
  );
}

export default function BBCodeRenderer({ content }: BBCodeRendererProps) {
  const html = useMemo(() => {
    if (!content) return '';
    try {
      return bbcodeToSafeHtml(content);
    } catch {
      return '';
    }
  }, [content]);

  if (!html) return null;

  /* `break-words` on the root, not just via the `@layer base` safety net.
     That net covers `:where(p, li, blockquote, td, dd)`, and this converter emits
     bare text nodes and `<br>` straight into the div — so a long URL or an
     unbroken username in any post or comment body pushed past the column. The
     app scroller is `overflow-y: scroll` with `overflow-x` computing to `auto`,
     which meant one such post gave the *whole page* a horizontal scrollbar. */
  return (
    <div className="bbcode-content break-words" dangerouslySetInnerHTML={{ __html: html }} />
  );
}
