'use client';

import React, { useRef } from 'react';
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

interface BBCodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export default function BBCodeEditor({ value, onChange, placeholder, disabled }: BBCodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const insertBBCode = (openTag: string, closeTag: string, placeholder: string = '') => {
    if (!textareaRef.current) return;

    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const text = textareaRef.current.value;

    const before = text.substring(0, start);
    const selected = text.substring(start, end);
    const after = text.substring(end, text.length);

    const insertText = selected 
      ? `${openTag}${selected}${closeTag}` 
      : `${openTag}${placeholder}${closeTag}`;
    const newText = `${before}${insertText}${after}`;
    onChange(newText);

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        if (!selected) {
          const cursorPos = start + openTag.length;
          textareaRef.current.setSelectionRange(cursorPos, cursorPos + placeholder.length);
        } else {
          const cursorPos = start + insertText.length;
          textareaRef.current.setSelectionRange(cursorPos, cursorPos);
        }
      }
    }, 0);
  };

  const insertUrl = () => {
    if (!textareaRef.current) return;

    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const text = textareaRef.current.value;

    const before = text.substring(0, start);
    const selected = text.substring(start, end);
    const after = text.substring(end, text.length);

    let insertText: string;
    if (selected) {
      insertText = `[url=https://]${selected}[/url]`;
    } else {
      insertText = `[url=https://]链接文字[/url]`;
    }
    
    const newText = `${before}${insertText}${after}`;
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
  };

  const insertImage = () => {
    insertBBCode('[img]', '[/img]', 'https://example.com/image.jpg');
  };

  const tools = [
    { icon: <MdFormatBold size={20} />, title: '粗体', action: () => insertBBCode('[b]', '[/b]', '粗体文字') },
    { icon: <MdFormatItalic size={20} />, title: '斜体', action: () => insertBBCode('[i]', '[/i]', '斜体文字') },
    { icon: <MdFormatUnderlined size={20} />, title: '下划线', action: () => insertBBCode('[u]', '[/u]', '下划线文字') },
    { icon: <MdFormatStrikethrough size={20} />, title: '删除线', action: () => insertBBCode('[s]', '[/s]', '删除线文字') },
    { icon: <MdFormatColorText size={20} />, title: '颜色', action: () => insertBBCode('[color=red]', '[/color]', '红色文字') },
    { icon: <MdFormatListBulleted size={20} />, title: '列表', action: () => insertBBCode('[list]\n[*]', '\n[*]项目2\n[/list]', '项目1') },
    { icon: <MdFormatQuote size={20} />, title: '引用', action: () => insertBBCode('[quote]', '[/quote]', '引用内容') },
    { icon: <MdCode size={20} />, title: '代码', action: () => insertBBCode('[code]', '[/code]', '代码内容') },
    { icon: <MdLink size={20} />, title: '链接', action: insertUrl },
    { icon: <MdImage size={20} />, title: '图片', action: insertImage },
  ];

  return (
    <div className="w-full border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900/50 overflow-hidden focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary transition-all">
      <div className="flex flex-wrap items-center gap-1 p-2 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        {tools.map((tool, index) => (
          <button
            key={index}
            type="button"
            onClick={tool.action}
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