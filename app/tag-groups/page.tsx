'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MdAdd, MdBookmarks } from 'react-icons/md';
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
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { createShareLink, trackShare } from '@/lib/api/share';
import { deleteTagGroup, MAX_TAG_GROUPS, saveTagGroup, type TagGroup } from '@/lib/api/tagGroups';
import { readToken, readUserInfo, useSession } from '@/lib/hooks';
import { ICON } from '@/lib/icons';
import { SKIP, useResource } from '@/lib/resource';
import { shareableGroups, tagGroups } from '@/lib/resources';
import { SHARED_BY_PARAM } from '@/lib/searchState';
import { settle } from '@/lib/settle';
import { cn, copyText } from '@/lib/utils';
import TagGroupRow, { tagGroupSearchHref } from './TagGroupRow';
import TagGroupEditor, { draftOf, type TagGroupDraft, type TagGroupInput } from './TagGroupEditor';

/** What the link preview and the recipient's notice call a sharer with no name. */
const ANONYMOUS = '匿名用户';

/** Write the list in place; the forum's list of the user's own groups changes with it. */
function writeGroups(token: string, update: (groups: TagGroup[]) => TagGroup[]) {
  tagGroups.write({ token }, (previous) => update(previous ?? []));
  shareableGroups.invalidate({ token });
}

/**
 * 标签组 — the original front end's 自定义标签收藏组: named sets of tags kept on the account, each
 * searched as one (搜索这组标签) or shared as a link that opens that search for somebody else. Up
 * to 50 groups of 50 tags. The forum's 标签组分享 imports other people's groups into this list.
 */
