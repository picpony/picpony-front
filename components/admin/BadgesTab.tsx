'use client';

import DateInput from './DateInput';

import { useState } from 'react';
import { MdContentCopy, MdEmojiEvents, MdLink } from 'react-icons/md';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import DataTable, { type Column } from '@/components/DataTable';
import IconButton from '@/components/IconButton';
import { Input } from '@/components/Input';
import Radio from '@/components/Radio';
import SectionHeading from '@/components/SectionHeading';
import Tabs from '@/components/Tabs';
import TabPanes, { TabPane } from '@/components/TabPanes';
import UserBadge from '@/components/UserBadge';
import { showToast } from '@/components/Toast';
import { useConfirm, usePrompt } from '@/components/ConfirmDialog';
import { copyText } from '@/lib/utils';
import { formatDate } from '@/lib/format';
import * as adminApi from '@/lib/api/admin';
import SectionHeader from './SectionHeader';
import ColorField, { isHexColor } from './ColorField';
import { AdminForm, AdminNote, FormActions, FormGrid } from './AdminForm';
import { AdminListAnchor, AdminPager, usePagedRows } from './paging';
import { defineAdminQuery, useAdminQuery, adminList, tableError } from './queries';
import { useAdminMutation } from './useAdminMutation';
import type { AdminPanelProps } from './registry';
import { grantPayload, parseUserIds, type GrantForm } from './badges';
import BadgeDictionaryPane from './catalogTools/BadgeDictionaryPane';
import DeleteBadgeLinkAction from './catalogTools/DeleteBadgeLinkAction';

interface BadgeLink {
  id: number;
  token: string;
  badge_name: string;
  badge_color: string;
  is_active: number;
  badge_expires_at: string | null;
  link_expires_at: string | null;
  required_location?: string | null;
  location_error_msg?: string | null;
}

type SubTab = 'grant' | 'links' | 'badge-dictionary';

const linksQuery = defineAdminQuery<BadgeLink[]>('badge-links', async (token, signal) => {
  const data = await adminApi.adminGetBadgeLinks(token, signal);
  return adminList<BadgeLink>(data, ['data.links', 'links'], '领取链接');
});

const SUB_TABS: { value: SubTab; label: string }[] = [
  { value: 'grant', label: '授予徽章' },
  { value: 'links', label: '领取链接' },
  { value: 'badge-dictionary', label: '徽章简介' },
];

/**
 * 徽章管理: grant a badge to people, or mint a link anyone can claim one with.
 *
 * The sub-tabs are plain `TabPanes` (decision 25: a work tool does not lean). The link list is
 * read when 领取链接 is first opened — and until it lands the pane shows the list's skeleton, not
 * 「暂无领取链接」, which used to be the pane's content all the way through its entrance (R9-017).
 * A user's badges are edited and deleted from that user's editor in 用户管理, where the badge ids
 * are; the 「已有徽章列表」 table here had no endpoint to fill it (R9-016).
 */
export default function BadgesTab({ token }: AdminPanelProps) {
  const [sub, setSub] = useState<SubTab>('grant');
  const [linksAsked, setLinksAsked] = useState(false);
  const [dictionaryAsked, setDictionaryAsked] = useState(false);
  if (sub === 'badge-dictionary' && !dictionaryAsked) setDictionaryAsked(true);
  if (sub === 'links' && !linksAsked) setLinksAsked(true);
  const links = useAdminQuery(linksQuery, linksAsked ? token : '');

  return (
    <div className="space-y-6">
      <SectionHeader section="badges"
        onRefresh={sub === 'links' ? links.refresh : undefined}
        refreshLabel="刷新链接"
        isLoading={links.refreshing}
      />
      <Tabs value={sub} onChange={setSub} activation="manual" label="徽章管理分区" tabs={SUB_TABS} />
      <TabPanes value={sub}>
        <TabPane value="grant">
          <GrantPane token={token} />
        </TabPane>
        <TabPane value="links">
          <LinksPane token={token} links={links} asked={linksAsked} />
        </TabPane>
        <TabPane value="badge-dictionary">
          {dictionaryAsked && <BadgeDictionaryPane token={token} />}
        </TabPane>
      </TabPanes>
    </div>
  );
}

const EMPTY_GRANT: GrantForm = {
  name: '',
  color: '#f1c40f',
  target: 'users',
  userIds: '',
  startDate: '',
  endDate: '',
  permanent: true,
  expiresAt: '',
};

