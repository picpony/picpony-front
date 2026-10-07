'use client';

import { useId, useState } from 'react';
import { ColorSwatch, Input } from '@/components/Input';

const HEX = /^#[\da-f]{6}$/i;

/** A `#RRGGBB` colour — the only form `ColorSwatch` (the OS picker) speaks and a badge stores. */
export function isHexColor(value: string): boolean {
  return HEX.test(value.trim());
}

/**
 * A badge's colour in a console form (R9-039): the OS swatch beside a labelled outlined hex field,
 * one field family with the form around it. It was a caption `<p>`, the swatch and an unlabelled
 * filled field — three label systems in one row.
 *
 * The two stay in step both ways; while the typed value is not a colour yet, the swatch keeps the
 * last one that was.
 */
export default function ColorField({
  label,
  value,
  onChange,
  disabled,
  error,
  helper,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: string;
  helper?: string;
}) {
  const fieldId = useId();
  /* The swatch can only show a colour; while the typed value is half-written it holds the last
     complete one (a render-phase update, so it never lags a frame). */
  const typed = isHexColor(value) ? value.trim().toLowerCase() : null;
  const [lastColour, setLastColour] = useState(typed ?? '#000000');
  if (typed && typed !== lastColour) setLastColour(typed);
  return (
    <div className="flex items-start gap-3">
      <ColorSwatch
        aria-label={`${label}（取色）`}
        value={typed ?? lastColour}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      <Input
        id={fieldId}
        label={label}
        value={value}
        disabled={disabled}
        error={error}
        helper={error ? undefined : helper}
        spellCheck={false}
        autoComplete="off"
        className="font-mono"
        fieldClassName="min-w-0 flex-1"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
