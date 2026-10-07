/**
 * Derpibooru's Markdown made readable from this origin, and any comment as plain text.
 *
 * A description or a comment written on Derpibooru links the way Philomena's own pages do:
 * root-relative (`[@name](/images/232093#comment_10184427)`, `[a tag](/tags/…)`) and with its
 * own picture references (`>>123`, and the embed forms `>>123s|t|p`). Rendered here as written,
 * the first opened this app's 404 in a new tab and the second read as a quote marker and a
 * number. `derpiMarkdown` rewrites both before the rich-text renderer sees the text: a relative
 * link becomes Derpibooru's absolute one, a reference becomes a link to the picture in this app
 * (an embed is only ever a link — a picture pasted into a comment would skip every content
 * setting the viewer has).
 *
 * `plainTextOf` is for places markup cannot be rendered — a reply's preview, the text a
 * translation is asked for. It reads PicPony's BBCode and Derpibooru's Markdown alike.
 *
 * Plain module: the server renders descriptions too.
 */

import { descriptionTeaser } from '@/lib/plainText';

export const DERPIBOORU_ORIGIN = 'https://derpibooru.org';

/** Code (a fenced block, an inline span) is shown as written, so nothing inside it is rewritten. */
function outsideCode(text: string, transform: (chunk: string) => string): string {
  return text
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
    .map((part, index) => (index % 2 === 1 ? part : transform(part)))
    .join('');
}

/** `>>123` standing on its own — at a line's start, after a space or an opening bracket. */
const PICTURE_REFERENCE = /(^|[\s（「(])>>(\d{1,9})([stp])?(?![\w])/gm;

/**
 * A Derpibooru description or comment, with its relative links made absolute and its picture
 * references made links to this app's detail page.
 */
export function derpiMarkdown(body: string | null | undefined): string {
  if (!body) return '';
  return outsideCode(body.replace(/\r\n?/g, '\n'), (chunk) =>
    chunk
      .replace(/\]\(\s*(\/(?!\/)[^)\s]*)/g, (_, path: string) => `](${DERPIBOORU_ORIGIN}${path}`)
      .replace(
        /^(\s{0,3}\[[^\]]+\]:\s*)(\/(?!\/)\S*)/gm,
        (_, lead: string, path: string) => `${lead}${DERPIBOORU_ORIGIN}${path}`,
      )
      .replace(PICTURE_REFERENCE, (_, lead: string, id: string) => `${lead}[>>${id}](/pic/${id})`),
  );
}

/**
 * A link that names a comment on Derpibooru (`…/images/232093#comment_10184427`, absolute or
 * not): its picture and comment ids, so a click can scroll to it when it is on screen here.
 */
export function derpiCommentTarget(href: string | null | undefined): { imageId: number; commentId: number } | null {
  if (!href) return null;
  const match = /^(?:https?:\/\/(?:www\.)?(?:derpibooru\.org|trixiebooru\.org))?\/(?:images\/)?(\d+)#comment_(\d+)$/i.exec(
    href.trim(),
  );
  if (!match) return null;
  return { imageId: Number(match[1]), commentId: Number(match[2]) };
}

/** The BBCode tags the editor writes and the renderer reads; a block tag ends a line. */
const BBCODE_TAG =
  /\[\/?(?:b|i|u|s|url|quote|code|list|\*|color|size|font|center|left|right|align|div|p|span|h[1-6]|table|tr|td|th|br|hr|spoiler|sup|sub|email)(?:=[^\]]*)?\]/gi;
const BLOCK_TAG = /^\[\/?(?:p|div|br|quote|list|\*|h[1-6]|center|tr|table|hr)\b/i;

/** BBCode that carries somebody else's words (a quote) or no words at all (a picture). */
function stripBbcode(text: string, keepQuotes: boolean): string {
  let out = text;
  if (!keepQuotes) {
    /* Innermost first, until nothing changes: a quote of a quote leaves nothing behind. */
    let previous: string;
    do {
      previous = out;
      out = out.replace(/\[quote(?:=[^\]]*)?\](?:(?!\[quote)[\s\S])*?\[\/quote\]/gi, '');
    } while (out !== previous);
  }
  return out
    .replace(/\[img[^\]]*\][\s\S]*?\[\/img\]/gi, '')
    .replace(/\[url=[^\]]*\]([\s\S]*?)\[\/url\]/gi, '$1')
    /* Only the tags the editor and the renderer know: a Markdown link's `[text]` is words. */
    .replace(BBCODE_TAG, (tag) => (BLOCK_TAG.test(tag) ? '\n' : ''))
    .replace(/<[^>]+>/g, '');
}

/**
 * Any comment or description as plain text: BBCode tags and Markdown gone, their words kept.
 * Paragraphs are kept (joined by a blank line); `max` cuts the result, with an ellipsis. A reply's
 * preview drops the quotes (`keepQuotes: false`) — they are the words being answered.
 */
export function plainTextOf(
  body: string | null | undefined,
  { max = Number.POSITIVE_INFINITY, keepQuotes = true }: { max?: number; keepQuotes?: boolean } = {},
): string {
  if (!body) return '';
  /* A picture reference survives the Markdown rules (which would read `>>` as a quote marker). */
  const guarded = stripBbcode(body.replace(/\r\n?/g, '\n'), keepQuotes).replace(
    PICTURE_REFERENCE,
    (_, lead: string, id: string) => `${lead}\u0001${id}\u0001`,
  );
  const paragraphs = guarded
    .split(/\n\s*\n/)
    .map((paragraph) =>
      paragraph
        .split('\n')
        .filter((line) => keepQuotes || !/^\s*>/.test(line))
        .join('\n'),
    )
    .map((paragraph) => descriptionTeaser(paragraph, Number.MAX_SAFE_INTEGER))
    .filter(Boolean)
    .map((paragraph) => paragraph.replace(/\u0001(\d+)\u0001/g, '>>$1'));
  const text = paragraphs.join('\n\n');
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, Math.max(0, max - 1)).join('').trimEnd()}…` : text;
}
