'use client';
import { useState } from 'react';
import Button from '@/components/Button';
import Checkbox from '@/components/Checkbox';
import DataTable, { type Column } from '@/components/DataTable';
import InlineEditorPanel, { captureInlineEditorLayout } from '@/components/InlineEditorPanel';
import { Input, Textarea } from '@/components/Input';
import SearchInput from '@/components/SearchInput';
import Skeleton from '@/components/Skeleton';
import Modal from '@/components/Modal';
import ToggleSwitch from '@/components/ToggleSwitch';
import { useConfirm } from '@/components/ConfirmDialog';
import { showToast } from '@/components/Toast';
import * as api from '@/lib/api/adminCatalogTools';
import { mergeDiscovery, type Pony, type Speech } from '@/lib/adminCatalogTools/model';
import { defineResource, useResource, SKIP } from '@/lib/resource';
import { apiErrorMessage, FAILURE_MESSAGES, isRetryable } from '@/lib/api/errors';
import { readToken } from '@/lib/hooks';
import { ponyCatalog, myPonies, ponyConfigs } from '@/lib/desktopPonies/queries';
import type { AdminPanelProps } from '../registry';
import { AdminForm, AdminNote, FormActions } from '../AdminForm';
import SectionHeader from '../SectionHeader';
import { defineAdminQuery, useAdminQuery, tableError } from '../queries';
import { AdminListAnchor, AdminPager, usePagedRows } from '../paging';
import { useCatalogMutation } from './useCatalogMutation';
import MutationResult from './MutationResult';

