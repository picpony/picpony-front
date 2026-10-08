import { PONY_EMOJI, type PonyEmoji } from '@/lib/generated/emoji';
import { parseShare, shareSummary } from '@/lib/api/messages';
import { subscriptionHref } from '@/components/subscriptions/href';

/*
 * What a message's text *is*, as tokens — pure, so it can be tested without a DOM.
 *
 * **A direct message is plain text** (coordinator call C10): line breaks kept, links made
 * clickable, `$emoji_<name>$` markers drawn as the picture — no Markdown. It was parsed as
 * Markdown, so a line starting `1. ` became a list, a `#` a heading and three lines one line.
 *
 * **Except what the original front end sent.** Its composer was a rich-text editor whose output
 * went through `htmlToBBCode`, so every message written there is wrapped in `[p]…[/p]` and may
 * carry `[br]`, `[b]`, `[img]`, `[url=…]`. Rendering those tags as literal text would show every
 * old conversation as markup; `legacyTokens` reads them into the same plain model instead — a
 * paragraph is a line, a picture is a picture, a link is a link, and inline formatting is text.
 */

export type MessageToken =
  | { type: 'text'; text: string }
  | { type: 'emoji'; emoji: PonyEmoji }
  | { type: 'link'; text: string; href: string; internal: boolean }
  | { type: 'image'; src: string };

export const EMOJI_BY_NAME: ReadonlyMap<string, PonyEmoji> = new Map(PONY_EMOJI.map((emoji) => [emoji.name, emoji]));

/** A `$emoji_<name>$` marker. Capturing, so a split keeps the markers as their own pieces. */
const EMOJI_MARKER = /(\$emoji_[a-zA-Z0-9_]+\$)/;
const EMOJI_NAME = /^\$emoji_([a-zA-Z0-9_]+)\$$/;

/** The picture a marker stands for, or `null` for text that only looks like one. */
export function emojiOfMarker(marker: string): PonyEmoji | null {
  const match = EMOJI_NAME.exec(marker);
  return match ? EMOJI_BY_NAME.get(match[1]) ?? null : null;
}

export function emojiMarker(name: string): string {
  return `$emoji_${name}$`;
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/**
 * A URL in running text ends at whitespace, a quote, an angle bracket or Chinese punctuation —
 * 「地址：https://dev.picpony.top/，测试前端…」 is the shape the notices are written in.
 */
const URL_IN_TEXT = /https?:\/\/[^\s<>"'`，。！？、；：（）【】《》「」『』]+/gi;
/** ASCII punctuation that ends a sentence rather than the URL. */
const TRAILING = /[.,!?;:'"\]}]$/;

/**
 * A URL without the punctuation the sentence put after it. A closing parenthesis is the URL's
 * own while it closes one the URL opened (a Wikipedia title), and the sentence's otherwise.
 */
function trimUrl(candidate: string): string {
  let url = candidate;
  while (url) {
    if (url.endsWith(')')) {
      const opened = url.split('(').length - 1;
      const closed = url.split(')').length - 1;
      if (closed <= opened) break;
    } else if (!TRAILING.test(url)) {
      break;
    }
    url = url.slice(0, -1);
  }
  return url;
}

const PICPONY_HOSTS = /^(?:www\.|dev\.)?picpony\.top$/i;
const DERPI_IMAGE = /^(?:www\.)?(?:derpibooru|trixiebooru)\.org$/i;
/** In-app paths a link may open without leaving the app. */
const APP_PATH = /^\/(?:pic|forum|user|derpi\/user)\/\d+\/?$/;

/**
 * Where a typed URL should go. A PicPony page opens in the app; so does a Derpibooru picture,
 * which this site mirrors (the original front end did the same). Anything else is external.
 * `null` for anything that is not an http(s) URL.
 */
export function resolveLink(raw: string, origin?: string): { href: string; internal: boolean } | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const sameSite = (origin !== undefined && url.origin === origin) || PICPONY_HOSTS.test(url.hostname);
  if (sameSite && APP_PATH.test(url.pathname)) {
    return { href: `${url.pathname.replace(/\/$/, '')}${url.search}`, internal: true };
  }
  const derpi = DERPI_IMAGE.test(url.hostname) ? /^\/(?:images\/)?(\d+)\/?$/.exec(url.pathname) : null;
  if (derpi) return { href: `/pic/${derpi[1]}`, internal: true };
  return { href: url.href, internal: false };
}

/** Plain text into text and link tokens. */
export function linkify(text: string, origin?: string): MessageToken[] {
  const tokens: MessageToken[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_IN_TEXT)) {
    const candidate = trimUrl(match[0]);
    const start = match.index ?? 0;
    const link = resolveLink(candidate, origin);
    if (!link) continue;
    if (start > last) tokens.push({ type: 'text', text: text.slice(last, start) });
    tokens.push({ type: 'link', text: candidate, href: link.href, internal: link.internal });
    last = start + candidate.length;
  }
  if (last < text.length) tokens.push({ type: 'text', text: text.slice(last) });
  return tokens;
}

/** Text into text, emoji and link tokens. */
function plainTokens(text: string, origin?: string): MessageToken[] {
  const tokens: MessageToken[] = [];
  for (const piece of text.split(EMOJI_MARKER)) {
    if (!piece) continue;
    const emoji = emojiOfMarker(piece);
    if (emoji) tokens.push({ type: 'emoji', emoji });
    else tokens.push(...linkify(piece, origin));
  }
  return mergeText(tokens);
}

/** Adjacent text tokens as one, so a renderer never splits a run of prose. */
function mergeText(tokens: MessageToken[]): MessageToken[] {
  const out: MessageToken[] = [];
  for (const token of tokens) {
    const previous = out[out.length - 1];
    if (token.type === 'text' && previous?.type === 'text') previous.text += token.text;
    else out.push(token.type === 'text' ? { ...token } : token);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The original front end's rich text
// ---------------------------------------------------------------------------

/** A block wrapper its editor put around every line — the tell that a message came from it. */
const LEGACY_BLOCK = /\[(?:p|div|h[1-6]|quote(?:=[^\]]*)?|list(?:=1)?|table|center|right)\]|\[br\]/i;

export function isLegacyRichText(content: string): boolean {
  return LEGACY_BLOCK.test(content);
}

/** Sentinels for the pieces pulled out before the tags are stripped (private-use code points). */
const HOLE_OPEN = '\uE000';
const HOLE_CLOSE = '\uE001';
const HOLES = /\uE000(\d+)\uE001/g;

/** A BBCode message into the plain model: blocks become lines, formatting becomes its text. */
export function legacyTokens(content: string, origin?: string): MessageToken[] {
  const holes: MessageToken[] = [];
  const hole = (token: MessageToken) => `${HOLE_OPEN}${holes.push(token) - 1}${HOLE_CLOSE}`;
  let text = content
    .replace(/\[img\]([\s\S]*?)\[\/img\]/gi, (whole, src: string) => {
      const value = src.trim();
      return /^https?:\/\//i.test(value) ? hole({ type: 'image', src: value }) : '';
    })
    .replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, (whole, href: string, label: string) => {
      const link = resolveLink(href.trim(), origin);
      const visible = stripInline(label).trim() || href.trim();
      return link ? hole({ type: 'link', text: visible, href: link.href, internal: link.internal }) : visible;
    })
    .replace(/\[url\]([\s\S]*?)\[\/url\]/gi, (whole, href: string) => href.trim());
  text = text
    .replace(/\r\n?/g, '\n')
    .replace(/\[br\]/gi, '\n')
    /* A block's end is a line break; the editor also put a newline after each, which is the
       same break, not a second one. */
    .replace(/\[\/(?:p|div|h[1-6]|quote|list|table|tr|center|right)\]\n?/gi, '\n')
    .replace(/\[(?:p|div|h[1-6]|quote(?:=[^\]]*)?|list(?:=1)?|table|tr|center|right)\]/gi, '')
    .replace(/\[\*\]\s?/g, '• ')
    .replace(/\[\/(?:td|th)\]/gi, '  ')
    .replace(/\[(?:td|th)\]/gi, '');
  text = stripInline(text)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const tokens: MessageToken[] = [];
  let last = 0;
  for (const match of text.matchAll(HOLES)) {
    const start = match.index ?? 0;
    if (start > last) tokens.push(...plainTokens(text.slice(last, start), origin));
    const token = holes[Number(match[1])];
    if (token) tokens.push(token);
    last = start + match[0].length;
  }
  if (last < text.length) tokens.push(...plainTokens(text.slice(last), origin));
  return mergeText(tokens);
}

