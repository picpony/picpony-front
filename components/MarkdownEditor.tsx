'use client';

import React, { useRef, useCallback } from 'react';
import { MdFormatBold, MdFormatItalic, MdFormatUnderlined, MdTitle, MdFormatListBulleted, MdFormatListNumbered, MdFormatQuote, MdCode, MdLink, MdImage } from 'react-icons/md';
import { useTextInsertion } from '@/lib/hooks';

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

type ToolAction = 'bold' | 'italic' | 'underline' | 'heading' | 'ulist' | 'olist' | 'quote' | 'code' | 'link' | 'image';

const toolDefs: { icon: React.ReactNode; title: string; action: ToolAction }[] = [
  { icon: <MdFormatBold size={20} />, title: '加粗', action: 'bold' },
  { icon: <MdFormatItalic size={20} />, title: '斜体', action: 'italic' },
  { icon: <MdFormatUnderlined size={20} />, title: '下划线', action: 'underline' },
  { icon: <MdTitle size={20} />, title: '标题', action: 'heading' },
  { icon: <MdFormatListBulleted size={20} />, title: '无序列表', action: 'ulist' },
  { icon: <MdFormatListNumbered size={20} />, title: '有序列表', action: 'olist' },
  { icon: <MdFormatQuote size={20} />, title: '引用', action: 'quote' },
  { icon: <MdCode size={20} />, title: '代码', action: 'code' },
  { icon: <MdLink size={20} />, title: '链接', action: 'link' },
  { icon: <MdImage size={20} />, title: '图片', action: 'image' },
];

export default function MarkdownEditor({ value, onChange, placeholder, disabled }: MarkdownEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { insertText } = useTextInsertion(textareaRef, onChange);

  const insertBlock = useCallback((prefix: string, suffix: string = '') => {
    insertText(prefix, suffix, '');
  }, [insertText]);

  const insertTemplate = useCallback((template: string, placeholder: string = '') => {
    if (!textareaRef.current) return;

    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const text = textareaRef.current.value;

    const before = text.substring(0, start);
    const selected = text.substring(start, end);
    const after = text.substring(end);

    const [prefix, suffix] = template.split('{{selected}}');
    const insertTextContent = selected ? `${prefix}${selected}${suffix}` : `${prefix}${placeholder}${suffix}`;
    const newText = `${before}${insertTextContent}${after}`;
    onChange(newText);

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        if (!selected) {
          const cursorPos = start + prefix.length;
          textareaRef.current.setSelectionRange(cursorPos, cursorPos + placeholder.length);
        } else {
          const cursorPos = start + insertTextContent.length;
          textareaRef.current.setSelectionRange(cursorPos, cursorPos);
        }
      }
    }, 0);
  }, [textareaRef, onChange]);

  const handleToolAction = useCallback((action: ToolAction) => {
    switch (action) {
      case 'bold': insertBlock('**', '**'); break;
      case 'italic': insertBlock('*', '*'); break;
      case 'underline': insertBlock('<u>', '</u>'); break;
      case 'heading': insertTemplate('## {{selected}}', '标题'); break;
      case 'ulist': insertTemplate('- {{selected}}', '列表项'); break;
      case 'olist': insertTemplate('1. {{selected}}', '列表项'); break;
      case 'quote': insertTemplate('> {{selected}}', '引用内容'); break;
      case 'code': insertTemplate('`{{selected}}`', '代码'); break;
      case 'link': insertTemplate('[{{selected}}](url)', '链接文字'); break;
      case 'image': insertTemplate('![{{selected}}](url)', '图片描述'); break;
    }
  }, [insertBlock, insertTemplate]);

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
