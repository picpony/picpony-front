'use client';

/**
 * Which tab the user is actually on while the URL catches up.
 *
 * The tab bar and the panes share nothing but the URL, and React sees a history write on the
 * router's own schedule — the home pill's return to 图库 is a traversal, a task later — so for
 * a commit or two the panes would animate towards a tab the user has already left, and a
 * sidebar link or back/forward arrives looking the same. Pass the optimistic tab while one is
 * outstanding and `null` once the URL agrees. The tab bar clears it whenever it is off the
 * home route, so a stale intent cannot outlive the page.
 *
 * Lives here, not in lib/motion: the writer is AppLayout (mounted on every route) and the
 * only reader is the tab driver, so a one-line setter must not pull GSAP into every shell.
 */
let pendingTabIntent: string | null = null;

export function setTabIntent(to: string | null): void {
  pendingTabIntent = to;
}

export function tabIntent(): string | null {
  return pendingTabIntent;
}