function GrantPane({ token }: { token: string }) {
  const mutation = useAdminMutation(token);
  const { confirmThen, confirmDialog } = useConfirm();
  const [form, setForm] = useState<GrantForm>(EMPTY_GRANT);
  const [errors, setErrors] = useState<Partial<Record<keyof GrantForm, string>>>({});
  const busy = mutation.busy;

  const set = <K extends keyof GrantForm>(field: K, value: GrantForm[K]) => {
    setForm((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined }));
  };

  const submit = () => {
    if (mutation.isPending()) return;
    const next: typeof errors = {};
    if (!form.name.trim()) next.name = '请输入徽章名称';
    if (!isHexColor(form.color)) next.color = '请输入 #RRGGBB 格式的颜色';
    const ids = form.target === 'users' ? parseUserIds(form.userIds) : [];
    if (form.target === 'users' && ids === null) next.userIds = '用户 ID 须为正整数，用逗号分隔';
    else if (form.target === 'users' && ids?.length === 0) next.userIds = '请输入至少一个用户 ID';
    if (form.target === 'dates') {
      if (!form.startDate) next.startDate = '请选择起始日期';
      if (!form.endDate) next.endDate = '请选择截止日期';
      if (form.startDate && form.endDate && form.startDate > form.endDate) next.endDate = '截止日期不能早于起始日期';
    }
    if (!form.permanent && !form.expiresAt) next.expiresAt = '请选择徽章的到期日期';
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;

    const name = form.name.trim();
    const audience = form.target === 'users'
      ? `${ids?.length ?? 0} 位用户`
      : `${formatDate(form.startDate)} 至 ${formatDate(form.endDate)} 期间注册的所有用户`;
    confirmThen(
      '确认授予徽章',
      `确定要向 ${audience}授予徽章「${name}」吗？`,
      () => void mutation.run(
        () => adminApi.adminGrantBadge(token, grantPayload(form)),
        () => {
          showToast(`已授予徽章「${name}」`, 'success');
          setForm((previous) => ({ ...EMPTY_GRANT, color: previous.color }));
        },
        '授予失败',
      ),
      { tone: form.target === 'dates' ? 'danger' : 'filled' },
    );
  };

  return (
    <div className="space-y-6">
      <AdminNote>向指定的用户，或在一段日期内注册的所有用户授予专属徽章。徽章会显示在用户的发言、个人主页等处。</AdminNote>
      <AdminForm onSubmit={submit} aria-label="授予徽章">
        <FormGrid>
          <Input
            label="徽章名称"
            value={form.name}
            readOnly={busy}
            error={errors.name}
            placeholder="例如：元老、贡献者"
            onChange={(event) => set('name', event.target.value)}
          />
          <ColorField
            label="徽章颜色"
            value={form.color}
            disabled={busy}
            error={errors.color}
            onChange={(value) => set('color', value)}
          />
        </FormGrid>
        <fieldset className="m-0 min-w-0 space-y-3 border-0 p-0">
          <legend className="mb-1 text-label-l text-on-surface-variant">授予对象</legend>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Radio name="badge-target" value="users" label="指定用户" checked={form.target === 'users'} disabled={busy} onChange={() => set('target', 'users')} />
            <Radio name="badge-target" value="dates" label="按注册日期" checked={form.target === 'dates'} disabled={busy} onChange={() => set('target', 'dates')} />
          </div>
          {form.target === 'users' ? (
            <Input
              label="用户 ID"
              autoComplete="off"
              value={form.userIds}
              readOnly={busy}
              error={errors.userIds}
              helper="多个 ID 用逗号分隔"
              placeholder="例如：1, 2, 5"
              onChange={(event) => set('userIds', event.target.value)}
            />
          ) : (
            <FormGrid>
              <DateInput
                label="注册起始日期"

                value={form.startDate}
                readOnly={busy}
                error={errors.startDate}
                onChange={(event) => set('startDate', event.target.value)}
              />
              <DateInput
                label="注册截止日期"

                value={form.endDate}
                readOnly={busy}
                error={errors.endDate}
                onChange={(event) => set('endDate', event.target.value)}
              />
            </FormGrid>
          )}
        </fieldset>
        <fieldset className="m-0 min-w-0 space-y-3 border-0 p-0">
          <legend className="mb-1 text-label-l text-on-surface-variant">有效期</legend>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Radio name="badge-duration" value="permanent" label="永久有效" checked={form.permanent} disabled={busy} onChange={() => set('permanent', true)} />
            <Radio name="badge-duration" value="expiring" label="设定到期日期" checked={!form.permanent} disabled={busy} onChange={() => set('permanent', false)} />
          </div>
          {!form.permanent && (
            <DateInput
              label="到期日期"

              value={form.expiresAt}
              readOnly={busy}
              error={errors.expiresAt}
              fieldClassName="sm:w-72"
              onChange={(event) => set('expiresAt', event.target.value)}
            />
          )}
        </fieldset>
        <FormActions>
          <Button type="submit" variant="filled" icon={<MdEmojiEvents />} loading={busy}>
            授予徽章
          </Button>
        </FormActions>
      </AdminForm>
      {confirmDialog}
    </div>
  );
}

