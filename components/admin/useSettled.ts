'use client';

import { useEffect, useState } from 'react';

/**
 * `value`, once it has stopped changing for `ms` — what a typing-driven read keys on, so a word
 * typed a letter at a time costs one request rather than one per keystroke. `ms` 0 settles at
 * once (clearing a search should show everything without waiting).
 */
export function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (Object.is(settled, value)) return;
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms, settled]);
  return ms <= 0 ? value : settled;
}
