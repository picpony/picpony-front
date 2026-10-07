'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { springTiming } from '@/lib/springTiming';

/**
 * A tag's name arriving where something else stood — its placeholder, or the tag itself when the
 * dictionary answered after its wait ran out: the new name fades in on FastEffects instead of
 * replacing it in a frame (M1-017). Never on mount (a name known at once is simply there), and the
 * element is the same throughout, so the line keeps its box and nothing beside it moves.
 *
 * `name` is what identifies the content: `undefined` while the name is still being asked for.
 */
export default function NameFade({
  name,
  as: Tag = 'span',
  className,
  children,
}: {
  name: string | undefined;
  as?: 'span' | 'div';
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const shown = useRef(name);
  useLayoutEffect(() => {
    if (shown.current === name) return;
    shown.current = name;
    if (name === undefined) return;
    ref.current?.animate([{ opacity: 0 }, { opacity: 1 }], springTiming('fastEffects'));
  }, [name]);
  return (
    <Tag ref={ref as React.RefObject<HTMLDivElement & HTMLSpanElement>} className={className}>
      {children}
    </Tag>
  );
}
