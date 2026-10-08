'use client';

import { useCallback, useRef, useState } from 'react';
import { MdAdd, MdDownload, MdShield } from 'react-icons/md';
import Button from '@/components/Button';
import { useConfirm } from '@/components/ConfirmDialog';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import { GroupRowsSkeleton } from '@/components/groups/GroupRow';
import PageHeader from '@/components/PageHeader';
import PresenceList from '@/components/PresenceList';
import SignInRequired from '@/components/SignInRequired';
import { showToast } from '@/components/Toast';
import PresenceBlock from '@/components/PresenceBlock';
import {
  deleteBlockGroup,
  MAX_BLOCK_GROUPS,
  saveBlockGroup,
  toggleBlockGroup,
  type BlockGroup,
  type BlockGroupInput,
} from '@/lib/api/blockGroups';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { mirrorBlockGroups } from '@/lib/blockGroupMirror';
import { readToken, useSession } from '@/lib/hooks';
import { ICON } from '@/lib/icons';
import { SKIP, useResource } from '@/lib/resource';
import { blockGroups, shareableGroups, syncBrowsingCookie } from '@/lib/resources';
import { settle } from '@/lib/settle';
import { cn } from '@/lib/utils';
import BlockGroupRow from './BlockGroupRow';
import BlockGroupEditor, { draftOf, type BlockGroupDraft } from './BlockGroupEditor';
import DerpiFilterImport, { type FilterImport } from './DerpiFilterImport';

/**
 * Write the list in place and put it in force on this device at once — a switch or a save must
 * not wait for a re-read to change what the gallery hides (`lib/blockGroupMirror.ts`). The forum's
 * list of the user's own groups changes with it.
 */
function writeGroups(token: string, update: (groups: BlockGroup[]) => BlockGroup[]) {
  blockGroups.write({ token }, (previous) => {
    const next = update(previous ?? []);
    if (readToken() === token && mirrorBlockGroups(next)) syncBrowsingCookie();
    return next;
  });
  shareableGroups.invalidate({ token });
}

