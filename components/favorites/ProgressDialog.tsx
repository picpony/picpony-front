'use client';

import { useState } from 'react';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import ProgressBar from '@/components/ProgressBar';
import { MOTION_SPEED_SCALE, motionTier } from '@/lib/appearance';
import { SPRING_MS } from '@/lib/spring';
import type { ProgressState } from './progressState';

export { completeProgress, runSummary, type ProgressState } from './progressState';

/**
 * A run that went to its end shows its end. The last step's `done` and the run's close used to
 * arrive in one render, so the meter never drew its last step and left from wherever it was, and
 * a run whose steps were all skipped never moved at all (M1-007). The caller fills the meter
 * (`completeProgress`), waits this long, and only then closes.
 *
 * The meter's fill runs on the slow effects spring; a wall-clock wait for it takes the slowest
 * speed (AGENTS: a timer that bounds an animation reads `MOTION_SPEED_SCALE.slow`, never the
 * animation's own number). Under 关闭 there is nothing to wait for.
 */
export function progressLanding(): Promise<void> {
  if (motionTier() === 'off') return Promise.resolve();
  return new Promise((resolve) => window.setTimeout(resolve, SPRING_MS.slowEffects * MOTION_SPEED_SCALE.slow));
}

/**
 * The meter and the line under it — shared with a dialog that turns into a run (`ImportDialog`).
 *
 * The running line is a live region; the summary is not, and is a node of its own rather than new
 * words in the live one: every run ends with a toast saying what it did, and announced from both
 * the outcome would be heard twice. One line of `body-m` either way, so the dialog keeps its
 * height through the swap.
 */
export function ProgressBody({ state }: { state: ProgressState }) {
  const percent = state.total > 0 ? (state.done / state.total) * 100 : 0;
  return (
    <div className="flex flex-col gap-3">
      <ProgressBar value={percent} label={state.title} />
      {state.summary ? (
        <p key="summary" className="text-body-m text-on-surface-variant tabular-nums">
          {state.summary}
        </p>
      ) : (
        <p key="running" className="text-body-m text-on-surface-variant tabular-nums" aria-live="polite">
          {`${state.detail}（${state.done} / ${state.total}）`}
        </p>
      )}
    </div>
  );
}

/**
 * 停止, the run's one way out. `autoFocus` for a run that takes over a dialog already open: the
 * control that started it is gone, and focus must not fall to the page under the dialog.
 */
export function StopButton({
  state,
  onStop,
  className,
  autoFocus,
}: {
  state: ProgressState;
  onStop: () => void;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <Button variant="text" onClick={onStop} loading={state.stopping} data-autofocus="" autoFocus={autoFocus} className={className}>
      停止
    </Button>
  );
}

/**
 * A run of steps the user waits on — an import, a download, a removal one picture at a time —
 * with a determinate meter and the one way out, 停止. It is not dismissed any other way while it
 * runs (Esc, the scrim and Back are swallowed, as a native non-cancellable dialog does), so the
 * run cannot be left going behind a closed dialog; 停止 lets the current step finish and ends the
 * run, and the caller reports what was done.
 *
 * **It leaves showing the run it showed** (M1-007): `state` goes null the moment the caller closes
 * it, and read directly the title and the line emptied and the meter ran back to zero while the
 * dialog faded — work being undone, on screen. The last state is held through the exit.
 */
export default function ProgressDialog({ state, onStop }: { state: ProgressState | null; onStop: () => void }) {
  const [shown, setShown] = useState(state);
  if (state && state !== shown) setShown(state);
  const view = state ?? shown;
  return (
    <Modal
      isOpen={state !== null}
      onClose={() => {}}
      onExited={() => setShown(null)}
      title={view?.title ?? ''}
      hideCloseButton
      closeOnEscape={false}
      closeOnOverlayClick={false}
      maxWidth="sm"
      footer={view ? <StopButton state={view} onStop={onStop} /> : null}
    >
      {view ? <ProgressBody state={view} /> : null}
    </Modal>
  );
}