/** Inline formatting, stripped to its text. */
function stripInline(text: string): string {
  return text.replace(/\[\/?(?:b|i|u|s|color(?:=[^\]]*)?|bg(?:=[^\]]*)?|size(?:=[^\]]*)?|font(?:=[^\]]*)?)\]/gi, '');
}

// ---------------------------------------------------------------------------
// What callers use
// ---------------------------------------------------------------------------

/** A message's body, as the bubble draws it. (A share card is recognised before this.) */
export function messageTokens(content: string, origin?: string): MessageToken[] {
  if (!content) return [];
  return isLegacyRichText(content) ? legacyTokens(content, origin) : plainTokens(content, origin);
}

/** A message as one line — a contact row's preview: cards as their summary, pictures by name. */
export function messagePreview(content: string): string {
  if (!content) return '';
  const share = parseShare(content);
  if (share) return shareSummary(share);
  return messageTokens(content)
    .map((token) => {
      switch (token.type) {
        case 'text':
          return token.text;
        case 'emoji':
          return `[${token.emoji.label}]`;
        case 'link':
          return token.text;
        case 'image':
          return '[图片]';
      }
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A notification's body. The backend writes links as markers — `[user:12|名字]`,
 * `[post:5|标题]`, `[image:123|说明]` — the original front end turned into links, and
 * `[tag_subscription|标签]`, the sync's note that a subscribed tag gained pictures: it opens that
 * subscription's pictures (the original opened the list, one tap further away). Anything else is
 * plain text with its URLs made clickable.
 */
const NOTIFICATION_MARKER = /\[(user|post|image):(\d+)\|([^\]]+)\]|\[tag_subscription\|([^\]]+)\]/g;

export function notificationTokens(content: string, origin?: string): MessageToken[] {
  if (!content) return [];
  const tokens: MessageToken[] = [];
  let last = 0;
  for (const match of content.matchAll(NOTIFICATION_MARKER)) {
    const start = match.index ?? 0;
    if (start > last) tokens.push(...linkify(content.slice(last, start), origin));
    if (match[1]) {
      const path = match[1] === 'user' ? 'user' : match[1] === 'post' ? 'forum' : 'pic';
      tokens.push({ type: 'link', text: match[3], href: `/${path}/${match[2]}`, internal: true });
    } else {
      tokens.push({ type: 'link', text: match[4], href: subscriptionHref(match[4]), internal: true });
    }
    last = start + match[0].length;
  }
  if (last < content.length) tokens.push(...linkify(content.slice(last), origin));
  return mergeText(tokens);
}
