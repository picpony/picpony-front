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
 * M3 has no component for this — a row of single-character boxes is a convention
 * rather than a spec'd control — so the thing that matters is that it wears the
 * *text field's* vocabulary rather than inventing a second one. It takes the
 * field's 12dp corner, its `outline` boundary, and its focus indicator: the
 * outline thickening to 2dp in `primary`, with no ring beside it. Before this
 * existed the row carried an 8dp corner (the chip's step, not a field's) and
 * *both* indicators at once — a border colour change and a 2px ring around it —
 * which made it the one control in the app that announced the keyboard's position
 * twice.
 *
 * It lived inline in `AuthModal` with its own `useRef` array and four handlers.
 * That is the shape of thing that gets copied the moment a second flow needs a
 * code, and copied without the parts that are easy to forget:
 *
 * - **Paste fills the row.** Pasting a six-digit code into the first box must
 *   distribute it, not put six characters in one field and truncate to one.
 * - **Backspace on an empty box steps back** *and* clears the box it lands on,
 *   which is what makes holding backspace erase the code rather than stall.
 * - **Arrow keys move between boxes**, which the inline version did not do at
 *   all — the only way back to an earlier digit was the mouse or backspace.
 * - **Focus selects**, so typing over a filled box replaces rather than appends.
 * - `autoComplete="one-time-code"` lets the platform offer the code from an SMS
 *   or an authenticator, which is the single biggest thing this row can do for a
 *   user on a phone.
 *
 * The value is one string rather than an array of characters. The array version
 * meant every caller reassembled it with `.join('')` to test the length and to
 * submit, and `codeDigits.join('').length !== 6` was already written twice.
 *
 * The string is **left-packed**: there is no way to represent a hole, because
 * clearing a digit closes up behind it. That is both what every real OTP field
 * does and what makes `value.length === length` a sound test for "complete" —
 * with holes allowed, a six-character value can still be missing a digit, and
 * every caller has to know that.
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

  /* On mount only: land on the first empty box, which is the first one unless the
     value arrived prefilled. Deliberately not reactive — moving focus whenever
     the value changes would fight the per-keystroke advance below. */
  useEffect(() => {
    if (!autoFocus || disabled) return;
    boxes.current[Math.min(value.length, length - 1)]?.focus();
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
      boxes.current[index - 1]?.focus();
      setAt(index - 1, '');
      return;
    }
    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      boxes.current[index - 1]?.focus();
    }
    if (event.key === 'ArrowRight' && index < length - 1) {
      event.preventDefault();
      boxes.current[index + 1]?.focus();
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>, index: number) => {
    event.preventDefault();
    const pasted = clean(event.clipboardData.getData('text'));
    if (!pasted) return;
    /* A full-length paste fills from the start whichever box it landed in — the
       user pasted "the code", not "the code from here on". A partial one inserts
       where they are. */
    const start = pasted.length >= length ? 0 : index;
    const arr = value.split('');
    for (let i = 0; i < pasted.length && start + i < length; i += 1) arr[start + i] = pasted[i];
    commit(arr.join(''));
    boxes.current[Math.min(start + pasted.length, length - 1)]?.focus();
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
          autoComplete="one-time-code"
          maxLength={1}
          value={digit}
          disabled={disabled}
          aria-label={`${ariaLabel} 第 ${i + 1} 位，共 ${length} 位`}
          onFocus={(event) => event.target.select()}
          onChange={(event) => {
            const typed = clean(event.target.value);
            if (!typed) {
              setAt(i, '');
              return;
            }
            /* A key press on a filled box replaces it (`onFocus` selected the
               contents), and the browser hands us the whole new value — take its
               last character so an unselected append still reads as a replace. */
            setAt(i, typed.slice(-1));
            if (i < length - 1) boxes.current[i + 1]?.focus();
          }}
          onKeyDown={(event) => onKeyDown(event, i)}
          onPaste={(event) => onPaste(event, i)}
          /* The text field's own language, and now literally its own numbers: 4dp
             (`OutlinedTextFieldTokens.ContainerShape`), 56dp (`ContainerHeight`), an
             `outline` boundary, and that outline thickening to 2dp `primary` on
             focus as the only indicator. It read 12dp/48dp, both of which the field
             itself has since corrected.
             No container fill: an outlined field has none, and
             `bg-surface-container-lowest` here was adding one the language it claims
             to speak does not have — visible as six pale plates on any surface step
             darker than the page. */
          className={cn(
            'text-title-m-emphasized h-14 w-10 rounded-xs border border-outline text-center sm:w-11',
            'text-on-surface outline-none',
            'transition-[border-color,border-width] duration-200 ease-[var(--ease-standard)]',
            'focus:border-2 focus:border-primary',
            'disabled:cursor-not-allowed disabled:disabled-content',
          )}
        />
      ))}
    </div>
  );
}
