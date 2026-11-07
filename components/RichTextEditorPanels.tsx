'use client';

import { useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref, type RefObject } from 'react';
import { MdClose, MdFormatColorReset, MdImage, MdUpload } from 'react-icons/md';
import Button from '@/components/Button';
import IconButton from '@/components/IconButton';
import { Input } from '@/components/Input';
import Menu, { type MenuAction } from '@/components/Menu';
import Modal from '@/components/Modal';
import Popover, { type PopoverHandle } from '@/components/Popover';
import { safeUrl } from '@/lib/bbcode';
import { ICON } from '@/lib/icons';

interface PanelBase {
  key: string;
  title: string;
  anchor: HTMLElement;
}

export interface EditorColorPanel extends PanelBase {
  kind: 'color';
  colors: string[];
  value: string;
  pick: (color: string | null) => void;
}

export interface EditorImageMenu extends PanelBase {
  kind: 'image';
  uploadDisabled: boolean;
  select: (key: 'uploadImage' | 'insertImage') => void;
}

export interface EditorFormField {
  label: string;
  value: string;
  required?: boolean;
  url?: boolean;
  max?: number;
}

export interface EditorFormPanel extends PanelBase {
  kind: 'form';
  fields: EditorFormField[];
  submit: (values: string[]) => void;
  returnFocus: () => HTMLElement | null;
  restore?: () => void;
}

export interface EditorContextMenu extends PanelBase {
  kind: 'context';
  items: MenuAction[];
  select: (key: string) => void;
  dismiss: () => void;
}

export type EditorPanelRequest = EditorColorPanel | EditorImageMenu | EditorFormPanel;
type Entry<T> = { request: T; open: boolean; revision: number };
type PanelState = {
  color?: Entry<EditorColorPanel>;
  image?: Entry<EditorImageMenu>;
  form?: Entry<EditorFormPanel>;
  context?: Entry<EditorContextMenu>;
};

export interface RichTextEditorPanelsHandle {
  open: (request: EditorPanelRequest) => void;
  context: (request: EditorContextMenu | null) => void;
  close: () => void;
}

function closeAll(state: PanelState): PanelState {
  return Object.fromEntries(Object.entries(state).map(([key, value]) => [key, { ...value, open: false }]));
}

function sameContext(a: EditorContextMenu, b: EditorContextMenu) {
  return a.anchor === b.anchor && a.items.length === b.items.length &&
    a.items.every((item, index) => item.value === b.items[index].value && item.disabled === b.items[index].disabled);
}

function ImageMenu({ entry, close }: { entry: Entry<EditorImageMenu>; close: () => void }) {
  const { request, open } = entry;
  const anchorRef = useMemo(() => ({ current: request.anchor }), [request.anchor]);
  useEffect(() => {
    request.anchor.setAttribute('aria-haspopup', 'menu');
    request.anchor.setAttribute('aria-expanded', String(open));
    return () => request.anchor.setAttribute('aria-expanded', 'false');
  }, [request.anchor, open]);
  return (
    <Menu
      open={open}
      onClose={close}
      anchorRef={anchorRef}
      aria-label="插入图片"
      items={[
        { value: 'uploadImage', label: '上传图片', icon: <MdUpload size={ICON.standard} />, disabled: request.uploadDisabled },
        { value: 'insertImage', label: '网络图片', icon: <MdImage size={ICON.standard} /> },
      ]}
      onSelect={(key) => request.select(key as 'uploadImage' | 'insertImage')}
    />
  );
}

function colorLabel(value: string) {
  const rgb = /^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/.exec(value);
  return rgb ? `#${rgb.slice(1).map((channel) => Number(channel).toString(16).padStart(2, '0')).join('').toUpperCase()}` : value;
}

