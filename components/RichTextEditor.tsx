'use client';

import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type Ref } from 'react';
import { htmlToBBCode, bbcodeToHtml } from '@/lib/bbcode';
import { readToken } from '@/lib/hooks';
import { showToast } from '@/components/Toast';
import { cn, getAssetUrl } from '@/lib/utils';
import { mediaPreview, mediaWithoutPreview, previewMediaText, rememberMediaPreview, storedMediaText } from '@/lib/mediaPreview';
import { ICON } from '@/lib/icons';
import { useTooltip } from '@/components/Tooltip';
import RichTextEditorPanels, { type RichTextEditorPanelsHandle, type EditorFormField } from '@/components/RichTextEditorPanels';
import FollowHeight from '@/components/FollowHeight';
import { isImageHeroTransitionRunning, waitForImageHeroTransition } from '@/lib/hero/runtime';
import { uploadForumPicture } from '@/lib/forumImages';
import {
  EDITOR_MIN_HEIGHT,
  EDITOR_FRAME_CLASS_NAME,
  EDITOR_TOOLBAR_CLASS_NAME,
  type RichTextEditorHandle,
  type RichTextEditorSize,
} from '@/components/RichTextEditorShell';
import './RichTextEditor.css';

import type { IDomEditor, Toolbar, IEditorConfig, IDropPanelMenu, IModalMenu } from '@wangeditor/editor';

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
  target: HTMLElement;
  label?: string;
}

function EditorControlTooltip({ target, label }: EditorHint) {
  return useTooltip(label, target).tooltip;
}

const EDITOR_CONTROL_CLASSES = 'state-layer focus-visible:outline-hidden focus-visible:ring-2 focus-ring transition-icon-button select-none touch-manipulation';

/** Avoid no-op attribute mutations: the package's DOM is observed for new controls. */
function addClasses(element: HTMLElement, classes: string) {
  const missing = classes.split(' ').filter((name) => name && !element.classList.contains(name));
  if (missing.length) element.classList.add(...missing);
}

/** Simple mode draws flat list rows; keep Slate's DOM and apply the shared prose rhythm. */
function styleListRows(editable: HTMLElement) {
  const rows = new Set(Array.from(editable.querySelectorAll<HTMLElement>(':scope > div > [data-w-e-reserve]'))
    .map((marker) => marker.parentElement!));
  for (const row of rows) {
    row.setAttribute('data-editor-list', '');
    row.toggleAttribute('data-editor-list-start', !rows.has(row.previousElementSibling as HTMLElement));
    row.toggleAttribute('data-editor-list-end', !rows.has(row.nextElementSibling as HTMLElement));
  }
}

const TOGGLE_TOOLS = new Set([
  'bold', 'italic', 'underline', 'through', 'header2', 'header3',
  'bulletedList', 'numberedList', 'justifyLeft', 'justifyCenter', 'justifyRight', 'tableHeader',
]);

const PANEL_TOOLS_HANDLED = new Set(['color', 'bgColor', 'group-image', 'insertLink', 'editLink', 'insertImage', 'insertTable']);

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

/* Geometry shared with RichTextEditor.css: a tool is
   a max(40px, touch floor) square — one that opens a panel carries an arrow and is at least 60px
   wide — 2px apart; a divider is 1px with 4px either side; the bar sits 6px in from its edges;
   the 更多 toggle is one more tool with the bar's 6px after it. */
const TOOL_GAP = 2;
const DIVIDER = 9;
const BAR_PADDING = 12;
const PANEL_TOOL_MIN = 60;
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
    }
    items += 1;
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
 * panels — the shared editor panels own placement. A reply box is shorter on purpose. Only that
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

