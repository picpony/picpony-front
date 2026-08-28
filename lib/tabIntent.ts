'use client';

/**
 * Which tab the user is actually on while the URL catches up.
 *
 * The tab bar and the panes are in different components and share nothing but the URL, and the
 * URL is the one thing that lags: the switch plays on the tap, the push is coalesced behind it,
 * and a burst of taps therefore drags the address bar through tabs the user has already left.
 * `useTabPanes` cannot tell one of those from a real destination — a sidebar link or the back
 * button arrive looking exactly the same — so it chased them, and each one restarted the
 * transition in the opposite direction.
 *
 * Measured on two taps 520ms apart, 图库 → 论坛 → 图库: the panes ran three animations, the middle
 * one backwards, and the switch visibly sprang back to 论坛 before completing.
 *
 * Pass the optimistic tab while one is outstanding and `null` once the URL agrees. The tab bar
 * unmounts when the route leaves home, so its cleanup is also what guarantees a stale intent
 * cannot outlive the page it belongs to.
 *
 * It lives here rather than in `lib/motion.ts` because the *writer* is `AppLayout`, which the root
 * layout mounts on every route, while the only *reader* is `useTabPanes` — so a one-line setter
 * was pulling GSAP into the shell of every screen in the app to serve one screen's tab bar.
 */
let pendingTabIntent: string | null = null;

export function setTabIntent(to: string | null): void {
  pendingTabIntent = to;
}

export function tabIntent(): string | null {
  return pendingTabIntent;
}
