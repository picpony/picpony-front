'use client';

import { useRef, type CSSProperties, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { useOverlayScrollbar, type ScrollbarAutoHide, type ScrollbarAxis } from '@/lib/overlayScrollbar';
import { cn } from '@/lib/utils';

type ScrollAreaTag = 'div' | 'main' | 'p' | 'pre';

type TagElement<T extends ScrollAreaTag> = T extends 'main'
  ? HTMLElement
  : T extends 'p'
    ? HTMLParagraphElement
    : T extends 'pre'
      ? HTMLPreElement
      : HTMLDivElement;

type DataAttributes = {
  [key: `data-${string}`]: string | number | boolean | undefined;
};

export interface ScrollAreaProps<T extends ScrollAreaTag = 'div'> {
  /** Tag name of the actual scrolling viewport element. Defaults to `'div'`. */
  as?: T;
  /** Scrollable axis managed by OverlayScrollbars. Defaults to `'y'`. */
  axis?: ScrollbarAxis;
  /** Auto-hide mode; `'auto'` uses `'leave'` for fine pointers and `'scroll'` for touch. */
  autoHide?: ScrollbarAutoHide;
  /** Override whether auto-hide stays suspended until first scroll on fine pointers. */
  autoHideSuspend?: boolean;
  /** Defer OverlayScrollbars attachment until idle, hover or first scroll. */
  defer?: boolean;
  /** When false, renders only the viewport element without a slot wrapper or pseudo-scrollbar. */
  enabled?: boolean;
  /** Classes for the outer non-scrolling slot wrapper (sizing, flex, positioning). */
  className?: string;
  /** Inline style for the outer slot wrapper. */
  style?: CSSProperties;
  /** Extra attributes on the outer slot wrapper. */
  slotProps?: HTMLAttributes<HTMLDivElement> & DataAttributes;
  /** Ref forwarded directly to the real scrolling viewport element. */
  viewportRef?: Ref<TagElement<T>>;
  /** Classes applied directly to the real scrolling viewport element. */
  viewportClassName?: string;
  /** Inline style applied directly to the real scrolling viewport element. */
  viewportStyle?: CSSProperties;
  /** Attributes and event listeners applied directly to the real scrolling viewport element. */
  viewportProps?: Omit<HTMLAttributes<TagElement<T>>, 'className' | 'style'> & DataAttributes;
  children?: ReactNode;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') {
    ref(value);
  } else if (ref && 'current' in ref) {
    (ref as { current: T | null }).current = value;
  }
}

/**
 * Scroll container with OverlayScrollbars floating pseudo-scrollbars.
 *
 * Keeps the real scrolling viewport as a React-owned element so existing refs,
 * `scrollTop` reads/writes, `ScrollTimeline` tracks, `data-app-scroll-container`
 * lookups and Hero selectors stay on one node while `.os-scrollbar` tracks mount
 * inside the surrounding non-scrolling `.os-slot` wrapper.
 */
export default function ScrollArea<T extends ScrollAreaTag = 'div'>({
  as,
  axis = 'y',
  autoHide = 'auto',
  autoHideSuspend,
  defer = false,
  enabled = true,
  className,
  style,
  slotProps,
  viewportRef,
  viewportClassName,
  viewportStyle,
  viewportProps,
  children,
}: ScrollAreaProps<T>) {
  const slotRef = useRef<HTMLDivElement>(null);
  const localViewportRef = useRef<HTMLElement | null>(null);

  useOverlayScrollbar(localViewportRef, slotRef, {
    axis,
    autoHide,
    autoHideSuspend,
    defer,
    enabled,
  });

  const assignViewportRef = (node: HTMLElement | null) => {
    localViewportRef.current = node;
    assignRef(viewportRef, node as TagElement<T> | null);
  };

  const Tag = (as ?? 'div') as 'div';

  if (!enabled) {
    return (
      <Tag
        ref={assignViewportRef}
        className={viewportClassName}
        style={viewportStyle}
        {...(viewportProps as HTMLAttributes<HTMLDivElement>)}
      >
        {children}
      </Tag>
    );
  }

  return (
    <div ref={slotRef} className={cn('os-slot', className)} style={style} {...slotProps}>
      <Tag
        ref={assignViewportRef}
        data-os-axis={axis}
        className={viewportClassName}
        style={viewportStyle}
        {...(viewportProps as HTMLAttributes<HTMLDivElement>)}
      >
        {children}
      </Tag>
    </div>
  );
}