/** WangEditor installs Slate history but omits its stacks from IDomEditor's public type. */
function editorHistory(editor: IDomEditor) {
  return (editor as IDomEditor & { history?: { undos: unknown[]; redos: unknown[] } }).history;
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
    /* A staged upload is drawn from its Blob URL preview (`lib/mediaPreview.ts`): the media
       endpoint shows an unpublished picture only to a request carrying the token. */
    editor.setHtml(previewMediaText(bbcodeToHtml(next)));
    const history = editorHistory(editor);
    if (history) {
      history.undos = [];
      history.redos = [];
    }
    if (focused) queueMicrotask(() => {
      if (current() === editor && !editor.isDestroyed) editor.focus(true);
    });
  } finally {
    updating.current = false;
  }
}

/** The editor's content as BBCode, each picture's Blob URL preview back to its stored path. */
function editorValue(editor: IDomEditor): string {
  return htmlToBBCode(storedMediaText(editor.getHtml()));
}

/**
 * Read the previews of the stored pictures `value` names that have none yet (a draft restored, a
 * post being edited), and redraw once they are in — unless the text changed meanwhile or the
 * writer is in it, whose caret a redraw would move; such a picture keeps its path, which shows
 * once it is published.
 */
function warmPreviews(
  editor: IDomEditor,
  value: string,
  token: string | null,
  redraw: () => void,
) {
  const missing = token ? mediaWithoutPreview(value) : [];
  if (!token || missing.length === 0) return;
  void Promise.all(missing.map((path) => mediaPreview(token, path))).then((previews) => {
    if (!previews.some(Boolean) || editor.isDestroyed || editor.isFocused()) return;
    if (editorValue(editor) === value) redraw();
  });
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
  const toolbarId = useId();
  const panelsRef = useRef<RichTextEditorPanelsHandle | null>(null);
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

  const writeValue = useCallback((editor: IDomEditor, next: string) => {
    const current = () => editorRef.current;
    writeEditorValue(editor, next, isUpdatingRef, current);
    warmPreviews(editor, next, (latest.current.getToken ?? readToken)(), () => {
      if (current() === editor) writeEditorValue(editor, next, isUpdatingRef, current);
    });
  }, []);

  useEffect(() => {
    const generation = ++generationRef.current;
    const uploads = uploadsRef.current;
    let semantics: MutationObserver | null = null;
    let resize: ResizeObserver | null = null;
    let stopPanelControls = () => {};
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
        customAlert(info, type) {
          showToast(info, type === 'success' ? 'success' : 'error');
        },
        onChange(editor: IDomEditor) {
          if (!isCurrent() || isUpdatingRef.current) return;
          latest.current.onChange(editorValue(editor));
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
            /* What the editor draws is the picture read back with the token (else the file
               itself); what it writes is the stored path (`editorValue`). */
            const preview = await mediaPreview(token, outcome.path) ?? rememberMediaPreview(outcome.path, file);
            if (!isCurrent() || editorRef.current !== owner || latest.current.disabled) return;
            insertFn(preview ?? getAssetUrl(outcome.path), '', '');
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

      const menuOf = (key: string) => toolbarRef.current?.getMenus()[key] ?? DomEditor.getHoverbar(editor)?.getMenus()[key];
      const canEdit = () => isCurrent() && !editor.isDestroyed && !latest.current.disabled;
      const editorFocusTarget = () => canEdit() ? editor.toDOMNode(editor) : null;
      const returnToEditor = () => {
        if (canEdit()) editor.restoreSelection();
        return editorFocusTarget();
      };
      const restoreAfterPanel = (anchor: HTMLElement) => () => {
        const active = document.activeElement;
        if (canEdit() && (active === document.body || active === anchor || active === editorFocusTarget())) editor.restoreSelection();
      };
      const openTool = (key: string, anchor: HTMLElement) => {
        if (!canEdit()) return;
        if (!editor.selection) editor.focus(true);
        if (key === 'group-image') {
          panelsRef.current?.open({ kind: 'image', key, title: '插入图片', anchor,
            uploadDisabled: !latest.current.enableImageUpload,
            select: (action) => {
              if (!canEdit()) return;
              editor.restoreSelection();
              if (!editor.selection) editor.focus(true);
              if (action === 'insertImage') openTool(action, anchor);
              else {
                const upload = menuOf(action);
                if (upload && !upload.isDisabled(editor)) upload.exec(editor, upload.getValue(editor));
              }
            },
          });
          return;
        }
        const menu = menuOf(key);
        if (!menu || menu.isDisabled(editor)) return;
        if ((key === 'color' || key === 'bgColor') && 'getPanelContentElem' in menu) {
          const native = (menu as IDropPanelMenu).getPanelContentElem(editor);
          const colors = Array.from(native.querySelectorAll<HTMLElement>('li[data-value]'))
            .map((cell) => cell.dataset.value ?? '').filter((value) => value && value !== '0');
          panelsRef.current?.open({ kind: 'color', key, title: MENU_LABELS[key], anchor,
            colors, value: String(menu.getValue(editor) || ''),
            pick: (value) => {
              if (!canEdit()) return;
              editor.restoreSelection();
              if (value) editor.addMark(key, value);
              else editor.removeMark(key);
            },
          });
          return;
        }
        if (key === 'insertTable' && 'getPanelContentElem' in menu) {
          const native = (menu as IDropPanelMenu).getPanelContentElem(editor);
          const cells = Array.from(native.querySelectorAll<HTMLElement>('td[data-x][data-y]'));
          const columns = Math.max(...cells.map((cell) => Number(cell.dataset.x))) + 1;
          const rows = Math.max(...cells.map((cell) => Number(cell.dataset.y))) + 1;
          panelsRef.current?.open({ kind: 'form', key, title: '插入表格', anchor,
            returnFocus: returnToEditor,
            restore: restoreAfterPanel(anchor),
            fields: [{ label: '行数', value: '3', max: rows, required: true }, { label: '列数', value: '3', max: columns, required: true }],
            submit: (values) => {
              if (!canEdit()) return;
              editor.restoreSelection();
              native.querySelector<HTMLElement>(`td[data-x="${Number(values[1]) - 1}"][data-y="${Number(values[0]) - 1}"]`)?.click();
            },
          });
          return;
        }
        if ('getModalContentElem' in menu) {
          const native = (menu as IModalMenu).getModalContentElem(editor);
          const inputs = Array.from(native.querySelectorAll<HTMLInputElement>('input'));
          const labels = key === 'insertImage' ? ['图片地址', '图片描述（选填）', '跳转链接（选填）']
            : key === 'editLink' ? ['链接地址'] : ['链接文本', '链接地址'];
          const fields: EditorFormField[] = inputs.map((input, index) => ({
            label: labels[index] ?? input.closest('label')?.textContent?.trim() ?? '内容',
            value: input.value,
            required: key === 'insertImage' ? index === 0 : true,
            url: key === 'editLink' || (key === 'insertImage' ? index !== 1 : index === 1),
          }));
          panelsRef.current?.open({ kind: 'form', key, title: MENU_LABELS[key], anchor, fields,
            returnFocus: returnToEditor,
            restore: restoreAfterPanel(anchor),
            submit: (values) => {
              if (!canEdit()) return;
              editor.restoreSelection();
              inputs.forEach((input, index) => { input.value = values[index]; });
              native.querySelector<HTMLButtonElement>('button')?.click();
            },
          });
        }
      };
      const shell = shellRef.current;
      const keepEditingFocus = (event: PointerEvent) => {
        if (event.button !== 0 || !editor.isFocused()) return;
        if ((event.target as Element).closest('button[data-menu-key]')) event.preventDefault();
      };
      const panelClick = (event: MouseEvent) => {
        const button = (event.target as Element).closest<HTMLButtonElement>('button[data-menu-key]');
        const key = button?.dataset.menuKey;
        if (button && (key === 'undo' || key === 'redo')) {
          event.preventDefault();
          event.stopPropagation();
          if (!canEdit() || button.matches(':disabled, [aria-disabled="true"]')) return;
          editor.restoreSelection();
          editor[key]?.();
          return;
        }
        if (!button || !key || !PANEL_TOOLS_HANDLED.has(key)) return;
        event.preventDefault();
        event.stopPropagation();
        openTool(key, button);
      };
      const panelKey = (event: KeyboardEvent) => {
        if (event.isComposing) return;
        const linkShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
        const button = linkShortcut ? shell.querySelector<HTMLButtonElement>('button[data-menu-key="insertLink"]')
          : (event.target as Element).closest<HTMLButtonElement>('button[data-menu-key]');
        const key = linkShortcut ? 'insertLink' : button?.dataset.menuKey;
        if (!button || !key || (!linkShortcut && event.key !== 'ArrowDown') || !PANEL_TOOLS_HANDLED.has(key)) return;
        event.preventDefault();
        event.stopPropagation();
        openTool(key, button);
      };
      shell.addEventListener('pointerdown', keepEditingFocus, true);
      shell.addEventListener('click', panelClick, true);
      shell.addEventListener('keydown', panelKey, true);
      stopPanelControls = () => {
        shell.removeEventListener('pointerdown', keepEditingFocus, true);
        shell.removeEventListener('click', panelClick, true);
        shell.removeEventListener('keydown', panelKey, true);
      };

      const syncContextMenu = () => {
        const bar = shell.querySelector<HTMLElement>('.w-e-hover-bar');
        if (!bar?.classList.contains('w-e-bar-show') || !canEdit()) { panelsRef.current?.context(null); return; }
        const buttons = Array.from(bar.querySelectorAll<HTMLButtonElement>('button[data-menu-key]'));
        const type = buttons.some((button) => button.dataset.menuKey === 'editLink') ? 'link'
          : buttons.some((button) => button.dataset.menuKey === 'deleteImage') ? 'image' : 'table';
        const node = DomEditor.getSelectedNodeByType(editor, type);
        if (!node) { panelsRef.current?.context(null); return; }
        const anchor = editor.toDOMNode(node);
        panelsRef.current?.context({ kind: 'context', key: type, anchor,
          title: type === 'link' ? '链接操作' : type === 'image' ? '图片操作' : '表格操作',
          items: buttons.map((button) => ({ value: button.dataset.menuKey!, label: MENU_LABELS[button.dataset.menuKey!] ?? button.textContent,
            disabled: button.classList.contains('disabled'), destructive: ['deleteImage', 'deleteTable'].includes(button.dataset.menuKey!),
          })),
          select: (key) => {
            if (!canEdit()) return;
            if (PANEL_TOOLS_HANDLED.has(key)) openTool(key, anchor);
            else {
              const action = menuOf(key);
              editor.restoreSelection();
              if (action && !action.isDisabled(editor)) action.exec(editor, action.getValue(editor));
            }
          },
          dismiss: () => DomEditor.getHoverbar(editor)?.hideAndClean(),
        });
      };

      // WangEditor uses a non-ARIA role and CSS-only tooltip labels. Bridge its
      // real DOM, including controls added when a toolbar group opens.
      const nameControls = () => {
        const editable = editorContainerRef.current?.querySelector<HTMLElement>('[data-slate-editor]');
        if (editable) {
          const { label: name, placeholder: hint, invalid: bad, describedBy: described } = latest.current;
          editable.setAttribute('role', 'textbox');
          editable.setAttribute('aria-multiline', 'true');
          addClasses(editable, 'rich-text-content focus-visible:outline-hidden');
          editable.classList.toggle('disabled-content', latest.current.disabled);
          styleListRows(editable);
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
          if (PANEL_TOOLS_HANDLED.has(key)) {
            const popup = key === 'group-image' ? 'menu' : 'dialog';
            if (button.getAttribute('aria-haspopup') !== popup) button.setAttribute('aria-haspopup', popup);
          }
          addClasses(button, EDITOR_CONTROL_CLASSES);
          if (!button.hasAttribute('data-ripple')) button.setAttribute('data-ripple', '');
          if (!button.hasAttribute('type')) button.type = 'button';
          const history = editorHistory(editor);
          const historyEmpty = key === 'undo' ? !history?.undos.length : key === 'redo' ? !history?.redos.length : false;
          const unavailable = latest.current.disabled || button.classList.contains('disabled') || historyEmpty;
          if (button.disabled !== unavailable) button.disabled = unavailable;
          button.classList.toggle('disabled-content', unavailable);
          const selected = button.classList.contains('active') || button.getAttribute('aria-expanded') === 'true';
          button.classList.toggle('forced-selected', selected);
          if (button.getAttribute('aria-disabled') !== String(unavailable)) button.setAttribute('aria-disabled', String(unavailable));
          if (TOGGLE_TOOLS.has(key) && button.getAttribute('aria-pressed') !== String(selected)) {
            button.setAttribute('aria-pressed', String(selected));
          }
          // The shared tooltip uses the same label; the package's pseudo-elements
          // must not take over the state-layer pseudo-element on a button.
          if (button.classList.contains('w-e-menu-tooltip-v5')) button.classList.remove('w-e-menu-tooltip-v5');
        });
        shell.querySelectorAll<HTMLElement>('.w-e-scroll, .table-container').forEach((scroller) => addClasses(scroller, 'popover-scrollbar'));
        const nextHints = Array.from(shellRef.current?.querySelectorAll<HTMLElement>('button[data-menu-key]') ?? [])
          .filter((target) => !target.closest('.w-e-hover-bar, .w-e-bar-item-menus-container'))
          .map((target) => ({
            target,
            label: target.matches(':disabled, [aria-disabled="true"], [aria-expanded="true"], .disabled')
              ? undefined : target.getAttribute('aria-label') ?? undefined,
          }));
        setHints((previous) => previous.length === nextHints.length && nextHints.every((hint, index) =>
          hint.target === previous[index].target && hint.label === previous[index].label,
        ) ? previous : nextHints);
        syncContextMenu();
      };

      nameControls();
      semantics = new MutationObserver(nameControls);
      semantics.observe(shellRef.current, {
        childList: true, characterData: true, subtree: true, attributes: true,
        attributeFilter: ['data-tooltip', 'class', 'disabled', 'aria-disabled', 'aria-expanded', 'style'],
      });
      /* A width change re-plans the row (a phone turned, a sidebar opened); nothing is rebuilt
         unless the tools that fit have changed. */
      resize = new ResizeObserver(() => {
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
      stopPanelControls();
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
      if (editorValue(editor) !== value) writeValue(editor, value);
    });
  }, [value, writeValue]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (disabled) {
      editor.disable();
      panelsRef.current?.close();
    }
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
    <div
      ref={shellRef}
      data-invalid={invalid ? '' : undefined}
      data-disabled={disabled ? '' : undefined}
      className={cn(EDITOR_FRAME_CLASS_NAME, invalid ? 'border-error' : 'border-outline')}
      style={{ '--editor-min-phone': `${phone}px`, '--editor-min-wide': `${wide}px`, '--editor-icon-size': `${ICON.control}px` } as CSSProperties}
    >
      <FollowHeight track>
        <div ref={rowRef} data-toolbar-row="" className={EDITOR_TOOLBAR_CLASS_NAME}>
          <div ref={toolbarContainerRef} id={toolbarId} role="toolbar" aria-label="格式" className="min-w-0 flex-1" />
          {overflow && (
            <button
              type="button"
              data-toolbar-toggle=""
              data-menu-key="more-formats"
              aria-label="更多格式"
              aria-expanded={expanded}
              aria-controls={toolbarId}
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
      </FollowHeight>
      <div ref={editorContainerRef} data-editor-host="" />
      {hints.map((hint, index) => <EditorControlTooltip key={index} {...hint} />)}
      <RichTextEditorPanels handleRef={panelsRef} ownerRef={shellRef} />
    </div>
  );
}
