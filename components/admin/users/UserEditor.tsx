'use client';

import DateInput from '../DateInput';

import { useEffect, useId, useState } from 'react';
import { MdDeleteOutline, MdEdit, MdPassword } from 'react-icons/md';
import Button from '@/components/Button';
import IconButton from '@/components/IconButton';
import InlineEditorPanel from '@/components/InlineEditorPanel';
import { Field, Input, Textarea } from '@/components/Input';
import RoleBadge from '@/components/RoleBadge';
import SectionHeading from '@/components/SectionHeading';
import Select from '@/components/Select';
import UserBadge from '@/components/UserBadge';
import { showToast } from '@/components/Toast';
import { GENDER_OPTIONS, optionsWith } from '@/lib/profileFields';
import type { Role } from '@/lib/roles';
import { copyText } from '@/lib/utils';
import { formatDateTime } from '@/lib/format';
import { validateApiKey, validateEmail, validateNewPassword, validateUsername, PASSWORD_HINT } from '@/lib/validation';
import { AdminForm, FormActions, FormGrid } from '../AdminForm';
import {
  initialUserForm,
  randomPassword,
  roleChoice,
  userUpdatePayload,
  type AdminUserBadge,
  type EditableUser,
  type UserFormValues,
} from './rules';

export interface AdminUser extends EditableUser {
  id: number;
  username: string;
  email: string;
  role: string;
  api_key: string | null;
  derpi_user_id?: string | number | null;
  derpi_username?: string | null;
  is_banned: number;
  created_at?: string | null;
  last_online?: string | null;
  last_ip?: string | null;
  ip_location?: string | null;
  badges?: unknown;
}

type FieldName = 'username' | 'email' | 'password' | 'apiKey';

export function userEditorId(userId: number) {
  return `users-inline-${userId}-editor`;
}

/**
 * The user editor, under its row (R9-010): an ordinary form column of labelled outlined fields,
 * two columns once the form has room — not a two-column table under a 「字段 / 内容」 header whose
 * labels sat 19px above their fields. Warnings are each field's supporting text; a save sends what
 * changed (`userUpdatePayload`).
 *
 * **The password field is a new password, and says so to the browser** (R9-006): a username and
 * then a password is the shape password managers fill with the administrator's own saved
 * credential, which a save would then set as this user's password. `autoComplete="new-password"`
 * (and `off` on the account fields) stops that; 生成随机密码 makes a strong one and copies it.
 */
