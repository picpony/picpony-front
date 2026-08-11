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
 * tail, only its last bubble gets the timestamp, and only its last bubble gets an
 * avatar. The others are the same speaker still talking.
 *
 * That is also why `avatar` is a slot rather than a required prop: an interior
 * bubble is passed nothing and reserves the gutter instead, so the column stays
 * aligned without repeating a 32px portrait five times down the thread.
 *
 * **Width.** `85%` on a phone, `70%` from `sm` up. A flat 70% was 252px on a
 * 360px screen, and Chinese does not hyphenate — so a message of any length
 * became a tall narrow ribbon with two or three characters per line.
 */
export interface ChatBubbleProps {
  /** Sent by the current user — decides the side, the tone and the tail corner. */
  own: boolean;
  children: ReactNode;
  /** Rendered in the gutter. Pass only on the last bubble of a run. */
  avatar?: ReactNode;
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
  avatar,
  timestamp,
  status,
  endOfRun = true,
  className = '',
}: ChatBubbleProps) {
  return (
    <div className={cn('flex', own ? 'justify-end' : 'justify-start', className)}>
      <div
        className={cn(
          'flex min-w-0 max-w-[85%] items-end gap-2 sm:max-w-[70%]',
          own ? 'flex-row-reverse' : 'flex-row',
        )}
      >
        {/* The gutter is reserved whether or not there is a portrait in it, so
            interior bubbles line up with the one that carries the avatar. */}
        <div className="h-8 w-8 shrink-0">{avatar}</div>
        <div className={cn('flex min-w-0 flex-col', own ? 'items-end' : 'items-start')}>
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
              'text-body-m min-w-0 rounded-2xl px-4 py-2 break-words',
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
    </div>
  );
}

/**
 * Splits a thread into runs, so a caller does not have to work out per-message
 * which bubble ends a turn.
 *
 * Returns one flag per message rather than nested arrays: the list still renders
 * as a flat sequence, and nesting it would break the `space-y` rhythm between
 * runs — which is the other half of what makes runs legible. A run is tight
 * inside and separated outside.
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
): { item: T; endOfRun: boolean }[] {
  return items.map((item, i) => {
    const next = items[i + 1];
    return {
      item,
      endOfRun:
        i === items.length - 1 ||
        senderOf(next) !== senderOf(item) ||
        Boolean(breaksAfter?.(item, next)),
    };
  });
}
