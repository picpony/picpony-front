'use client';

import React, { useRef } from 'react';
import { MdFormatBold, MdFormatItalic, MdFormatUnderlined } from 'react-icons/md';

interface BBCodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export default function BBCodeEditor({ value, onChange, placeholder, disabled }: BBCodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  const insertTag = (tagStart: string, tagEnd: string) => {
    if (!textareaRef.current) return;
    
    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const text = textareaRef.current.value;
    
    const before = text.substring(0, start);
    const selected = text.substring(start, end);
    const after = text.substring(end, text.length);
    
    const newText = `${before}${tagStart}${selected}${tagEnd}${after}`;
    onChange(newText);
    
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        if (selected.length === 0) {
           textareaRef.current.setSelectionRange(start + tagStart.length, start + tagStart.length);
        } else {
           textareaRef.current.setSelectionRange(start + tagStart.length + selected.length + tagEnd.length, start + tagStart.length + selected.length + tagEnd.length);
        }
      }
    }, 0);
  };

  return (
    <div className="w-full border border-slate-200 rounded-xl bg-slate-50 overflow-hidden focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary transition-all">
      <div className="flex flex-wrap items-center gap-1 p-2 bg-slate-100 border-b border-slate-200">
        <button
          type="button"
          onClick={() => insertTag('[b]', '[/b]')}
          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-200 rounded"
          title="加粗"
          disabled={disabled}
        >
          <MdFormatBold size={20} />
        </button>
        <button
          type="button"
          onClick={() => insertTag('[i]', '[/i]')}
          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-200 rounded"
          title="斜体"
          disabled={disabled}
        >
          <MdFormatItalic size={20} />
        </button>
        <button
          type="button"
          onClick={() => insertTag('[u]', '[/u]')}
          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-200 rounded"
          title="下划线"
          disabled={disabled}
        >
          <MdFormatUnderlined size={20} />
        </button>
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full min-h-[100px] p-3 bg-transparent outline-none resize-y text-slate-700"
      />
    </div>
  );
}
