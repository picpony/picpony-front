'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Modal from './Modal';
import Button from './Button';
import { Textarea } from './Input';

export interface ConfirmOptions {
  title: string;
  /** The body. A string is the common case; a node for a list of consequences. */
  message: ReactNode;
  /** Defaults to 确认. */
  confirmLabel?: string;
  /** Defaults to 取消. */
  cancelLabel?: string;
  /**
   * `danger` for anything that destroys or is hard to undo — deleting a row,
   * blacklisting an image. `filled` for a step that merely needs acknowledging,
   * which is what an upload's guideline check is.
   */
  tone?: 'danger' | 'filled';
}

/**
 * One "are you sure?" for the whole app — `Modal` at `max-w-sm`, a body, a text
 * 取消 next to the tone's confirm. Two shapes, because call sites want both:
 *
 *   if (!(await confirm({ title: '…', message: '…' }))) return;   // promise
 *   confirmThen('确认删除', '确定要删除此徽章吗？', async () => { … }); // fire-and-forget
 *
 * Render `confirmDialog` once, anywhere in the tree.
 *
 * The options are held through the close animation rather than cleared with the
 * open flag — clearing both at once emptied the card for the 200ms it spends
 * scaling away.
 */
export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const resolveRef = useRef<((confirmed: boolean) => void) | null>(null);

  useEffect(() => () => {
    resolveRef.current?.(false);
    resolveRef.current = null;
  }, []);

  const confirm = useCallback((next: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      // A second ask supersedes the first rather than orphaning its promise.
      resolveRef.current?.(false);
      resolveRef.current = resolve;
      setOptions(next);
      setIsOpen(true);
    });
  }, []);

  const confirmThen = useCallback(
    (title: string, message: ReactNode, action: () => void | Promise<void>) => {
      void confirm({ title, message }).then((confirmed) => {
        if (confirmed) void action();
      });
    },
    [confirm],
  );

  const settle = useCallback((confirmed: boolean) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setIsOpen(false);
    resolve?.(confirmed);
  }, []);

  const confirmDialog = (
    <Modal
      isOpen={isOpen}
      onClose={() => settle(false)}
      title={options?.title ?? ''}
      maxWidth="sm"
      footer={
        <>
          <Button variant="text" onClick={() => settle(false)}>
            {options?.cancelLabel ?? '取消'}
          </Button>
          <Button variant={options?.tone ?? 'danger'} onClick={() => settle(true)}>
            {options?.confirmLabel ?? '确认'}
          </Button>
        </>
      }
    >
      <div className="text-body-m text-on-surface-variant whitespace-pre-line">
        {options?.message}
      </div>
    </Modal>
  );

  return { confirm, confirmThen, confirmDialog };
}

export interface PromptOptions {
  title: string;
  /** The field's label. */
  label: string;
  message?: ReactNode;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  rows?: number;
}

/**
 * The same dialog with a field in it, replacing the browser's `prompt()`.
 *
 * Resolves to the entered string, or `null` if cancelled — the same contract
 * `prompt()` had. The value is trimmed here rather than at each call site.
 */
export function usePrompt() {
  const [options, setOptions] = useState<PromptOptions | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [value, setValue] = useState('');
  const resolveRef = useRef<((value: string | null) => void) | null>(null);

  useEffect(() => () => {
    resolveRef.current?.(null);
    resolveRef.current = null;
  }, []);

  const prompt = useCallback((next: PromptOptions) => {
    return new Promise<string | null>((resolve) => {
      resolveRef.current?.(null);
      resolveRef.current = resolve;
      setOptions(next);
      setValue(next.defaultValue ?? '');
      setIsOpen(true);
    });
  }, []);

  const settle = useCallback((result: string | null) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setIsOpen(false);
    resolve?.(result);
  }, []);

  const promptDialog = (
    <Modal
      isOpen={isOpen}
      onClose={() => settle(null)}
      title={options?.title ?? ''}
      maxWidth="sm"
      footer={
        <>
          <Button variant="text" onClick={() => settle(null)}>
            {options?.cancelLabel ?? '取消'}
          </Button>
          <Button variant="filled" onClick={() => settle(value.trim())}>
            {options?.confirmLabel ?? '确认'}
          </Button>
        </>
      }
    >
      {options?.message && (
        <p className="text-body-m text-on-surface-variant mb-4">{options.message}</p>
      )}
      <Textarea
        label={options?.label ?? ''}
        rows={options?.rows ?? 3}
        placeholder={options?.placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    </Modal>
  );

  return { prompt, promptDialog };
}
