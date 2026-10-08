'use client';

/**
 * A selection mode over a list of ids — the favourites' batch mode, on pictures and on folders.
 *
 * - **Entering**: a 选择 command, or a long press under a finger on a card (which arrives selected).
 * - **Toggling**: a card's press, tap, Enter or Space; Shift extends from the last one toggled
 *   through the list's own order.
 * - **Leaving**: the bar's ✕, Escape, and Back — the mode owns a history layer
 *   (`useHistoryLayer`), so the system gesture peels it before it leaves the page (decision 1).
 *   Escape is ignored while a dialog is up (the dialog's own) and in a field.
 * - **Focus** after leaving lands on what the caller names (`restoreFocus`) when the element that
 *   had it went with the mode (a card's checkbox, the bar).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHistoryLayer } from '@/lib/historyLayers';
import { escapeMeansBack } from '@/lib/hooks';
import { hasModalLayer } from '@/lib/overlay';
import { TOUCH_SLOP_PX } from '@/lib/ripple';

export interface SelectionMode {
  active: boolean;
  selected: ReadonlySet<number>;
  count: number;
  /** Turn the mode on, optionally with one id selected. */
  enter: (id?: number) => void;
  exit: () => void;
  /** Toggle one id; `range` extends from the last toggled through `order`. Stable. */
  toggle: (id: number, range: boolean) => void;
  /** Select (or deselect) these ids together — 全选. */
  setMany: (ids: readonly number[], on: boolean) => void;
  /** Drop ids that no longer exist (moved, removed), keeping the mode. */
  forget: (ids: readonly number[]) => void;
}

interface State {
  active: boolean;
  selected: Set<number>;
  anchor: number | null;
}

const OFF: State = { active: false, selected: new Set(), anchor: null };

export function useSelectionMode({
  order,
  restoreFocus,
}: {
  /** The list's ids, in its order — what a Shift range runs through. */
  order: readonly number[];
  /** Where focus goes when the mode ends and took the focused element with it. */
  restoreFocus?: () => HTMLElement | null | undefined;
}): SelectionMode {
  const [state, setState] = useState<State>(OFF);
  const latest = useRef({ order, restoreFocus });
  useEffect(() => {
    latest.current = { order, restoreFocus };
  });

  const enter = useCallback((id?: number) => {
    setState((current) => {
      const selected = new Set(current.active ? current.selected : []);
      if (id !== undefined) selected.add(id);
      return { active: true, selected, anchor: id ?? current.anchor };
    });
  }, []);

  const exit = useCallback(() => {
    setState((current) => (current.active ? OFF : current));
  }, []);

  const toggle = useCallback((id: number, range: boolean) => {
    setState((current) => {
      const selected = new Set(current.selected);
      const ids = latest.current.order;
      if (range && current.anchor !== null && ids.includes(current.anchor) && ids.includes(id)) {
        const [from, to] = [ids.indexOf(current.anchor), ids.indexOf(id)].sort((a, b) => a - b);
        const on = current.selected.has(current.anchor);
        for (const each of ids.slice(from, to + 1)) {
          if (on) selected.add(each);
          else selected.delete(each);
        }
      } else if (selected.has(id)) {
        selected.delete(id);
      } else {
        selected.add(id);
      }
      return { active: true, selected, anchor: id };
    });
  }, []);

  const setMany = useCallback((ids: readonly number[], on: boolean) => {
    setState((current) => {
      const selected = new Set(current.selected);
      for (const id of ids) {
        if (on) selected.add(id);
        else selected.delete(id);
      }
      return { ...current, active: true, selected };
    });
  }, []);

  const forget = useCallback((ids: readonly number[]) => {
    setState((current) => {
      if (!ids.some((id) => current.selected.has(id))) return current;
      const selected = new Set(current.selected);
      for (const id of ids) selected.delete(id);
      return { ...current, selected };
    });
  }, []);

  /* Back peels the mode before it leaves the page. */
  useHistoryLayer(state.active, exit);

  /* Escape leaves the mode — unless a dialog is up (it is the dialog's) or the user is typing. */
  useEffect(() => {
    if (!state.active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!escapeMeansBack(event) || hasModalLayer()) return;
      event.preventDefault();
      exit();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state.active, exit]);

  /* Leaving took the focused element away (a checkbox, the bar): hand focus to the caller's choice. */
  const wasActive = useRef(false);
  useEffect(() => {
    if (state.active) {
      wasActive.current = true;
      return;
    }
    if (!wasActive.current) return;
    wasActive.current = false;
    const focused = document.activeElement;
    if (focused && focused !== document.body && focused.isConnected && !focused.closest('[inert]')) return;
    latest.current.restoreFocus?.()?.focus({ preventScroll: true });
  }, [state.active]);

  return useMemo(
    () => ({
      active: state.active,
      selected: state.selected,
      count: state.selected.size,
      enter,
      exit,
      toggle,
      setMany,
      forget,
    }),
    [state, enter, exit, toggle, setMany, forget],
  );
}

/** A folder link's long press, while ordinary activation stays a link. */
export function useFolderLongPress(onSelect: (() => void) | undefined) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);
  return {
    onPointerDown: (event: React.PointerEvent) => {
      cancel();
      fired.current = false;
      if (!onSelect || event.pointerType !== 'touch' || !event.isPrimary) return;
      start.current = { x: event.clientX, y: event.clientY };
      timer.current = setTimeout(() => { timer.current = null; fired.current = true; onSelect(); }, 500);
    },
    onPointerMove: (event: React.PointerEvent) => {
      if (start.current && Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > TOUCH_SLOP_PX) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onClickCapture: (event: React.MouseEvent) => {
      if (!fired.current) return;
      fired.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    onContextMenu: (event: React.MouseEvent) => { if (fired.current || start.current) event.preventDefault(); },
  };
}
