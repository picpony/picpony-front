'use client';

import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type Ref } from 'react';
import { htmlToBBCode, bbcodeToHtml } from '@/lib/bbcode';
import { readToken } from '@/lib/hooks';
import { showToast } from '@/components/Toast';
import { clamp, cn, getAssetUrl } from '@/lib/utils';
import { ICON } from '@/lib/icons';
import { useTooltip } from '@/components/Tooltip';
import { isImageHeroTransitionRunning, waitForImageHeroTransition } from '@/lib/hero/runtime';
import { uploadForumPicture } from '@/lib/forumImages';
import {
  EDITOR_MIN_HEIGHT,
  type RichTextEditorHandle,
  type RichTextEditorSize,
} from '@/components/RichTextEditorShell';
import '@wangeditor/editor/dist/css/style.css';

import type { IDomEditor, Toolbar, IEditorConfig } from '@wangeditor/editor';

export type { RichTextEditorHandle, RichTextEditorSize };

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  enableImageUpload?: boolean;
  getToken?: () => string | null;
  /** The editing area's accessible name. Defaults to the placeholder, which is not a name. */
  label?: string;
  /** The editing area's height — see `RichTextEditorSize`. */
  size?: RichTextEditorSize;
  /** The field is in error: the boundary takes the error role, as an outlined field's does. */
  invalid?: boolean;
  /** The id of the line that describes the field — its error, usually. */
  describedBy?: string;
  handleRef?: Ref<RichTextEditorHandle>;
  /** Each uploaded picture's stored path — what a post lists in `draft_images`. */
  onUploaded?: (path: string) => void;
  /** Whether a picture is uploading, for a caller that must not submit half a message. */
  onUploadingChange?: (uploading: boolean) => void;
}

interface EditorHint {
  target: HTMLButtonElement;
  label?: string;
}

function EditorControlTooltip({ target, label }: EditorHint) {
  return useTooltip(label, target).tooltip;
}

/* ---------------------------------------------------------------------------
 * The toolbar
 * ------------------------------------------------------------------------- */

/**
 * Every tool, in reading order, `|` between groups. Everything here survives publishing: each
 * tool's output has a BBCode form the renderer draws (R6-043) — which is why there is no font
 * size, no indent, no code block, no picture width and no full-width table.
 */
const FULL_TOOLBAR = [
  'bold', 'italic', 'underline', 'through', '|',
  'color', 'bgColor', 'clearStyle', '|',
  'header2', 'header3', '|',
  'bulletedList', 'numberedList', '|',
  'justifyLeft', 'justifyCenter', 'justifyRight', '|',
  'insertLink', 'group-image', 'insertTable', '|',
  'undo', 'redo',
] as const;

/** Which tools stay on the row when it cannot hold them all, most wanted first (R6-044). */
const PRIORITY = [
  'bold', 'group-image', 'insertLink', 'italic', 'bulletedList', 'color', 'through', 'undo',
  'numberedList', 'underline', 'header2', 'insertTable', 'bgColor', 'justifyCenter', 'redo',
  'header3', 'justifyLeft', 'justifyRight', 'clearStyle',
];

/** Upload first, then a picture by its address — one slot for both. The glyph is the package's. */
const IMAGE_GROUP = {
  key: 'group-image',
  title: '插入图片',
  iconSvg:
    '<svg viewBox="0 0 1024 1024"><path d="M959.877 128l0.123 0.123v767.775l-0.123 0.122H64.102l-0.122-0.122V128.123l0.122-0.123h895.775zM960 64H64C28.795 64 0 92.795 0 128v768c0 35.205 28.795 64 64 64h896c35.205 0 64-28.795 64-64V128c0-35.205-28.795-64-64-64zM832 288.01c0 53.023-42.988 96.01-96.01 96.01s-96.01-42.987-96.01-96.01S682.967 192 735.99 192 832 234.988 832 288.01zM896 832H128V704l224.01-384 256 320h64l224.01-192z"></path></svg>',
  menuKeys: ['uploadImage', 'insertImage'],
};

