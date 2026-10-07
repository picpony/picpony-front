'use client';

import { useState } from 'react';
import Modal from './Modal';
import Button from './Button';
import Checkbox from './Checkbox';
import Skeleton from './Skeleton';
import ErrorRetry from './ErrorRetry';
import EmptyState from './EmptyState';
import UserBadge from './UserBadge';
import { showToast } from './Toast';
import { SKIP, useResource } from '@/lib/resource';
import { myBadges, tasks, userProfile } from '@/lib/resources';
import { equipBadges } from '@/lib/api/picpony';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { readToken, updateUserInfo } from '@/lib/hooks';
import {
  MAX_EQUIPPED_BADGES,
  badgeValidity,
  sameEquipped,
  type EquippedBadge,
  type HeldBadge,
} from '@/lib/userBadges';

interface BadgeEquipDialogProps {
  open: boolean;
  onClose: () => void;
  /** The signed-in owner's token and profile id — the profile the worn set is written back to. */
  token: string;
  profileId: string;
  /** The clock expiry is judged by. */
  now: number;
}

/** What the dialog is editing: the names chosen, seeded once per opening from the server's set. */
interface Draft {
  /** The `myBadges` answer the draft was seeded from, so a refresh underneath does not reseed it. */
  seededFrom: { badges: HeldBadge[]; equipped: EquippedBadge[] } | null;
  chosen: ReadonlySet<string>;
}

/**
 * 管理佩戴 — the owner chooses which badges appear beside their name (decision 15; the original
 * front end's 我的徽章 list: at most three, an expired badge unselectable, one save for the set).
 *
 * The list is `get_my_badges`, read when the dialog opens: the owner's own answer, fresher than
 * the five-minute public profile record. A save writes the new set everywhere it is shown — the
 * profile header (`userProfile`), this list (`myBadges`), the session, and /tasks' level card
 * (expired, so it re-reads) — only after the backend has accepted it.
 */
export default function BadgeEquipDialog({ open, onClose, token, profileId, now }: BadgeEquipDialogProps) {
  const [draft, setDraft] = useState<Draft>({ seededFrom: null, chosen: new Set() });
  const [saving, setSaving] = useState(false);
  /* Each opening starts from the server's set. Reset on the way *in*, not out: the dialog keeps
     painting its list through the exit animation, and a draft cleared on close would untick the
     boxes while they fade. */
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setDraft({ seededFrom: null, chosen: new Set() });
  }

  const read = useResource(myBadges, open ? { token } : SKIP);
  /* Seeded during render from the answer the dialog opened on (the documented pattern for state
     that follows other state): an effect would paint one frame of unticked boxes first. A refresh
     that lands while the owner is choosing leaves their choice alone. */
  const data = read.data;
  if (open && data && draft.seededFrom === null) {
    const current = new Set(
      data.badges.filter((badge) => !badgeValidity(badge.expiresAt, now).expired).map((badge) => badge.name),
    );
    setDraft({
      seededFrom: data,
      chosen: new Set(data.equipped.map((badge) => badge.badge_name).filter((name) => current.has(name))),
    });
  }

  const source = draft.seededFrom;
  const held = source?.badges ?? [];
  const chosenList: EquippedBadge[] = held
    .filter((badge) => draft.chosen.has(badge.name))
    .map((badge) => ({ badge_name: badge.name, badge_color: badge.color }));
  const initialList = (source?.equipped ?? []).filter((badge) =>
    held.some((h) => h.name === badge.badge_name && !badgeValidity(h.expiresAt, now).expired),
  );
  const changed = source !== null && !sameEquipped(chosenList, initialList);
  const full = draft.chosen.size >= MAX_EQUIPPED_BADGES;

  const toggle = (name: string, checked: boolean) => {
    /* Ignored rather than disabled while a save is in flight: a disabled checkbox drops the focus
       it holds. */
    if (saving) return;
    setDraft((previous) => {
      const chosen = new Set(previous.chosen);
      if (checked) {
        if (chosen.size >= MAX_EQUIPPED_BADGES) return previous;
        chosen.add(name);
      } else {
        chosen.delete(name);
      }
      return { ...previous, chosen };
    });
  };

  const save = async () => {
    if (!changed || saving) return;
    const list = chosenList;
    setSaving(true);
    /* No `finally`: the React Compiler cannot lower one, and it skipped the whole dialog for it. */
    let failure: unknown = null;
    try {
      await equipBadges(token, list);
    } catch (error) {
      failure = error;
    }
    setSaving(false);
    if (failure !== null) {
      showToast(apiErrorMessage(failure, '徽章佩戴保存失败，请稍后再试'), 'error');
      return;
    }
    /* A save that lands after the account changed is not this account's to write. */
    if (readToken() !== token) return;
    myBadges.write({ token }, (previous) => ({ badges: previous?.badges ?? held, equipped: list }));
    /* Only a profile record already held is corrected; a write on an empty key would *create*
       one, and `null` there means "no such user". */
    const shown = userProfile.peek({ id: profileId }).data;
    if (shown) userProfile.write({ id: profileId }, { ...shown, equipped_badges: list });
    tasks.expire({ token });
    updateUserInfo(token, { equipped_badges: list });
    showToast(list.length > 0 ? '已更新佩戴的徽章' : '已取下全部徽章', 'success');
    onClose();
  };

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="管理佩戴"
      maxWidth="md"
      hideCloseButton
      footer={
        <>
          <Button variant="text" onClick={onClose}>
            取消
          </Button>
          <Button variant="filled" onClick={save} loading={saving} disabled={!changed}>
            保存
          </Button>
        </>
      }
    >
      <p className="text-body-m text-on-surface-variant">
        最多同时佩戴 {MAX_EQUIPPED_BADGES} 个徽章，佩戴的徽章会显示在你的名字旁。
      </p>
      {source === null && data === undefined && read.error ? (
        <ErrorRetry
          size="inline"
          title="徽章加载失败"
          message={apiErrorMessage(read.error)}
          onRetry={isRetryable(read.error) ? read.refresh : undefined}
        />
      ) : source === null ? (
        /* The rows' own shape: a 40dp checkbox cell, the badge, its validity. */
        <ul className="mt-4 flex flex-col gap-1" aria-hidden="true">
          {Array.from({ length: 3 }, (_, index) => (
            <li key={index} className="flex min-h-12 items-center gap-3 px-1">
              <Skeleton className="size-5 shrink-0 rounded-xs" delay={index * 80} />
              <Skeleton className="h-5 w-20 rounded-xs" delay={index * 80 + 40} />
              <Skeleton className="h-4 w-16" delay={index * 80 + 80} />
            </li>
          ))}
        </ul>
      ) : held.length === 0 ? (
        <EmptyState size="inline" title="你还没有获得任何徽章" />
      ) : (
        <>
          <ul className="mt-4 flex flex-col gap-1">
            {held.map((badge) => {
              const validity = badgeValidity(badge.expiresAt, now);
              const checked = draft.chosen.has(badge.name);
              return (
                <li key={badge.name} className="flex min-h-12 items-center">
                  <Checkbox
                    checked={checked}
                    onChange={(next) => toggle(badge.name, next)}
                    disabled={validity.expired || (!checked && full)}
                    label={
                      <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                        <UserBadge name={badge.name} color={badge.color} size="md" />
                        <span className="text-body-s text-on-surface-variant">{validity.text}</span>
                      </span>
                    }
                  />
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-body-s text-on-surface-variant tabular-nums" aria-live="polite">
            已选择 {draft.chosen.size} / {MAX_EQUIPPED_BADGES}
          </p>
        </>
      )}
    </Modal>
  );
}