function ColorPanel({ entry, close }: { entry: Entry<EditorColorPanel>; close: () => void }) {
  const { request, open } = entry;
  const controls = useRef<(HTMLButtonElement | null)[]>([]);
  const anchorRef = useMemo(() => ({ current: request.anchor }), [request.anchor]);
  const [cursor, setCursor] = useState(0);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => controls.current[Math.max(0, request.colors.indexOf(request.value))]?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, request]);
  useEffect(() => {
    request.anchor.setAttribute('aria-haspopup', 'dialog');
    request.anchor.setAttribute('aria-expanded', String(open));
    return () => request.anchor.setAttribute('aria-expanded', 'false');
  }, [request.anchor, open]);
  const pick = (color: string | null) => {
    request.pick(color);
    close();
  };
  return (
    <Popover open={open} anchorRef={anchorRef} matchAnchorWidth={false}
      role="dialog" aria-label={request.title} className="w-72" estimatedHeight={288}
      onClose={(refocus) => { if (refocus) request.anchor.focus({ preventScroll: true }); close(); }}>
      <div className="flex items-center justify-between gap-2 px-2 pb-2">
        <span className="text-title-s">{request.title}</span>
        <IconButton size="sm" dismiss aria-label="关闭" icon={<MdClose />} onClick={() => { request.anchor.focus(); close(); }} />
      </div>
      <Button variant="text" fullWidth className="mb-2" icon={<MdFormatColorReset />} onClick={() => pick(null)}>
        {request.key === 'bgColor' ? '清除背景颜色' : '默认文字颜色'}
      </Button>
      <div className="grid grid-cols-5 gap-1" role="group" aria-label={request.title}>
        {request.colors.map((color, index) => (
          <IconButton key={color} ref={(node) => { controls.current[index] = node; }}
            aria-label={`选择颜色 ${colorLabel(color)}`} toggle selected={color === request.value}
            tabIndex={index === cursor ? 0 : -1} shape="square" className="touch-size justify-self-center"
            onFocus={() => setCursor(index)} onClick={() => pick(color)}
            icon={<span className="forced-boundary block size-6 rounded-xs" style={{ backgroundColor: color }} />}
            onKeyDown={(event) => {
              const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -5, ArrowDown: 5 };
              let next = index;
              if (event.key in offsets) next = Math.max(0, Math.min(request.colors.length - 1, index + offsets[event.key]));
              else if (event.key === 'Home') next = 0;
              else if (event.key === 'End') next = request.colors.length - 1;
              else return;
              event.preventDefault();
              controls.current[next]?.focus();
            }} />
        ))}
      </div>
    </Popover>
  );
}

function FormPanel({ entry, close }: { entry: Entry<EditorFormPanel>; close: () => void }) {
  const { request, open, revision } = entry;
  const formId = useId();
  const [draft, setDraft] = useState({ revision, values: request.fields.map((field) => field.value), errors: {} as Record<number, string> });
  if (draft.revision !== revision) setDraft({ revision, values: request.fields.map((field) => field.value), errors: {} });
  const pending = useRef<{ revision: number; values: string[] } | null>(null);
  const fields = useRef<(HTMLInputElement | null)[]>([]);
  useEffect(() => {
    if (!request.anchor.matches('button')) return;
    request.anchor.setAttribute('aria-expanded', String(open));
    return () => request.anchor.setAttribute('aria-expanded', 'false');
  }, [request.anchor, open]);
  const cancel = () => { pending.current = null; close(); };
  return (
    <Modal isOpen={open} title={request.title} maxWidth="sm" onClose={cancel} returnFocus={request.returnFocus}
      onExited={() => {
        const action = pending.current;
        pending.current = null;
        if (action?.revision === revision) request.submit(action.values);
        else request.restore?.();
      }}
      footer={<><Button variant="text" onClick={cancel}>取消</Button><Button type="submit" form={formId} variant="filled">{request.key === 'editLink' ? '保存' : '插入'}</Button></>}>
      <form id={formId} className="flex flex-col gap-4" noValidate
        onKeyDown={(event) => { if (event.key === 'Enter') event.stopPropagation(); }}
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const values = draft.values.map((value) => value.trim());
          const errors: Record<number, string> = {};
          request.fields.forEach((field, index) => {
            const value = values[index];
            if (field.required && !value) errors[index] = `请输入${field.label}`;
            else if (field.url && value && !safeUrl(value)) errors[index] = '请输入有效的链接地址';
            else if (field.max && (!Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > field.max)) errors[index] = `请输入 1 至 ${field.max} 的整数`;
          });
          setDraft((current) => ({ ...current, errors }));
          const first = Object.keys(errors)[0];
          if (first !== undefined) { fields.current[Number(first)]?.focus(); return; }
          pending.current = { revision, values };
          close();
        }}>
        {request.fields.map((field, index) => (
          <Input key={index} ref={(node) => { fields.current[index] = node; }} data-autofocus={index === 0 ? '' : undefined}
            label={field.label} required={field.required} value={draft.values[index] ?? ''}
            inputMode={field.max ? 'numeric' : field.url ? 'url' : 'text'}
            type={field.max ? 'number' : 'text'} min={field.max ? 1 : undefined} max={field.max}
            placeholder={field.url ? 'https://…' : undefined} error={draft.errors[index]}
            onChange={(event) => setDraft((current) => ({ ...current,
              values: current.values.map((value, position) => position === index ? event.target.value : value),
              errors: { ...current.errors, [index]: '' },
            }))} />
        ))}
      </form>
    </Modal>
  );
}