/** The names every tool is announced and labelled by — the package's own are uneven. */
const MENU_LABELS: Record<string, string> = {
  bold: '加粗',
  italic: '斜体',
  underline: '下划线',
  through: '删除线',
  color: '文字颜色',
  bgColor: '背景颜色',
  clearStyle: '清除格式',
  header2: '标题',
  header3: '小标题',
  bulletedList: '无序列表',
  numberedList: '有序列表',
  justifyLeft: '左对齐',
  justifyCenter: '居中',
  justifyRight: '右对齐',
  insertLink: '插入链接',
  'group-image': '插入图片',
  uploadImage: '上传图片',
  insertImage: '网络图片',
  insertTable: '插入表格',
  undo: '撤销',
  redo: '重做',
  editLink: '修改链接',
  unLink: '取消链接',
  viewLink: '打开链接',
  deleteImage: '删除图片',
  tableHeader: '表头',
  insertTableRow: '插入行',
  deleteTableRow: '删除行',
  insertTableCol: '插入列',
  deleteTableCol: '删除列',
  deleteTable: '删除表格',
  enter: '换行',
};

/* The geometry the plan below assumes, from the stylesheet in this file (and measured): a tool is
   a max(40px, touch floor) square — one that opens a panel carries an arrow and is at least 56px
   wide — 2px apart; a divider is 1px with 4px either side; the bar sits 6px in from its edges;
   the 更多 toggle is one more tool with the bar's 6px after it. */
const TOOL_GAP = 2;
const DIVIDER = 9;
const BAR_PADDING = 12;
const PANEL_TOOL_MIN = 56;
const PANEL_TOOLS: ReadonlySet<string> = new Set(['color', 'bgColor', 'group-image', 'insertTable']);

interface ToolbarPlan {
  keys: readonly string[];
  /** Whether the row holds less than every tool, so 更多 is offered. */
  overflow: boolean;
}

const widthOf = (key: string, tool: number) => (PANEL_TOOLS.has(key) ? Math.max(tool, PANEL_TOOL_MIN) : tool);

/** The width a run of tools takes on one row, its gaps and dividers included. */
function runWidth(keys: readonly string[], tool: number): number {
  let width = 0;
  let items = 0;
  for (const key of keys) {
    if (key === '|') width += DIVIDER;
    else {
      width += widthOf(key, tool);
      items += 1;
    }
  }
  return width + Math.max(0, items - 1) * TOOL_GAP;
}

/**
 * The tools for a row `width` wide. Everything, with its dividers, when it fits; else everything
 * without them; else — collapsed — the most wanted that fit beside the 更多 toggle, in reading
 * order, and — expanded — everything, wrapping onto as many rows as it takes. One row either way
 * until the writer asks for more: the toolbar wrapped to five rows above the text on a phone.
 */
function planToolbar(width: number, tool: number, expanded: boolean): ToolbarPlan {
  const buttons = FULL_TOOLBAR.filter((key) => key !== '|');
  const inner = width - BAR_PADDING;
  if (runWidth(FULL_TOOLBAR, tool) <= inner) return { keys: FULL_TOOLBAR, overflow: false };
  if (runWidth(buttons, tool) <= inner) return { keys: buttons, overflow: false };
  if (expanded) return { keys: FULL_TOOLBAR, overflow: true };
  const room = inner - (tool + BAR_PADDING / 2 + TOOL_GAP);
  const chosen = new Set<string>();
  for (const key of PRIORITY) {
    const next = [...chosen, key];
    if (chosen.size > 0 && runWidth(next, tool) > room) break;
    chosen.add(key);
  }
  return { keys: buttons.filter((key) => chosen.has(key)), overflow: true };
}

function toolbarKeysOf(keys: readonly string[]) {
  return keys.map((key) => (key === 'group-image' ? IMAGE_GROUP : key));
}

/** The tool size in px: 40dp, or the touch floor under a finger. */
function toolSize(shell: HTMLElement): number {
  const floor = parseFloat(getComputedStyle(shell).getPropertyValue('--touch-floor'));
  return Math.max(40, Number.isFinite(floor) ? floor : 0);
}

/* ---------------------------------------------------------------------------
 * The editor
 * ------------------------------------------------------------------------- */

/* Module scope, both: the React Compiler lowers neither an `import()` nor a `try` without a
   `catch` inside a component, and one it cannot lower leaves the whole component unoptimised. */
const loadEditorPackage = () => import('@wangeditor/editor');

/**
 * Creates the editor without the package's one warning about a short editing area: it checks
 * the height a microtask after creation and warns under 300px, about the placement of its
 * panels — which `placePanels` below does itself. A reply box is shorter on purpose. Only that
 * message is dropped, and only until the next task.
 */
let unfilteredWarn: typeof console.warn | null = null;

