'use client';

import React, { useEffect, useLayoutEffect, useRef, useCallback, useState } from 'react';
import { htmlToBBCode, bbcodeToHtml } from '@/lib/bbcode';
import { readToken } from '@/lib/hooks';
import { showToast } from '@/components/Toast';
import { clamp, getAssetUrl } from '@/lib/utils';
import { ICON } from '@/lib/icons';
import { useTooltip } from '@/components/Tooltip';
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

interface EditorHint {
  target: HTMLButtonElement;
  label?: string;
}

function EditorControlTooltip({ target, label }: EditorHint) {
  return useTooltip(label, target).tooltip;
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
  const shellRef = useRef<HTMLDivElement>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const toolbarContainerRef = useRef<HTMLDivElement>(null);
  const isUpdatingRef = useRef(false);
  const generationRef = useRef(0);
  const uploadsRef = useRef(new Set<AbortController>());
  const [hints, setHints] = useState<EditorHint[]>([]);
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
    let resize: ResizeObserver | null = null;
    let placementFrame = 0;
    let cancelSelection = () => {};
    const isCurrent = () => generationRef.current === generation;

    const init = async () => {
      const { createEditor, createToolbar, DomEditor } = await import('@wangeditor/editor');
      if (!isCurrent() || !editorContainerRef.current || !toolbarContainerRef.current || !shellRef.current) return;
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
            const readCredential = latest.current.getToken ?? readToken;
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
        shellRef.current?.querySelectorAll<HTMLButtonElement>('button[data-tooltip]').forEach((button) => {
          const label = button.dataset.tooltip?.trim();
          if (label) button.setAttribute('aria-label', label);
        });
        shellRef.current?.querySelectorAll<HTMLButtonElement>('button[data-menu-key]').forEach((button) => {
          if (button.getAttribute('aria-label')) return;
          const key = button.dataset.menuKey ?? '';
          const label = menuLabels[key] ?? button.textContent?.trim();
          // A generic name is preferable to an unnamed toolbar command if a
          // future WangEditor plugin introduces a new key before its wording is
          // added above; the key itself is an implementation detail.
          button.setAttribute('aria-label', label || '编辑器工具栏操作');
        });
        const nextHints = Array.from(shellRef.current?.querySelectorAll<HTMLButtonElement>('button[data-menu-key]') ?? [])
          .map((target) => ({
            target,
            label: target.matches(':disabled, [aria-disabled="true"], .disabled')
              ? undefined : target.getAttribute('aria-label') ?? undefined,
          }));
        setHints((previous) => previous.length === nextHints.length && nextHints.every((hint, index) =>
          hint.target === previous[index].target && hint.label === previous[index].label,
        ) ? previous : nextHints);
      };

      // The package clamps to the browser, while this editor lives in a narrower
      // clipped column. Keep its native panels inside that column and its focus
      // boundary, including when the editor is inside an application dialog.
      const placePanels = () => {
        if (placementFrame) return;
        placementFrame = requestAnimationFrame(() => {
          placementFrame = 0;
          const shell = shellRef.current;
          if (!isCurrent() || !shell) return;
          const panels = Array.from(shell.querySelectorAll<HTMLElement>('.w-e-drop-panel, .w-e-select-list, .w-e-modal'));
          const maxWidth = `${Math.max(0, shell.clientWidth - 16)}px`;
          for (const panel of panels) {
            if (panel.style.maxWidth !== maxWidth) panel.style.maxWidth = maxWidth;
          }
          const bounds = shell.getBoundingClientRect();
          const left = bounds.left + shell.clientLeft + 8;
          const right = left + shell.clientWidth - 16;
          const offsets = panels.filter((panel) => panel.getClientRects().length).map((panel) => {
            const rect = panel.getBoundingClientRect();
            const previous = parseFloat(panel.style.translate) || 0;
            const originalLeft = rect.left - previous;
            return { panel, offset: clamp(originalLeft, left, right - rect.width) - originalLeft };
          });
          for (const { panel, offset } of offsets) {
            if (Math.abs((parseFloat(panel.style.translate) || 0) - offset) > 0.5) {
              panel.style.translate = `${offset}px`;
            }
          }
        });
      };
      nameControls();
      semantics = new MutationObserver(() => { nameControls(); placePanels(); });
      semantics.observe(shellRef.current, {
        childList: true, subtree: true, attributes: true,
        attributeFilter: ['data-tooltip', 'class', 'disabled', 'aria-disabled', 'style'],
      });
      resize = new ResizeObserver(placePanels);
      resize.observe(shellRef.current);
    };
    void init().catch((err) => {
      if (isCurrent()) console.error('编辑器初始化异常:', err);
    });

    return () => {
      generationRef.current += 1;
      semantics?.disconnect();
      resize?.disconnect();
      if (placementFrame) cancelAnimationFrame(placementFrame);
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
  }, [writeValue]);

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
    <div ref={shellRef} className="rich-text-editor w-full min-w-0 overflow-hidden rounded-xs border border-outline">
      <style>{`
        /* Paint the focused 2dp boundary inward. Changing the actual border
           moved every toolbar target by 1px and rewrapped a nearly full row. */
        .rich-text-editor {
          outline: 2px solid transparent;
          outline-offset: -2px;
          transition:
            border-color var(--duration-spring-fast-effects) var(--ease-spring-effects),
            outline-color var(--duration-spring-fast-effects) var(--ease-spring-effects);
        }

        .rich-text-editor:focus-within {
          border-color: var(--md-sys-color-primary-ink);
          outline-color: var(--md-sys-color-primary-ink);
        }

        /* wangEditor is themed entirely through its own w-e custom properties.
           Pointing them at the design tokens means the editor follows the
           scheme on its own, and neither branch can drift. */
        .w-e-bar,
        .w-e-text-container,
        .w-e-modal,
        .w-e-select-list,
        .w-e-drop-panel,
        .w-e-bar-item-group .w-e-bar-item-menus-container {
          --w-e-textarea-bg-color: var(--md-sys-color-surface);
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
          --w-e-toolbar-bg-color: var(--md-sys-color-surface-container-highest);
          --w-e-toolbar-active-color: var(--md-sys-color-on-surface);
          --w-e-toolbar-active-bg-color: var(--md-sys-color-surface-container-high);
          --w-e-toolbar-disabled-color: color-mix(in srgb, var(--md-sys-color-on-surface) 38%, transparent);
          --w-e-toolbar-border-color: var(--md-sys-color-outline-variant);
          --w-e-modal-button-bg-color: var(--md-sys-color-surface-container-high);
          --w-e-modal-button-border-color: var(--md-sys-color-outline);
        }

        .w-e-text-container [data-slate-editor] pre > code {
          background-color: var(--md-sys-color-surface-container-high);
          border-color: var(--md-sys-color-outline-variant);
          text-shadow: none;
        }

        .w-e-text-container [data-slate-editor] table th {
          background-color: var(--md-sys-color-surface-container);
        }

        .w-e-text-container [data-slate-editor] table td,
        .w-e-text-container [data-slate-editor] table th {
          border-color: var(--md-sys-color-outline-variant);
        }

        .w-e-panel-content-color {
          max-width: 100%;
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
          border-radius: 0 0 calc(var(--radius-xs) - 1px) calc(var(--radius-xs) - 1px);
        }
        .w-e-text-container [data-slate-editor] {
          min-height: 300px;
          padding: 0.75rem 1rem;
          font-size: var(--text-body-l);
          line-height: var(--text-body-l--line-height);
          letter-spacing: var(--text-body-l--letter-spacing);
        }

        .w-e-text-container [data-slate-editor] p {
          margin-block: 0.75em;
        }

        /* The package gives these descendants a separate 1.5 line-height,
           overriding the editor's body token unless inheritance is explicit. */
        .w-e-text-container [data-slate-editor] :is(p, li, blockquote, td, th) {
          line-height: inherit;
        }

        .w-e-text-container [data-slate-editor] :is(h1, h2, h3, h4, h5, h6) {
          margin-block: 1.25em 0.5em;
        }

        .w-e-text-container [data-slate-editor] > :first-child {
          margin-top: 0;
        }

        .w-e-text-container [data-slate-editor] > :last-child {
          margin-bottom: 0;
        }

        .w-e-text-placeholder {
          top: 0.75rem;
          left: 1rem;
          font-size: var(--text-body-l);
          line-height: var(--text-body-l--line-height);
          font-style: normal;
        }

        .w-e-bar {
          border-radius: calc(var(--radius-xs) - 1px) calc(var(--radius-xs) - 1px) 0 0;
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
          font-weight: var(--text-label-l--font-weight);
          line-height: var(--text-label-l--line-height);
          letter-spacing: var(--text-label-l--letter-spacing);
        }

        .w-e-bar-show {
          flex-wrap: wrap;
          gap: 2px;
        }

        .w-e-bar svg {
          height: ${ICON.control}px;
          width: ${ICON.control}px;
          flex-shrink: 0;
        }

        .w-e-bar-item {
          height: auto;
          padding: 0;
        }

        /* The shared Tooltip handles timing, keyboard focus, dismissal and
           viewport clamping; suppress the package's 600ms pseudo-tooltip. */
        .rich-text-editor .w-e-menu-tooltip-v5::before,
        .rich-text-editor .w-e-menu-tooltip-v5::after {
          display: none;
        }

        .w-e-bar-item button {
          height: max(40px, var(--touch-floor));
          min-width: max(40px, var(--touch-floor));
          padding: 0 8px;
          border-radius: 9999px;
          transition:
            background-color var(--duration-spring-fast-effects) var(--ease-spring-effects),
            color var(--duration-spring-fast-effects) var(--ease-spring-effects),
            border-radius var(--duration-spring-fast-spatial) var(--ease-spring-standard-spatial);
        }

        /* The three state weights read the tokens rather than repeating numbers.
           The old hand-typed weights had no focus weight at all — the one state
           a keyboard user actually needs to see. */
        @media (hover: hover) {
          .w-e-bar-item button:hover:not(.disabled):not(:disabled) {
            background-color: color-mix(
              in oklab,
              var(--md-sys-color-on-surface) calc(var(--md-sys-state-hover-opacity) * 100%),
              transparent
            );
            color: var(--md-sys-color-on-surface);
          }
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

        .w-e-bar-item button:active:not(.disabled):not(:disabled) {
          background-color: color-mix(
            in oklab,
            var(--md-sys-color-on-surface) calc(var(--md-sys-state-pressed-opacity) * 100%),
            transparent
          );
        }

        /* Selected state — the M3 pairing, not a grey wash. */
        .w-e-bar-item .active,
        .w-e-bar-item button.active:hover:not(.disabled):not(:disabled) {
          background-color: var(--md-sys-color-secondary-container);
          color: var(--md-sys-color-on-secondary-container);
          border-radius: var(--radius-md);
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

        /* These are third-party DOM panels; adapt them once to Popover's
           material instead of leaving the package's 3px corners and shadow. */
        .w-e-select-list,
        .w-e-drop-panel,
        .w-e-modal,
        .w-e-hover-bar,
        .w-e-bar-item-group .w-e-bar-item-menus-container {
          --w-e-toolbar-bg-color: var(--md-sys-color-surface-container);
          border-radius: var(--radius-lg);
          border: 0;
          box-shadow: var(--md-sys-elevation-2);
        }

        .w-e-bar-item-group .w-e-bar-item-menus-container,
        .w-e-select-list,
        .w-e-drop-panel {
          margin-top: calc(max(40px, var(--touch-floor)) + 8px);
          padding: 8px;
        }
      `}</style>
      <div ref={toolbarContainerRef} className="border-b border-outline-variant" />
      <div ref={editorContainerRef} />
      {hints.map((hint, index) => <EditorControlTooltip key={index} {...hint} />)}
    </div>
  );
}

