'use client';

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';
import { EMOJI_BY_NAME } from './messageText';
import {
  createComposerHistory,
  parseComposerValue,
  readablePieces,
  serializePieces,
  type ComposerEdit,
  type ComposerHistory,
  type ComposerPiece,
} from './composerModel';

/**
 * The message field: an editable box that holds text *and* the pony emoji as pictures.
 *
 * A textarea can only hold text, so a picked emoji arrived as its raw wire token
 * (`$emoji_applehorror$`) — the user saw an internal code where they had chosen a picture.
 * This field holds the picture itself, an inline image, and reads back as the same
 * `$emoji_<name>$` text the message is sent as (`composerModel.ts` is the translation).
 *
 * **Plain text, whatever arrives.** It is `plaintext-only` where the engine has that mode
 * (every current one), and the handlers below hold the line where it does not: a paste is
 * inserted as text, formatting shortcuts do nothing, and any element the engine creates
 * anyway is flattened back into text on the next input. The DOM is always a flat run of text
 * nodes, emoji images and line breaks.
 *
 * **Its own undo.** The native history knows only the browser's own edits; an emoji inserted
 * by the page was either skipped or undid the wrong characters. Every change is recorded here
 * and undo/redo (keys and the context menu alike) replay it.
 *
 * **The keyboard's rules are a messenger's**: Enter sends, Shift+Enter breaks the line, and
 * nothing is intercepted while an input method is composing — Enter then chooses a candidate,
 * and Escape dismisses the candidate list (it is stopped here, so no surface above takes it as
 * "close").
 *
 * It sits in the filled field shell (`.m3-field`), so its tone, hover layer, 8dp corner and
 * focus ring — and forced colors' boundary — are the dense field's own. 28px of `body-l` line
 * plus 10px above and below: the 48dp the composer row is built on.
 */
export interface ChatComposerHandle {
  /** Focus the field with the caret where it last was. */
  focus: () => void;
  /** Insert a pony emoji at the caret — where it was when the field lost focus, if it has. */
  insertEmoji: (name: string) => void;
  /** Insert text at the caret (a Unicode emoji from the picker). */
  insertText: (text: string) => void;
  /** Empty the field and its undo history — after a send. */
  clear: () => void;
  /** The serialised value. */
  value: () => string;
}

interface ChatComposerProps {
  /** The draft to start from, serialised. Read once, on mount. */
  initialValue: string;
  placeholder: string;
  /** The field's accessible name. */
  label: string;
  onChange: (value: string) => void;
  /** Enter (without Shift), or the keyboard's send key. */
  onSubmit: () => void;
  onFocus?: () => void;
  /** Escape outside a composition — the emoji panel's to close, if one is open. */
  onEscape?: () => void;
  /** Take focus on mount — only under a fine pointer, where no keyboard springs up. */
  autoFocus?: boolean;
  id?: string;
}

const MIME = 'application/x-picpony-message';

let plaintextOnly: boolean | null = null;
function supportsPlaintextOnly(): boolean {
  if (plaintextOnly === null) {
    const probe = document.createElement('div');
    try {
      probe.contentEditable = 'plaintext-only';
      plaintextOnly = probe.contentEditable === 'plaintext-only';
    } catch {
      plaintextOnly = false;
    }
  }
  return plaintextOnly;
}

function emojiImage(name: string): HTMLImageElement {
  const img = document.createElement('img');
  img.src = `/img/emoji/${name}.png`;
  img.alt = `[${EMOJI_BY_NAME.get(name)?.label ?? name}]`;
  img.dataset.emoji = name;
  img.draggable = false;
  img.width = 24;
  img.height = 24;
  img.className = 'mx-px inline-block h-6 w-6 align-text-bottom';
  return img;
}

function nodesOf(pieces: readonly ComposerPiece[]): Node[] {
  return pieces.map((piece) =>
    piece.type === 'text' ? document.createTextNode(piece.text) : emojiImage(piece.name),
  );
}

