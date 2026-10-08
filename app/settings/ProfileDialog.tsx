'use client';

import { useState } from 'react';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import Select from '@/components/Select';
import { Input, Textarea } from '@/components/Input';
import { showToast } from '@/components/Toast';
import { saveProfile } from '@/lib/api/picpony';
import { envelopeMessage, readEnvelope } from '@/lib/api/http';
import { apiErrorMessage } from '@/lib/api/errors';
import { GENDER_OPTIONS, RACE_OPTIONS, normalizeGender, normalizeRace, optionsWith } from '@/lib/profileFields';
import { readToken, readUserInfo } from '@/lib/hooks';
import { enforceContentGate, todayOnBeijingCalendar } from '@/lib/settingsSync';
import { useFieldErrors } from '@/lib/useFieldErrors';
import { saveAccountFields, text } from './useAccount';

const BIO_MAX = 500;

export interface ProfileValues {
  bio: string;
  gender: string;
  birthday: string;
  race: string;
}

export function profileOf(record: Record<string, unknown>): ProfileValues {
  return {
    bio: text(record.bio),
    gender: normalizeGender(record.gender),
    birthday: text(record.birthday),
    race: normalizeRace(record.race),
  };
}

/**
 * 编辑个人资料 — a **draft**, seeded from the saved values each time the dialog opens and committed
 * only when `save_profile` succeeds. 取消 discards it. The editor used to edit the saved values in
 * place, so a cancelled birthday stayed on screen, reopened as if saved and — since the 16+ gate
 * read the same state — unlocked 中等限制 without the server ever hearing of it. The gate reads the
 * saved record only (`enforceContentGate` after a save).
 *
 * The two dropdowns are labelled form slots, the same outlined field as the text inputs, from the
 * one vocabulary in `lib/profileFields.ts`; a stored value neither list names is offered as it is,
 * so opening the editor and saving shows — and keeps — the user's own words.
 */
export default function ProfileDialog({
  open,
  token,
  saved,
  onClose,
}: {
  open: boolean;
  token: string;
  saved: ProfileValues;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(saved);
  const [busy, setBusy] = useState(false);
  const today = todayOnBeijingCalendar();
  const form = useFieldErrors<'bio' | 'birthday'>(() => [
    ['bio', draft.bio.length > BIO_MAX ? `简介最多 ${BIO_MAX} 个字符` : null],
    ['birthday', draft.birthday && draft.birthday > today ? '生日不能晚于今天' : null],
  ]);
  const dirty =
    draft.bio !== saved.bio ||
    draft.gender !== saved.gender ||
    draft.birthday !== saved.birthday ||
    draft.race !== saved.race;

  const set = <K extends keyof ProfileValues>(key: K, value: ProfileValues[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const close = () => {
    if (busy) return;
    onClose();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !form.check()) return;
    if (!dirty) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      const data = await readEnvelope(await saveProfile(token, draft));
      if (readToken() !== token) return;
      saveAccountFields(token, { ...draft });
      /* A birthday that no longer allows 中等限制 takes it away now, not on the next load. */
      enforceContentGate(readUserInfo());
      /* Setting a race can award its badge; the backend says so in its answer, in its own register. */
      const awarded = /徽章/.test(envelopeMessage(data) ?? '');
      showToast(awarded ? '已保存个人资料，种族徽章已放入我的徽章' : '已保存个人资料', 'success');
      onClose();
    } catch (error) {
      if (readToken() === token) showToast(apiErrorMessage(error, '个人资料保存失败'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={open}
      onClose={close}
      title="编辑个人资料"
      maxWidth="lg"
      closeOnEscape={!busy}
      footer={
        <>
          <Button variant="text" type="button" onClick={close} disabled={busy}>
            取消
          </Button>
          <Button variant="filled" type="submit" form="profile-form" loading={busy}>
            保存
          </Button>
        </>
      }
    >
      <form id="profile-form" onSubmit={submit} noValidate className="space-y-4">
        <Textarea
          {...form.field('bio')}
          label="个人简介"
          data-autofocus
          name="bio"
          value={draft.bio}
          onChange={(event) => {
            set('bio', event.target.value);
            form.clear('bio');
          }}
          rows={3}
          count={{ value: draft.bio.length, max: BIO_MAX }}
          className="resize-none"
          placeholder="介绍一下你自己…"
          readOnly={busy}
        />
        <Select
          label="性别"
          value={draft.gender}
          onChange={(value) => set('gender', value)}
          options={optionsWith(GENDER_OPTIONS, draft.gender)}
          disabled={busy}
        />
        <Input
          {...form.field('birthday')}
          label="生日"
          type="date"
          name="bday"
          autoComplete="bday"
          max={today}
          value={draft.birthday}
          helper="用于内容分级：年满 16 岁可选择中等限制"
          onChange={(event) => {
            set('birthday', event.target.value);
            form.clear('birthday');
          }}
          readOnly={busy}
        />
        <Select
          label="种族"
          value={draft.race}
          onChange={(value) => set('race', value)}
          options={optionsWith(RACE_OPTIONS, draft.race)}
          disabled={busy}
        />
      </form>
    </Modal>
  );
}
