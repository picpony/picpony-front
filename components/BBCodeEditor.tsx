'use client';

import React, { useRef, useCallback } from 'react';
import {
  MdFormatBold,
  MdFormatItalic,
  MdFormatUnderlined,
  MdFormatStrikethrough,
  MdFormatQuote,
  MdCode,
  MdLink,
  MdImage,
  MdFormatListBulleted,
  MdFormatColorText
} from 'react-icons/md';
import { useTextInsertion } from '@/lib/hooks';

interface BBCodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

type ToolAction = 'bold' | 'italic' | 'underline' | 'strikethrough' | 'color' | 'list' | 'quote' | 'code' | 'link' | 'image';

const toolDefs: { icon: React.ReactNode; title: string; action: ToolAction }[] = [
  { icon: <MdFormatBold size={20} />, title: '粗体', action: 'bold' },
  { icon: <MdFormatItalic size={20} />, title: '斜体', action: 'italic' },
  { icon: <MdFormatUnderlined size={20} />, title: '下划线', action: 'underline' },
  { icon: <MdFormatStrikethrough size={20} />, title: '删除线', action: 'strikethrough' },
  { icon: <MdFormatColorText size={20} />, title: '颜色', action: 'color' },
  { icon: <MdFormatListBulleted size={20} />, title: '列表', action: 'list' },
  { icon: <MdFormatQuote size={20} />, title: '引用', action: 'quote' },
  { icon: <MdCode size={20} />, title: '代码', action: 'code' },
  { icon: <MdLink size={20} />, title: '链接', action: 'link' },
  { icon: <MdImage size={20} />, title: '图片', action: 'image' },
];

export default function BBCodeEditor({ value, onChange, placeholder, disabled }: BBCodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { insertText } = useTextInsertion(textareaRef, onChange);

  const insertUrl = useCallback(() => {
    if (!textareaRef.current) return;

    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const text = textareaRef.current.value;

    const before = text.substring(0, start);
    const selected = text.substring(start, end);
    const after = text.substring(end);

    let insertTextContent: string;
    if (selected) {
      insertTextContent = `[url=https://]${selected}[/url]`;
    } else {
      insertTextContent = `[url=https://]链接文字[/url]`;
    }

    const newText = `${before}${insertTextContent}${after}`;
    onChange(newText);

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        if (selected) {
          const cursorPos = start + 6;
          textareaRef.current.setSelectionRange(cursorPos, cursorPos + 1);
        } else {
          const cursorPos = start + 6;
          textareaRef.current.setSelectionRange(cursorPos, cursorPos + 4);
        }
      }
    }, 0);
  }, [textareaRef, onChange]);

  const handleToolAction = useCallback((action: ToolAction) => {
    switch (action) {
      case 'bold': insertText('[b]', '[/b]', '粗体文字'); break;
      case 'italic': insertText('[i]', '[/i]', '斜体文字'); break;
      case 'underline': insertText('[u]', '[/u]', '下划线文字'); break;
      case 'strikethrough': insertText('[s]', '[/s]', '删除线文字'); break;
      case 'color': insertText('[color=red]', '[/color]', '红色文字'); break;
      case 'list': insertText('[list]\n[*]', '\n[*]项目2\n[/list]', '项目1'); break;
      case 'quote': insertText('[quote]', '[/quote]', '引用内容'); break;
      case 'code': insertText('[code]', '[/code]', '代码内容'); break;
      case 'link': insertUrl(); break;
      case 'image': insertText('[img]', '[/img]', 'https://example.com/image.jpg'); break;
    }
  }, [insertText, insertUrl]);

  return (
    <div className="w-full border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900/50 overflow-hidden focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary transition-all">
      <div className="flex flex-wrap items-center gap-1 p-2 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        {toolDefs.map((tool, index) => (
          <button
            key={index}
            type="button"
            onClick={() => handleToolAction(tool.action)}
            className="p-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"
            title={tool.title}
            disabled={disabled}
          >
            {tool.icon}
          </button>
        ))}
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full min-h-[100px] p-3 bg-transparent outline-none resize-y text-slate-700 dark:text-slate-300"
      />
    </div>
  );
}
