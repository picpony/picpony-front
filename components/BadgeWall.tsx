'use client';

import { useState } from 'react';
import { MdTimerOff } from 'react-icons/md';
import Modal from './Modal';
import Skeleton from './Skeleton';
import ErrorRetry from './ErrorRetry';
import SectionHeading from './SectionHeading';
import Button from './Button';
import UserBadge, { badgePaint } from './UserBadge';
import { SKIP, useResource } from '@/lib/resource';
import { badgeDictionary } from '@/lib/resources';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { badgeValidity, type HeldBadge } from '@/lib/userBadges';
import { cn } from '@/lib/utils';

/** Warm the dictionary on intent — a pointer arriving, focus, a press — so the dialog opens on
 *  its sentence rather than on a skeleton. One read serves the session. */
const warmDictionary = () => badgeDictionary.prefetch({});

/**
 * One badge on the wall: the badge's own colours, and a **control** — pressing it opens the
 * badge's description (AGENTS: a `Badge` is a mark, a `Chip` a control). It cannot be a `Chip`,
 * whose colours are token pairs from `lib/roles.ts` / `lib/tagCategories.ts`, while a badge's
 * fill is the author's hex; so this takes the chip's geometry instead — 32dp tall, the 8dp chip
 * corner, `label-l`, the 48px target under a finger with the matching block margin, the state
 * layer and the inner ripple host — and `UserBadge`'s paint, so the mark beside a name and the
 * control that explains it are one colour pair.
 */
function BadgeChip({ badge, expired, onOpen }: { badge: HeldBadge; expired: boolean; onOpen: () => void }) {
  const paint = badgePaint(badge.color);
  return (
    <span
      className={cn(
        'inline-flex h-8 max-w-full items-center rounded-sm text-label-l select-none pointer-coarse:my-1 forced-boundary',
        !paint && 'bg-surface-container-high text-on-surface-variant',
      )}
      style={paint ?? undefined}
    >
      <button
        type="button"
        onClick={onOpen}
        onPointerEnter={warmDictionary}
        onPointerDown={warmDictionary}
        onFocus={warmDictionary}
        aria-haspopup="dialog"
        aria-label={expired ? `${badge.name}（已过期）` : badge.name}
        data-ripple="inner"
        className={cn(
          'inline-flex min-w-0 items-center self-stretch rounded-sm pr-4 cursor-pointer touch-manipulation touch-target',
          expired ? 'gap-2 pl-2' : 'pl-4',
          'state-layer focus-visible:outline-hidden focus-visible:ring-2 focus-ring',
        )}
      >
        <span data-ripple-host="" aria-hidden="true" />
        {expired && (
          <span className="shrink-0 [&>svg]:block [&>svg]:size-4.5" aria-hidden="true">
            <MdTimerOff />
          </span>
        )}
        <span className="truncate">{badge.name}</span>
      </button>
    </span>
  );
}

interface BadgeWallProps {
  badges: readonly HeldBadge[];
  /** Names of the badges the user wears. */
  equipped: ReadonlySet<string>;
  /** The clock the wall judges expiry by (the page's reference time — see `ProfileContent`). */
  now: number;
  /** The owner's own profile: the heading carries 管理佩戴. */
  onManage?: () => void;
}

/**
 * A profile's badge wall — every badge the user holds, each opening its description (decision
 * 15, the original front end's 徽章墙 and its description dialog). Held badges come off the
 * profile record; the descriptions come from the dictionary, read on the first open and warmed on
 * intent. An expired badge stays on the wall, after the current ones, marked with a glyph and
 * 已过期 in its dialog; it is simply never worn.
 *
 * Nothing renders when the user holds no badge: an empty wall is a heading over nothing.
 */
export default function BadgeWall({ badges, equipped, now, onManage }: BadgeWallProps) {
  /* The dialog's badge, kept through the exit animation: closing clears only `open`. */
  const [selected, setSelected] = useState<HeldBadge | null>(null);
  const [open, setOpen] = useState(false);
  const dictionary = useResource(badgeDictionary, open ? {} : SKIP);

  if (badges.length === 0) return null;

  const ordered = [...badges].sort(
    (a, b) => Number(badgeValidity(a.expiresAt, now).expired) - Number(badgeValidity(b.expiresAt, now).expired),
  );
  const validity = selected ? badgeValidity(selected.expiresAt, now) : null;
  const description = selected ? dictionary.data?.[selected.name] : undefined;

  return (
    <section aria-label="徽章墙">
      {/* 40dp for the row whether or not 管理佩戴 is in it: the button arrives with the session,
          after hydration, and must not push the wall down when it does. */}
      <SectionHeading
        className="mb-2 min-h-10"
        aside={badges.length}
        actions={
          onManage ? (
            <Button variant="text" size="xs" onClick={onManage}>
              管理佩戴
            </Button>
          ) : undefined
        }
      >
        徽章墙
      </SectionHeading>
      <ul className="flex flex-wrap gap-2">
        {ordered.map((badge) => (
          <li key={badge.name} className="flex max-w-full">
            <BadgeChip
              badge={badge}
              expired={badgeValidity(badge.expiresAt, now).expired}
              onOpen={() => {
                setSelected(badge);
                setOpen(true);
              }}
            />
          </li>
        ))}
      </ul>

      <Modal isOpen={open} onClose={() => setOpen(false)} title={selected?.name ?? ''} maxWidth="sm">
        {selected && (
          <div className="flex flex-col items-start gap-3">
            <UserBadge name={selected.name} color={selected.color} size="md" />
            {description !== undefined ? (
              <p className="text-body-m text-on-surface whitespace-pre-wrap wrap-anywhere">{description}</p>
            ) : dictionary.data !== undefined ? (
              <p className="text-body-m text-on-surface-variant">暂无简介</p>
            ) : dictionary.error ? (
              <ErrorRetry
                size="inline"
                title="徽章简介加载失败"
                message={apiErrorMessage(dictionary.error)}
                onRetry={isRetryable(dictionary.error) ? dictionary.refresh : undefined}
              />
            ) : (
              /* Two lines at the description's own line height (21px, `body-m`): most
                 descriptions are one or two. */
              <div className="flex w-full flex-col gap-1 py-0.5" aria-hidden="true">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/5" />
              </div>
            )}
            {validity && (
              <p className="text-body-s text-on-surface-variant">
                {validity.text}
                {equipped.has(selected.name) && !validity.expired ? ' · 佩戴中' : ''}
              </p>
            )}
          </div>
        )}
      </Modal>
    </section>
  );
}
