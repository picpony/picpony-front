'use client';

import { useCallback, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type DropZoneState = 'idle' | 'dragging' | 'invalid' | 'filled';

interface DropZoneProps {
  /** Called with the first accepted file, from either a drop or the picker. */
  onFile: (file: File) => void;
  /**
   * A dropped file that turned out not to match `accept` (its type was not known while
   * it was being dragged). Without this it goes to `onFile`, so the caller's own
   * validation reports it rather than the drop vanishing without a word.
   */
  onReject?: (file: File) => void;
  /** `accept` for the hidden input, and what a drag and a drop are checked against. */
  accept?: string;
  /** Something is already selected — the zone shows its preview, not its prompt. */
  filled?: boolean;
  disabled?: boolean;
  /** Padding scale. `lg` for a whole-page upload target, `sm` for a form row. */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /**
   * Preview or prompt. Receives the live state so a caller can react to a drag.
   * Controls inside it (a remove button) are real controls in their own right: the
   * zone's own target is a layer *behind* the content, not a wrapper around it.
   */
  children: ReactNode | ((state: DropZoneState) => ReactNode);
  'aria-label'?: string;
}

/** Whether `type` / `name` satisfy an `accept` list (MIME types, `type/*` families, `.ext`). */
function accepts(accept: string | undefined, type: string, name = ''): boolean {
  if (!accept) return true;
  const mime = type.toLowerCase();
  const file = name.toLowerCase();
  return accept
    .split(',')
    .map((rule) => rule.trim().toLowerCase())
    .filter(Boolean)
    .some((rule) =>
      rule.startsWith('.')
        ? file.endsWith(rule)
        : rule.endsWith('/*')
          ? mime.startsWith(rule.slice(0, -1))
          : mime === rule,
    );
}

/**
 * During a drag only the dragged items' MIME types are readable (names are not), and
 * some sources report none. `true` when some file is acceptable or none can be judged
 * yet; `false` only when every file's type is known and none is acceptable.
 */
function dragAcceptable(accept: string | undefined, event: DragEvent): boolean {
  if (!accept) return true;
  const items = [...(event.dataTransfer?.items ?? [])].filter((item) => item.kind === 'file');
  if (items.length === 0) return true;
  return items.some((item) => !item.type || accepts(accept, item.type));
}

/**
 * Click-or-drag file target. The states are the component's, not the call site's:
 *
 *   idle      dashed `outline`, the M3 state layer for hover.
 *   dragging  `primary` border on the `primary-container` tone.
 *             No scale transform: the border and tone already read
 *             unambiguously as "let go here", and the transform would corrupt
 *             rects of children being measured.
 *   invalid   `error` border: what is being dragged is not something this zone
 *             takes, and the platform's no-drop cursor says the same — a drag that
 *             carries nothing acceptable cannot be dropped at all.
 *   filled    `surface-container-high` with a solid `outline-variant` edge. It is
 *             not inviting a drop any more; it is showing you what you chose — and
 *             in a brand-pink block that flooded /upload's form and framed the very
 *             picture 从图片取色 asks you to judge colours in.
 *
 * The border's style is per state rather than in the base, so exactly one style
 * class is ever emitted (`cn` is a plain join).
 *
 * **The target is a layer, not a wrapper.** A `role="button"` wrapper makes its
 * children presentational — the upload page's 移除文件 inside it was flattened for
 * assistive tech and needed `stopPropagation` to work at all, two tab stops for one
 * object. Now a real `<button>` fills the zone *behind* its content, the content lets
 * the pointer through to it, and a control inside the content is an ordinary sibling
 * control again.
 *
 * `dragenter`/`dragleave` are counted rather than toggled. A single boolean flips
 * off the moment the pointer crosses onto a *child* element, because `dragleave`
 * fires on the parent as `dragenter` fires on the child — so a zone containing a
 * preview image flickered its highlight the whole time a file was held over it.
 */
const SIZES = {
  sm: 'px-4 py-3',
  md: 'p-6',
  lg: 'p-8 sm:p-12',
} as const;

export default function DropZone({
  onFile,
  onReject,
  accept,
  filled = false,
  disabled = false,
  size = 'md',
  className = '',
  children,
  'aria-label': ariaLabel = '选择或拖拽文件',
}: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const [drag, setDrag] = useState<'none' | 'ok' | 'invalid'>('none');

  const state: DropZoneState =
    drag !== 'none' && !disabled ? (drag === 'ok' ? 'dragging' : 'invalid') : filled ? 'filled' : 'idle';

  const take = useCallback(
    (file: File | undefined | null) => {
      if (!file || disabled) return;
      onFile(file);
    },
    [onFile, disabled],
  );

  const onDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    if (disabled) return;
    depth.current += 1;
    setDrag(dragAcceptable(accept, e) ? 'ok' : 'invalid');
  }, [disabled, accept]);

  const onDragOver = useCallback((e: DragEvent) => {
    // `dragover` must be prevented too or the browser navigates to the file.
    e.preventDefault();
    if (!e.dataTransfer) return;
    /* `none` is the platform's own refusal: the no-drop cursor, and no `drop` event
       when the button is let go. */
    e.dataTransfer.dropEffect = disabled || !dragAcceptable(accept, e) ? 'none' : 'copy';
  }, [disabled, accept]);

  const onDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDrag('none');
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      depth.current = 0;
      setDrag('none');
      if (disabled) return;
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length === 0) return;
      const fit = files.find((file) => accepts(accept, file.type, file.name));
      if (fit) take(fit);
      else (onReject ?? onFile)(files[0]);
    },
    [take, accept, disabled, onReject, onFile],
  );

  return (
    <div
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        'relative flex flex-col items-center justify-center rounded-md border-2 text-center',
        'spring-fast-effects transition-[background-color,border-color,box-shadow]',
        SIZES[size],
        disabled && 'disabled-content',
        state === 'idle' && 'border-dashed border-outline',
        state === 'dragging' && 'border-dashed border-primary-ink bg-primary-container',
        state === 'invalid' && 'border-dashed border-error',
        state === 'filled' && 'border-solid border-outline-variant bg-surface-container-high',
        className,
      )}
    >
      {/* The zone's one target: behind the content, the zone's own shape, the inset
          ring (the dashed border is right outside it). */}
      <button
        type="button"
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'absolute inset-0 rounded-[inherit] touch-manipulation',
          'focus-visible:outline-hidden focus-visible:inset-ring-2 focus-visible:focus-ring-inset',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
          state === 'idle' && !disabled && 'state-layer',
        )}
      />
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        disabled={disabled}
        className="hidden"
        onChange={(e) => {
          take(e.target.files?.[0]);
          // Cleared so re-picking the same file still fires `change`.
          e.target.value = '';
        }}
      />
      {/* The content lets the pointer through to the target beneath it; anything
          interactive inside takes it back (`[data-dropzone-content]`, globals.css).
          The caller's layout for its content (e.g. a row with a gap) is written on the
          zone, so the content box inherits the direction and gap rather than fixing
          its own. */}
      <div
        data-dropzone-content=""
        className="relative flex w-full items-center justify-center [flex-direction:inherit] [gap:inherit]"
      >
        {typeof children === 'function' ? children(state) : children}
      </div>
    </div>
  );
}