export default function TagGroupsPage() {
  const { token, ready } = useSession();
  const { confirm, confirmDialog } = useConfirm();
  const read = useResource(tagGroups, token ? { token } : SKIP);
  const groups = read.data;
  const count = groups?.length ?? 0;
  const full = count >= MAX_TAG_GROUPS;

  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<TagGroupDraft>(() => draftOf(null));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<ReadonlySet<number>>(() => new Set());
  const [sharing, setSharing] = useState<number | null>(null);
  const sharePending = useRef(false);
  const shareRequest = useRef<AbortController | null>(null);
  useEffect(() => () => shareRequest.current?.abort(), []);
  const presence = useRef<PresenceList<TagGroup>>(null);
  const listBox = useRef<HTMLDivElement>(null);

  /* An empty state that replaces the last row answers the press that removed it: the pane-swap
     clock, not an entrance of its own (whose staggered start holds its heading hidden — where the
     removed row's focus lands). /block-groups' arrangement. */
  const [hadRows, setHadRows] = useState(false);
  if (!hadRows && groups && groups.length > 0) setHadRows(true);
  const emptyAfterRows = hadRows && groups !== undefined && groups.length === 0;

  const openEditor = useCallback((group: TagGroup | null) => {
    setDraft(draftOf(group));
    setEditorOpen(true);
  }, []);

  const save = async (input: TagGroupInput) => {
    if (!token || saving || readToken() !== token) return;
    setSaving(true);
    const saved = await settle(saveTagGroup(token, input));
    if (!saved.ok) {
      if (readToken() === token) showToast(apiErrorMessage(saved.error, '保存失败'), 'error');
    } else if (readToken() === token) {
      if (input.id) {
        writeGroups(token, (list) => list.map((group) => (group.id === input.id ? { ...group, name: input.name, tags: [...input.tags] } : group)));
        tagGroups.expire({ token });
      } else {
        /* A new group waits for the list, so the card arrives as the dialog leaves. */
        await tagGroups.read({ token }, { force: true }).catch(() => tagGroups.expire({ token }));
        shareableGroups.invalidate({ token });
      }
      if (readToken() !== token) { setSaving(false); return; }
      setEditorOpen(false);
      showToast(input.id ? '已保存标签组' : '已创建标签组', 'success');
    }
    setSaving(false);
  };

  const remove = useCallback(async (group: TagGroup) => {
    if (!token || readToken() !== token || deleting.has(group.id)) return;
    if (!(await confirm({
      title: '确认删除',
      message: `确定要删除标签组「${group.name || '未命名标签组'}」吗？`,
      tone: 'danger',
    }))) return;
    if (readToken() !== token) return;
    setDeleting((previous) => new Set(previous).add(group.id));
    const deleted = await settle(deleteTagGroup(token, group.id));
    if (readToken() === token) {
      if (deleted.ok) {
        /* The user's removal: the list places a focus the confirmation has not returned yet. */
        presence.current?.claimFocus([group.id]);
        writeGroups(token, (list) => list.filter((item) => item.id !== group.id));
        tagGroups.expire({ token });
        showToast('已删除标签组', 'success');
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

  /**
   * 分享 — the original's contract: a short link (falling back to the long one) to the group's
   * search, naming who shared it, copied. A copy the browser refuses once the link has been made
   * (the gesture can be spent by then) is offered again as the toast's 复制.
   */
  const share = useCallback(async (group: TagGroup) => {
    if (!token || readToken() !== token || sharePending.current || group.tags.length === 0) return;
    sharePending.current = true;
    shareRequest.current?.abort();
    const controller = new AbortController();
    shareRequest.current = controller;
    const current = () => !controller.signal.aborted && readToken() === token && window.location.pathname === '/tag-groups';
    setSharing(group.id);
    const username = readUserInfo()?.username;
    const sharer = (typeof username === 'string' && username.trim()) || ANONYMOUS;
    const target = new URL(tagGroupSearchHref(group.tags), window.location.origin);
    target.searchParams.set(SHARED_BY_PARAM, sharer);
    const link = await settle(createShareLink(
      {
        targetUrl: target.href,
        title: `分享标签组：${group.name || '未命名标签组'}`,
        desc: `包含标签：${group.tags.join(', ')}\n点击链接即可在 PicPony 中搜索这组标签`,
      },
      { token, signal: controller.signal },
    ));
    sharePending.current = false;
    setSharing(null);
    if (!current()) return;
    if (!link.ok) {
      showToast(apiErrorMessage(link.error, '分享失败'), 'error');
      return;
    }
    const url = link.value.url;
    // The fallback action can be pressed again while its toast leaves. The link counts once.
    let counted = false;
    const copyLink = async () => {
      if (!current() || !(await copyText(url)) || !current()) return false;
      showToast('已复制分享链接', 'success');
      if (!counted) {
        counted = true;
        trackShare(token);
      }
      return true;
    };
    if (await copyLink() || !current()) return;
    showToast('分享链接已生成', 'info', {
      action: {
        label: '复制',
        onClick: () => {
          void copyLink().then((copied) => {
            if (!copied && current()) showToast('复制失败，请检查浏览器的剪贴板权限', 'error');
          });
        },
      },
    });
  }, [token]);

  const signedIn = ready && Boolean(token);
  const header = (
    <PageHeader
      title="标签组"
      subtitle={
        signedIn && groups
          ? full
            ? `已创建 ${count} / ${MAX_TAG_GROUPS} 个标签组，已达上限`
            : `已创建 ${count} / ${MAX_TAG_GROUPS} 个标签组。把常用的标签放在一起，一键搜索`
          : undefined
      }
      actions={
        signedIn && groups && count > 0 ? (
          /* While empty, the empty state carries 新建 — one primary action, not two. */
          <Button variant="filled" icon={<MdAdd />} disabled={full} onClick={() => openEditor(null)}>
            新建
          </Button>
        ) : undefined
      }
    />
  );

  let body;
  if (!ready || (token && groups === undefined && read.error === undefined)) {
    body = <GroupRowsSkeleton control="button" />;
  } else if (!token) {
    body = <SignInRequired description="登录后即可创建标签组，把常用的标签放在一起一键搜索。" />;
  } else if (!groups) {
    body = (
      <ErrorRetry
        title="标签组加载失败"
        message={apiErrorMessage(read.error)}
        onRetry={isRetryable(read.error) ? read.refresh : undefined}
      />
    );
  } else {
    body = (
      /* One run of the grouped list, /block-groups' arrangement (D1-009, M1-023): a deleted row
         fades where it stood while the ones under it close the gap, a created one arrives in its
         own place, and the list stays mounted while it is empty so the first row has somewhere to
         arrive into. */
      <PresenceList
        ref={presence}
        items={groups}
        getKey={(group) => group.id}
        variant="list"
        resetKey={token}
        /* The last row's focus lands on the empty state taking its place: its heading. */
        fallbackFocus={() => listBox.current?.querySelector<HTMLElement>(':scope > div h2') ?? null}
      >
        {(entries, ref) => (
          /* Positioned for the empty state, which leaves where it stood as the first row arrives. */
          <div ref={listBox} className="relative">
            <ul ref={ref}>
              {entries.map(({ item: group, key, leaving }) => (
                <TagGroupRow
                  key={key}
                  data-presence-key={key}
                  group={group}
                  sharing={!leaving && sharing === group.id}
                  deleting={leaving || deleting.has(group.id)}
                  onShare={share}
                  onEdit={openEditor}
                  onDelete={remove}
                />
              ))}
            </ul>
            <PresenceBlock show={groups.length === 0}>
              <div className={cn(emptyAfterRows && 'animate-page-transition')}>
                <EmptyState
                  entrance={!emptyAfterRows}
                  icon={<MdBookmarks size={ICON.display} />}
                  title="还没有任何标签组"
                  description="把常用的标签放在一起，以后一键就能搜索这组标签。"
                  action={
                    <Button variant="filled" icon={<MdAdd />} onClick={() => openEditor(null)}>
                      新建标签组
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
        <TagGroupEditor
          isOpen={editorOpen}
          initial={draft}
          saving={saving}
          onSave={(input) => void save(input)}
          onClose={() => setEditorOpen(false)}
        />
      )}
      {confirmDialog}
    </div>
  );
}