const isEmojiNode = (node: Node): node is HTMLImageElement =>
  node instanceof HTMLImageElement && Boolean(node.dataset.emoji);
const isBreak = (node: Node): node is HTMLBRElement => node instanceof HTMLBRElement;
const BLOCK = /^(?:DIV|P|LI|H[1-6]|BLOCKQUOTE|PRE)$/;

/**
 * The field's children as pieces. A `<br>` that is the last child is the engine's placeholder
 * for an empty final line, not content.
 */
function readPieces(root: Node): ComposerPiece[] {
  const pieces: ComposerPiece[] = [];
  const pushText = (text: string) => {
    if (!text) return;
    const last = pieces[pieces.length - 1];
    if (last?.type === 'text') last.text += text;
    else pieces.push({ type: 'text', text });
  };
  const walk = (node: Node, top: boolean) => {
    const children = Array.from(node.childNodes);
    children.forEach((child, index) => {
      if (child.nodeType === Node.TEXT_NODE) pushText(child.nodeValue ?? '');
      else if (isEmojiNode(child)) pieces.push({ type: 'emoji', name: child.dataset.emoji! });
      else if (isBreak(child)) {
        if (!(top && index === children.length - 1)) pushText('\n');
      } else if (child instanceof HTMLElement) {
        /* Something the engine made (a block for a new line, a span): its text, with a block
           on a line of its own. Anything that is not text or an emoji carries nothing. */
        const text = readablePieces(pieces);
        if (BLOCK.test(child.tagName) && text && !text.endsWith('\n')) pushText('\n');
        walk(child, false);
      }
    });
  };
  walk(root, true);
  return pieces;
}

/** Whether the field holds anything but text, emoji and line breaks directly. */
function needsFlattening(root: HTMLElement): boolean {
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE || isEmojiNode(child) || isBreak(child)) continue;
    return true;
  }
  return false;
}

function render(root: HTMLElement, pieces: readonly ComposerPiece[]) {
  root.replaceChildren(...nodesOf(pieces));
  /* A final empty line needs a box to hold the caret. */
  const last = pieces[pieces.length - 1];
  if (last?.type === 'text' && last.text.endsWith('\n')) root.appendChild(document.createElement('br'));
}

/** Units a child spans: its text length, or one for an emoji or a line break. */
function unitsOf(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return (node.nodeValue ?? '').length;
  return isEmojiNode(node) || isBreak(node) ? 1 : 0;
}

/** A DOM position inside `root` as a unit offset. */
function unitsAt(root: HTMLElement, node: Node, offset: number): number {
  const children = Array.from(root.childNodes);
  let units = 0;
  if (node === root) {
    for (let i = 0; i < Math.min(offset, children.length); i++) units += unitsOf(children[i]);
    return units;
  }
  for (const child of children) {
    if (child === node) return units + (node.nodeType === Node.TEXT_NODE ? offset : offset > 0 ? unitsOf(child) : 0);
    /* Inside something the engine nested (flattened on the next input): its start. */
    if (child.contains(node)) return units;
    units += unitsOf(child);
  }
  return units;
}

/** The selection inside `root`, as unit offsets, or null when it is elsewhere. */
function selectionOf(root: HTMLElement): { start: number; end: number } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  return {
    start: unitsAt(root, range.startContainer, range.startOffset),
    end: unitsAt(root, range.endContainer, range.endOffset),
  };
}

/** The caret — the selection's focus — inside `root`, or null when the selection is elsewhere. */
function caretOf(root: HTMLElement): number | null {
  const selection = window.getSelection();
  const node = selection?.focusNode;
  if (!selection || !node || !root.contains(node)) return null;
  return unitsAt(root, node, selection.focusOffset);
}

