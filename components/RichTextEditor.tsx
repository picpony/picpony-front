'use client';

import React, { useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { htmlToBBCode, bbcodeToHtml } from '@/lib/bbcode';
import { useAuth } from '@/lib/hooks';
import { showToast } from '@/components/Toast';
import { getAssetUrl } from '@/lib/utils';
import { isImageHeroTransitionRunning, waitForImageHeroTransition } from '@/lib/hero';
import '@wangeditor/editor/dist/css/style.css';

import type { IDomEditor, Toolbar, IEditorConfig } from '@wangeditor/editor';

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
  placeholder = '请输入内容…',
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
  const generationRef = useRef(0);
  const uploadsRef = useRef(new Set<AbortController>());
  const { getToken: getTokenFromAuth } = useAuth();
  const latest = useRef({ value, onChange, placeholder, disabled, enableImageUpload, imageUploadUrl, getToken });

  useLayoutEffect(() => {
    latest.current = { value, onChange, placeholder, disabled, enableImageUpload, imageUploadUrl, getToken };
  });

  const writeValue = useCallback((editor: IDomEditor, next: string) => {
    isUpdatingRef.current = true;
    try {
      const focused = editor.isFocused();
      // setHtml restores the previous Slate selection, even when its offset is
      // beyond the new text. Clear it first so a controlled reset cannot throw
      // later in the editor's asynchronous DOM-selection synchronization.
      editor.deselect();
      editor.blur();
      editor.setHtml(bbcodeToHtml(next));
      if (focused) queueMicrotask(() => {
        if (editorRef.current === editor && !editor.isDestroyed) editor.focus(true);
      });
    } finally {
      isUpdatingRef.current = false;
    }
  }, []);

  useEffect(() => {
    const generation = ++generationRef.current;
    const uploads = uploadsRef.current;
    let semantics: MutationObserver | null = null;
    let cancelSelection = () => {};
    const isCurrent = () => generationRef.current === generation;

    const init = async () => {
      const { createEditor, createToolbar, DomEditor } = await import('@wangeditor/editor');
      if (!isCurrent() || !editorContainerRef.current || !toolbarContainerRef.current) return;
      const config = latest.current;
      const editorConfig: Partial<IEditorConfig> = {
        autoFocus: false,
        placeholder: config.placeholder,
        MENU_CONF: {},
        onChange(editor: IDomEditor) {
          if (!isCurrent() || isUpdatingRef.current) return;
          latest.current.onChange(htmlToBBCode(editor.getHtml()));
        },
      };
      if (config.enableImageUpload) {
        editorConfig.MENU_CONF!.uploadImage = {
          async customUpload(file: File, insertFn: (url: string, alt: string, href: string) => void) {
            const owner = editorRef.current;
            if (!owner || !isCurrent() || latest.current.disabled) return;
            const readCredential = latest.current.getToken ?? getTokenFromAuth;
            const token = readCredential();
            const controller = new AbortController();
            uploads.add(controller);
            try {
              const formData = new FormData();
              formData.append('image', file);
              const res = await fetch(latest.current.imageUploadUrl || '/api.php?action=upload_forum_image', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token || ''}` },
                body: formData,
                signal: controller.signal,
              });
              const data = await res.json();
              if (!isCurrent() || controller.signal.aborted || editorRef.current !== owner ||
                readCredential() !== token || latest.current.disabled) return;
              if (res.ok && data.success) {
                const imageUrl = getAssetUrl(data.url);
                insertFn(imageUrl, '', imageUrl);
              } else {
                showToast(data.error || '上传图片失败', 'error');
              }
            } catch (err) {
              if (!isCurrent() || controller.signal.aborted || readCredential() !== token) return;
              console.error('上传图片异常:', err);
              showToast('上传图片失败', 'error');
            } finally {
              uploads.delete(controller);
            }
          },
          maxFileSize: 5 * 1024 * 1024,
        };
      }
      const editor = createEditor({ selector: editorContainerRef.current, config: editorConfig, mode: 'simple' });
      editorRef.current = editor;
      // WangEditor 5 removes its selectionchange listener on destroy but does
      // not cancel lodash.throttle's trailing invocation. That callback reads
      // a WeakMap entry which destroy has deleted and throws after unmount.
      const textarea = DomEditor.getTextarea(editor) as unknown as {
        onDOMSelectionChange?: { cancel?: () => void };
      };
      cancelSelection = () => textarea.onDOMSelectionChange?.cancel?.();
      toolbarRef.current = createToolbar({
        editor,
        selector: toolbarContainerRef.current,
        config: { excludeKeys: [
          'headerSelect', 'blockquote', 'group-more-style', 'insertVideo',
          'insertTable', 'codeBlock', 'todo', 'fullScreen',
        ] },
        mode: 'simple',
      });
      writeValue(editor, latest.current.value);
      if (latest.current.disabled) editor.disable();

      // WangEditor uses a non-ARIA role and CSS-only tooltip labels. Bridge its
      // real DOM, including controls added when a toolbar group opens.
      const menuLabels: Record<string, string> = {
        'group-image': '插入图片',
        bold: '加粗',
        italic: '斜体',
        underline: '下划线',
        through: '删除线',
        color: '文字颜色',
        bgColor: '背景颜色',
        bulletedList: '无序列表',
        numberedList: '有序列表',
        justifyLeft: '左对齐',
        justifyCenter: '居中对齐',
        justifyRight: '右对齐',
        insertLink: '插入链接',
        undo: '撤销',
        redo: '重做',
      };
      const nameControls = () => {
        const editable = editorContainerRef.current?.querySelector<HTMLElement>('[data-slate-editor]');
        if (editable) {
          editable.setAttribute('role', 'textbox');
          editable.setAttribute('aria-multiline', 'true');
          editable.setAttribute('aria-label', latest.current.placeholder);
        }
        toolbarContainerRef.current?.querySelectorAll<HTMLButtonElement>('button[data-tooltip]').forEach((button) => {
          const label = button.dataset.tooltip?.trim();
          if (label) button.setAttribute('aria-label', label);
        });
        toolbarContainerRef.current?.querySelectorAll<HTMLButtonElement>('button[data-menu-key]').forEach((button) => {
          if (button.getAttribute('aria-label')) return;
          const key = button.dataset.menuKey ?? '';
          const label = menuLabels[key] ?? button.textContent?.trim();
          // A generic name is preferable to an unnamed toolbar command if a
          // future WangEditor plugin introduces a new key before its wording is
          // added above; the key itself is an implementation detail.
          button.setAttribute('aria-label', label || '编辑器工具栏操作');
        });
      };
      nameControls();
      semantics = new MutationObserver(nameControls);
      semantics.observe(toolbarContainerRef.current, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-tooltip'] });
    };
    void init().catch((err) => {
      if (isCurrent()) console.error('编辑器初始化异常:', err);
    });

    return () => {
      generationRef.current += 1;
      semantics?.disconnect();
      for (const controller of uploads) controller.abort();
      uploads.clear();
      // Capture these instances now. A deferred teardown must never destroy the
      // new editor installed by a remount/StrictMode replay in the meantime.
      const editor = editorRef.current;
      const toolbar = toolbarRef.current;
      editorRef.current = null;
      toolbarRef.current = null;
      const destroy = () => {
        cancelSelection();
        try { toolbar?.destroy(); } catch (err) { console.error('销毁工具栏失败:', err); }
        try { editor?.destroy(); } catch (err) { console.error('销毁编辑器失败:', err); }
      };
      if (isImageHeroTransitionRunning()) void waitForImageHeroTransition().then(destroy, destroy);
      else queueMicrotask(destroy);
    };
  }, [getTokenFromAuth, writeValue]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || isUpdatingRef.current) return;
    // A controlled reset to '' is still a value. Compare the serialized value
    // rather than normalized HTML so ordinary typing keeps its selection.
    try {
      if (htmlToBBCode(editor.getHtml()) !== value) writeValue(editor, value);
    } catch (err) { console.error('更新编辑器内容失败:', err); }
  }, [value, writeValue]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (disabled) editor.disable();
    else editor.enable();
    editorContainerRef.current?.querySelector('[data-slate-editor]')?.setAttribute('aria-label', placeholder);
  }, [disabled, placeholder]);

  return (
    /* outline, not outline-variant: this is the boundary of a control you
       type into — the same object as a text field's border, which the app's
       rule gives outline while outline-variant is for dividers. (The w-e
       custom properties below keep outline-variant where they genuinely
       are dividers.)

       **One focus indicator, and 4dp not 8**: the outline thickening to
       primary *is* the indicator — no ring beside it (two nested boxes is the
       defect CodeInput records removing) — and the corner is the text field's
       4dp step, not the chip's 8dp. */
    <div className="w-full overflow-hidden rounded-xs border border-outline transition-ui focus-within:border-2 focus-within:border-primary-ink">
      <style>{`
        /* wangEditor is themed entirely through its own w-e custom properties.
           Pointing them at the design tokens means the editor follows the
           scheme on its own, and neither branch can drift. */
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
          /* A selection border and four drag handles: marks on the composer's surface with
             nothing sitting inside them, so they take the ink rather than the fill — the
             same call the focus outline twenty lines above makes. On a palette whose brand
             sits above tone 61 the fill would put the handles at 1.5–2.4:1 against the
             container behind them. */
          --w-e-textarea-selected-border-color: var(--md-sys-color-primary-ink);
          --w-e-textarea-handler-bg-color: var(--md-sys-color-primary-ink);
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
           Rebuilt here as a row of M3 icon buttons: 40dp round targets, a
           state-layer hover, secondary-container for the active state, and the
           row wraps instead of overflowing (a horizontal scroller here would
           compete with pull-to-dismiss, which force-writes touch-action on the
           surrounding scroller).
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
            background-color var(--transition-duration-standard) var(--ease-standard),
            color var(--transition-duration-standard) var(--ease-standard);
        }

        /* The three state weights read the tokens rather than repeating numbers.
           The old hand-typed weights had no focus weight at all — the one state
           a keyboard user actually needs to see. */
        .w-e-bar-item button:hover {
          background-color: color-mix(
            in oklab,
            var(--md-sys-color-on-surface) calc(var(--md-sys-state-hover-opacity) * 100%),
            transparent
          );
          color: var(--md-sys-color-on-surface);
        }

        /* Focus gets the state layer *and* the app's own ring — a ring sits
           outside the target, unlike the inset outline this used to draw.
           No backticks anywhere in this block: it lives inside a template
           literal, and one would end the string. */
        .w-e-bar-item button:focus-visible {
          background-color: color-mix(
            in oklab,
            var(--md-sys-color-on-surface) calc(var(--md-sys-state-focus-opacity) * 100%),
            transparent
          );
          outline: none;
          box-shadow: 0 0 0 2px var(--md-sys-color-focus);
        }

        .w-e-bar-item button:active {
          background-color: color-mix(
            in oklab,
            var(--md-sys-color-on-surface) calc(var(--md-sys-state-pressed-opacity) * 100%),
            transparent
          );
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

