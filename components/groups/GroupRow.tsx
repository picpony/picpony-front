'use client';

import { useRef, useState, type ReactNode } from 'react';
import { MdMoreVert } from 'react-icons/md';
import Badge from '@/components/Badge';
import IconButton from '@/components/IconButton';
import Menu, { type MenuAction } from '@/components/Menu';
import Skeleton, { SkeletonCircle } from '@/components/Skeleton';
import { cn } from '@/lib/utils';

/**
 * The ink a group's state recolours on, on the clock of the switch that changes it — `FastEffects`,
 * the spring its track and handle already change on (M1-024): with no transition of its own the
 * row's text turned in the first frame while the switch was still on its way.
 */
const STATE_TRANSITION = 'spring-fast-effects transition-[background-color,color]';

/**
 * One group — a named set of tags kept on the account: /block-groups' 屏蔽组 and /tag-groups'
 * 标签组 — as a row of its page's grouped list. **One anatomy for both screens** (D1-009: they
 * were two designs one menu row apart): the name, wrapping to a second line rather than cut, over
 * a line of counts; at the trailing edge the row's own control — a rule's switch, a saved search's
 * 搜索 — and a ⋮ for the rest; its tags as marks underneath. The trailing pair is all the width
 * the name gives up, and the two are 8dp apart, so their 48dp targets meet under a finger rather
 * than overlapping (G4-014).
 *
 * `active` is a state, and a state is a container (D1-002): a rule in force wears the selection
 * pair across the whole row and its text inherits the container's ink — never the severity
 * colours, which said "something is wrong" about the user's own preference. Off, it is the list's
 * resting tone.
 */
export function GroupRow({
  name,
  summary,
  active = false,
  busy = false,
  control,
  menu,
  children,
  'data-presence-key': presenceKey,
}: {
  name: string;
  /** The line under the name: how many tags, of which kind. */
  summary: string;
  active?: boolean;
  /** The group is going away: the row says so to assistive technology. */
  busy?: boolean;
  /** The row's own control, at its trailing edge. */
  control: ReactNode;
  /** The ⋮ (`GroupMenu`) beside it. */
  menu: ReactNode;
  /** The tags (`TagMarks`), under the name. */
  children?: ReactNode;
  /** The list's presence handle (`PresenceList`), on the row's own root. */
  'data-presence-key'?: string;
}) {
  return (
    <li
      className={cn(
        'm3-row p-4',
        STATE_TRANSITION,
        active ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container-low text-on-surface',
      )}
      aria-busy={busy || undefined}
      data-presence-key={presenceKey}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          {/* `title` for the rare name past two lines — the text is on screen, cut only at its end. */}
          <h2 className="line-clamp-2 text-title-m wrap-anywhere" title={name}>
            {name}
          </h2>
          <p className={cn('text-body-s', STATE_TRANSITION, !active && 'text-on-surface-variant')}>{summary}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {control}
          {menu}
        </div>
      </div>
      {children && <div className="mt-3 flex flex-col gap-2">{children}</div>}
    </li>
  );
}

/**
 * A group's ⋮ and the commands it opens. `busy` while one of them is out (a share link being
 * made, a delete): the menu returns focus here after running an item, so the spinner sits where
 * the person's focus is, and the button keeps it.
 */
export function GroupMenu({
  label,
  items,
  busy = false,
  onSelect,
}: {
  /** Names the button and the menu: 「name」的更多操作. */
  label: string;
  items: MenuAction[];
  busy?: boolean;
  onSelect: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <IconButton
        ref={anchorRef}
        icon={<MdMoreVert />}
        aria-label={label}
        tooltip="更多操作"
        aria-haspopup="menu"
        aria-expanded={open}
        loading={busy}
        onClick={() => setOpen((value) => !value)}
      />
      <Menu open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} aria-label={label} items={items} onSelect={onSelect} />
    </>
  );
}

/**
 * A group's tags as marks, the first `preview` of them and then how many more. `icon` leads the
 * run when a group holds two kinds (a rule's 隐藏 and 遮挡): the glyph is the visible difference,
 * `label` the list's name for a screen reader. The count beyond the preview takes the row's
 * supporting ink — the container's own on an active row.
 */
export function TagMarks({
  tags,
  preview,
  label,
  icon,
  active = false,
}: {
  tags: readonly string[];
  preview: number;
  label: string;
  icon?: ReactNode;
  active?: boolean;
}) {
  if (tags.length === 0) return null;
  const rest = tags.length - preview;
  return (
    <div className="flex min-w-0 items-start gap-2">
      {icon && (
        <span className={cn('flex h-5 shrink-0 items-center [&>svg]:block', STATE_TRANSITION, !active && 'text-on-surface-variant')} aria-hidden="true">
          {icon}
        </span>
      )}
      <ul className="flex min-w-0 flex-wrap items-center gap-1.5" aria-label={label}>
        {tags.slice(0, preview).map((tag) => (
          <li key={tag} className="max-w-full">
            <Badge title={tag}>{tag}</Badge>
          </li>
        ))}
        {rest > 0 && (
          <li className={cn('text-body-s', STATE_TRANSITION, !active && 'text-on-surface-variant')}>+{rest}</li>
        )}
      </ul>
    </div>
  );
}

/** The list while it is read, row for row in the loaded list's geometry. */
export function GroupRowsSkeleton({ control }: { control: 'switch' | 'button' }) {
  return (
    <div data-page-loading aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="m3-row bg-surface-container-low p-4">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1 space-y-1.5 py-0.5">
              <Skeleton className="h-5 w-36 max-w-full" delay={i * 90} />
              <Skeleton className="h-4 w-24 max-w-full" delay={i * 90 + 40} />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Skeleton className={cn('rounded-full', control === 'switch' ? 'h-8 w-13' : 'h-10 w-10 sm:w-24')} delay={i * 90 + 60} />
              <SkeletonCircle size={40} delay={i * 90 + 80} />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {['w-16', 'w-12', 'w-20', 'w-10'].map((width, j) => (
              <Skeleton key={width} className={cn('h-5 rounded-xs', width)} delay={i * 90 + 100 + j * 30} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