export default function UserEditor({
  user,
  viewer,
  closing,
  saving,
  badges,
  badgeBusy,
  onSave,
  onCancel,
  onExitComplete,
  onDirtyChange,
  onEditBadge,
  onDeleteBadge,
}: {
  user: AdminUser;
  viewer: { id: number; role: Role };
  closing: boolean;
  saving: boolean;
  badges: AdminUserBadge[];
  badgeBusy: (badgeId: number) => boolean;
  onSave: (payload: Record<string, unknown> | null) => void;
  onCancel: () => void;
  onExitComplete: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onEditBadge: (badge: AdminUserBadge) => void;
  onDeleteBadge: (badge: AdminUserBadge) => void;
}) {
  const [baseline] = useState(() => user);
  const [form, setForm] = useState<UserFormValues>(() => initialUserForm(baseline));
  const badgesHeading = useId();
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const choice = roleChoice(viewer, user);
  const id = (field: string) => `users-inline-${user.id}-${field}`;

  const dirty = userUpdatePayload(baseline, form, choice.locked === null) !== null;
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const set = <K extends keyof UserFormValues>(field: K, value: UserFormValues[K]) => {
    setForm((previous) => ({ ...previous, [field]: value }));
    if (field in errors) setErrors((previous) => ({ ...previous, [field]: undefined }));
  };

  const submit = () => {
    if (saving) return;
    const before = initialUserForm(baseline);
    const next: Partial<Record<FieldName, string>> = {};
    /* An unchanged name or address is not re-validated: an account older than a rule must still
       be editable without being renamed. */
    if (form.username.trim() !== before.username) next.username = validateUsername(form.username) ?? undefined;
    if (form.email.trim() !== before.email && form.email.trim()) next.email = validateEmail(form.email) ?? undefined;
    if (form.password) next.password = validateNewPassword(form.password) ?? undefined;
    /* A changed key is held to the rule the user's own 账户 dialog and the upload hop share (review
       P6-F4); clearing it (an unbind) and an unchanged legacy key are not re-validated. */
    if (form.apiKey.trim() && form.apiKey.trim() !== before.apiKey) next.apiKey = validateApiKey(form.apiKey) ?? undefined;
    if (Object.values(next).some(Boolean)) {
      setErrors(next);
      const first = (['username', 'email', 'password', 'apiKey'] as const).find((field) => next[field]);
      if (first) document.getElementById(id(first === 'apiKey' ? 'api-key' : first))?.focus();
      return;
    }
    onSave(userUpdatePayload(baseline, form, choice.locked === null));
  };

  const generate = async () => {
    const password = randomPassword();
    set('password', password);
    showToast((await copyText(password)) ? '已生成随机密码并复制' : '已生成随机密码', 'success');
  };

  const facts = [
    user.created_at ? `注册于 ${formatDateTime(user.created_at)}` : null,
    user.last_online ? `最近在线 ${formatDateTime(user.last_online)}` : null,
    user.ip_location ? `IP 属地 ${user.ip_location}` : null,
    user.last_ip ? `最近 IP ${user.last_ip}` : null,
    user.derpi_username ? `Derpibooru：${user.derpi_username}` : null,
  ].filter(Boolean);

  return (
    <InlineEditorPanel
      id={userEditorId(user.id)}
      label={`编辑用户 ${user.username}`}
      isClosing={closing}
      onExitComplete={onExitComplete}
      onEscape={saving ? undefined : onCancel}
    >
      {/* The panel is the named region (编辑用户 …); the form inside it is not a second one (G4-031). */}
      <AdminForm onSubmit={submit}>
          <SectionHeading
            as="h3"
            subtitle={facts.length > 0 ? facts.join(' · ') : undefined}
            aside={<RoleBadge role={user.role} showUser size="md" />}
          >
            {`#${user.id} ${user.username}`}
          </SectionHeading>
          <FormGrid>
            <Input
              id={id('username')}
              label="用户名"
              name="admin-edit-username"
              autoComplete="off"
              spellCheck={false}
              value={form.username}
              readOnly={saving}
              error={errors.username}
              onChange={(event) => set('username', event.target.value)}
            />
            <Input
              id={id('email')}
              label="邮箱"
              type="email"
              name="admin-edit-email"
              autoComplete="off"
              spellCheck={false}
              value={form.email}
              readOnly={saving}
              error={errors.email}
              onChange={(event) => set('email', event.target.value)}
            />
            <Input
              id={id('password')}
              label="新密码"
              type="password"
              name="new-password"
              autoComplete="new-password"
              value={form.password}
              readOnly={saving}
              error={errors.password}
              helper={`留空则不修改；修改后该用户需在所有设备上重新登录。${PASSWORD_HINT}`}
              onChange={(event) => set('password', event.target.value)}
              trailing={
                <IconButton
                  aria-label="生成随机密码"
                  icon={<MdPassword />}
                  disabled={saving}
                  onClick={() => void generate()}
                />
              }
            />
            <Input
              id={id('api-key')}
              label="Derpibooru API Key"
              name="admin-edit-api-key"
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              value={form.apiKey}
              readOnly={saving}
              error={errors.apiKey}
              helper="清空后保存会解除该用户的 API Key 绑定"
              onChange={(event) => set('apiKey', event.target.value)}
            />
            <Field helper={choice.locked ?? choice.note ?? undefined}>
              <Select
                label="角色"
                value={form.role}
                options={choice.options}
                disabled={saving || choice.locked !== null}
                onChange={(value) => set('role', value)}
              />
            </Field>
            <Select
              label="性别"
              value={form.gender}
              options={optionsWith(GENDER_OPTIONS, form.gender)}
              disabled={saving}
              onChange={(value) => set('gender', value)}
            />
            <DateInput
              id={id('birthday')}
              label="生日"

              value={form.birthday}
              readOnly={saving}
              onChange={(event) => set('birthday', event.target.value)}
            />
          </FormGrid>
          <Textarea
            id={id('bio')}
            label="个人简介"
            rows={3}
            className="resize-none"
            value={form.bio}
            readOnly={saving}
            onChange={(event) => set('bio', event.target.value)}
          />
          {badges.length > 0 && (
            <section aria-labelledby={badgesHeading} className="space-y-2">
              <h4 id={badgesHeading} className="text-label-l text-on-surface-variant">已获得的徽章</h4>
              <ul className="flex flex-wrap gap-x-4 gap-y-1">
                {badges.map((badge) => (
                  <li key={badge.id} className="flex items-center gap-1">
                    <UserBadge name={badge.name} color={badge.color} />
                    <IconButton
                      size="sm"
                      aria-label={`编辑徽章 ${badge.name}`}
                      icon={<MdEdit />}
                      disabled={saving || badgeBusy(badge.id)}
                      onClick={() => onEditBadge(badge)}
                    />
                    <IconButton
                      size="sm"
                      variant="danger-text"
                      aria-label={`删除徽章 ${badge.name}`}
                      icon={<MdDeleteOutline />}
                      loading={badgeBusy(badge.id)}
                      disabled={saving}
                      onClick={() => onDeleteBadge(badge)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
          <FormActions>
            <Button type="button" variant="text" onClick={onCancel} disabled={saving}>
              取消
            </Button>
            <Button type="submit" variant="filled" loading={saving}>
              保存修改
            </Button>
          </FormActions>
      </AdminForm>
    </InlineEditorPanel>
  );
}
