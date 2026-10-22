/**
 * Acceptance-probe marks (`scripts/acceptHeroMatrix.py`). Off unless the page sets
 * `globalThis.__HERO_PROBE__`, so production pays one property read per call site.
 * A mark names the moment a visual response is *written*; the probe pairs it with the
 * compositor frame that presents it to measure input → photons on the trace.
 */
export function heroProbeMark(name: string) {
  if ((globalThis as { __HERO_PROBE__?: boolean }).__HERO_PROBE__) performance.mark(name);
}

/** Acceptance A/B switch: the probe can turn a named optimisation off to measure what it buys. */
export function heroProbeDisabled(feature: 'arm') {
  const flags = (globalThis as { __HERO_PROBE_OFF__?: string[] }).__HERO_PROBE_OFF__;
  return Boolean(flags && flags.includes(feature));
}
