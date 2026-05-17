'use client';

import React from 'react';
import BBCodeRenderer from './BBCodeRenderer';
import MarkdownRenderer from './MarkdownRenderer';

interface RichTextRendererProps {
  content: string;
}

export default function RichTextRenderer({ content }: RichTextRendererProps) {
  const hasBBCode = (text: string): boolean => {
    const bbcodePatterns = [
      /\[\/?b\]/i,           // [b] [/b]
      /\[\/?i\]/i,           // [i] [/i]
      /\[\/?u\]/i,           // [u] [/u]
      /\[\/?s\]/i,           // [s] [/s]
      /\[\/?quote\]/i,       // [quote] [/quote]
      /\[\/?code\]/i,        // [code] [/code]
      /\[\/?list\]/i,        // [list] [/list]
      /\[\*\]/i,             // [*]
      /\[\/?img\]/i,         // [img] [/img]
      /\[\/?url\b/i,         // [url] [url=]
      /\[\/?color\b/i,       // [color=]
    ];
    
    return bbcodePatterns.some(pattern => pattern.test(text));
  };

  if (hasBBCode(content)) {
    return <BBCodeRenderer content={content} />;
  }

  return <MarkdownRenderer content={content} />;
}