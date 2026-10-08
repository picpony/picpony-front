'use client';

import type { FormEvent, ReactNode } from 'react';
import { MdWarning } from 'react-icons/md';
import Card from '@/components/Card';
import { ICON } from '@/lib/icons';
import { cn } from '@/lib/utils';

/**
 * The console's form: a real `<form>`, so Enter in any field submits it (the submit `Button` takes
 * `type="submit"`; every other button in it takes `type="button"`). A column of labelled outlined
 * fields — one field family (R9-039) — capped at the form column's `2xl`, because a 900px field is
 * harder to fill in than a 560px one (AGENTS "a block inside a column is not a column").
 *
 * **No card around it.** A form wrapped in a padded surface started 16px in from its panel's
 * header while the lists beside it started flush; a form is separated by spacing.
 *
 * A busy submit is `Button loading`: it keeps focus and blocks activation, and implicit submission
 * from a field goes through the same blocked click, so a second Enter cannot send twice.
 */
const HAS_MAX_WIDTH = /(?:^|\s)max-w-\S+/;

export function AdminForm({
  id,
  onSubmit,
  children,
  className = '',
  'aria-label': ariaLabel,
  'aria-labelledby': labelledBy,
}: {
  /** For a submit button outside the form — a dialog footer's — which names it with `form={id}`. */
  id?: string;
  onSubmit: () => void;
  children: ReactNode;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };
  /* The column cap stands down when the call site names its own (a dialog's form takes the
     dialog's width): `cn` is a plain join, so emitting both would leave the winner to the
     stylesheet's order. */
  const capped = !HAS_MAX_WIDTH.test(className);
  return (
    <form
      id={id}
      noValidate
      onSubmit={submit}
      aria-label={ariaLabel}
      aria-labelledby={labelledBy}
      className={cn('@container/form w-full space-y-4', capped && 'max-w-2xl', className)}
    >
      {children}
    </form>
  );
}

/** Two fields side by side once the form has room for both labels (32rem), one above the other below it. */
export function FormGrid({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-1 gap-4 @lg/form:grid-cols-2', className)}>{children}</div>;
}

/** The form's action row, at its trailing edge — where a dialog's actions sit. */
export function FormActions({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-center justify-end gap-3', className)}>{children}</div>;
}

/**
 * A panel's explanatory note — one short paragraph on what the section does. `warning` is for the
 * one note that is a caution about the section's own use (the message audit's privacy rule): the
 * same surface with a leading glyph in the error ink, so the caution does not need a second
 * container recipe.
 */
export function AdminNote({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'warning' }) {
  return (
    <Card variant="filled" padding="sm" className="flex items-start gap-2 text-body-s text-on-surface-variant">
      {tone === 'warning' && (
        <MdWarning size={ICON.dense} aria-hidden="true" className="mt-0.5 shrink-0 text-error" />
      )}
      <p className="min-w-0">{children}</p>
    </Card>
  );
}
