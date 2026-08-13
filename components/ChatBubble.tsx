'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * One message in a conversation.
 *
 * **The shape.** A bubble was the one thing in the app whose radius had been
 * chosen by eye: `rounded-2xl` with a `rounded-br-sm` / `rounded-bl-sm` tail. The
 * step itself is defensible — 28dp is the shape scale's "dialog, sheet, large
 * media container" role and a bubble is none of those, but roundness *is* the
 * semantics of a speech bubble, so this is the one place a small element
 * legitimately takes the largest step. What was missing is that it was never
 * written down, so the next person to add a bubble-like thing had nothing to
 * copy. It is a documented role now (see the shape table in AGENTS.md) and it
 * lives here rather than at the call site.
 *
 * **The tail belongs to the run, not the message.** Every bubble used to carry
 * one, which is what made a burst of four messages read as four separate
 * utterances from four separate people. A run — consecutive messages from the
 * same sender — is one turn in the conversation: only its last bubble gets the
 * tail and only its last bubble gets the timestamp. The others are the same
 * speaker still talking.
 *
 * **The portrait is not here.** It used to be a slot on the last bubble of a
 * run, which put it at the *end* of the turn — so a burst of six messages
 * introduced itself only after you had read all six. `ChatRun` owns it now, at
 * the head of the turn and pinned there while the run scrolls past.
 *
 * **Width.** `85%` on a phone, `70%` from `sm` up. A flat 70% was 252px on a
 * 360px screen, and Chinese does not hyphenate — so a message of any length
 * became a tall narrow ribbon with two or three characters per line.
 */
export interface ChatBubbleProps {
  /** Sent by the current user — decides the side, the tone and the tail corner. */
  own: boolean;
  children: ReactNode;
  /** Rendered under the bubble. Pass only on the last bubble of a run. */
  timestamp?: string;
  /**
   * Delivery state, beside the timestamp. Only the newest outgoing message in a
   * thread should carry one — a 已读 under every bubble is a column of noise, and
   * the state of an older message is implied by the newer one below it.
   */
  status?: ReactNode;
  /** Last of a run — takes the tail. */
  endOfRun?: boolean;
  className?: string;
}

export default function ChatBubble({
  own,
  children,
  timestamp,
  status,
  endOfRun = true,
  className = '',
}: ChatBubbleProps) {
  return (
    <div className={cn('flex', own ? 'justify-end' : 'justify-start', className)}>
      <div className={cn('flex min-w-0 max-w-[85%] flex-col sm:max-w-[70%]', own ? 'items-end' : 'items-start')}>
        <div
          className={cn(
            /* `break-words` plus `min-w-0`, because `max-w-[85%]` is a *maximum*
               and does nothing about a minimum. A flex item's `min-width` is
               `auto`, i.e. its min-content width — and the min-content width of
               an unbroken 200-character string is 200 characters. So one pasted
               URL made the bubble wider than its own cap, widened the thread
               pane, and pushed the whole chat frame off the right of the screen.
               The base layer sets `overflow-wrap` on `p`/`li`/`td`, which never
               reached here: message text is rendered into `<span>`s. */
            'text-body-m min-w-0 max-w-full rounded-2xl px-4 py-2 break-words',
            own ? 'bg-primary text-on-primary' : 'bg-surface-container-lowest text-on-surface',
            /* The tail. `rounded-sm` (8dp) rather than a square corner: a hard
               90° against a 28dp curve reads as a rendering error at small
               sizes, and the M3 shape scale has no 0dp role for anything that
               holds text. */
            endOfRun && (own ? 'rounded-br-sm' : 'rounded-bl-sm'),
          )}
        >
          {children}
        </div>
        {(timestamp || status) && (
          /* Below the bubble, not above it. Above, it separated a message from
             the one it was replying to and sat between two bubbles with no
             indication which it belonged to. */
          /* `on-surface-variant`, the app's secondary-ink role — not `outline`,
             which is a *boundary* role for rules and text-field borders. At
             11px (`label-s`) it was under the contrast the ink roles guarantee,
             and every other time on this page already uses this role. */
          <span className="text-label-s text-on-surface-variant mt-1 flex items-center gap-1.5 px-1 tabular-nums">
            {timestamp}
            {status}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * One turn: a portrait and the bubbles that belong to it.
 *
 * The portrait sits beside the *first* message of the run and stays there while
 * the run scrolls, which is two changes from what this was.
 *
 * It was on the last bubble, and the argument for that is the one every desktop
 * mail client makes — the avatar marks where a turn *ends*. In a conversation it
 * is the wrong end: a burst of six messages is six bubbles of unattributed text
 * followed, finally, by a face. Reading order wants to know who is speaking
 * before it reads what they said.
 *
 * And it is `sticky`, because a long turn is taller than the viewport. Pinned to
 * the top of its own run, the portrait travels down with the scroll for as long
 * as the run lasts and stops at its last bubble — so "who is talking" is
 * answered at every point in a turn instead of only at the two ends of it.
 * `self-start` is what gives the sticky box something to stick within: without
 * it the column stretches to the run's full height and there is no travel.
 *
 * The gutter is reserved on both sides whether or not a portrait is in it, so a
 * run with one bubble and a run with six line up down the thread.
 */
export function ChatRun({
  own,
  avatar,
  children,
  className = '',
}: {
  own: boolean;
  avatar?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn('flex items-start gap-2', own ? 'flex-row-reverse' : 'flex-row', className)}
    >
      <div className="sticky top-2 h-8 w-8 shrink-0 self-start">{avatar}</div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">{children}</div>
    </div>
  );
}

/**
 * Splits a thread into runs, so a caller does not have to work out per-message
 * which bubble opens and which closes a turn.
 *
 * Returns flags per message rather than nested arrays: the caller groups them
 * itself (see `ChatRun`), and it also needs the flat sequence to place the
 * per-day separators, which fall between messages and belong to neither run.
 *
 * `breaksAfter` ends a run for a reason other than the speaker changing. Time is
 * the one that matters: two messages from the same person minutes apart are two
 * turns, not one, and joining them hides the timestamp of the first — the run's
 * clock is only printed on its last bubble. Without it a thread that ran all
 * afternoon collapsed into a single run with one time under it.
 */
export function markRuns<T>(
  items: T[],
  senderOf: (item: T) => string | number,
  breaksAfter?: (item: T, next: T) => boolean,
): { item: T; startOfRun: boolean; endOfRun: boolean }[] {
  const breaks = (a: T, b: T) => senderOf(a) !== senderOf(b) || Boolean(breaksAfter?.(a, b));
  return items.map((item, i) => {
    const previous = items[i - 1];
    const next = items[i + 1];
    return {
      item,
      startOfRun: i === 0 || breaks(previous, item),
      endOfRun: i === items.length - 1 || breaks(item, next),
    };
  });
}
