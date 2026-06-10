'use client';

import React, { useRef } from 'react';
import { MdFormatBold, MdFormatItalic, MdFormatUnderlined, MdTitle, MdFormatListBulleted, MdFormatListNumbered, MdFormatQuote, MdCode, MdLink, MdImage } from 'react-icons/md';
import { useTextInsertion } from '@/lib/hooks';

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export default function MarkdownEditor({ value, onChange, placeholder, disabled }: MarkdownEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { insertText } = useTextInsertion(textareaRef, onChange);

  const insertBlock = (prefix: string, suffix: string = '') => {
    insertText(prefix, suffix, '');
  };

  const insertTemplate = (template: string, placeholder: string = '') => {
    if (!textareaRef.current) return;

    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const text = textareaRef.current.value;

    const before = text.substring(0, start);
    const selected = text.substring(start, end);
    const after = text.substring(end);

    const [prefix, suffix] = template.split('{{selected}}');
    const insertText = selected ? `${prefix}${selected}${suffix}` : `${prefix}${placeholder}${suffix}`;
    const newText = `${before}${insertText}${after}`;
    onChange(newText);

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        if (!selected) {
          const cursorPos = start + prefix.length;
          textareaRef.current.setSelectionRange(cursorPos, cursorPos + placeholder.length);
        } else {
          const cursorPos = start + insertText.length;
          textareaRef.current.setSelectionRange(cursorPos, cursorPos);
        }
      }
    }, 0);
  };

  const tools = [
    { icon: <MdFormatBold size={20} />, title: '加粗', action: () => insertBlock('**', '**') },
    { icon: <MdFormatItalic size={20} />, title: '斜体', action: () => insertBlock('*', '*') },
    { icon: <MdFormatUnderlined size={20} />, title: '下划线', action: () => insertBlock('<u>', '</u>') },
    { icon: <MdTitle size={20} />, title: '标题', action: () => insertTemplate('## {{selected}}', '标题') },
    { icon: <MdFormatListBulleted size={20} />, title: '无序列表', action: () => insertTemplate('- {{selected}}', '列表项') },
    { icon: <MdFormatListNumbered size={20} />, title: '有序列表', action: () => insertTemplate('1. {{selected}}', '列表项') },
    { icon: <MdFormatQuote size={20} />, title: '引用', action: () => insertTemplate('> {{selected}}', '引用内容') },
    { icon: <MdCode size={20} />, title: '代码', action: () => insertTemplate('`{{selected}}`', '代码') },
    { icon: <MdLink size={20} />, title: '链接', action: () => insertTemplate('[{{selected}}](url)', '链接文字') },
    { icon: <MdImage size={20} />, title: '图片', action: () => insertTemplate('![{{selected}}](url)', '图片描述') },
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
