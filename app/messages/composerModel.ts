import { EMOJI_BY_NAME, emojiMarker } from './messageText';

/*
 * The composer's value, as the pieces the editable field holds: runs of text and pony emoji.
 *
 * **The field shows the picture; the wire carries the marker.** A picked emoji used to land in
 * a textarea as the raw token `$emoji_applehorror$`. The composer is now an editable box holding
 * the emoji itself as an inline image, and this module is the one translation between what it
 * holds and the `$emoji_<name>$` text a message is sent as — the format this front end has
 * always sent and its renderer draws. Pure, so it is tested without a DOM.
 *
 * An offset into a value counts a text character (a UTF-16 unit) as one and an emoji as one —
 * the same unit the caret moves by in the field.
 */

export type ComposerPiece = { type: 'text'; text: string } | { type: 'emoji'; name: string };

const MARKER = /(\$emoji_[a-zA-Z0-9_]+\$)/;
const MARKER_NAME = /^\$emoji_([a-zA-Z0-9_]+)\$$/;

/** A serialised value into pieces. A marker naming no known picture stays text. */
export function parseComposerValue(value: string): ComposerPiece[] {
  const pieces: ComposerPiece[] = [];
  for (const part of value.split(MARKER)) {
    if (!part) continue;
    const name = MARKER_NAME.exec(part)?.[1];
    if (name && EMOJI_BY_NAME.has(name)) pieces.push({ type: 'emoji', name });
    else appendText(pieces, part);
  }
  return pieces;
}

function appendText(pieces: ComposerPiece[], text: string) {
  const last = pieces[pieces.length - 1];
  if (last?.type === 'text') last.text += text;
  else pieces.push({ type: 'text', text });
}

/** Pieces back into the wire format. */
export function serializePieces(pieces: readonly ComposerPiece[]): string {
  return pieces.map((piece) => (piece.type === 'text' ? piece.text : emojiMarker(piece.name))).join('');
}

/** What a person reads: an emoji as its name in brackets — the clipboard's plain text. */
export function readablePieces(pieces: readonly ComposerPiece[]): string {
  return pieces
    .map((piece) => (piece.type === 'text' ? piece.text : `[${EMOJI_BY_NAME.get(piece.name)?.label ?? piece.name}]`))
    .join('');
}

/** Whether a value would send nothing: only whitespace, and no picture. */
export function isBlankValue(value: string): boolean {
  return value.trim() === '';
}

/** A value ready to send: surrounding whitespace dropped, line breaks inside kept. */
export function outgoingValue(value: string): string {
  return value.replace(/^\s+|\s+$/g, '');
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

export interface ComposerSnapshot {
  value: string;
  /** The caret, in piece units (see the module note). */
  caret: number;
}

export type ComposerEdit = 'type' | 'delete' | 'insert';

/**
 * The composer's own undo history.
 *
 * An editable box's native undo only knows the edits the browser made itself. An emoji is
 * inserted by the page, so the native stack either skipped it or undid the wrong characters
 * around it; this one records every change — typing and deleting coalesced into bursts, as a
 * text field does, an insertion (emoji, paste) always its own step — and the field routes
 * undo and redo here.
 */
export function createComposerHistory(initial: ComposerSnapshot, limit = 100) {
  let stack: ComposerSnapshot[] = [initial];
  let index = 0;
  let lastKind: ComposerEdit | null = null;
  let lastAt = 0;
  const COALESCE_MS = 1000;

  return {
    /** Record the state after an edit. */
    record(snapshot: ComposerSnapshot, kind: ComposerEdit, now: number) {
      if (snapshot.value === stack[index].value) {
        stack[index] = snapshot;
        return;
      }
      const burst = kind !== 'insert' && kind === lastKind && now - lastAt < COALESCE_MS && index === stack.length - 1 && index > 0;
      stack = stack.slice(0, index + 1);
      if (burst) stack[index] = snapshot;
      else {
        stack.push(snapshot);
        if (stack.length > limit) stack.shift();
        index = stack.length - 1;
      }
      lastKind = kind;
      lastAt = now;
    },
    undo(): ComposerSnapshot | null {
      if (index === 0) return null;
      index -= 1;
      lastKind = null;
      return stack[index];
    },
    redo(): ComposerSnapshot | null {
      if (index >= stack.length - 1) return null;
      index += 1;
      lastKind = null;
      return stack[index];
    },
    /** Start over from `snapshot` — a sent message, a restored draft. */
    reset(snapshot: ComposerSnapshot) {
      stack = [snapshot];
      index = 0;
      lastKind = null;
    },
  };
}

export type ComposerHistory = ReturnType<typeof createComposerHistory>;
