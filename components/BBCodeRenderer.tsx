'use client';

import React, { useMemo } from 'react';

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
  html = html.replace(
    /\[img\]([\s\S]*?)\[\/img\]/gi,
    (match, url: string) => {
      const src = url.trim();
      if (!src) return '';
      // Resolve relative paths
      const resolved = src.startsWith('/') ? `https://picpony.top${src}` : src;
      return `<img src="${resolved}" alt="" style="max-width:100%;border-radius:8px;margin:8px 0;" />`;
    }
  );

  // Bold
  html = html.replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '<em>$1</em>');
  // Underline
  html = html.replace(
    /\[u\]([\s\S]*?)\[\/u\]/gi,
    '<span style="text-decoration:underline;">$1</span>'
  );
  // Strikethrough
  html = html.replace(
    /\[s\]([\s\S]*?)\[\/s\]/gi,
    '<span style="text-decoration:line-through;">$1</span>'
  );

  // Color
  html = html.replace(
    /\[color=(.*?)\]([\s\S]*?)\[\/color\]/gi,
    '<span style="color:$1;">$2</span>'
  );

  // Center alignment
  html = html.replace(
    /\[center\]([\s\S]*?)\[\/center\]/gi,
    '<div style="text-align:center;margin:8px 0;">$1</div>'
  );

  // URL with custom text [url=href]text[/url]
  html = html.replace(
    /\[url=(.*?)\]([\s\S]*?)\[\/url\]/gi,
    '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:underline;">$2</a>'
  );

  // Bare URL [url]href[/url]
  html = html.replace(
    /\[url\]([\s\S]*?)\[\/url\]/gi,
    '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:underline;">$1</a>'
  );

  // Quote
  html = html.replace(
    /\[quote\]([\s\S]*?)\[\/quote\]/gi,
    '<blockquote style="border-left:4px solid #94a3b8;padding-left:16px;margin:8px 0;font-style:italic;color:#64748b;">$1</blockquote>'
  );

  // Code block (preserve inner content exactly)
  html = html.replace(
    /\[code\]([\s\S]*?)\[\/code\]/gi,
    '<pre style="background:#f1f5f9;border-radius:8px;padding:16px;overflow-x:auto;margin:8px 0;"><code style="font-size:0.875rem;">$1</code></pre>'
  );

  // Ordered list [list=1]
  html = html.replace(
    /\[list=1\]([\s\S]*?)\[\/list\]/gi,
    '<ol style="list-style-type:decimal;margin:8px 0;padding-left:16px;">$1</ol>'
  );

  // Unordered list [list]
  html = html.replace(
    /\[list\]([\s\S]*?)\[\/list\]/gi,
    '<ul style="list-style-type:disc;margin:8px 0;padding-left:16px;">$1</ul>'
  );

  // List items [*]
  html = html.replace(/\[\*\] /gi, '<li style="margin-left:16px;">');
  html = html.replace(
    /\[\*\]([\s\S]*?)(?=\[\*\]|\[\/list\]|\[\/ol\]|\[\/ul\]|$)/gi,
    '<li style="margin-left:16px;">$1</li>'
  );

  // HTML-mapped tags: div wrapper
  html = html.replace(
    /\[div\]([\s\S]*?)\[\/div\]/gi,
    '<div>$1</div>'
  );

  // Headings h1-h6
  html = html.replace(/\[h1\]([\s\S]*?)\[\/h1\]/gi, '<h1 style="font-size:1.5rem;font-weight:700;margin:12px 0 8px;">$1</h1>');
  html = html.replace(/\[h2\]([\s\S]*?)\[\/h2\]/gi, '<h2 style="font-size:1.25rem;font-weight:700;margin:10px 0 6px;">$1</h2>');
  html = html.replace(/\[h3\]([\s\S]*?)\[\/h3\]/gi, '<h3 style="font-size:1.125rem;font-weight:600;margin:8px 0 4px;">$1</h3>');
  html = html.replace(/\[h4\]([\s\S]*?)\[\/h4\]/gi, '<h4 style="font-size:1rem;font-weight:600;margin:6px 0 4px;">$1</h4>');
  html = html.replace(/\[h5\]([\s\S]*?)\[\/h5\]/gi, '<h5 style="font-size:0.875rem;font-weight:600;margin:6px 0 4px;">$1</h5>');
  html = html.replace(/\[h6\]([\s\S]*?)\[\/h6\]/gi, '<h6 style="font-size:0.75rem;font-weight:600;margin:6px 0 4px;">$1</h6>');

  // Paragraph
  html = html.replace(
    /\[p\]([\s\S]*?)\[\/p\]/gi,
    '<p style="margin:4px 0;">$1</p>'
  );

  // Span
  html = html.replace(
    /\[span\]([\s\S]*?)\[\/span\]/gi,
    '<span>$1</span>'
  );

  // Table tags
  html = html.replace(/\[table\]([\s\S]*?)\[\/table\]/gi, '<table style="border-collapse:collapse;width:100%;margin:8px 0;">$1</table>');
  html = html.replace(/\[tr\]([\s\S]*?)\[\/tr\]/gi, '<tr>$1</tr>');
  html = html.replace(/\[td\]([\s\S]*?)\[\/td\]/gi, '<td style="border:1px solid #cbd5e1;padding:6px 10px;">$1</td>');
  html = html.replace(/\[th\]([\s\S]*?)\[\/th\]/gi, '<th style="border:1px solid #cbd5e1;padding:6px 10px;font-weight:600;background:#f8fafc;">$1</th>');

  // Line break [br] — before generic \n conversion
  html = html.replace(/\[br\]/gi, '<br />');

  // Step 3: convert newlines to <br />
  html = html.replace(/\n/g, '<br />');

  return html;
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

  return (
    <div
      className="bbcode-content"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
