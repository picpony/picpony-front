'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { showToast } from '@/components/Toast';
import { apiErrorMessage } from '@/lib/api/errors';
import { deleteBrowsingHistoryItem, restoreBrowsingHistoryItem, type HistoryEntry } from '@/lib/api/history';
import { readToken } from '@/lib/hooks';
import { browsingHistory } from '@/lib/resources';

/**
 * How long a deleted row waits for 撤销 before its delete is sent. Longer than the toast's own
 * four seconds, so 撤销 works for as long as the toast offers it.
 */
export const UNDO_WINDOW_MS = 6000;

interface Held {
  entry: HistoryEntry;
  token: string;
}

/**
 * Deleting a 浏览历史 row the way a native list does (R5-027): the row leaves at once, the toast
 * offers 撤销, and the delete goes out only when the window closes — so 撤销 puts the row back
 * exactly where it was, at its own time, rather than re-adding it as a fresh view.
 *
 * - **Held deletes are sent, never dropped**: when the window closes, when the screen unmounts
 *   (another page, a sign-out remount), and when the page itself goes away (`pagehide`, sent with
 *   `keepalive`). A late 撤销 — after the send — puts the rows back through the detail's own
 *   write (`add_browsing_history`), which is the only way back the backend has.
 * - **The page back-fills.** After a send the current page is corrected in place, every other
 *   page is dropped (they all shifted), and the current one is re-read underneath what it shows,
 *   so the next page's first rows move up instead of the list shrinking.
 * - A delete the server refused comes back, with the reason.
 * - **撤销 hands the focus back to the list** (`onRestored`): it is pressed in the toast, which
 *   then leaves and takes the focus with it, so the screen is told which rows came back and which
 *   element had the focus when 撤销 was pressed.
 */
export function useHistoryDeletes(
  token: string | null,
  view: { page: number; date: string | null },
  onRestored?: (ids: number[], pressed: Element | null) => void,
) {
  const [hidden, setHidden] = useState<ReadonlySet<number>>(() => new Set());
  const held = useRef(new Map<number, Held>());
  const sent = useRef<{ token: string; entries: HistoryEntry[] } | null>(null);
  const sending = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const viewRef = useRef(view);
  const restoredRef = useRef(onRestored);
  useEffect(() => {
    viewRef.current = view;
    restoredRef.current = onRestored;
  }, [view, onRestored]);

  const show = useCallback((ids: Iterable<number>) => {
    const back = new Set(ids);
    if (back.size === 0) return;
    setHidden((previous) => new Set([...previous].filter((id) => !back.has(id))));
  }, []);

  const send = useCallback(async ({ keepalive = false }: { keepalive?: boolean } = {}) => {
    clearTimeout(timer.current);
    const batch = [...held.current.values()];
    held.current.clear();
    if (batch.length === 0) return;
    const work = (async () => {
      const done: Held[] = [];
      const failed: Held[] = [];
      let reason: unknown = null;
      await Promise.all(batch.map(async (item) => {
        try {
          await deleteBrowsingHistoryItem(item.token, item.entry.id, { keepalive });
          done.push(item);
        } catch (error) {
          failed.push(item);
          reason = error;
        }
      }));
      if (keepalive) return;
      const current = readToken();
      const owned = done.filter((item) => item.token === current);
      if (owned.length > 0 && current) {
        const gone = new Set(owned.map((item) => item.entry.id));
        const args = { token: current, ...viewRef.current };
        const shown = browsingHistory.peek(args).data;
        browsingHistory.invalidate();
        if (shown) browsingHistory.write(args, { ...shown, entries: shown.entries.filter((entry) => !gone.has(entry.id)) });
        browsingHistory.expire(args);
        sent.current = { token: current, entries: owned.map((item) => item.entry) };
      }
      show([...done, ...failed].map((item) => item.entry.id));
      if (failed.length > 0 && failed.some((item) => item.token === current)) {
        showToast(`有 ${failed.length} 条浏览记录未能删除：${apiErrorMessage(reason)}`, 'error');
      }
    })();
    const previous = sending.current;
    const pending = previous ? Promise.all([previous, work]).then(() => {}) : work;
    sending.current = pending;
    await pending;
    if (sending.current === pending) sending.current = null;
  }, [show]);

  const undo = useCallback(async () => {
    /* A toast can outlive navigation, which sends the batch before its undo window ends. */
    await sending.current;
    const waiting = [...held.current.values()];
    if (waiting.length > 0) {
      clearTimeout(timer.current);
      held.current.clear();
      const ids = waiting.map((item) => item.entry.id);
      show(ids);
      restoredRef.current?.(ids, document.activeElement);
      showToast('已恢复浏览记录', 'success');
      return;
    }
    const batch = sent.current;
    sent.current = null;
    if (!batch || readToken() !== batch.token) return;
    const results = await Promise.allSettled(batch.entries.map((entry) => restoreBrowsingHistoryItem(batch.token, entry)));
    if (readToken() !== batch.token) return;
    browsingHistory.invalidate();
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed) showToast(`未能恢复浏览记录：${apiErrorMessage(failed.reason)}`, 'error');
    else showToast('已恢复浏览记录', 'success');
  }, [show]);

  const remove = useCallback((entry: HistoryEntry) => {
    if (!token || readToken() !== token) return;
    held.current.set(entry.id, { entry, token });
    sent.current = null;
    setHidden((previous) => new Set(previous).add(entry.id));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void send(), UNDO_WINDOW_MS);
    /* One toast for the whole run: an identical message restarts the one on screen and takes the
       newest 撤销, and 撤销 brings back every row still held. */
    showToast('已删除浏览记录', 'success', { action: { label: '撤销', onClick: () => void undo() } });
  }, [token, send, undo]);

  /** 清空记录 makes every held delete moot: forget them without sending. */
  const forget = useCallback(() => {
    clearTimeout(timer.current);
    held.current.clear();
    sent.current = null;
    setHidden(new Set());
  }, []);

  /* Leaving the screen sends what is held; so does the page going away, which cannot wait. */
  useEffect(() => {
    const onHide = () => void send({ keepalive: true });
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      void send();
    };
  }, [send]);

  return { hidden, remove, forget };
}
