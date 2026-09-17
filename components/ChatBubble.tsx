'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * One message in a conversation.
 *
 * **The shape is a list row, not a lozenge.** 16dp outer corners
 * (`ListTokens.ItemSelectedContainerShape`), with the seams inside a turn cut to
 * 4dp — the app's grouped-list seam. What it keeps from a bubble: each row is only
 * as wide as its own text, so the ragged right edge carries the rhythm of speech.
 *
 * **The tail belongs to the run, not the message.** A run (consecutive messages
 * from one sender) is one turn: only its last bubble carries the timestamp and only
 * the run has large outer corners.
 *
 * **One colour family on both sides.** Both are container pairs, one step apart —
 * `secondary-container` for what you said, `surface-container-highest` for what was
 * said to you (a *lower* step flips above/below its host between schemes, so the
 * same row read as a raised card and then as a hole). Which side is which is
 * carried by alignment and cut corners; saturation is not needed and costs the
 * thread its calm.
 *
 * **The portrait is not here.** `ChatRun` owns it, at the head of the turn.
 *
 * **Width.** 85% in a narrow message column, 70% once that column reaches 32rem.
 * The contact rail and app drawer share the viewport, so the viewport cannot say
 * how much room a message has. A narrow column needs readable lines either way.
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
  /**
   * First of a run — nothing of the same turn above this bubble, so its top corner
   * on the speaker's side stays large.
   */
  startOfRun?: boolean;
  /**
   * Last of a run — nothing of the same turn below, so its bottom corner on the
   * speaker's side stays large and the turn closes on the bubble shape rather than
   * on a seam.
   *
   * Defaults to `true` so a bubble rendered on its own is a bubble, not a fragment.
   */
  endOfRun?: boolean;
  className?: string;
}

export default function ChatBubble({
  own,
  children,
  timestamp,
  status,
  startOfRun = true,
  endOfRun = true,
  className = '',
}: ChatBubbleProps) {
  return (
    <div className={cn('@container/bubble flex', own ? 'justify-end' : 'justify-start', className)}>
      <div className={cn('flex min-w-0 max-w-[85%] flex-col @lg/bubble:max-w-[70%]', own ? 'items-end' : 'items-start')}>
        <div
          className={cn(
            /* Wrapping plus `min-w-0`: a flex item's min-width is its
               min-content width, and the min-content width of an unbroken
               200-character string is 200 characters — one pasted URL made the
               bubble wider than its cap and pushed the chat frame off screen.
               Message text renders into `<span>`s, so the base layer's
               `overflow-wrap` on p/li/td never reached here. */
            'text-body-m min-w-0 max-w-full rounded-lg px-4 py-2 wrap-anywhere',
            /* Two steps of one family rather than a fill and a tint: see the note on
               the component. The ink is the container's own `on-` role either way, so
               it follows the fill in both schemes. */
            own
              ? 'bg-secondary-container text-on-secondary-container'
              : 'bg-surface-container-highest text-on-surface',
            /* **The run is one block, cut where the rows meet.** On the speaker's
               side a corner drops to 4dp wherever another row of the same turn
               is against it; everything else stays 16dp, so a turn keeps the row
               shape outside and only its seams are tight — a grouped list with
               each row free to be as wide as its own text. 4dp, not square:
               the shape scale has no 0dp role for anything holding text.
               Both flags are needed; with the bottom cut unconditionally every
               row ended in a seam, including the last, which has nothing below. */
            !startOfRun && (own ? 'rounded-tr-xs' : 'rounded-tl-xs'),
            !endOfRun && (own ? 'rounded-br-xs' : 'rounded-bl-xs'),
          )}
        >
          {children}
        </div>
        {(timestamp || status) && (
          /* Below the bubble, not above: above, it separated a message from the one
             it was replying to with no indication which it belonged to. */
          /* `on-surface-variant` — the secondary-ink role, not `outline`, which is a
             *boundary* role. At 11px it was under the contrast the ink roles
             guarantee, and every other timestamp on this page uses this role. */
          <span className="text-label-s text-on-surface-variant mt-1 flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 px-1 tabular-nums">
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
 * The portrait sits beside the *first* message of the run — in a conversation a
 * burst of six messages is six unattributed bubbles if the face only marks the
 * end; reading order wants to know who is speaking first. And it is `sticky`,
 * pinned to the top of its own run, so "who is talking" is answered at every
 * point of a long turn, not only at its ends. `self-start` gives the sticky box
 * something to stick within (a stretched column has no travel).
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
      {/* 2dp between the rows of one turn — `ListTokens.SegmentedGap`. Wide enough
          a gap and the 4dp seams have nothing to close against, so a run reads as
          separate rows that happen to be near each other. */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">{children}</div>
    </div>
  );
}

/**
 * Splits a thread into runs, so a caller does not have to work out per-message
 * which bubble opens and which closes a turn.
 *
 * Returns flags per message rather than nested arrays: the caller groups them
 * itself (see `ChatRun`) and also needs the flat sequence to place the per-day
 * separators, which fall between messages and belong to neither run.
 *
 * `breaksAfter` ends a run for a reason other than the speaker changing — time
 * above all: two messages from one person minutes apart are two turns, and
 * joining them hides the first turn's timestamp (the run's clock prints only on
 * its last bubble).
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
