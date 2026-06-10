'use client';

import React from 'react';

interface BBCodeRendererProps {
  content: string;
}

export default function BBCodeRenderer({ content }: BBCodeRendererProps) {
  const parseBBCode = (text: string): React.ReactNode[] => {
    if (!text) return [];

    const parts: (string | { type: 'code'; content: string })[] = [];
    const codeRegex = /\[code\]([\s\S]*?)\[\/code\]/gi;
    let match;
    let lastIndex = 0;

    while ((match = codeRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index));
      }
      parts.push({ type: 'code', content: match[1] });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }

    if (parts.length === 0) {
      parts.push(text);
    }

    const result: React.ReactNode[] = [];
    let keyCounter = 0;
    const getKey = () => `bbcode-${keyCounter++}`;

    parts.forEach((part) => {
      if (typeof part === 'object' && part.type === 'code') {
        result.push(
          <pre key={getKey()} className="bg-slate-100 dark:bg-slate-800 rounded-lg p-4 overflow-x-auto my-2">
            <code className="text-sm">{part.content}</code>
          </pre>
        );
      } else {
        result.push(...parseBBCodeInText(part as string, getKey));
      }
    });

    return result;
  };

  const parseBBCodeInText = (text: string, getKey: () => string): React.ReactNode[] => {
    type TagHandler = {
      open: RegExp;
      close: string;
      render: (content: React.ReactNode[], props: Record<string, string>) => React.ReactNode;
    };

    const tags: TagHandler[] = [
      {
        open: /\[b\]/i,
        close: '[/b]',
        render: (content) => <strong key={getKey()} className="font-bold">{content}</strong>
      },
      {
        open: /\[i\]/i,
        close: '[/i]',
        render: (content) => <em key={getKey()} className="italic">{content}</em>
      },
      {
        open: /\[u\]/i,
        close: '[/u]',
        render: (content) => <span key={getKey()} className="underline">{content}</span>
      },
      {
        open: /\[s\]/i,
        close: '[/s]',
        render: (content) => <span key={getKey()} className="line-through">{content}</span>
      },
      {
        open: /\[quote\]/i,
        close: '[/quote]',
        render: (content) => (
          <blockquote key={getKey()} className="border-l-4 border-slate-300 dark:border-slate-600 pl-4 my-2 text-slate-600 dark:text-slate-400 italic">
            {content}
          </blockquote>
        )
      },
      {
        open: /\[color=([^\]]+)\]/i,
        close: '[/color]',
        render: (content, props) => <span key={getKey()} style={{ color: props.color }}>{content}</span>
      },
      {
        open: /\[url=([^\]]+)\]/i,
        close: '[/url]',
        render: (content, props) => {
          if (!props.href || props.href.toLowerCase().startsWith('javascript:')) return <>{content}</>;
          return (
            <a key={getKey()} href={props.href} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 underline">
              {content}
            </a>
          );
        }
      },
      {
        open: /\[url\]/i,
        close: '[/url]',
        render: (content) => {
          const url = typeof content[0] === 'string' ? content[0] : '';
          if (!url || url.toLowerCase().startsWith('javascript:')) return <>{content}</>;
          return (
            <a key={getKey()} href={url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 underline">
              {content}
            </a>
          );
        }
      },
      {
        open: /\[img\]/i,
        close: '[/img]',
        render: (content) => {
          const src = typeof content[0] === 'string' ? content[0] : '';
          if (!src) return null;
          return <img key={getKey()} src={src} alt="" className="max-w-full rounded-lg my-2" />;
        }
      },
      {
        open: /\[list\]/i,
        close: '[/list]',
        render: (content) => <ul key={getKey()} className="list-disc my-2 ml-4">{content}</ul>
      },
    ];

    interface Token {
      type: 'open' | 'close' | 'text';
      tag?: string;
      index: number;
      length: number;
      props?: Record<string, string>;
    }

    const tokens: Token[] = [];
    
    for (const tag of tags) {
      const regex = new RegExp(tag.open.source, 'gi');
      let m;
      while ((m = regex.exec(text)) !== null) {
        const props: Record<string, string> = {};
        if (m[1]) props.color = m[1];
        if (m[1] && tag.close === '[/url]') props.href = m[1];
        
        tokens.push({
          type: 'open',
          tag: tag.close,
          index: m.index,
          length: m[0].length,
          props
        });
      }
    }

    for (const tag of tags) {
      const closeRegex = new RegExp(tag.close.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      let m;
      while ((m = closeRegex.exec(text)) !== null) {
        tokens.push({
          type: 'close',
          tag: tag.close,
          index: m.index,
          length: m[0].length
        });
      }
    }

    tokens.sort((a, b) => a.index - b.index);

    interface Node {
      tag?: string;
      props: Record<string, string>;
      children: (Node | string)[];
      startIndex: number;
      endIndex: number;
    }

    const root: Node = { props: {}, children: [], startIndex: 0, endIndex: text.length };
    const stack: Node[] = [root];

    let lastTextIndex = 0;

    for (const token of tokens) {
      if (token.index > lastTextIndex && stack.length > 0) {
        const textContent = text.substring(lastTextIndex, token.index);
        if (textContent) {
          stack[stack.length - 1].children.push(textContent);
        }
      }

      if (token.type === 'open') {
        const newNode: Node = {
          tag: token.tag,
          props: token.props || {},
          children: [],
          startIndex: token.index + token.length,
          endIndex: text.length
        };
        if (stack.length > 0) {
          stack[stack.length - 1].children.push(newNode);
        }
        stack.push(newNode);
      } else if (token.type === 'close' && stack.length > 1) {
        const current = stack[stack.length - 1];
        if (current.tag === token.tag) {
          current.endIndex = token.index;
          stack.pop();
        }
      }

      lastTextIndex = token.index + token.length;
    }

    if (lastTextIndex < text.length && stack.length > 0) {
      const textContent = text.substring(lastTextIndex);
      if (textContent) {
        stack[stack.length - 1].children.push(textContent);
      }
    }

    const renderNode = (node: Node | string): React.ReactNode => {
      if (typeof node === 'string') {
        if (node.includes('[*]')) {
          const parts = node.split(/(\[\*\]|\[\/\*\])/);
          return parts.map((part, idx) => {
            if (part === '[*]') return null;
            if (part === '[/*]') return null;
            if (!part) return null;
            return <li key={getKey()} className="ml-4">{renderText(part)}</li>;
          }).filter(Boolean);
        }
        return renderText(node);
      }

      const content = node.children.map(child => renderNode(child));
      
      const tagHandler = tags.find(t => t.close === node.tag);
      if (tagHandler) {
        return tagHandler.render(content.flat(), node.props);
      }

      return <React.Fragment key={getKey()}>{content}</React.Fragment>;
    };

    const renderText = (str: string): React.ReactNode => {
      const escaped = str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      const lines = escaped.split('\n');
      if (lines.length === 1) return lines[0];

      return lines.map((line, idx) => (
        <React.Fragment key={getKey()}>
          {line}
          {idx < lines.length - 1 && <br />}
        </React.Fragment>
      ));
    };

    return root.children.map(child => renderNode(child));
  };

  return (
    <div className="bbcode-content text-slate-700 dark:text-slate-300">
      {parseBBCode(content)}
    </div>
  );
}