'use client';

import React, { useEffect, useRef, useCallback } from 'react';
import { htmlToBBCode, bbcodeToHtml } from '@/lib/bbcode';
import { useAuth } from '@/lib/hooks';
import { showToast } from '@/components/Toast';
import { getAssetUrl } from '@/lib/utils';
import { isImageHeroTransitionRunning, waitForImageHeroTransition } from '@/lib/hero';
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
    try {
      if (editorRef.current) {
        editorRef.current.destroy();
        editorRef.current = null;
      }
      if (toolbarRef.current) {
        toolbarRef.current.destroy();
        toolbarRef.current = null;
      }
    } catch (err) {
      console.error('销毁编辑器失败:', err);
    }
    initializedRef.current = false;
  }, []);

  const initEditor = useCallback(async () => {
    if (initializedRef.current) return;
    if (!toolbarContainerRef.current || !editorContainerRef.current) return;

    const wangEditor = await import('@wangeditor/editor');

    // Guard: after async import, re-check since StrictMode double-mount may
    // have already initialized the editor while we were awaiting
    if (initializedRef.current) return;
    if (!toolbarContainerRef.current || !editorContainerRef.current) return;

    const { createEditor, createToolbar } = wangEditor;

    const editorConfig: Partial<IEditorConfig> = {
      autoFocus: false,
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
              if (!editorRef.current) {
                showToast('编辑器已关闭，图片无法插入', 'warning');
                return;
              }
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
  }, [
    placeholder,
    onChange,
    enableImageUpload,
    imageUploadUrl,
    getToken,
    getTokenFromAuth,
    destroyEditor,
    value,
  ]);

  // Mount once: re-running on initEditor/value changes would tear down the editor mid-edit
  useEffect(() => {
    initEditor().catch((err) => console.error('编辑器初始化异常:', err));

    return () => {
      if (!isImageHeroTransitionRunning()) {
        destroyEditor();
        return;
      }
      void waitForImageHeroTransition().then(destroyEditor);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional mount/unmount lifecycle only
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !value) return;
    if (isUpdatingRef.current) return;

    let currentHtml: string;
    try {
      currentHtml = editor.getHtml();
    } catch {
      // Editor instance was destroyed (WeakMap entry cleared); skip update
      return;
    }
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

    try {
      if (disabled) {
        editor.disable();
      } else {
        editor.enable();
      }
    } catch {
      // Editor instance was destroyed; ignore
    }
  }, [disabled]);

  return (
    <div className="w-full overflow-hidden rounded-sm border border-outline-variant transition-ui focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
      <style>{`
        /* wangEditor is themed entirely through its own \`--w-e-*\` variables.
           These used to be set only under \`.dark\`, and to a cold slate palette:
           light mode fell through to the library's stock greys, and dark mode
           got a blue-grey that fought the warm rose neutral everywhere else.
           Pointing them at the design tokens instead means the editor follows
           the scheme on its own and neither branch can drift. */
        .w-e-bar,
        .w-e-text-container,
        .w-e-modal,
        .w-e-select-list,
        .w-e-drop-panel,
        .w-e-bar-item-group .w-e-bar-item-menus-container {
          --w-e-textarea-bg-color: var(--md-sys-color-surface-container-lowest);
          --w-e-textarea-color: var(--md-sys-color-on-surface);
          --w-e-textarea-border-color: var(--md-sys-color-outline-variant);
          --w-e-textarea-slight-border-color: var(--md-sys-color-outline-variant);
          --w-e-textarea-slight-color: var(--md-sys-color-on-surface-variant);
          --w-e-textarea-slight-bg-color: var(--md-sys-color-surface-container);
          --w-e-textarea-selected-border-color: var(--md-sys-color-primary);
          --w-e-textarea-handler-bg-color: var(--md-sys-color-primary);
          --w-e-toolbar-color: var(--md-sys-color-on-surface-variant);
          --w-e-toolbar-bg-color: var(--md-sys-color-surface-container-low);
          --w-e-toolbar-active-color: var(--md-sys-color-on-surface);
          --w-e-toolbar-active-bg-color: var(--md-sys-color-surface-container-high);
          --w-e-toolbar-disabled-color: var(--md-sys-color-outline);
          --w-e-toolbar-border-color: var(--md-sys-color-outline-variant);
          --w-e-modal-button-bg-color: var(--md-sys-color-surface-container-high);
          --w-e-modal-button-border-color: var(--md-sys-color-outline);
        }

        .w-e-text-container [data-slate-editor] pre > code {
          background-color: var(--md-sys-color-surface-container-high);
          border-color: var(--md-sys-color-outline-variant);
        }

        .w-e-text-container [data-slate-editor] table th {
          background-color: var(--md-sys-color-surface-container);
        }

        .w-e-text-container [data-slate-editor] table td,
        .w-e-text-container [data-slate-editor] table th {
          border-color: var(--md-sys-color-outline-variant);
        }

        .w-e-panel-content-color li {
          border-color: var(--w-e-toolbar-bg-color);
        }

        /* The checkerboard behind a transparent video poster. */
        .w-e-textarea-video-container {
          background-image:
            linear-gradient(45deg, var(--md-sys-color-surface-container-high) 25%, transparent 0, transparent 75%, var(--md-sys-color-surface-container-high) 0, var(--md-sys-color-surface-container-high)),
            linear-gradient(45deg, var(--md-sys-color-surface-container-high) 25%, var(--md-sys-color-surface-container-lowest) 0, var(--md-sys-color-surface-container-lowest) 75%, var(--md-sys-color-surface-container-high) 0, var(--md-sys-color-surface-container-high));
        }

        .w-e-text-container {
          min-height: 300px;
          height: auto !important;
          border-radius: 0 0 calc(0.5rem - 1px) calc(0.5rem - 1px);
        }
        .w-e-text-container [data-slate-editor] {
          min-height: 300px;
        }

        .w-e-bar {
          border-radius: calc(0.5rem - 1px) calc(0.5rem - 1px) 0 0;
        }

        /* ---- Toolbar -------------------------------------------------
           wangEditor ships a 32px-tall row of bare 14px glyphs with a square
           grey hover — none of which is M3, and none of which is usable with a
           thumb. It also lays the row out as a single unwrapped flex line, so
           in simple mode (~15 items, roughly 600px) it spilled straight through
           the rounded border on a phone and pushed horizontal overflow onto the
           whole detail page.

           Rebuilt here as a row of M3 icon buttons: 40dp round targets, a
           state-layer hover, secondary-container for the active state, and the
           row wraps instead of overflowing. Wrapping rather than a horizontal
           scroller because a scroller here would compete with pull-to-dismiss,
           which force-writes touch-action on the surrounding scroller.
           (No backticks in this block: it lives inside a JS template literal.) */
        .w-e-bar {
          padding: 6px;
          font-size: var(--text-label-l);
        }

        .w-e-bar-show {
          flex-wrap: wrap;
          gap: 2px;
        }

        .w-e-bar svg {
          height: 18px;
          width: 18px;
        }

        .w-e-bar-item {
          height: auto;
          padding: 0;
        }

        .w-e-bar-item button {
          height: 40px;
          min-width: 40px;
          padding: 0 8px;
          border-radius: 9999px;
          transition:
            background-color 200ms var(--ease-standard),
            color 200ms var(--ease-standard);
        }

        .w-e-bar-item button:hover {
          background-color: color-mix(
            in oklab,
            var(--md-sys-color-on-surface) 8%,
            transparent
          );
          color: var(--md-sys-color-on-surface);
        }

        .w-e-bar-item button:active {
          background-color: color-mix(
            in oklab,
            var(--md-sys-color-on-surface) 12%,
            transparent
          );
        }

        .w-e-bar-item button:focus-visible {
          outline: 2px solid var(--md-sys-color-primary);
          outline-offset: -2px;
        }

        /* Selected state — the M3 pairing, not a grey wash. */
        .w-e-bar-item .active,
        .w-e-bar-item .active:hover {
          background-color: var(--md-sys-color-secondary-container);
          color: var(--md-sys-color-on-secondary-container);
        }

        .w-e-bar-item .active svg {
          fill: var(--md-sys-color-on-secondary-container);
        }

        .w-e-bar-divider {
          height: 24px;
          align-self: center;
          margin: 0 4px;
          background-color: var(--md-sys-color-outline-variant);
        }

        /* Grouped menus (indent, justify) opened on hover only, so on a touch
           device they could not be opened at all. */
        .w-e-bar-item-group:focus-within .w-e-bar-item-menus-container {
          display: block;
        }

        .w-e-bar-item-group .w-e-bar-item-menus-container {
          margin-top: 44px;
          border-radius: var(--radius-sm);
          border-color: var(--md-sys-color-outline-variant);
          box-shadow: var(--md-sys-elevation-2);
          padding: 4px;
        }
      `}</style>
      <div ref={toolbarContainerRef} className="border-b border-outline-variant" />
      <div ref={editorContainerRef} />
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