function quietly<T>(create: () => T): T {
  if (!unfilteredWarn) {
    const warn = console.warn;
    unfilteredWarn = warn;
    console.warn = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes('Textarea height < 300px')) return;
      warn.apply(console, args);
    };
    setTimeout(() => {
      console.warn = warn;
      unfilteredWarn = null;
    }, 0);
  }
  return create();
}

/** Runs a step of the package's that may throw, logging rather than breaking the screen. */
function safely(label: string, run: () => void) {
  try {
    run();
  } catch (err) {
    console.error(label, err);
  }
}

/** Replaces the editor's content with `next`, flagged so its change handler knows it was us. */
function writeEditorValue(
  editor: IDomEditor,
  next: string,
  updating: { current: boolean },
  current: () => IDomEditor | null,
) {
  updating.current = true;
  try {
    const focused = editor.isFocused();
    // setHtml restores the previous Slate selection, even when its offset is
    // beyond the new text. Clear it first so a controlled reset cannot throw
    // later in the editor's asynchronous DOM-selection synchronization.
    editor.deselect();
    editor.blur();
    editor.setHtml(bbcodeToHtml(next));
    if (focused) queueMicrotask(() => {
      if (current() === editor && !editor.isDestroyed) editor.focus(true);
    });
  } finally {
    updating.current = false;
  }
}

/**
 * The one rich-text editor — WangEditor 5 in its simple mode, writing BBCode (`htmlToBBCode`) and
 * reading it back (`bbcodeToHtml`).
 *
 * Pictures upload through `uploadForumPicture` — checked, shrunk past 5MB as the original front
 * end did, reported to the caller (`onUploaded`, `onUploadingChange`) — and paste goes the same
 * way. Headings, alignment, colours, highlights, lists, links and tables all have a BBCode form, so
 * what the toolbar makes is what the post shows.
 */
