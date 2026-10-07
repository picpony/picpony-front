'use client';

import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';

interface CodeInputProps {
  /** The code so far, shorter than `length` while it is being typed. */
  value: string;
  onChange: (value: string) => void;
  /** How many characters. 6 covers every one-time code this app sends. */
  length?: number;
  /** Fires once the last box is filled, so the caller need not watch the length. */
  onComplete?: (value: string) => void;
  /** Focus the first empty box on mount. */
  autoFocus?: boolean;
  disabled?: boolean;
  /** Names the group. Each box announces its own position within it. */
  'aria-label'?: string;
  className?: string;
}

/** Only digits: every code this app issues is numeric. */
const clean = (raw: string) => raw.replace(/\D/g, '');

/**
 * A one-time-code field.
 *
 * M3 has no component for this, so the thing that matters is that it wears the
 * *text field's* vocabulary rather than inventing a second one: the field's
 * 4dp corner, its `outline` boundary, and its focus indicator (the outline
 * thickening to 2dp `primary`, with no ring beside it).
 *
 * The parts easy to forget, all handled here:
 *
 * - **Paste and autofill fill the row** — a full-length code distributes from the
 *   start whichever box it landed in; a partial one inserts where you are.
 * - **Backspace on an empty box steps back** *and* clears the box it lands on.
 * - **Arrow keys move between boxes**; **focus selects**, so typing over a
 *   filled box replaces rather than appends.
 * - `autoComplete="one-time-code"` lets the platform offer the code from an SMS
 *   or authenticator — the single biggest thing this row can do on a phone.
 *
 * The value is one string rather than an array of characters, **left-packed**:
 * clearing a digit closes up behind it, which is both what every real OTP field
 * does and what makes `value.length === length` a sound test for "complete".
 */
export default function CodeInput({
  value,
  onChange,
  length = 6,
  onComplete,
  autoFocus = false,
  disabled = false,
  'aria-label': ariaLabel = '验证码',
  className = '',
}: CodeInputProps) {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');
  /* True while this component moves focus itself. `focus()` fires the box's `onFocus`
     synchronously, before the parent has re-rendered with the keystroke's value, so that
     handler still sees the value from before it. It took the box just advanced to for one
     past the first empty box, sent focus back, and the next key overwrote the digit before:
     typing 123456 at a human pace left 246. A move this component makes lands where the
     value is about to be. Only a focus from the user is redirected. */
  const steering = useRef(false);
  const focusBox = (index: number) => {
    steering.current = true;
    try {
      boxes.current[index]?.focus();
    } finally {
      steering.current = false;
    }
  };

  /* On mount only: land on the first empty box, which is the first one unless the
     value arrived prefilled. Deliberately not reactive — moving focus whenever
     the value changes would fight the per-keystroke advance below. */
  useEffect(() => {
    if (!autoFocus || disabled) return;
    focusBox(Math.min(value.length, length - 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = (next: string) => {
    const trimmed = next.slice(0, length);
    onChange(trimmed);
    if (trimmed.length === length) onComplete?.(trimmed);
  };

  /** Replace box `index`, or — with an empty `char` — remove it and close up. */
  const setAt = (index: number, char: string) => {
    const arr = value.split('');
    if (char) arr[index] = char;
    else arr.splice(index, 1);
    // `join` renders a gap left by writing past the end as nothing, so the
    // result is always left-packed without a separate pass.
    commit(arr.join(''));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (event.key === 'Backspace') {
      if (digits[index]) return; // the box has something to delete itself
      event.preventDefault();
      if (index === 0) return;
      focusBox(index - 1);
      setAt(index - 1, '');
      return;
    }
    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      focusBox(index - 1);
    }
    if (event.key === 'ArrowRight' && index < length - 1) {
      event.preventDefault();
      focusBox(index + 1);
    }
  };

  /** Several digits at once, landing in box `index`: spread them across the row. */
  const fill = (digitsIn: string, index: number) => {
    /* A full-length run fills from the start whichever box it landed in — the user
       gave "the code", not "the code from here on". A partial one inserts where they
       are, never past the first empty box (the value is left-packed). */
    const start = digitsIn.length >= length ? 0 : Math.min(index, value.length);
    const arr = value.split('');
    for (let i = 0; i < digitsIn.length && start + i < length; i += 1) arr[start + i] = digitsIn[i];
    commit(arr.join(''));
    focusBox(Math.min(start + digitsIn.length, length - 1));
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>, index: number) => {
    event.preventDefault();
    const pasted = clean(event.clipboardData.getData('text'));
    if (pasted) fill(pasted, index);
  };

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('flex items-center justify-center gap-2 sm:gap-3', className)}
    >
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            boxes.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          /* No `maxLength`. The platform's one-time-code autofill (iOS from Messages
             and Mail, Android from SMS) writes the *whole* code into the focused box,
             and a one-character limit cut it to its first digit. */
          autoComplete="one-time-code"
          value={digit}
          disabled={disabled}
          aria-label={`${ariaLabel} 第 ${i + 1} 位，共 ${length} 位`}
          onFocus={(event) => {
            /* The value is left-packed, so a box past the first empty one has nothing
               to edit: typing there wrote into that first empty box while the caret
               stayed where it was. Land on the first empty box instead — for a focus the
               user gave, never for this component's own advance (`steering`). */
            if (!steering.current && i > value.length) {
              focusBox(value.length);
              return;
            }
            event.target.select();
          }}
          onChange={(event) => {
            const typed = clean(event.target.value);
            if (!typed) {
              setAt(i, '');
              return;
            }
            const own = digits[i];
            if (typed.length >= length) {
              /* A whole code: autofill writes it into the focused box, over that box's
                 digit (selected on focus) or after it. */
              fill(typed.length > length && own && typed.startsWith(own) ? typed.slice(own.length) : typed, i);
              return;
            }
            /* A key press on a filled box replaces it (`onFocus` selected the
               contents); an append the caret was not over reads the same. */
            const appended = own && typed.length > 1 && typed.startsWith(own) ? typed.slice(own.length) : typed;
            if (appended.length <= 1) {
              setAt(i, (appended || typed).slice(-1));
              if (i < length - 1) focusBox(i + 1);
              return;
            }
            // Several digits at once: autofill, a keyboard's suggestion, an IME commit.
            fill(appended, i);
          }}
          onKeyDown={(event) => onKeyDown(event, i)}
          onPaste={(event) => onPaste(event, i)}
          /* The text field's own language: 4dp corner, 56dp height, an `outline`
             boundary, and that outline thickening to 2dp `primary` on focus as
             the only indicator. No container fill — an outlined field has none,
             and a fill here shows as six pale plates on any darker surface. */
          className={cn(
            // Native fields have an intrinsic width floor; release it so all
            // six boxes still fit inside a narrow dialog's content column.
            'text-title-m-emphasized h-14 w-10 min-w-0 rounded-xs border border-outline text-center tabular-nums sm:w-11',
            'text-on-surface focus-visible:outline-hidden',
            'spring-fast-effects transition-[border-color]',
            'focus:border-2 focus:border-primary-ink',
            'disabled:cursor-not-allowed disabled:disabled-content',
          )}
        />
      ))}
    </div>
  );
}