/** The editor uses the same overlay components as the rest of the app. Only command data is adapted. */
export default function RichTextEditorPanels({ handleRef, ownerRef }: {
  handleRef: Ref<RichTextEditorPanelsHandle>;
  ownerRef: RefObject<HTMLElement | null>;
}) {
  const [state, setState] = useState<PanelState>({});
  const revision = useRef(0);
  const contextRef = useRef<PopoverHandle | null>(null);
  const contextAnchor = useMemo(() => ({ current: state.context?.request.anchor ?? null }), [state.context?.request.anchor]);
  const panelOpen = Boolean(state.image?.open || state.color?.open || state.form?.open || state.context?.open);
  useLayoutEffect(() => {
    const owner = ownerRef.current;
    owner?.toggleAttribute('data-panel-open', panelOpen);
    return () => owner?.removeAttribute('data-panel-open');
  }, [ownerRef, panelOpen]);
  useImperativeHandle(handleRef, () => ({
    open(request) {
      const next = ++revision.current;
      setState((current) => {
        if (request.kind === 'color' && current.color?.open && current.color.request.anchor === request.anchor) {
          return { ...current, color: { ...current.color, open: false } };
        }
        if (request.kind === 'image' && current.image?.open && current.image.request.anchor === request.anchor) {
          return { ...current, image: { ...current.image, open: false } };
        }
        return { ...closeAll(current), [request.kind]: { request, open: true, revision: next } };
      });
    },
    context(request) {
      setState((current) => {
        if (!request || current.color?.open || current.image?.open || current.form?.open) {
          if (!request && !current.color?.open && !current.image?.open && !current.form?.open &&
            contextRef.current?.element?.contains(document.activeElement)) return current;
          return current.context?.open ? { ...current, context: { ...current.context, open: false } } : current;
        }
        if (current.context?.open && sameContext(current.context.request, request)) return current;
        return { ...current, context: { request, open: true, revision: 0 } };
      });
    },
    close() { setState((current) => closeAll(current)); },
  }), []);
  const close = (kind: keyof PanelState, expected: number) => setState((current) => {
    const entry = current[kind];
    return entry?.revision === expected && entry.open ? { ...current, [kind]: { ...entry, open: false } } : current;
  });
  return <>
    {state.image && <ImageMenu entry={state.image} close={() => close('image', state.image!.revision)} />}
    {state.color && <ColorPanel entry={state.color} close={() => close('color', state.color!.revision)} />}
    {state.form && <FormPanel entry={state.form} close={() => close('form', state.form!.revision)} />}
    {state.context && <Menu open={state.context.open} aria-label={state.context.request.title}
      handleRef={contextRef}
      anchorRef={contextAnchor} items={state.context.request.items} focusOnOpen={false}
      onSelect={state.context.request.select}
      onClose={() => { state.context!.request.dismiss(); close('context', 0); }} />}
  </>;
}
