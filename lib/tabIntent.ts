'use client';

/**
 * Which tab the user is actually on while the URL catches up.
 *
 * The tab bar and the panes share nothing but the URL, and the URL lags behind coalesced
 * pushes — a burst of taps drags the address bar through tabs the user has already left,
 * and a sidebar link or back/forward arrives looking the same. Pass the optimistic tab
 * while one is outstanding and `null` once the URL agrees. The tab bar unmounts on leaving
 * home, so its cleanup guarantees a stale intent cannot outlive the page.
 *
 * Lives here, not in lib/motion: the writer is AppLayout (mounted on every route) and the
 * only reader is useTabPanes, so a one-line setter must not pull GSAP into every shell.
 */
let pendingTabIntent: string | null = null;

export function setTabIntent(to: string | null): void {
  pendingTabIntent = to;
}

export function tabIntent(): string | null {
  return pendingTabIntent;
}
