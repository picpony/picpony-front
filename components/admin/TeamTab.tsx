'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MdDeleteOutline, MdEdit } from 'react-icons/md';
import Avatar from '@/components/Avatar';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import DataTable, { type Column } from '@/components/DataTable';
import IconButton from '@/components/IconButton';
import InlineEditorPanel, { captureInlineEditorLayout } from '@/components/InlineEditorPanel';
import { Input } from '@/components/Input';
import SectionHeading from '@/components/SectionHeading';
import Select from '@/components/Select';
import { showToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { teamMembers, userProfile } from '@/lib/resources';
import { apiErrorMessage, isNotFound } from '@/lib/api/errors';
import * as adminApi from '@/lib/api/admin';
import SectionHeader from './SectionHeader';
import { AdminForm, AdminNote, FormActions, FormGrid } from './AdminForm';
import { AdminListAnchor, AdminPager, usePagedRows } from './paging';
import { defineAdminQuery, useAdminQuery, adminList, tableError } from './queries';
import { useAdminMutation } from './useAdminMutation';
import type { AdminPanelProps } from './registry';
import {
  TEAM_CATEGORIES,
  boundUser,
  externalLink,
  suggestion,
  teamForm,
  teamPayload,
  type TeamFormErrors,
  type TeamFormValues,
  type TeamMemberRow,
} from './team';
import { figureOf, figureText } from './figures';

const EMPTY: TeamMemberRow[] = [];
/* `include_all=1` — the roster as the original console edits it, bound accounts and the editors'
   automatic ranking included. /about's public read (`teamMembers`) is refreshed beside it. */
const membersQuery = defineAdminQuery<TeamMemberRow[]>('team', async (token, signal) => {
  const data = await adminApi.adminGetTeamMembers(token, signal);
  return adminList<TeamMemberRow>(data, 'members', '团队成员');
});

const categoryLabel = (value: unknown) =>
  TEAM_CATEGORIES.find((option) => option.value === value)?.label ?? String(value ?? '');

function teamEditorId(memberId: number) {
  return `team-inline-${memberId}-editor`;
}

/**
 * 团队管理 — the roster /about shows.
 *
 * A new member is added in the form above the list; an existing one is edited **under its own
 * row** (R9-021). Editing used to fill the add form at the top of the tab, so pressing 编辑 far down
 * the list changed a form 900px above the viewer, and a later 添加成员 turned out to update that
 * far-away row.
 */
export default function TeamTab({ token }: AdminPanelProps) {
  const read = useAdminQuery(membersQuery, token);
  const members = read.data ?? EMPTY;
  const paged = usePagedRows(members, token);
  const addMutation = useAdminMutation(token);
  const saveMutation = useAdminMutation(token);
  const deleteMutation = useAdminMutation(token);
  const { confirm, confirmThen, confirmDialog } = useConfirm();
  const [editing, setEditing] = useState<{ id: number; closing: boolean } | null>(null);
  /* A fresh add form after each add: the session is its key. */
  const [addSession, setAddSession] = useState(0);
  const dirtyRef = useRef(false);
  const setDirty = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);

  const committed = () => {
    read.refresh();
    teamMembers.invalidate();
  };

  const add = (payload: Record<string, unknown>) =>
    void addMutation.run(
      () => adminApi.addTeamMember(token, payload),
      () => {
        showToast(`已添加成员「${String(payload.name)}」`, 'success');
        setAddSession((session) => session + 1);
      },
      '添加失败',
      { onCommitted: committed },
    );

  const save = (member: TeamMemberRow, payload: Record<string, unknown>) =>
    void saveMutation.run(
      () => adminApi.updateTeamMember(token, payload),
      () => {
        showToast(`已保存成员「${String(payload.name)}」`, 'success');
        setEditing((current) => (current?.id === member.id ? { id: member.id, closing: true } : current));
      },
      '保存失败',
      { key: member.id, onCommitted: committed },
    );

  const remove = (member: TeamMemberRow) =>
    confirmThen(
      '确认删除成员',
      `确定要删除团队成员「${member.name}」吗？删除后关于页将不再显示该成员。`,
      () => void deleteMutation.run(
        () => adminApi.deleteTeamMember(token, member.id),
        () => showToast(`已删除成员「${member.name}」`, 'success'),
        '删除失败',
        {
          key: member.id,
          onCommitted: () => {
            setEditing((current) => (current?.id === member.id ? null : current));
            membersQuery.write(token, (previous) => previous?.filter((row) => row.id !== member.id) ?? []);
            committed();
          },
        },
      ),
    );

  const openEditor = async (member: TeamMemberRow, trigger: HTMLElement) => {
    if (editing && saveMutation.isPending(editing.id)) return;
    if (editing && editing.id !== member.id && !editing.closing && dirtyRef.current) {
      const current = members.find((row) => row.id === editing.id);
      const discard = await confirm({
        title: '确认放弃修改',
        message: `确定要放弃对成员「${current?.name ?? ''}」的修改吗？`,
      });
      if (!discard) return;
    }
    captureInlineEditorLayout(trigger);
    dirtyRef.current = false;
    setEditing({ id: member.id, closing: false });
  };

  const closeEditor = () => {
    if (!editing || saveMutation.isPending(editing.id)) return;
    setEditing({ ...editing, closing: true });
  };

  const columns: Column<TeamMemberRow>[] = [
    {
      key: 'member',
      header: '成员',
      primary: true,
      render: (member) => (
        <span className="flex min-w-0 items-center gap-3">
          <Avatar src={member.account_avatar || member.avatar_url} name={member.name} size={40} unoptimized />
          <span className="min-w-0">
            <span className="block text-body-m-emphasized text-on-surface">{member.name}</span>
            {member.role && <span className="block text-body-s text-on-surface-variant">{member.role}</span>}
          </span>
        </span>
      ),
    },
    { key: 'category', header: '栏目', width: 'auto', render: (member) => categoryLabel(member.category) },
    {
      key: 'account',
      header: '关联用户',
      width: 'auto',
      render: (member) => {
        const uid = boundUser(member.user_id);
        return uid ? `#${uid}` : <span className="text-on-surface-variant">未关联</span>;
      },
    },
    {
      key: 'rank',
      header: '贡献榜',
      width: 'auto',
      render: (member) =>
        Number(member.auto_editor_rank) > 0 ? (
          <Badge tone="primary" size="md">
            {/* A contribution count that did not arrive is left out, not printed as 0 条 (G4-015). */}
            {[`第 ${Number(member.auto_editor_rank)} 名`, figureOf(member.auto_editor_count) !== null ? `${figureText(member.auto_editor_count)} 条` : null]
              .filter(Boolean)
              .join(' · ')}
          </Badge>
        ) : (
          <span className="text-on-surface-variant">手动添加</span>
        ),
    },
    {
      key: 'order',
      header: '排序',
      width: 'auto',
      render: (member) => <span className="tabular-nums">{figureText(member.order_num)}</span>,
    },
    {
      key: 'actions',
      header: '操作',
      actions: true,
      render: (member) => {
        const open = editing?.id === member.id && !editing.closing;
        const busy = saveMutation.pendingKeys.has(member.id) || deleteMutation.pendingKeys.has(member.id);
        return (
          <>
            <IconButton
              size="sm"
              icon={<MdEdit />}
              aria-label={`编辑成员 ${member.name}`}
              aria-expanded={open}
              aria-controls={teamEditorId(member.id)}
              disabled={busy && !open}
              onClick={(event) => {
                if (open) closeEditor();
                else void openEditor(member, event.currentTarget);
              }}
            />
            <IconButton
              size="sm"
              variant="danger-text"
              icon={<MdDeleteOutline />}
              aria-label={`删除成员 ${member.name}`}
              loading={deleteMutation.pendingKeys.has(member.id)}
              disabled={saveMutation.pendingKeys.has(member.id)}
              onClick={() => remove(member)}
            />
          </>
        );
      },
    },
  ];

  const renderEditor = (member: TeamMemberRow) => {
    if (editing?.id !== member.id) return null;
    const current = members.find((row) => row.id === member.id) ?? member;
    return (
      <InlineEditorPanel
        key={member.id}
        id={teamEditorId(member.id)}
        label={`编辑成员 ${current.name}`}
        isClosing={editing.closing}
        onExitComplete={() => setEditing((state) => (state?.id === member.id && state.closing ? null : state))}
        onEscape={saveMutation.pendingKeys.has(member.id) ? undefined : closeEditor}
      >
        <TeamMemberForm
          member={current}
          heading={`编辑成员 · ${current.name}`}
          submitLabel="保存修改"
          busy={saveMutation.pendingKeys.has(member.id)}
          onSubmit={(payload) => save(current, payload)}
          onCancel={closeEditor}
          onDirtyChange={setDirty}
        />
      </InlineEditorPanel>
    );
  };

  return (
    <div className="space-y-6">
      <SectionHeader section="team" onRefresh={read.refresh} isLoading={read.refreshing} />
      <div className="space-y-4">
        <TeamMemberForm
          key={addSession}
          heading="添加团队成员"
          submitLabel="添加成员"
          busy={addMutation.busy}
          onSubmit={add}
        />
      </div>
      <section aria-labelledby="admin-team-members-heading" className="space-y-4">
        <SectionHeading as="h3" id="admin-team-members-heading">成员列表</SectionHeading>
        <AdminNote>
          小编团队按词库贡献榜自动同步前 16 名：每次读取列表时更新榜单成员、名次和贡献数；姓名、头衔、关联用户和备用头像仍可编辑，不在榜单上的小编记录只保留在后台。
        </AdminNote>
        <AdminListAnchor>
          <DataTable<TeamMemberRow>
            columns={columns}
            rows={paged.rows}
            listKey={paged.listKey}
            rowKey={(member) => member.id}
            expandedRow={renderEditor}
            loading={read.loading}
            skeletonRows={6}
            {...tableError('团队成员加载失败', read.error)}
            onRetry={read.retryable ? read.refresh : undefined}
            empty="暂无成员"
          />
          <AdminPager page={paged.page} totalPages={paged.totalPages} onPageChange={(page) => { setEditing(null); paged.setPage(page); }} />
        </AdminListAnchor>
      </section>
      {confirmDialog}
    </div>
  );
}

