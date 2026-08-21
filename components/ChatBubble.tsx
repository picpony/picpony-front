'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * One message in a conversation.
 *
 * **The shape is a list row, not a lozenge.** This was 28dp with 8dp seams, on the
 * argument that roundness *is* the semantics of a speech bubble and that this is the
 * one place a small element may take the shape scale's largest step. The argument is
 * a real one and it lost to the thread it produced: at 28dp a two-word message is a
 * capsule, a long one is a stadium, and a column of them reads as a bag of lozenges
 * rather than as a conversation you can scan. A thread is a *list* — 16dp outer
 * corners (`ListTokens.ItemSelectedContainerShape = CornerLarge`) with the seams
 * inside a turn cut to 4dp, which is this app's own grouped-list seam. What it keeps
 * from the bubble is the thing worth keeping: each row is only as wide as its own
 * text, so the ragged right edge still carries the rhythm of speech.
 *
 * **The tail belongs to the run, not the message.** Every bubble used to carry
 * one, which is what made a burst of four messages read as four separate
 * utterances from four separate people. A run — consecutive messages from the
 * same sender — is one turn in the conversation: only its last bubble gets the
 * timestamp, and only the *run* has large outer corners. The others are the same
 * speaker still talking.
 *
 * **A run is one block that has been cut, which is the same idea as `.m3-row`.**
 * The bubbles inside a turn share their adjoining edges at the seam step and the
 * turn keeps 16dp on its outer corners, so a burst reads as one column with a head
 * and a foot rather than as a stack of separate rows. Only the *tail* was doing this
 * before, so the second and third bubbles of a run were fully rounded on all four
 * corners and the run had no shape of its own.
 *
 * **One colour family on both sides.** Outgoing was `primary`/`on-primary` — the
 * brand fill, at full saturation, against an incoming `secondary-container`. Two
 * different *kinds* of colour in one thread: one row was a filled control and the
 * next was a tinted surface, and the eye reads that as two materials rather than as
 * two speakers. Both are container pairs now, one step apart —
 * `secondary-container` for what you said, `surface-container-highest` for what was
 * said to you. Which side is which is carried by the alignment and by which corners
 * are cut, both of which are unambiguous; saturation is not needed to say it and
 * costs the thread its calm.
 *
 * `surface-container-highest` rather than `-lowest`, which is what incoming used to
 * be: `-lowest` is *above* its host in the light scheme and *below* it in the dark
 * one, so the same row read as a raised white card and then as a hole punched in the
 * pane. `-highest` is a step up from the thread's `surface-container-low` in both.
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
            'text-body-m min-w-0 max-w-full rounded-lg px-4 py-2 break-words',
            /* Two steps of one family rather than a fill and a tint: see the note on
               the component. The ink is the container's own `on-` role either way, so
               it follows the fill in both schemes. */
            own
              ? 'bg-secondary-container text-on-secondary-container'
              : 'bg-surface-container-highest text-on-surface',
            /* **The run is one block, cut where the rows meet.** On the speaker's
               side a corner drops to `rounded-xs` (4dp) wherever there is another row
               of the same turn against it — above if this is not the run's first,
               below if it is not its last. Everything else stays at 16dp, so the
               *outside* of a turn keeps the row shape and only its internal seams are
               tight. A run of three therefore reads: 16dp on top, both seams cut, and
               16dp on the bottom of the last — which is exactly what a grouped list
               does, with each row free to be as wide as its own text.
               4dp rather than a square corner because the shape scale has no 0dp role
               for anything holding text, and it is the step this app already uses for
               a seam in a grouped list.
               Both flags are needed and `endOfRun` is the one that was missing: with
               the bottom corner cut unconditionally, *every* row ended in a seam —
               including the last, which has nothing below it to join — so a turn
               finished on a clipped corner instead of closing. */
            !startOfRun && (own ? 'rounded-tr-xs' : 'rounded-tl-xs'),
            !endOfRun && (own ? 'rounded-br-xs' : 'rounded-bl-xs'),
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
      {/* 2dp between the rows of one turn — `ListTokens.SegmentedGap`, which is the
          token for exactly this: the gap between segments of one list. It was 4dp,
          which is wide enough that the 4dp seam corners had nothing to close against
          and a run read as separate rows that happened to be near each other. */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">{children}</div>
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