export default function BlockGroupsPage() {
  const { user, token, ready } = useSession();
  const { confirm, confirmDialog } = useConfirm();
  const read = useResource(blockGroups, token ? { token } : SKIP);
  const groups = read.data;
  const count = groups?.length ?? 0;
  const full = count >= MAX_BLOCK_GROUPS;
  const apiKey = typeof user?.api_key === 'string' && user.api_key ? user.api_key : null;

  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<BlockGroupDraft>(() => draftOf(null));
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deleting, setDeleting] = useState<ReadonlySet<number>>(() => new Set());
  const toggles = useRef(new Map<number, { confirmed: boolean; wanted: boolean }>());
  const presence = useRef<PresenceList<BlockGroup>>(null);
  const listBox = useRef<HTMLDivElement>(null);

  /* An empty state that replaces the last row answers the press that removed it: it arrives on
     the pane-swap clock rather than with an entrance of its own (whose staggered start holds its
     heading hidden — the very element the removed row's focus lands on). Only one that is there
     from the start enters as the screen's own. */
  const [hadRows, setHadRows] = useState(false);
  if (!hadRows && groups && groups.length > 0) setHadRows(true);
  const emptyAfterRows = hadRows && groups !== undefined && groups.length === 0;

  const openEditor = useCallback((group: BlockGroup | null) => {
    setDraft(draftOf(group));
    setEditorOpen(true);
  }, []);

  /** After a create or an import: the list as the server now has it (its fetch puts it in force). */
  const reread = useCallback(async (owner: string) => {
    await blockGroups.read({ token: owner }, { force: true }).catch(() => blockGroups.expire({ token: owner }));
    shareableGroups.invalidate({ token: owner });
  }, []);

  const save = async (input: BlockGroupInput) => {
    if (!token || saving || readToken() !== token) return;
    setSaving(true);
    const saved = await settle(saveBlockGroup(token, input));
    if (!saved.ok) {
      if (readToken() === token) showToast(apiErrorMessage(saved.error, '保存失败'), 'error');
    } else if (readToken() === token) {
      if (input.id) {
        /* An edit is written through at once; a new group waits for the list (its default
           state is the server's to say), so the card arrives as the dialog leaves. */
        const hidden = [...input.hidden];
        const spoilered = [...input.spoilered];
        writeGroups(token, (list) => list.map((group) => (group.id === input.id
          ? { ...group, name: input.name, hidden_tags: hidden, spoilered_tags: spoilered, tags: [...new Set([...hidden, ...spoilered])] }
          : group)));
        blockGroups.expire({ token });
      } else {
        await reread(token);
      }
      if (readToken() !== token) { setSaving(false); return; }
      setEditorOpen(false);
      showToast(input.id ? '已保存屏蔽组' : '已创建屏蔽组', 'success');
    }
    setSaving(false);
  };

  /**
   * A switch flips at once and its request follows. Presses while one is out are not dropped —
   * the switch stays a live control meanwhile (G4-002) — and the latest one is what is sent next,
   * so the server ends where the switch does; a refusal puts the switch back where the server last
   * agreed and says why.
   */
  const toggle = useCallback((group: BlockGroup, active: boolean) => {
    if (!token || readToken() !== token) return;
    const flip = (value: boolean) =>
      writeGroups(token, (list) => list.map((item) => (item.id === group.id ? { ...item, is_active: value ? 1 : 0 } : item)));
    const current = toggles.current.get(group.id);
    const state = current ?? { confirmed: group.is_active === 1, wanted: active };
    state.wanted = active;
    flip(active);
    if (current) return;
    toggles.current.set(group.id, state);
    void (async () => {
      let sentAny = false;
      while (readToken() === token && state.confirmed !== state.wanted) {
        const sending = state.wanted;
        const sent = await settle(toggleBlockGroup(token, group.id, sending));
        if (!sent.ok) {
          state.wanted = state.confirmed;
          if (readToken() === token) {
            flip(state.confirmed);
            showToast(apiErrorMessage(sent.error, '切换失败'), 'error');
          }
          break;
        }
        state.confirmed = sending;
        sentAny = true;
      }
      toggles.current.delete(group.id);
      /* A list read that was already out when the switch flipped answers with the old state and
         replaces the flip — on screen and in the device's mirror — after which nothing put it
         back (review P4-F8). Once the server has the last word, the list is asked again. */
      if (sentAny && readToken() === token) blockGroups.expire({ token });
    })();
  }, [token]);

  const remove = useCallback(async (group: BlockGroup) => {
    if (!token || readToken() !== token || deleting.has(group.id)) return;
    /* The question comes first; nothing on the card changes until it is answered (R5-039). */
    if (!(await confirm({
      title: '确认删除',
      message: `确定要删除屏蔽组「${group.name}」吗？`,
      tone: 'danger',
    }))) return;
    if (readToken() !== token) return;
    setDeleting((previous) => new Set(previous).add(group.id));
    const deleted = await settle(deleteBlockGroup(token, group.id));
    if (readToken() === token) {
      if (deleted.ok) {
        /* The user's removal: if the confirmation has not given the focus back to the row by the
           time it leaves, the list still places it (`PresenceList`'s `claimFocus`). */
        presence.current?.claimFocus([group.id]);
        writeGroups(token, (list) => list.filter((item) => item.id !== group.id));
        blockGroups.expire({ token });
        showToast('已删除屏蔽组', 'success');
      } else {
        showToast(apiErrorMessage(deleted.error, '删除失败'), 'error');
      }
    }
    setDeleting((previous) => {
      const next = new Set(previous);
      next.delete(group.id);
      return next;
    });
  }, [token, confirm, deleting]);

  const importFilter = async (result: FilterImport) => {
    if (!token || readToken() !== token) return;
    await saveBlockGroup(token, { name: result.name, hidden: result.hidden, spoilered: result.spoilered });
    if (readToken() !== token) return;
    await reread(token);
    if (readToken() !== token) return;
    setImportOpen(false);
    showToast(
      result.dropped > 0 ? `已导入屏蔽组，有 ${result.dropped} 个标签超出上限未导入` : '已导入屏蔽组',
      result.dropped > 0 ? 'warning' : 'success',
    );
  };

  const signedIn = ready && Boolean(token);
  const header = (
    <PageHeader
      title="屏蔽组"
      subtitle={
        signedIn && groups
          ? full
            ? `已创建 ${count} / ${MAX_BLOCK_GROUPS} 个屏蔽组，已达上限`
            : `已创建 ${count} / ${MAX_BLOCK_GROUPS} 个屏蔽组。开启后，图库与搜索会自动处理包含这些标签的图片`
          : undefined
      }
      actions={
        signedIn && groups ? (
          <>
            <Button variant="tonal" icon={<MdDownload />} responsiveLabel onClick={() => setImportOpen(true)}>
              从 Derpibooru 导入
            </Button>
            {/* While empty, the empty state carries 新建 — one primary action, not two (R5-041). */}
            {count > 0 && (
              <Button variant="filled" icon={<MdAdd />} disabled={full} onClick={() => openEditor(null)}>
                新建
              </Button>
            )}
          </>
        ) : undefined
      }
    />
  );

  let body;
  if (!ready || (token && groups === undefined && read.error === undefined)) {
    body = <GroupRowsSkeleton control="switch" />;
  } else if (!token) {
    body = <SignInRequired description="登录后即可创建和管理屏蔽组。" />;
  } else if (!groups) {
    /* A failed read is a failure, never 还没有任何屏蔽组 (R5-035): the adapter throws on a refusal. */
    body = (
      <ErrorRetry
        title="屏蔽组加载失败"
        message={apiErrorMessage(read.error)}
        onRetry={isRetryable(read.error) ? read.refresh : undefined}
      />
    );
  } else {
    body = (
      /* One run of the grouped list (D1-009: a list page, as AGENTS' column table has it — the
         three-up grid cut names to 118px). The rows come and go in place (M1-023): a deleted row
         fades where it stood while the ones under it close the gap, and a created one arrives in
         its own place as the dialog that made it leaves. The list stays mounted while it is
         empty, so the first row has somewhere to arrive into; the last one leaving fades over the
         empty state rising in its place. */
      <PresenceList
        ref={presence}
        items={groups}
        getKey={(group) => group.id}
        variant="list"
        resetKey={token}
        /* The last row's focus lands on the empty state taking its place: its heading, a landing,
           with 新建屏蔽组 the next Tab stop. */
        fallbackFocus={() => listBox.current?.querySelector<HTMLElement>(':scope > div h2') ?? null}
      >
        {(entries, ref) => (
          /* Positioned for the empty state, which leaves where it stood as the first row arrives. */
          <div ref={listBox} className="relative">
            <ul ref={ref}>
              {entries.map(({ item: group, key, leaving }) => (
                <BlockGroupRow
                  key={key}
                  data-presence-key={key}
                  group={group}
                  deleting={leaving || deleting.has(group.id)}
                  onToggle={toggle}
                  onEdit={openEditor}
                  onDelete={remove}
                />
              ))}
            </ul>
            <PresenceBlock show={groups.length === 0}>
              <div className={cn(emptyAfterRows && 'animate-page-transition')}>
                <EmptyState
                  entrance={!emptyAfterRows}
                  icon={<MdShield size={ICON.display} />}
                  title="还没有任何屏蔽组"
                  description="创建一个后，图库与搜索会自动处理包含这些标签的图片。"
                  action={
                    <Button variant="filled" icon={<MdAdd />} onClick={() => openEditor(null)}>
                      新建屏蔽组
                    </Button>
                  }
                />
              </div>
            </PresenceBlock>
          </div>
        )}
      </PresenceList>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      {header}
      {body}
      {token && (
        <>
          <BlockGroupEditor
            isOpen={editorOpen}
            initial={draft}
            saving={saving}
            onSave={(input) => void save(input)}
            onClose={() => setEditorOpen(false)}
          />
          <DerpiFilterImport
            isOpen={importOpen}
            onClose={() => setImportOpen(false)}
            apiKey={apiKey}
            canCreate={!full}
            onImport={importFilter}
          />
        </>
      )}
      {confirmDialog}
    </div>
  );
}