interface LinkForm {
  name: string;
  color: string;
  badgeExpiresAt: string;
  linkExpiresAt: string;
  location: string;
  locationMessage: string;
}

const EMPTY_LINK: LinkForm = {
  name: '',
  color: '#e74c3c',
  badgeExpiresAt: '',
  linkExpiresAt: '',
  location: '',
  locationMessage: '',
};

function claimUrl(token: string) {
  const url = new URL('/claim-badge', window.location.origin);
  url.searchParams.set('token', token);
  return url.href;
}

function LinksPane({
  token,
  links,
  asked,
}: {
  token: string;
  links: ReturnType<typeof useAdminQuery<BadgeLink[]>>;
  asked: boolean;
}) {
  const createMutation = useAdminMutation(token);
  const toggleMutation = useAdminMutation(token);
  const { confirmThen, confirmDialog } = useConfirm();
  const { prompt, promptDialog } = usePrompt();
  const [form, setForm] = useState<LinkForm>(EMPTY_LINK);
  const [errors, setErrors] = useState<{ name?: string; color?: string }>({});
  const creating = createMutation.busy;
  const paged = usePagedRows(links.data ?? [], token);

  const set = <K extends keyof LinkForm>(field: K, value: LinkForm[K]) => {
    setForm((previous) => ({ ...previous, [field]: value }));
    if (field === 'name' || field === 'color') setErrors((previous) => ({ ...previous, [field]: undefined }));
  };

  const create = () => {
    if (createMutation.isPending()) return;
    const next = {
      name: form.name.trim() ? undefined : '请输入徽章名称',
      color: isHexColor(form.color) ? undefined : '请输入 #RRGGBB 格式的颜色',
    };
    setErrors(next);
    if (next.name || next.color) return;
    void createMutation.run(
      () => adminApi.adminCreateBadgeLink(token, {
        badge_name: form.name.trim(),
        badge_color: form.color,
        badge_expires_at: form.badgeExpiresAt,
        link_expires_at: form.linkExpiresAt,
        required_location: form.location.trim(),
        location_error_msg: form.locationMessage.trim(),
      }),
      () => {
        showToast('已生成领取链接，可在下方列表中复制', 'success');
        setForm((previous) => ({ ...EMPTY_LINK, color: previous.color }));
      },
      '生成失败',
      { onCommitted: links.refresh },
    );
  };

  const toggle = (link: BadgeLink) => {
    const enabling = !link.is_active;
    const run = () => void toggleMutation.run(
      () => adminApi.adminToggleBadgeLink(token, link.id, enabling ? 1 : 0),
      () => showToast(enabling ? '已启用领取链接' : '已停用领取链接', 'success'),
      enabling ? '启用失败' : '停用失败',
      {
        key: link.id,
        onCommitted: () => {
          linksQuery.write(token, (previous) =>
            previous?.map((row) => (row.id === link.id ? { ...row, is_active: enabling ? 1 : 0 } : row)) ?? []);
          links.refresh();
        },
      },
    );
    if (enabling) run();
    else confirmThen('确认停用链接', `确定要停用徽章「${link.badge_name}」的领取链接吗？停用后该链接将无法再领取徽章。`, run);
  };

  const copy = async (link: BadgeLink) => {
    const url = claimUrl(link.token);
    if (await copyText(url)) {
      showToast('已复制领取链接', 'success');
      return;
    }
    void prompt({ title: '复制领取链接', label: '领取链接', defaultValue: url, message: '无法自动复制，请手动复制下面的链接。', confirmLabel: '完成', allowEmpty: true });
  };

  const expiry = (link: BadgeLink) =>
    `链接：${link.link_expires_at ? formatDate(link.link_expires_at) : '永久'} · 徽章：${link.badge_expires_at ? formatDate(link.badge_expires_at) : '永久'}`;

  const columns: Column<BadgeLink>[] = [
    {
      key: 'badge',
      header: '徽章',
      primary: true,
      render: (link) => <UserBadge name={link.badge_name} color={link.badge_color} size="md" />,
    },
    {
      key: 'state',
      header: '状态',
      width: 'auto',
      render: (link) => (
        <Badge tone={link.is_active ? 'success' : 'neutral'} size="md">
          {link.is_active ? '生效中' : '已停用'}
        </Badge>
      ),
    },
    { key: 'expiry', header: '有效期', render: (link) => <span className="text-on-surface-variant">{expiry(link)}</span> },
    {
      key: 'location',
      header: '地区限制',
      render: (link) => (
        <span className="text-on-surface-variant">{link.required_location ? `仅限 ${link.required_location}` : '不限'}</span>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      actions: true,
      render: (link) => (
        <>
          <IconButton
            size="sm"
            icon={<MdContentCopy />}
            aria-label={`复制徽章「${link.badge_name}」的领取链接`}
            onClick={() => void copy(link)}
          />
          <Button
            size="xs"
            variant={link.is_active ? 'danger-text' : 'text'}
            loading={toggleMutation.pendingKeys.has(link.id)}
            onClick={() => toggle(link)}
          >
            {link.is_active ? '停用' : '启用'}
          </Button>
          <DeleteBadgeLinkAction token={token} id={link.id} name={link.badge_name} disabled={toggleMutation.busy} onDeleted={links.refresh} />
        </>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <AdminNote>生成一个领取链接，用户打开并登录后即可领取指定的徽章。链接可以随时停用。</AdminNote>
      <AdminForm onSubmit={create} aria-label="生成领取链接">
        <FormGrid>
          <Input
            label="徽章名称"
            value={form.name}
            readOnly={creating}
            error={errors.name}
            onChange={(event) => set('name', event.target.value)}
          />
          <ColorField label="徽章颜色" value={form.color} disabled={creating} error={errors.color} onChange={(value) => set('color', value)} />
          <DateInput
            label="徽章到期日期"

            value={form.badgeExpiresAt}
            readOnly={creating}
            helper="留空则领取的徽章永久有效"
            onChange={(event) => set('badgeExpiresAt', event.target.value)}
          />
          <DateInput
            label="链接失效日期"

            value={form.linkExpiresAt}
            readOnly={creating}
            helper="留空则链接长期有效"
            onChange={(event) => set('linkExpiresAt', event.target.value)}
          />
          <Input
            label="领取地区限制"
            value={form.location}
            readOnly={creating}
            helper="只有 IP 属地包含此词的用户才能领取，例如「江苏」；留空不限制"
            onChange={(event) => set('location', event.target.value)}
          />
          <Input
            label="地区不符时的提示"
            value={form.locationMessage}
            readOnly={creating}
            helper="留空则使用默认提示"
            onChange={(event) => set('locationMessage', event.target.value)}
          />
        </FormGrid>
        <FormActions>
          <Button type="submit" variant="filled" icon={<MdLink />} loading={creating}>
            生成领取链接
          </Button>
        </FormActions>
      </AdminForm>
      <section aria-labelledby="admin-badge-links-heading" className="space-y-4">
        <SectionHeading as="h3" id="admin-badge-links-heading">已生成的链接</SectionHeading>
        <AdminListAnchor>
          <DataTable<BadgeLink>
            columns={columns}
            rows={paged.rows}
            listKey={paged.listKey}
            rowKey={(link) => link.id}
            loading={!asked || links.loading}
            skeletonRows={4}
            {...tableError('领取链接加载失败', links.error)}
            onRetry={links.retryable ? links.refresh : undefined}
            empty="暂无领取链接"
          />
          <AdminPager page={paged.page} totalPages={paged.totalPages} onPageChange={paged.setPage} />
        </AdminListAnchor>
      </section>
      {confirmDialog}
      {promptDialog}
    </div>
  );
}