/** A DOM position for a unit offset: inside a text node, or between children. */
function positionOf(root: HTMLElement, caret: number): { node: Node; offset: number } {
  let remaining = caret;
  const children = Array.from(root.childNodes);
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const units = unitsOf(child);
    if (child.nodeType === Node.TEXT_NODE && remaining <= units) return { node: child, offset: remaining };
    if (remaining < units || (remaining === 0 && units > 0)) return { node: root, offset: i };
    remaining -= units;
  }
  /* Past the end — but before the placeholder break, so typing lands on the last line. */
  const tail = children[children.length - 1];
  return { node: root, offset: tail && isBreak(tail) ? children.length - 1 : children.length };
}

function placeCaret(root: HTMLElement, caret: number) {
  const selection = window.getSelection();
  if (!selection) return;
  const { node, offset } = positionOf(root, caret);
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function totalUnits(pieces: readonly ComposerPiece[]): number {
  return pieces.reduce((sum, piece) => sum + (piece.type === 'text' ? piece.text.length : 1), 0);
}

/** Split pieces at a unit offset. */
function splitAt(pieces: readonly ComposerPiece[], caret: number): [ComposerPiece[], ComposerPiece[]] {
  const before: ComposerPiece[] = [];
  const after: ComposerPiece[] = [];
  let remaining = caret;
  for (const piece of pieces) {
    const units = piece.type === 'text' ? piece.text.length : 1;
    if (remaining >= units) {
      before.push(piece);
      remaining -= units;
    } else if (remaining > 0 && piece.type === 'text') {
      before.push({ type: 'text', text: piece.text.slice(0, remaining) });
      after.push({ type: 'text', text: piece.text.slice(remaining) });
      remaining = 0;
    } else {
      after.push(piece);
      remaining = 0;
    }
  }
  return [before, after];
}

function joinPieces(...groups: ComposerPiece[][]): ComposerPiece[] {
  return parseComposerValue(serializePieces(groups.flat()));
}

const ChatComposer = forwardRef<ChatComposerHandle, ChatComposerProps>(function ChatComposer(
  { initialValue, placeholder, label, onChange, onSubmit, onFocus, onEscape, autoFocus = false, id },
  ref,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [empty, setEmpty] = useState(() => initialValue.trim() === '');
  const history = useRef<ComposerHistory | null>(null);
  /** The caret as of the last selection change inside the field, for an insertion made while
   *  focus is on the emoji picker. */
  const caret = useRef<number | null>(null);
  const composing = useRef(false);
  /** What the next input event was, from its `beforeinput`, for the undo history. */
  const pendingEdit = useRef<ComposerEdit>('type');
  const latest = useRef({ onChange, onSubmit, onEscape });
  useLayoutEffect(() => {
    latest.current = { onChange, onSubmit, onEscape };
  });

  const publish = useCallback((pieces: readonly ComposerPiece[]) => {
    const value = serializePieces(pieces);
    setEmpty(value === '');
    latest.current.onChange(value);
    return value;
  }, []);

  /* Mount: the editing mode, the draft, the history, and the caret at its end. */
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.contentEditable = supportsPlaintextOnly() ? 'plaintext-only' : 'true';
    const pieces = parseComposerValue(initialValue);
    render(root, pieces);
    const end = totalUnits(pieces);
    history.current = createComposerHistory({ value: serializePieces(pieces), caret: end });
    caret.current = end;
    if (autoFocus) {
      root.focus({ preventScroll: true });
      placeCaret(root, end);
    }
    // The draft is read once: it seeds the field, it does not control it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Where the caret is, whenever it moves inside the field. */
  useLayoutEffect(() => {
    const onSelection = () => {
      const root = rootRef.current;
      if (!root || composing.current) return;
      const at = caretOf(root);
      if (at !== null) caret.current = at;
    };
    document.addEventListener('selectionchange', onSelection);
    return () => document.removeEventListener('selectionchange', onSelection);
  }, []);

  /** Replace the whole value — undo, redo, a flatten, an insertion — and put the caret back. */
  const apply = useCallback((pieces: readonly ComposerPiece[], at: number, focusIt: boolean) => {
    const root = rootRef.current;
    if (!root) return '';
    render(root, pieces);
    caret.current = at;
    if (focusIt || document.activeElement === root) placeCaret(root, at);
    return publish(pieces);
  }, [publish]);

  const insertPieces = useCallback((inserted: ComposerPiece[]) => {
    const root = rootRef.current;
    const record = history.current;
    if (!root || !record || inserted.length === 0) return;
    const focused = document.activeElement === root;
    const current = readPieces(root);
    const end = totalUnits(current);
    /* Focused, at the selection — which the insertion replaces, as typing would. Otherwise
       (a tap on the picker took focus, or a phone's picker keeps the keyboard down) at the
       caret the field last had. */
    const live = focused ? selectionOf(root) : null;
    const start = Math.min(live ? Math.min(live.start, live.end) : caret.current ?? end, end);
    const stop = Math.min(live ? Math.max(live.start, live.end) : start, end);
    const [before] = splitAt(current, start);
    const [, after] = splitAt(current, stop);
    const next = joinPieces(before, inserted, after);
    const nextCaret = start + totalUnits(inserted);
    const value = apply(next, nextCaret, focused);
    record.record({ value, caret: nextCaret }, 'insert', Date.now());
  }, [apply]);

  useImperativeHandle(ref, () => ({
    focus() {
      const root = rootRef.current;
      if (!root) return;
      root.focus({ preventScroll: true });
      placeCaret(root, caret.current ?? totalUnits(readPieces(root)));
    },
    insertEmoji(name) {
      if (EMOJI_BY_NAME.has(name)) insertPieces([{ type: 'emoji', name }]);
    },
    insertText(text) {
      if (text) insertPieces(parseComposerValue(text));
    },
    clear() {
      const root = rootRef.current;
      if (!root) return;
      render(root, []);
      caret.current = 0;
      history.current?.reset({ value: '', caret: 0 });
      if (document.activeElement === root) placeCaret(root, 0);
      publish([]);
    },
    value() {
      const root = rootRef.current;
      return root ? serializePieces(readPieces(root)) : '';
    },
  }), [insertPieces, publish]);

  const restore = (snapshot: { value: string; caret: number } | null | undefined) => {
    if (!snapshot) return;
    apply(parseComposerValue(snapshot.value), snapshot.caret, true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const native = event.nativeEvent;
    if (native.isComposing || event.keyCode === 229) {
      /* The candidate list's own keys. An Escape that dismisses a candidate list is marked
         handled, so no surface above (the phone's conversation view, a popover) reads it as
         "close" — the overlay layer honours `defaultPrevented`. The input method has already
         acted on the key; marking it changes nothing for the composition. */
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    const mod = event.ctrlKey || event.metaKey;
    if (event.key === 'Enter' && !event.shiftKey && !mod && !event.altKey) {
      event.preventDefault();
      latest.current.onSubmit();
      return;
    }
    if (event.key === 'Escape') {
      /* Escape in a field is the field's (lib/hooks `useEscapeBack`): it closes the emoji
         panel if one is open and does nothing else — it never discards the draft and never
         closes the conversation around the field. */
      event.preventDefault();
      event.stopPropagation();
      latest.current.onEscape?.();
      return;
    }
    if (mod && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === 'z' || key === 'y') {
        event.preventDefault();
        const redo = key === 'y' || event.shiftKey;
        restore(redo ? history.current?.redo() : history.current?.undo());
        return;
      }
      /* Bold, italic, underline: there is no formatting in a message. */
      if (key === 'b' || key === 'i' || key === 'u') event.preventDefault();
    }
  };

  const onBeforeInput = (event: InputEvent) => {
    const type = event.inputType;
    if (type.startsWith('format')) {
      event.preventDefault();
      return;
    }
    if (type === 'historyUndo' || type === 'historyRedo') {
      event.preventDefault();
      restore(type === 'historyRedo' ? history.current?.redo() : history.current?.undo());
      return;
    }
    /* A software keyboard's Enter arrives here without a keydown the page can read (key 229):
       its send key sends. Shift+Enter is a line break, and passes. */
    if (type === 'insertParagraph' && !event.isComposing) {
      event.preventDefault();
      latest.current.onSubmit();
      return;
    }
    pendingEdit.current = type.startsWith('delete') ? 'delete' : type === 'insertFromDrop' ? 'insert' : 'type';
  };

  /* React's synthetic `onBeforeInput` is a legacy polyfill without `inputType`; listen natively. */
  const onBeforeInputRef = useRef(onBeforeInput);
  useLayoutEffect(() => {
    onBeforeInputRef.current = onBeforeInput;
  });
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const listener = (event: Event) => onBeforeInputRef.current(event as InputEvent);
    root.addEventListener('beforeinput', listener);
    return () => root.removeEventListener('beforeinput', listener);
  }, []);

  const onInput = () => {
    const root = rootRef.current;
    if (!root) return;
    const pieces = readPieces(root);
    if (composing.current) {
      /* Mid-composition the DOM is the input method's; read it, touch nothing. */
      publish(pieces);
      return;
    }
    const at = caretOf(root) ?? totalUnits(pieces);
    const value = needsFlattening(root) ? apply(pieces, at, true) : publish(pieces);
    caret.current = at;
    history.current?.record({ value, caret: at }, pendingEdit.current, Date.now());
    pendingEdit.current = 'type';
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const data = event.clipboardData;
    const own = data.getData(MIME);
    const plain = (own || data.getData('text/plain')).replace(/\r\n?/g, '\n');
    if (plain) insertPieces(parseComposerValue(plain));
  };

  const copySelection = (event: ClipboardEvent<HTMLDivElement>, cut: boolean) => {
    const selection = window.getSelection();
    const root = rootRef.current;
    if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;
    const holder = document.createElement('div');
    holder.appendChild(range.cloneContents());
    const pieces = readPieces(holder);
    event.preventDefault();
    /* Readable text for anywhere else; the markers themselves for a paste back in here. */
    event.clipboardData.setData('text/plain', readablePieces(pieces));
    event.clipboardData.setData(MIME, serializePieces(pieces));
    if (cut) {
      range.deleteContents();
      pendingEdit.current = 'delete';
      onInput();
    }
  };

  return (
    <div className="m3-field" data-size="sm" data-multiline="">
      <div
        ref={rootRef}
        id={id}
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        aria-placeholder={placeholder}
        tabIndex={0}
        enterKeyHint="send"
        inputMode="text"
        suppressContentEditableWarning
        onKeyDown={onKeyDown}
        onInput={onInput}
        onPaste={onPaste}
        onCopy={(event) => copySelection(event, false)}
        onCut={(event) => copySelection(event, true)}
        onDrop={(event) => {
          /* Text may be dropped in; a file never becomes part of a message. */
          if (event.dataTransfer.files.length) event.preventDefault();
        }}
        onFocus={() => onFocus?.()}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
          pendingEdit.current = 'type';
          onInput();
        }}
        /* The field's own control: the shell's fieldset draws its ring and, under forced
           colors, its boundary, exactly as for the native inputs — so the element itself
           shows no outline in either mode. */
        className="popover-scrollbar relative z-10 max-h-40 min-w-0 flex-1 overflow-y-auto whitespace-pre-wrap px-4 py-2.5 text-body-l text-on-surface outline-hidden wrap-anywhere"
      />
      {empty && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-2.5 left-4 z-10 truncate text-body-l text-on-surface-variant"
        >
          {placeholder}
        </span>
      )}
      <fieldset aria-hidden="true" />
    </div>
  );
});

export default ChatComposer;