const query = defineAdminQuery('catalog-ponies', api.getPonies);
const committed = (token: string) => {
  query.expire(token);
  ponyCatalog.expire();
  myPonies.expire({ token });
  ponyConfigs.expire();
};
const speechQuery = defineResource<{ token: string; name: string; path: string }, Speech[]>({
  name: 'admin-pony-speeches',
  key: (p) => JSON.stringify(p),
  ttl: 60000,
  maxEntries: 8,
  fetch: (p, signal) => {
    if (readToken() !== p.token) throw new Error(FAILURE_MESSAGES.unauthorized);
    return api.getPonySpeeches(p.token, p.path, signal);
  },
});
export default function PoniesTab({ token }: AdminPanelProps) {
  const read = useAdminQuery(query, token);
  const [draft, setDraft] = useState<{ enabled: boolean; ponies: Pony[] } | null>(null);
  /* Every roster, name and speech write names the revision of the last read (`expected_revision`):
     a draft is edited on top of whatever read is current, and a stale one answers 409. */
  const revision = read.data?.revision ?? 0;
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Pony | null>(null);
  /* The editor stays mounted once opened so closing plays `Modal`'s own exit instead of
     disappearing between two frames; `shownPony` holds the row it was opened for while it leaves,
     and keys the instance so a different角色 starts from its own values. */
  /* `shownRow` keeps the角色 the editor was opened for while it leaves, so closing plays `Modal`'s
     own exit rather than vanishing between two frames, and keys the instance so a different角色
     starts from its own values. */
  const [shownRow, setShownRow] = useState<Pony | null>(null);
  const mutation = useCatalogMutation(token);
  const discovery = useCatalogMutation(token);
  const { confirmThen, confirmDialog } = useConfirm();
  const config = draft ?? read.data;
  const paged = usePagedRows(
    config?.ponies.filter((row) => row.name.toLowerCase().includes(filter.toLowerCase())) ?? [],
    `${token}:${filter}`,
  );
  const busy = mutation.busy || discovery.busy;
  const columns: Column<Pony>[] = [
    { key: 'name', header: '角色', primary: true, render: (row) => row.name },
    /* `aria-label`, not `label`: `Checkbox`'s `label` renders visible text inside the
       `<label>`, so every row printed 「展示 <角色名>」 beside its box under a column already
       headed 展示. */
    {
      key: 'enabled',
      header: '展示',
      width: 'auto',
      render: (row) => (
        <Checkbox
          checked={row.enabled}
          aria-label={`展示 ${row.name}`}
          disabled={busy}
          onChange={(enabled) => {
            if (config)
              setDraft({
                ...config,
                ponies: config.ponies.map((p) => (p.path === row.path ? { ...p, enabled } : p)),
              });
          }}
        />
      ),
    },
    {
      key: 'actions',
      header: '操作',
      actions: true,
      render: (row) => (
        <Button
          size="xs"
          variant="text"
          disabled={busy}
          onClick={() => {
            setShownRow(row);
            setSelected(row);
          }}
        >
          名称与台词
        </Button>
      ),
    },
  ];
  function scan() {
    if (config)
      void discovery.run(
        () => api.scanPonies(token),
        (found) => {
          setDraft({ ...config, ponies: mergeDiscovery(config.ponies, found) });
          showToast(`已发现 ${found.length} 个角色`, 'success');
        },
      );
  }
  return (
    <div className="@container space-y-6">
      <SectionHeader
        section="ponies"
        onRefresh={() => {
          if (!draft) read.refresh();
          else
            confirmThen(
              '确认重新读取',
              '确定要放弃尚未保存的展示设置并重新读取吗？',
              () => {
                setDraft(null);
                read.refresh();
              },
              { tone: 'filled' },
            );
        }}
        isLoading={read.refreshing}
      />
      <AdminNote>角色名称与台词单独保存。</AdminNote>
      {read.loading && !config && (
        <div className="max-w-2xl space-y-4" aria-hidden="true">
          <div className="flex h-8 items-center justify-between gap-4">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-8 w-13 rounded-full" />
          </div>
          <div className="flex justify-end gap-3">
            <Skeleton className="h-10 w-24 rounded-full" delay={40} />
            <Skeleton className="h-10 w-28 rounded-full" delay={80} />
          </div>
        </div>
      )}
      {config && (
        <AdminForm
          aria-label="桌面小马设置"
          onSubmit={() =>
            confirmThen(
              '确认保存展示设置',
              `确定要${config.enabled ? '开启' : '关闭'}桌面小马并保存 ${config.ponies.length} 个角色的设置吗？其中 ${config.ponies.filter((row) => row.enabled).length} 个角色已勾选。`,
              () =>
                void mutation.run(
                  () => api.savePonies(token, revision, config.enabled, config.ponies),
                  () => {
                    setDraft(null);
                    showToast('已保存桌面小马设置', 'success');
                  },
                  () => {
                    query.write(token, {
                      enabled: config.enabled,
                      ponies: config.ponies,
                      revision,
                    });
                    committed(token);
                  },
                ),
              { tone: 'filled' },
            )
          }
        >
          <ToggleSwitch
            layout="row"
            checked={config.enabled}
            label="全局展示桌面小马"
            disabled={busy}
            onChange={(enabled) => setDraft({ ...config, enabled })}
          />
          <FormActions>
            <Button
              type="button"
              variant="text"
              loading={discovery.busy}
              disabled={mutation.busy || discovery.uncertain}
              onClick={scan}
            >
              扫描资源库
            </Button>
            <Button
              type="submit"
              variant="filled"
              loading={mutation.busy}
              disabled={discovery.busy || mutation.uncertain}
            >
              保存展示设置
            </Button>
          </FormActions>
        </AdminForm>
      )}
      <MutationResult mutation={mutation} />
      <MutationResult mutation={discovery} />
      <div className="flex flex-col gap-3 @md:flex-row @md:items-center">
        <SearchInput value={filter} onChange={setFilter} placeholder="筛选角色…" className="min-w-0 @md:flex-1" />
        {config && (
          <div className="flex flex-wrap items-center gap-2">
            {[true, false].map((enabled) => (
              <Button
                key={String(enabled)}
                variant="text"
                size="xs"
                disabled={busy}
                onClick={() =>
                  confirmThen(
                    '确认批量选择',
                    `确定要将全部 ${config.ponies.length} 个角色${enabled ? '勾选' : '取消勾选'}吗？保存后生效。`,
                    () =>
                      setDraft({
                        ...config,
                        ponies: config.ponies.map((row) => ({ ...row, enabled })),
                      }),
                    { tone: 'filled' },
                  )
                }
              >
                {enabled ? '全选角色' : '取消全选'}
              </Button>
            ))}
          </div>
        )}
      </div>
      <AdminListAnchor>
        <DataTable
          columns={columns}
          rows={paged.rows}
          listKey={paged.listKey}
          rowKey={(row) => row.path}
          loading={read.loading}
          {...tableError('角色加载失败', read.error)}
          onRetry={read.retryable ? read.refresh : undefined}
          empty="暂无角色，可扫描资源库"
        />
        <AdminPager page={paged.page} totalPages={paged.totalPages} onPageChange={paged.setPage} />
      </AdminListAnchor>
      {shownRow && (
        <PonyEditor
          key={shownRow.path}
          isOpen={selected !== null}
          token={token}
          revision={revision}
          pony={shownRow}
          onClose={() => setSelected(null)}
          onRenamed={(name) => {
            /* A rename is saved on its own. It corrects an unsaved draft when there is one; without one it
         corrects the read itself — minting a draft from it made the panel claim unsaved settings
         (刷新 asked to discard them) and pinned every row to this snapshot, hiding the re-read
         `committed` asks for (review P6-F6). */
            const renamed = (rows: Pony[]) => rows.map((row) => (row.path === shownRow.path ? { ...row, name } : row));
            if (draft) setDraft({ ...draft, ponies: renamed(draft.ponies) });
            else if (read.data) {
              const base = read.data;
              query.write(token, (previous) => {
                const current = previous ?? base;
                return { ...current, ponies: renamed(current.ponies) };
              });
              query.expire(token);
            }
            setShownRow({ ...shownRow, name });
            setSelected((current) => current && { ...current, name });
          }}
        />
      )}
      {confirmDialog}
    </div>
  );
}
function PonyEditor({
  isOpen,
  token,
  revision,
  pony,
  onClose,
  onRenamed,
}: {
  isOpen: boolean;
  token: string;
  revision: number;
  pony: Pony;
  onClose: () => void;
  onRenamed: (name: string) => void;
}) {
  const [name, setName] = useState(pony.name);
  const [editing, setEditing] = useState<{ name: string; text: string; closing: boolean } | null>(null);
  const read = useResource(speechQuery, token ? { token, name: pony.name, path: pony.path } : SKIP);
  const rename = useCatalogMutation(token);
  const save = useCatalogMutation(token);
  const busy = rename.busy || save.busy;
  const closeSpeech = () => {
    if (busy) return;
    setEditing((current) => (current ? { ...current, closing: true } : null));
  };
  const speechId = (speechName: string) => `pony-speech-${speechName}`;
  const columns: Column<Speech>[] = [
    {
      key: 'name',
      header: '台词',
      primary: true,
      width: 'minmax(0, 1fr)',
      render: (row) => row.name,
    },
    {
      key: 'text',
      header: '内容',
      width: 'minmax(0, 3fr)',
      className: 'whitespace-pre-wrap wrap-anywhere',
      render: (row) => row.text,
    },
    {
      key: 'audio',
      header: '音频',
      width: 'auto',
      className: 'tabular-nums',
      render: (row) => (row.audio.length ? `${row.audio.length} 个文件` : '无音频'),
    },
    {
      key: 'actions',
      header: '操作',
      actions: true,
      render: (row) => {
        const open = editing?.name === row.name && !editing.closing;
        return (
          <Button
            size="xs"
            variant="text"
            aria-expanded={open}
            aria-controls={speechId(row.name)}
            disabled={busy && !open}
            onClick={(event) => {
              if (open) closeSpeech();
              else {
                captureInlineEditorLayout(event.currentTarget);
                setEditing({ name: row.name, text: row.text, closing: false });
              }
            }}
          >
            编辑台词
          </Button>
        );
      },
    },
  ];
  const renderSpeechEditor = (row: Speech) => {
    if (editing?.name !== row.name) return null;
    return (
      <InlineEditorPanel
        id={speechId(row.name)}
        label={`编辑台词 ${row.name}`}
        surface="dialog"
        isClosing={editing.closing}
        onEscape={busy ? undefined : closeSpeech}
        onExitComplete={() => setEditing((current) => (current?.name === row.name && current.closing ? null : current))}
      >
        <AdminForm
          className="max-w-none"
          aria-label={`编辑台词 ${row.name}`}
          onSubmit={() =>
            void save.run(
              () => api.savePonySpeech(token, revision, pony.path, editing.name, editing.text),
              () => {
                setEditing((current) => (current?.name === row.name ? { ...current, closing: true } : current));
                showToast('已保存台词', 'success');
              },
              () => {
                speechQuery.expire({ token, name: pony.name, path: pony.path });
                ponyConfigs.expire();
                query.expire(token);
              },
            )
          }
        >
          <Textarea
            label={`台词内容 · ${row.name}`}
            rows={4}
            className="resize-none"
            maxLength={2000}
            value={editing.text}
            readOnly={busy}
            onChange={(event) =>
              setEditing((current) => (current ? { ...current, text: event.target.value } : current))
            }
          />
          <FormActions>
            <Button type="button" variant="text" disabled={busy} onClick={closeSpeech}>
              取消
            </Button>
            <Button type="submit" variant="filled" loading={save.busy} disabled={rename.busy || save.uncertain}>
              保存台词
            </Button>
          </FormActions>
        </AdminForm>
      </InlineEditorPanel>
    );
  };
  return (
    <Modal
      maxWidth="2xl"
      isOpen={isOpen}
      title={`角色 · ${pony.name}`}
      onClose={() => {
        if (!busy) onClose();
      }}
      closeOnEscape={!busy}
      footer={
        <Button variant="text" disabled={busy} onClick={onClose}>
          完成
        </Button>
      }
    >
      <div className="space-y-6">
        <AdminForm
          className="max-w-none"
          aria-label="修改角色名称"
          onSubmit={() =>
            void rename.run(
              () => api.savePonyName(token, revision, pony.path, pony.name, name),
              (data) => {
                const saved = data.new_name;
                onRenamed(saved);
                setName(saved);
                showToast('已保存角色名称', 'success');
              },
              () => committed(token),
            )
          }
        >
          <Input
            label="角色名称"
            value={name}
            maxLength={200}
            readOnly={busy}
            onChange={(event) => setName(event.target.value)}
          />
          <FormActions>
            <Button type="submit" variant="filled" loading={rename.busy} disabled={save.busy || rename.uncertain}>
              保存名称
            </Button>
          </FormActions>
          <MutationResult mutation={rename} />
        </AdminForm>
        <MutationResult mutation={save} />
        <DataTable
          surface="dialog"
          columns={columns}
          rows={read.data ?? []}
          rowKey={(row) => row.name}
          expandedRow={renderSpeechEditor}
          loading={read.data === undefined && !read.error}
          {...tableError('台词加载失败', read.error ? apiErrorMessage(read.error) : undefined)}
          onRetry={read.error && isRetryable(read.error) ? read.refresh : undefined}
          empty="暂无台词"
        />
      </div>
    </Modal>
  );
}
