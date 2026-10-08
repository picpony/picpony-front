'use client';

import BBCodeRenderer from './BBCodeRenderer';
import MarkdownRenderer from './MarkdownRenderer';

export type RichTextFormat = 'auto' | 'bbcode' | 'markdown';

interface RichTextRendererProps {
  content: string;
  /**
   * What the text is written in, when the caller knows.
   *
   * `bbcode` for PicPony's own texts (forum posts, replies, site comments): BBCode or plain text,
   * never Markdown — a plain reply starting 「1. 首先」 is a sentence, not a list, and read as
   * Markdown it became one. `markdown` for Derpibooru's. `auto` (the default) guesses from the
   * tags: any BBCode tag means BBCode, anything else Markdown.
   */
  format?: RichTextFormat;
  className?: string;
}

/** A BBCode tag the original front end or this one writes — the evidence `auto` goes by. Exact
 *  forms only, so a Markdown link's text (`[i am](…)`) is not mistaken for an italic. */
const BBCODE_TAG =
  /\[\/?(?:b|i|u|s|code|img|center|right|div|span|p|table|tr|td|th|h[1-6])\]|\[\/?(?:url|color|bg|quote|list)(?:=[^\]\n]*)?\]|\[\*\]|\[br\]/i;

export function isBBCode(text: string): boolean {
  return BBCODE_TAG.test(text);
}

export default function RichTextRenderer({ content, format = 'auto', className }: RichTextRendererProps) {
  const bbcode = format === 'bbcode' || (format === 'auto' && isBBCode(content));
  if (bbcode) return <BBCodeRenderer content={content} className={className} />;
  if (className) {
    return (
      <div className={className}>
        <MarkdownRenderer content={content} />
      </div>
    );
  }
  return <MarkdownRenderer content={content} />;
}
