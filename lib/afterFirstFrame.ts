/**
 * Runs `task` once the frame after the current task has been drawn — a frame, then a task — or at
 * once, ahead of the next `pointerdown` or `keydown` anywhere: no later input acts on a state the
 * task has not yet written. `cancelOn` names events that drop it instead, `onCancel` then running.
 * Returns a function that drops it.
 *
 * **What it is for: work a tap causes that need not be in the tap's first frame.** An update made
 * inside an input event is rendered in that event's task (React gives it the event's priority, and
 * Next renders a native history write synchronously), and the frame that would show the tap's
 * answer waits for all of it. Deferred to here, the same update renders after that frame, while
 * whatever the tap started runs on the compositor: the home pill's history write
 * (`lib/homeTabs.ts`), and a tab row's selection once its switch is already moving (`Tabs`).
 */
export function afterFirstFrame(
  task: () => void,
  options: { cancelOn?: readonly string[]; onCancel?: () => void } = {},
): () => void {
  if (typeof window === 'undefined') return () => {};
  const cancelOn = options.cancelOn ?? [];
  let frame = 0;
  let timer = 0;
  let live = true;
  const stop = () => {
    live = false;
    window.removeEventListener('pointerdown', flush, true);
    window.removeEventListener('keydown', flush, true);
    for (const type of cancelOn) window.removeEventListener(type, cancel, true);
    window.cancelAnimationFrame(frame);
    window.clearTimeout(timer);
  };
  function flush() {
    if (!live) return;
    stop();
    task();
  }
  function cancel() {
    if (!live) return;
    stop();
    options.onCancel?.();
  }
  window.addEventListener('pointerdown', flush, true);
  window.addEventListener('keydown', flush, true);
  for (const type of cancelOn) window.addEventListener(type, cancel, true);
  frame = window.requestAnimationFrame(() => {
    timer = window.setTimeout(flush, 0);
  });
  return () => {
    if (live) stop();
  };
}
