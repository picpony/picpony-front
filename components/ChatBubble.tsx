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
 * **The text is plain text.** Line breaks are kept (`pre-wrap`) and nothing is parsed as
 * Markdown — a message is what was typed. The caller hands in the rendered pieces (links,
 * emoji pictures); the bubble only lays them out.
 *
 * **An attachment is not a bubble.** A shared picture or folder is a card with its own
 * surface (`attachment`), laid out on the speaker's side in the same column — wrapping it in
 * the bubble's fill put a card inside a card.
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
  /** A card (a shared picture, a folder) rather than text: no bubble surface around it. */
  attachment?: boolean;
  /** Rendered under the bubble. Pass only on the last bubble of a run. */
  timestamp?: ReactNode;
  /**
   * Delivery state, beside the timestamp — 已读 under the newest message the other side has
   * read, 已送达 under a newer one, and the state of a message still on its way (see
   * `receiptPlacement` in app/messages). The older ones' state is implied by those.
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
  attachment = false,
  timestamp,
  status,
  startOfRun = true,
  endOfRun = true,
  className = '',
}: ChatBubbleProps) {
  return (
    <div className={cn('@container/bubble flex', own ? 'justify-end' : 'justify-start', className)}>
      <div className={cn('flex min-w-0 max-w-[85%] flex-col @lg/bubble:max-w-[70%]', own ? 'items-end' : 'items-start')}>
        {attachment ? (
          <div className="min-w-0 max-w-full">{children}</div>
        ) : (
          <div
            className={cn(
              /* Wrapping plus `min-w-0`: a flex item's min-width is its
                 min-content width, and the min-content width of an unbroken
                 200-character string is 200 characters — one pasted URL made the
                 bubble wider than its cap and pushed the chat frame off screen.
                 `pre-wrap` keeps the sender's line breaks and spaces; the words
                 still wrap at the bubble's edge. */
              'text-body-m min-w-0 max-w-full whitespace-pre-wrap rounded-lg px-4 py-2 wrap-anywhere',
              /* Forced colors flattens the two fills to one canvas; the edge is what is left
                 of a bubble there. */
              'forced-boundary',
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
        )}
        {(timestamp || status) && (
          /* Below the bubble, not above: above, it separated a message from the one
             it was replying to with no indication which it belonged to. */
          /* `on-surface-variant` — the secondary-ink role, not `outline`, which is a
             *boundary* role. At 11px it was under the contrast the ink roles
             guarantee, and every other timestamp on this page uses this role. A status
             passes its own ink only for a failure. */
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
  label,
  children,
  className = '',
}: {
  own: boolean;
  avatar?: ReactNode;
  /** Who is speaking, for a screen reader — the portrait says it to everyone else. */
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn('flex items-start gap-2', own ? 'flex-row-reverse' : 'flex-row', className)}
    >
      <div className="sticky top-2 h-8 w-8 shrink-0 self-start" aria-hidden="true">
        {avatar}
      </div>
      {/* 2dp between the rows of one turn — `ListTokens.SegmentedGap`. Wide enough
          a gap and the 4dp seams have nothing to close against, so a run reads as
          separate rows that happen to be near each other. */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {label && <span className="sr-only">{label}</span>}
        {children}
      </div>
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
  items: readonly T[],
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
