'use client';

import React from 'react';
import BBCodeRenderer from './BBCodeRenderer';
import MarkdownRenderer from './MarkdownRenderer';

interface RichTextRendererProps {
  content: string;
  /** Render as inline content — see `MarkdownRenderer`. BBCode is block-shaped
   *  by construction ([quote], [list], [table]) and ignores this. */
  inline?: boolean;
}

export default function RichTextRenderer({ content, inline = false }: RichTextRendererProps) {
  const hasBBCode = (text: string): boolean => {
    const bbcodePatterns = [
      /\[\/?b\]/i, // [b] [/b]
      /\[\/?i\]/i, // [i] [/i]
      /\[\/?u\]/i, // [u] [/u]
      /\[\/?s\]/i, // [s] [/s]
      /\[\/?quote\b/i, // [quote] [/quote] [quote=]
      /\[\/?code\]/i, // [code] [/code]
      /\[\/?list\b/i, // [list] [/list] [list=1]
      /\[\*\]/i, // [*]
      /\[\/?img\]/i, // [img] [/img]
      /\[\/?url\b/i, // [url] [url=]
      /\[\/?color\b/i, // [color=]
      /\[\/?center\]/i, // [center] [/center]
      /\[\/?div\]/i, // [div] [/div]
      /\[\/?h[1-6]\]/i, // [h1] [/h1] ... [h6] [/h6]
      /\[br\]/i, // [br]
      /\[\/?span\]/i, // [span] [/span]
      /\[\/?p\]/i, // [p] [/p]
      /\[\/?table\]/i, // [table] [/table]
      /\[\/?tr\]/i, // [tr] [/tr]
      /\[\/?td\]/i, // [td] [/td]
      /\[\/?th\]/i, // [th] [/th]
    ];

    return bbcodePatterns.some((pattern) => pattern.test(text));
  };

  if (hasBBCode(content)) {
    return <BBCodeRenderer content={content} />;
  }

  return <MarkdownRenderer content={content} inline={inline} />;
}
