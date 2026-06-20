'use client';

import React, { useEffect, useRef, useCallback } from 'react';
import { htmlToBBCode, bbcodeToHtml } from '@/lib/bbcode';
import { useAuth } from '@/lib/hooks';
import { showToast } from '@/components/Toast';
import { getAssetUrl } from '@/lib/utils';
import '@wangeditor/editor/dist/css/style.css';

import type { IDomEditor, Toolbar, IEditorConfig, IToolbarConfig } from '@wangeditor/editor';

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  enableImageUpload?: boolean;
  imageUploadUrl?: string;
  getToken?: () => string | null;
}

export default function RichTextEditor({
  value,
  onChange,
  placeholder = '请输入内容...',
  disabled = false,
  enableImageUpload = true,
  imageUploadUrl,
  getToken,
}: RichTextEditorProps) {
  const editorRef = useRef<IDomEditor | null>(null);
  const toolbarRef = useRef<Toolbar | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const toolbarContainerRef = useRef<HTMLDivElement>(null);
  const isUpdatingRef = useRef(false);
  const initializedRef = useRef(false);

  const { getToken: getTokenFromAuth } = useAuth();

  const destroyEditor = useCallback(() => {
    if (toolbarRef.current) {
      toolbarRef.current.destroy();
      toolbarRef.current = null;
    }
    if (editorRef.current) {
      editorRef.current.destroy();
      editorRef.current = null;
    }
    initializedRef.current = false;
  }, []);

  const initEditor = useCallback(async () => {
    if (initializedRef.current) return;
    if (!toolbarContainerRef.current || !editorContainerRef.current) return;

    const wangEditor = await import('@wangeditor/editor');
    const { createEditor, createToolbar } = wangEditor;

    const editorConfig: Partial<IEditorConfig> = {
      placeholder,
      MENU_CONF: {},
      onChange(editor: IDomEditor) {
        if (isUpdatingRef.current) return;
        const html = editor.getHtml();
        const bbcode = htmlToBBCode(html);
        onChange(bbcode);
      },
    };

    if (enableImageUpload) {
      const menuConf = editorConfig.MENU_CONF || {};
      menuConf.uploadImage = {
        async customUpload(file: File, insertFn: (url: string, alt: string, href: string) => void) {
          const formData = new FormData();
          formData.append('image', file);

          const uploadUrl = imageUploadUrl || '/api.php?action=upload_forum_image';
          const token = getToken ? getToken() : getTokenFromAuth();

          try {
            const res = await fetch(uploadUrl, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token || ''}`,
              },
              body: formData,
            });
            const data = await res.json();
            if (data.success) {
              const imageUrl = getAssetUrl(data.url);
              insertFn(imageUrl, '', imageUrl);
            } else {
              console.error('上传图片失败:', data.error);
              showToast(data.error || '上传图片失败', 'error');
            }
          } catch (err) {
            console.error('上传图片异常:', err);
            showToast('上传图片发生异常', 'error');
          }
        },
        maxFileSize: 5 * 1024 * 1024,
      };
    }

    const toolbarConfig: Partial<IToolbarConfig> = {
      excludeKeys: [
        'headerSelect',
        'blockquote',
        'group-more-style',
        'insertVideo',
        'insertTable',
        'codeBlock',
        'todo',
        'fullScreen',
      ],
    };

    destroyEditor();

    try {
      const editor = createEditor({
        selector: editorContainerRef.current,
        config: editorConfig,
        mode: 'simple',
      });

      const toolbar = createToolbar({
        editor,
        selector: toolbarContainerRef.current,
        config: toolbarConfig,
        mode: 'simple',
      });

      editorRef.current = editor;
      toolbarRef.current = toolbar;
      initializedRef.current = true;

      if (value) {
        isUpdatingRef.current = true;
        try {
          editor.setHtml(bbcodeToHtml(value));
        } catch {
          editor.clear();
          try {
            editor.dangerouslyInsertHtml(bbcodeToHtml(value));
          } catch (e) {
            console.error('设置编辑器内容失败:', e);
          }
        }
        isUpdatingRef.current = false;
      }
    } catch (err) {
      console.error('初始化编辑器失败:', err);
    }
  }, [placeholder, onChange, enableImageUpload, imageUploadUrl, getToken, getTokenFromAuth, destroyEditor, value]);

  useEffect(() => {
    initEditor();

    return () => {
      destroyEditor();
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !value) return;
    if (isUpdatingRef.current) return;

    const currentHtml = editor.getHtml();
    const expectedHtml = bbcodeToHtml(value);
    if (currentHtml !== expectedHtml) {
      isUpdatingRef.current = true;
      try {
        editor.setHtml(expectedHtml);
      } catch {
        editor.clear();
        try {
          editor.dangerouslyInsertHtml(expectedHtml);
        } catch (e) {
          console.error('更新编辑器内容失败:', e);
        }
      }
      isUpdatingRef.current = false;
    }
  }, [value]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    if (disabled) {
      editor.disable();
    } else {
      editor.enable();
    }
  }, [disabled]);

  return (
    <div className="w-full border border-slate-200 dark:border-slate-700 rounded-xl focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary transition-all">
      <style>{`
        .dark .w-e-bar,
        .dark .w-e-text-container,
        .dark .w-e-modal,
        .dark .w-e-select-list,
        .dark .w-e-drop-panel,
        .dark .w-e-bar-item-group .w-e-bar-item-menus-container {
          --w-e-textarea-bg-color: #1e293b;
          --w-e-textarea-color: #cbd5e1;
          --w-e-textarea-border-color: #334155;
          --w-e-textarea-slight-border-color: #334155;
          --w-e-textarea-slight-color: #64748b;
          --w-e-textarea-slight-bg-color: #0f172a;
          --w-e-textarea-selected-border-color: #e06c9f;
          --w-e-textarea-handler-bg-color: #e06c9f;
          --w-e-toolbar-color: #94a3b8;
          --w-e-toolbar-bg-color: #1e293b;
          --w-e-toolbar-active-color: #f1f5f9;
          --w-e-toolbar-active-bg-color: #334155;
          --w-e-toolbar-disabled-color: #475569;
          --w-e-toolbar-border-color: #334155;
          --w-e-modal-button-bg-color: #334155;
          --w-e-modal-button-border-color: #475569;
        }

        .dark .w-e-text-container [data-slate-editor] pre > code {
          background-color: #0f172a;
          border-color: #334155;
        }

        .dark .w-e-text-container [data-slate-editor] table th {
          background-color: #0f172a;
        }

        .dark .w-e-text-container [data-slate-editor] table td,
        .dark .w-e-text-container [data-slate-editor] table th {
          border-color: #334155;
        }

        .dark .w-e-panel-content-color li {
          border-color: var(--w-e-toolbar-bg-color);
        }

        .dark .w-e-textarea-video-container {
          background-image: linear-gradient(45deg, #334155 25%, transparent 0, transparent 75%, #334155 0, #334155),
            linear-gradient(45deg, #334155 25%, #1e293b 0, #1e293b 75%, #334155 0, #334155);
        }

        .w-e-text-container {
          min-height: 300px;
          height: auto !important;
          border-radius: 0 0 calc(0.75rem - 1px) calc(0.75rem - 1px);
        }
        .w-e-text-container [data-slate-editor] {
          min-height: 300px;
        }

        .w-e-bar {
          border-radius: calc(0.75rem - 1px) calc(0.75rem - 1px) 0 0;
        }
      `}</style>
      <div
        ref={toolbarContainerRef}
        className="border-b border-slate-200 dark:border-slate-700"
      />
      <div
        ref={editorContainerRef}
      />
    </div>
  );
}

export function getEditorBBCode(editor: IDomEditor | null): string {
  if (!editor) return '';
  try {
    return htmlToBBCode(editor.getHtml());
  } catch {
    return '';
  }
}
