/**
 * Transient reports, independent of React and the DOM. Producers publish here;
 * ToastContainer owns rendering, deduplication, dismissal and announcements.
 * The component re-exports showToast so UI call sites keep their existing entry.
 */
export type ToastType = 'success' | 'error' | 'info' | 'warning';

/** An explicit action — the only part of a toast that takes a tap (e.g. 撤销). */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  /** Reading time in ms. Defaults to the severity's own, lengthened for a long message. */
  duration?: number;
  action?: ToastAction;
}

export interface ToastNotice {
  id: number;
  message: string;
  type: ToastType;
  duration: number;
  action?: ToastAction;
}

export type ToastListener = (toast: ToastNotice) => void;
const listeners: ToastListener[] = [];
/** Raised before the container subscribed (a first-commit effect anywhere in the tree). */
const pending: ToastNotice[] = [];
let toastId = 0;

function deliver(listener: ToastListener, toast: ToastNotice) {
  try {
    listener(toast);
  } catch {
    // Reporting is best effort: a renderer failure must not reject the request
    // that produced this notice, or prevent other subscribers from receiving it.
  }
}

/** M3's snackbar dwell runs 4–10s. A status report reads in four; a problem gets six. */
const BASE_DWELL: Record<ToastType, number> = { success: 4000, info: 4000, warning: 6000, error: 6000 };
const PER_CHARACTER_MS = 60;
const MAX_DWELL = 10000;

function dwellFor(message: string, type: ToastType) {
  const extra = Math.max(0, Array.from(message).length - 20) * PER_CHARACTER_MS;
  return Math.min(MAX_DWELL, BASE_DWELL[type] + extra);
}

/**
 * A transient status report. `options` may be a bare duration (the former signature).
 *
 *     showToast('已保存');
 *     showToast('邮箱地址无效', 'error');
 *     showToast('已删除', 'success', { action: { label: '撤销', onClick: undo } });
 */
export const showToast = (
  message: string,
  type: ToastType = 'success',
  options?: number | ToastOptions,
) => {
  const opts = typeof options === 'number' ? { duration: options } : (options ?? {});
  const toast: ToastNotice = {
    id: ++toastId,
    message,
    type,
    duration: opts.duration ?? dwellFor(message, type),
    action: opts.action,
  };
  if (!listeners.length) {
    pending.push(toast);
    return;
  }
  listeners.forEach((listener) => deliver(listener, toast));
};

/** Drains early reports once, in order; a later remount does not replay delivered reports. */
export function subscribeToasts(listener: ToastListener): () => void {
  listeners.push(listener);
  for (const toast of pending.splice(0)) deliver(listener, toast);
  return () => {
    const index = listeners.indexOf(listener);
    if (index > -1) listeners.splice(index, 1);
  };
}