/**
 * One member's fields — the add form above the list and the editor under a row are this one form.
 * 导入资料 fills it from the account typed into 关联站内用户 ID (`get_user_profile`, the original
 * console's 快捷导入); typing again, or leaving, makes a slower answer obsolete before it lands.
 */
function TeamMemberForm({
  member,
  heading,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
  onDirtyChange,
}: {
  member?: TeamMemberRow;
  heading: string;
  submitLabel: string;
  busy: boolean;
  onSubmit: (payload: Record<string, unknown>) => void;
  onCancel?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [values, setValues] = useState<TeamFormValues>(() => teamForm(member));
  const [errors, setErrors] = useState<TeamFormErrors>({});
  const [importing, setImporting] = useState(false);
  const generation = useRef(0);
  const prefix = member ? `team-${member.id}` : 'team-new';
  const external = member ? externalLink(member.link_url) : null;

  const initial = teamForm(member);
  const dirty = (Object.keys(initial) as (keyof TeamFormValues)[]).some((key) => initial[key] !== values[key]);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => {
    generation.current += 1;
  }, []);

  const set = <K extends keyof TeamFormValues>(field: K, value: TeamFormValues[K]) => {
    /* Editing what an import is about to overwrite makes that import obsolete. */
    if (importing) {
      generation.current += 1;
      setImporting(false);
    }
    setValues((previous) => ({ ...previous, [field]: value }));
    if (field in errors) setErrors((previous) => ({ ...previous, [field]: undefined }));
  };

  const importProfile = async () => {
    const text = values.userId.trim();
    const uid = boundUser(text);
    if (!/^\d+$/.test(text) || !uid) {
      setErrors((previous) => ({ ...previous, userId: text ? '站内用户 ID 须为正整数' : '请先填写要导入的站内用户 ID' }));
      return;
    }
    const ticket = ++generation.current;
    setImporting(true);
    /* Settled into a value rather than a try/finally, which the React Compiler cannot lower (it
       skipped this whole form). An answer that an edit made obsolete changes nothing, busy state
       included: the edit already took that over. */
    const outcome = await userProfile.read({ id: String(uid) }).then(
      (profile) => ({ profile, error: null as unknown }),
      (error: unknown) => ({ profile: null, error }),
    );
    if (generation.current !== ticket) return;
    setImporting(false);
    if (outcome.error) {
      if (isNotFound(outcome.error)) setErrors((previous) => ({ ...previous, userId: `没有 ID 为 ${uid} 的用户` }));
      else showToast(apiErrorMessage(outcome.error, '导入失败'), 'error');
      return;
    }
    const profile = outcome.profile;
    if (!profile) {
      setErrors((previous) => ({ ...previous, userId: `没有 ID 为 ${uid} 的用户` }));
      return;
    }
    const suggested = suggestion(profile.role);
    setValues((previous) => ({
      ...previous,
      userId: String(uid),
      name: profile.username,
      avatarUrl: profile.avatar ?? '',
      /* A title already typed is the admin's; the role's suggestion only fills a blank one. */
      title: previous.title.trim() ? previous.title : suggested.title,
      category: previous.title.trim() ? previous.category : suggested.category,
    }));
    setErrors({});
    showToast(`已导入「${profile.username}」的资料`, 'success');
  };

  const submit = () => {
    if (busy) return;
    generation.current += 1;
    setImporting(false);
    const result = teamPayload(values, member);
    if (result.errors) {
      setErrors(result.errors);
      return;
    }
    onSubmit(result.payload);
  };

  return (
    /* Above the list this form is the region, named by its heading; under a row the editor's panel
       is (`InlineEditorPanel`'s label), so the form inside it is not a second landmark (G4-031). */
    <AdminForm onSubmit={submit} aria-labelledby={member ? undefined : `${prefix}-heading`}>
      <SectionHeading as="h3" id={`${prefix}-heading`}>{heading}</SectionHeading>
      <FormGrid>
        <Input
          id={`${prefix}-user`}
          label="关联站内用户 ID"
          inputMode="numeric"
          autoComplete="off"
          value={values.userId}
          readOnly={busy}
          error={errors.userId}
          helper="关联后，关于页显示该用户当前的头像，成员卡片链接到其个人主页"
          onChange={(event) => set('userId', event.target.value)}
          trailing={
            <Button type="button" variant="text" loading={importing} disabled={busy} onClick={() => void importProfile()}>
              导入资料
            </Button>
          }
        />
        <Input
          id={`${prefix}-name`}
          label="成员姓名"
          required
          autoComplete="off"
          value={values.name}
          readOnly={busy}
          error={errors.name}
          onChange={(event) => set('name', event.target.value)}
        />
        <Input
          id={`${prefix}-title`}
          label="头衔"
          autoComplete="off"
          placeholder="例如：全栈开发"
          value={values.title}
          readOnly={busy}
          onChange={(event) => set('title', event.target.value)}
        />
        <Select
          label="栏目"
          value={values.category}
          options={TEAM_CATEGORIES}
          disabled={busy}
          onChange={(value) => set('category', value)}
        />
        <Input
          id={`${prefix}-avatar`}
          label="备用头像链接"
          autoComplete="off"
          spellCheck={false}
          value={values.avatarUrl}
          readOnly={busy}
          helper="未关联站内用户，或其头像无法加载时显示"
          onChange={(event) => set('avatarUrl', event.target.value)}
        />
        <Input
          id={`${prefix}-order`}
          label="排序号"
          inputMode="numeric"
          autoComplete="off"
          value={values.order}
          readOnly={busy}
          error={errors.order}
          helper="数值越小越靠前"
          onChange={(event) => set('order', event.target.value)}
        />
      </FormGrid>
      {external && (
        <p className="px-4 text-body-s text-on-surface-variant wrap-anywhere">
          {`当前卡片链接：${external}。关联站内用户后，卡片会改为链接到该用户的主页。`}
        </p>
      )}
      <FormActions>
        {onCancel && (
          <Button type="button" variant="text" onClick={onCancel} disabled={busy}>
            取消
          </Button>
        )}
        <Button type="submit" variant="filled" loading={busy}>
          {submitLabel}
        </Button>
      </FormActions>
    </AdminForm>
  );
}
