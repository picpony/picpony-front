/**
 * A run's progress as its dialog shows it (`ProgressDialog`, and `ImportDialog`'s run face), and
 * the two pure steps a run takes at its end. Plain, without React, so the tests read it as it is.
 */

export interface ProgressState {
  title: string;
  /** What is happening now — 正在导入第 3 张. */
  detail: string;
  done: number;
  total: number;
  /** The run is being stopped: the current step is finishing. */
  stopping?: boolean;
  /**
   * What a run that went to its end did, in the past tense — 已导入 50 张，2 张失败 — shown in
   * place of the running line once the meter is full (`completeProgress`), for its landing and its
   * exit: a finished run read 正在导入（50 / 50） to the end (FX-F8).
   */
  summary?: string;
}

/**
 * `已导入 47 张，3 张失败` — a run's summary from its own counts: the meter fills for every step
 * the run went through, failed ones included, so the words, not the meter, say what took.
 */
export function runSummary(verb: string, succeeded: number, failed: number): string {
  return `${verb} ${succeeded} 张${failed > 0 ? `，${failed} 张失败` : ''}`;
}

/**
 * The meter at its end, with what the run did (`runSummary`), for a run that went through every
 * step (failed ones included). Curried, for `setProgress(completeProgress(summary))`.
 */
export function completeProgress(summary: string) {
  return (state: ProgressState | null): ProgressState | null => (state ? { ...state, done: state.total, summary } : state);
}
