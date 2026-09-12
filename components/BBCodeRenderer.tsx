'use client';

import { useMemo } from 'react';
import { bbcodeToSafeHtml } from '@/lib/bbcode';

interface BBCodeRendererProps {
  content: string;
}

export default function BBCodeRenderer({ content }: BBCodeRendererProps) {
  const html = useMemo(() => bbcodeToSafeHtml(content), [content]);
  if (!html) return null;

  return (
    <div className="bbcode-content break-words" dangerouslySetInnerHTML={{ __html: html }} />
  );
}
