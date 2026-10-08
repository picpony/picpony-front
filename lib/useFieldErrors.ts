'use client';

import { useRef, useState } from 'react';
import { collectErrors } from './validation';

type Rules<F extends string> = () => ReadonlyArray<readonly [F, string | null]>;

/**
 * A form's field errors, shown in each field's own supporting line (`Input`'s `error`) rather than
 * in a toast away from the field or the browser's own bubble — the forms are `noValidate`.
 *
 * Checked on submit, which focuses the first field at fault; after that attempt a field is checked
 * again when it loses focus, and an error clears as soon as its field is edited. A server's answer
 * about one field (a name already taken, a wrong code) goes through `set`.
 *
 *     const form = useFieldErrors<'name'>(() => [['name', validateUsername(name)]]);
 *     <Input {...form.field('name')} onChange={(e) => { setName(e.target.value); form.clear('name'); }} />
 *     const submit = () => { if (!form.check()) return; … };
 *
 * The sign-in dialog uses it too; its private copy drifted from this one (review P2-F8).
 */
export function useFieldErrors<F extends string>(rules: Rules<F>) {
  const [errors, setErrors] = useState<Partial<Record<F, string>>>({});
  const [attempted, setAttempted] = useState(false);
  const targets = useRef<Partial<Record<F, HTMLElement | null>>>({});

  const recheck = (field: F) => {
    const message = rules().find(([name]) => name === field)?.[1] ?? undefined;
    setErrors((prev) => (prev[field] === message ? prev : { ...prev, [field]: message }));
  };

  return {
    errors,
    /** Props for the field: its error, where focus goes, and the re-check on blur. */
    field(field: F) {
      return {
        ref: (element: HTMLElement | null) => {
          targets.current[field] = element;
        },
        error: errors[field],
        onBlur: () => {
          if (attempted) recheck(field);
        },
      };
    },
    clear(field: F) {
      setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
    },
    /** Validate everything; false — with the first bad field focused — if anything failed. */
    check(): boolean {
      const { errors: next, first } = collectErrors(rules());
      setAttempted(true);
      setErrors(next);
      if (first) focusField(targets.current[first]);
      return first === null;
    },
    /** A server's answer about one field. */
    set(field: F, message: string) {
      setErrors((prev) => ({ ...prev, [field]: message }));
      focusField(targets.current[field]);
    },
    /** Forget everything — a dialog opening again starts clean. */
    reset() {
      setErrors({});
      setAttempted(false);
    },
  };
}

/** A code row is a group of boxes: focus lands on its first empty one. */
export function focusField(target: HTMLElement | null | undefined) {
  if (!target) return;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    target.focus();
    return;
  }
  const boxes = Array.from(target.querySelectorAll<HTMLInputElement>('input'));
  (boxes.find((box) => !box.value) ?? boxes.at(-1))?.focus();
}