export default function RichTextEditor({
  value,
  onChange,
  placeholder = '请输入内容…',
  disabled = false,
  enableImageUpload = true,
  getToken,
  label,
  size,
  invalid = false,
  describedBy,
  handleRef,
  onUploaded,
  onUploadingChange,
}: RichTextEditorProps) {
  const editorRef = useRef<IDomEditor | null>(null);
  const toolbarRef = useRef<Toolbar | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const toolbarContainerRef = useRef<HTMLDivElement>(null);
  const isUpdatingRef = useRef(false);
  const generationRef = useRef(0);
  const uploadsRef = useRef(new Set<AbortController>());
  const pendingFocusRef = useRef(false);
  /* Rebuilds the toolbar for a plan — installed by the init effect, which owns the package. */
  const rebuildRef = useRef<((plan: ToolbarPlan) => void) | null>(null);
  const planRef = useRef<ToolbarPlan | null>(null);
  const [hints, setHints] = useState<EditorHint[]>([]);
  const [overflow, setOverflow] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const expandedRef = useRef(expanded);
  const latest = useRef({
    value, onChange, placeholder, label, disabled, enableImageUpload, getToken, invalid, describedBy, onUploaded, onUploadingChange,
  });

  useLayoutEffect(() => {
    latest.current = {
      value, onChange, placeholder, label, disabled, enableImageUpload, getToken, invalid, describedBy, onUploaded, onUploadingChange,
    };
    expandedRef.current = expanded;
  });

  useImperativeHandle(handleRef, () => ({
    focus() {
      const editor = editorRef.current;
      if (!editor || editor.isDestroyed) {
        pendingFocusRef.current = true;
        return;
      }
      editor.focus(true);
    },
  }), []);

  const writeValue = useCallback(
    (editor: IDomEditor, next: string) => writeEditorValue(editor, next, isUpdatingRef, () => editorRef.current),
    [],
  );

  useEffect(() => {
    const generation = ++generationRef.current;
    const uploads = uploadsRef.current;
    let semantics: MutationObserver | null = null;
    let resize: ResizeObserver | null = null;
    let placementFrame = 0;
    let uploading = 0;
    let cancelSelection = () => {};
    const isCurrent = () => generationRef.current === generation;
    const reportUploading = (delta: number) => {
      const before = uploading > 0;
      uploading = Math.max(0, uploading + delta);
      if (before !== uploading > 0) latest.current.onUploadingChange?.(uploading > 0);
    };

    const init = async () => {
      const { createEditor, createToolbar, DomEditor } = await loadEditorPackage();
      if (!isCurrent() || !editorContainerRef.current || !toolbarContainerRef.current || !shellRef.current) return;
      const config = latest.current;
      const editorConfig: Partial<IEditorConfig> = {
        autoFocus: false,
        placeholder: config.placeholder,
        /* Only what survives publishing: no picture widths (BBCode has none), no full-width
           table. */
        hoverbarKeys: {
          link: { menuKeys: ['editLink', 'unLink', 'viewLink'] },
          image: { menuKeys: ['deleteImage'] },
          table: {
            menuKeys: ['enter', 'tableHeader', 'insertTableRow', 'deleteTableRow', 'insertTableCol', 'deleteTableCol', 'deleteTable'],
          },
        },
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
            if (!token) {
              showToast('登录后才能上传图片', 'error');
              return;
            }
            const controller = new AbortController();
            uploads.add(controller);
            reportUploading(1);
            const outcome = await uploadForumPicture(token, file, { signal: controller.signal });
            uploads.delete(controller);
            if (isCurrent()) reportUploading(-1);
            if (!isCurrent() || controller.signal.aborted || editorRef.current !== owner ||
              readCredential() !== token || latest.current.disabled) return;
            if (!outcome.ok) {
              if (!outcome.aborted) showToast(outcome.message, 'error');
              return;
            }
            insertFn(getAssetUrl(outcome.path), '', '');
            latest.current.onUploaded?.(outcome.path);
          },
          /* The package's own size check would stop a large photo before it could be shrunk;
             `prepareForumImage` owns the limits and says them in words. */
          maxFileSize: 50 * 1024 * 1024,
          allowedFileTypes: ['image/*'],
        };
      }
      const editor = quietly(() => createEditor({ selector: editorContainerRef.current!, config: editorConfig, mode: 'simple' }));
      editorRef.current = editor;
      // WangEditor 5 removes its selectionchange listener on destroy but does
      // not cancel lodash.throttle's trailing invocation. That callback reads
      // a WeakMap entry which destroy has deleted and throws after unmount.
      const textarea = DomEditor.getTextarea(editor) as unknown as {
        onDOMSelectionChange?: { cancel?: () => void };
      };
      cancelSelection = () => textarea.onDOMSelectionChange?.cancel?.();

      const buildToolbar = (plan: ToolbarPlan) => {
        if (!isCurrent() || !toolbarContainerRef.current || editor.isDestroyed) return;
        const previous = toolbarRef.current;
        if (previous && planRef.current && planRef.current.keys.join() === plan.keys.join()) {
          planRef.current = plan;
          return;
        }
        if (previous) {
          safely('销毁工具栏失败:', () => previous.destroy());
          /* The package marks the container as holding a toolbar and clears the mark only
             when the *editor* is destroyed, so a second toolbar in it would be refused. */
          toolbarContainerRef.current.removeAttribute('data-w-e-toolbar');
        }
        planRef.current = plan;
        toolbarRef.current = createToolbar({
          editor,
          selector: toolbarContainerRef.current,
          config: { toolbarKeys: toolbarKeysOf(plan.keys) },
          mode: 'simple',
        });
      };
      rebuildRef.current = (plan) => {
        buildToolbar(plan);
        setOverflow(plan.overflow);
      };
      const measure = () => {
        const row = rowRef.current;
        const shell = shellRef.current;
        if (!row || !shell) return null;
        return planToolbar(row.clientWidth, toolSize(shell), expandedRef.current);
      };
      const first = measure() ?? { keys: FULL_TOOLBAR, overflow: false };
      buildToolbar(first);
      setOverflow(first.overflow);
      writeValue(editor, latest.current.value);
      if (latest.current.disabled) editor.disable();
      if (pendingFocusRef.current) {
        pendingFocusRef.current = false;
        editor.focus(true);
      }

      // WangEditor uses a non-ARIA role and CSS-only tooltip labels. Bridge its
      // real DOM, including controls added when a toolbar group opens.
      const nameControls = () => {
        const editable = editorContainerRef.current?.querySelector<HTMLElement>('[data-slate-editor]');
        if (editable) {
          const { label: name, placeholder: hint, invalid: bad, describedBy: described } = latest.current;
          editable.setAttribute('role', 'textbox');
          editable.setAttribute('aria-multiline', 'true');
          if (editable.getAttribute('aria-label') !== (name || hint)) editable.setAttribute('aria-label', name || hint);
          if (bad) editable.setAttribute('aria-invalid', 'true');
          else editable.removeAttribute('aria-invalid');
          if (described) editable.setAttribute('aria-describedby', described);
          else editable.removeAttribute('aria-describedby');
        }
        shellRef.current?.querySelectorAll<HTMLButtonElement>('button[data-menu-key]').forEach((button) => {
          const key = button.dataset.menuKey ?? '';
          const label = MENU_LABELS[key] ?? button.getAttribute('aria-label') ?? button.dataset.tooltip?.trim() ?? button.textContent?.trim();
          // A generic name is preferable to an unnamed toolbar command if a
          // future WangEditor plugin introduces a new key before its wording is
          // added above; the key itself is an implementation detail.
          const name = label || '编辑器工具栏操作';
          if (button.getAttribute('aria-label') !== name) button.setAttribute('aria-label', name);
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
      /* A width change re-plans the row (a phone turned, a sidebar opened); nothing is rebuilt
         unless the tools that fit have changed. */
      resize = new ResizeObserver(() => {
        placePanels();
        const plan = measure();
        if (plan) rebuildRef.current?.(plan);
      });
      resize.observe(shellRef.current);
    };
    void init().catch((err) => {
      if (isCurrent()) console.error('编辑器初始化异常:', err);
    });

    return () => {
      generationRef.current += 1;
      rebuildRef.current = null;
      planRef.current = null;
      semantics?.disconnect();
      resize?.disconnect();
      if (placementFrame) cancelAnimationFrame(placementFrame);
      for (const controller of uploads) controller.abort();
      uploads.clear();
      if (uploading > 0) latest.current.onUploadingChange?.(false);
      // Capture these instances now. A deferred teardown must never destroy the
      // new editor installed by a remount/StrictMode replay in the meantime.
      const editor = editorRef.current;
      const toolbar = toolbarRef.current;
      editorRef.current = null;
      toolbarRef.current = null;
      const destroy = () => {
        cancelSelection();
        safely('销毁工具栏失败:', () => toolbar?.destroy());
        safely('销毁编辑器失败:', () => editor?.destroy());
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
    safely('更新编辑器内容失败:', () => {
      if (htmlToBBCode(editor.getHtml()) !== value) writeValue(editor, value);
    });
  }, [value, writeValue]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (disabled) editor.disable();
    else editor.enable();
  }, [disabled]);

  /* The editable's name, validity and description follow their props. */
  useEffect(() => {
    const editable = editorContainerRef.current?.querySelector<HTMLElement>('[data-slate-editor]');
    if (!editable) return;
    editable.setAttribute('aria-label', label || placeholder);
    if (invalid) editable.setAttribute('aria-invalid', 'true');
    else editable.removeAttribute('aria-invalid');
    if (describedBy) editable.setAttribute('aria-describedby', describedBy);
    else editable.removeAttribute('aria-describedby');
  }, [label, placeholder, invalid, describedBy]);

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    expandedRef.current = next;
    const row = rowRef.current;
    const shell = shellRef.current;
    if (row && shell) rebuildRef.current?.(planToolbar(row.clientWidth, toolSize(shell), next));
  };

  const [phone, wide] = EDITOR_MIN_HEIGHT[size ?? 'default'];

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
    <div
      ref={shellRef}
      data-invalid={invalid ? '' : undefined}
      className={cn('rich-text-editor w-full min-w-0 overflow-hidden rounded-xs border', invalid ? 'border-error' : 'border-outline')}
      style={{ '--editor-min-phone': `${phone}px`, '--editor-min-wide': `${wide}px` } as CSSProperties}
    >
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

        /* An invalid field keeps its error boundary when focused, as an outlined text field
           does: the thickening is in the error role, not the brand's. */
        .rich-text-editor[data-invalid]:focus-within {
          border-color: var(--md-sys-color-error);
          outline-color: var(--md-sys-color-error);
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

        /* The toolbar row: the package's bar and, when the row cannot hold every tool, the
           更多 toggle after it on the same tone. One row tall before the package mounts. */
        .rich-text-editor [data-toolbar-row] {
          display: flex;
          align-items: flex-start;
          min-height: calc(max(40px, var(--touch-floor)) + 12px);
          background-color: var(--md-sys-color-surface-container-highest);
          border-bottom: 1px solid var(--md-sys-color-outline-variant);
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

        /* The editing area's height is the caller's size (see EDITOR_MIN_HEIGHT): shorter on a
           phone, where the toolbar and the keyboard share the rest of the screen. It grows
           with the text. The host holds the same height before the package mounts. */
        .rich-text-editor [data-editor-host],
        .w-e-text-container,
        .w-e-text-container [data-slate-editor] {
          min-height: var(--editor-min-phone);
        }

        @media (min-width: 640px) {
          .rich-text-editor [data-editor-host],
          .w-e-text-container,
          .w-e-text-container [data-slate-editor] {
            min-height: var(--editor-min-wide);
          }
        }

        .w-e-text-container {
          height: auto !important;
          border-radius: 0 0 calc(var(--radius-xs) - 1px) calc(var(--radius-xs) - 1px);
        }
        .w-e-text-container [data-slate-editor] {
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
           state-layer hover, secondary-container for the active state. The row
           holds only what fits (the plan in this file); the rest waits behind
           the 更多 toggle, whose expanded form wraps.
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

        .w-e-bar svg,
        .rich-text-editor [data-toolbar-toggle] svg {
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

        .w-e-bar-item button,
        .rich-text-editor [data-toolbar-toggle] {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          height: max(40px, var(--touch-floor));
          min-width: max(40px, var(--touch-floor));
          padding: 0 8px;
          border-radius: 9999px;
          color: var(--w-e-toolbar-color, var(--md-sys-color-on-surface-variant));
          fill: currentColor;
          transition:
            background-color var(--duration-spring-fast-effects) var(--ease-spring-effects),
            color var(--duration-spring-fast-effects) var(--ease-spring-effects),
            border-radius var(--duration-spring-fast-spatial) var(--ease-spring-standard-spatial);
        }

        .rich-text-editor [data-toolbar-toggle] {
          flex-shrink: 0;
          margin: 6px 6px 6px 0;
          color: var(--md-sys-color-on-surface-variant);
        }

        /* The three state weights read the tokens rather than repeating numbers.
           The old hand-typed weights had no focus weight at all — the one state
           a keyboard user actually needs to see. */
        @media (hover: hover) {
          .w-e-bar-item button:hover:not(.disabled):not(:disabled),
          .rich-text-editor [data-toolbar-toggle]:hover:not(:disabled) {
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
        .w-e-bar-item button:focus-visible,
        .rich-text-editor [data-toolbar-toggle]:focus-visible {
          background-color: color-mix(
            in oklab,
            var(--md-sys-color-on-surface) calc(var(--md-sys-state-focus-opacity) * 100%),
            transparent
          );
          outline: 2px solid transparent;
          box-shadow: 0 0 0 2px var(--md-sys-color-focus);
        }

        .w-e-bar-item button:active:not(.disabled):not(:disabled),
        .rich-text-editor [data-toolbar-toggle]:active:not(:disabled) {
          background-color: color-mix(
            in oklab,
            var(--md-sys-color-on-surface) calc(var(--md-sys-state-pressed-opacity) * 100%),
            transparent
          );
        }

        .rich-text-editor [data-toolbar-toggle]:disabled {
          opacity: 0.38;
        }

        /* Selected state — the M3 pairing, not a grey wash. The expanded toggle is one too. */
        .w-e-bar-item .active,
        .w-e-bar-item button.active:hover:not(.disabled):not(:disabled),
        .rich-text-editor [data-toolbar-toggle][aria-expanded='true'] {
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

        /* Grouped menus opened on hover only, so on a touch device they could not be opened
           at all. */
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

        @media (forced-colors: active) {
          .rich-text-editor[data-invalid] {
            border-color: Mark;
          }
        }
      `}</style>
      <div ref={rowRef} data-toolbar-row="">
        <div ref={toolbarContainerRef} role="toolbar" aria-label="格式" className="min-w-0 flex-1" />
        {overflow && (
          <button
            type="button"
            data-toolbar-toggle=""
            data-menu-key="more-formats"
            aria-label="更多格式"
            aria-expanded={expanded}
            disabled={disabled}
            onClick={toggleExpanded}
          >
            {/* Three dots, or a chevron to fold the extra rows away. */}
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {expanded ? (
                <path d="M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z" />
              ) : (
                <path d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
              )}
            </svg>
          </button>
        )}
      </div>
      <div ref={editorContainerRef} data-editor-host="" />
      {hints.map((hint, index) => <EditorControlTooltip key={index} {...hint} />)}
    </div>
  );
}
