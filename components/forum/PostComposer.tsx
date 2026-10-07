'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import dynamic from 'next/dynamic';
import { MdHistory, MdSend } from 'react-icons/md';
import Button from '@/components/Button';
import { Input, Textarea } from '@/components/Input';
import Radio from '@/components/Radio';
import ToggleSwitch from '@/components/ToggleSwitch';
import { useConfirm } from '@/components/ConfirmDialog';
import { showToast } from '@/components/Toast';
import { EditorPlaceholder, type RichTextEditorHandle } from '@/components/RichTextEditorShell';
import CoverField from '@/components/forum/CoverField';
import { CategoryIcon } from '@/components/forum/ForumBadges';
import SharedGroupsPicker, { sharedGroupsOf, type KeptGroups } from '@/components/forum/SharedGroupsPicker';
import {
  createForumPost,
  encodeCommission,
  FORUM_CATEGORIES,
  isCommissionLink,
  parseCommission,
  parseSharedGroups,
  updateForumPost,
  type ForumPostInput,
} from '@/lib/api/forum';
import { apiErrorMessage } from '@/lib/api/errors';
import { firstImageOf } from '@/lib/bbcode';
import { clearDraft, EMPTY_DRAFT, readDraft, writeDraft, type ForumDraft } from '@/lib/forumDraft';
import { storedAssetPath } from '@/lib/forumImages';
import { isBlankRichText } from '@/lib/forumText';
import { formatShortDateTime } from '@/lib/format';
import { readToken } from '@/lib/hooks';
import { ICON } from '@/lib/icons';
import { shareableGroups } from '@/lib/resources';
import type { ForumCategory, ForumPost } from '@/lib/types/forum';

const RichTextEditor = dynamic(() => import('@/components/RichTextEditor'), {
  ssr: false,
  loading: () => <EditorPlaceholder size="post" />,
});

/** The original front end's limits, which the backend enforces too. */
const TITLE_MIN = 5;
const TITLE_MAX = 100;
const EXCERPT_MAX = 300;

/** What each kind of post is for, under the choice. */
const CATEGORY_HINTS: Record<ForumCategory, string> = {
  discussion: '聊聊图片、画师或站内的任何事',
  commission: '发布约稿信息，可以附上约稿平台的链接',
  taggroups: '把你的标签组或屏蔽组分享出去，大家可以一键导入',
};

type FieldKey = 'title' | 'excerpt' | 'content' | 'link' | 'groups';
type Errors = Partial<Record<FieldKey, string>>;

/** The form as an edited post stands: its body taken apart by kind. */
function draftOf(post: ForumPost): { draft: ForumDraft; kept: KeptGroups | null } {
  const base: ForumDraft = {
    ...EMPTY_DRAFT,
    title: post.title,
    excerpt: post.excerpt,
    category: post.category,
    content: post.content,
    cover: post.cover_image,
  };
  if (post.category === 'commission') {
    const commission = parseCommission(post.content);
    if (commission) return { draft: { ...base, content: commission.description, commissionLink: commission.link }, kept: null };
  }
  if (post.category === 'taggroups') {
    const groups = parseSharedGroups(post.content);
    if (groups) {
      const keys = [
        ...groups.tagGroups.map((_, index) => `kept-tag:${index}`),
        ...groups.blockGroups.map((_, index) => `kept-block:${index}`),
      ];
      return {
        draft: { ...base, content: '', groupsDescription: groups.description, groups: keys },
        kept: { tagGroups: groups.tagGroups, blockGroups: groups.blockGroups },
      };
    }
    return { draft: { ...base, content: '', groupsDescription: post.content }, kept: null };
  }
  return { draft: base, kept: null };
}

const sameDraft = (a: ForumDraft, b: ForumDraft) => JSON.stringify(a) === JSON.stringify(b);

type Outcome = { ok: true; id: number } | { ok: false; message: string };

/* Module scope: the React Compiler does not lower a `try` with a `finally` in a component. */
async function send(token: string, editing: number | null, body: ForumPostInput): Promise<Outcome> {
  try {
    if (editing === null) return { ok: true, id: await createForumPost(token, body) };
    await updateForumPost(token, editing, body);
    return { ok: true, id: editing };
  } catch (error) {
    return { ok: false, message: apiErrorMessage(error, editing === null ? '发布失败' : '保存失败') };
  }
}

interface PostComposerProps {
  /** The account writing — whose draft this is. */
  userId: string;
  token: string;
  /** Editing: the post as it stands. Absent: a new post. */
  post?: ForumPost;
  /** Sent: the post's id and what was sent, for the caller to show it. */
  onDone: (id: number, body: ForumPostInput) => void;
  onCancel: () => void;
}

/**
 * Writing a post, and editing one — the original front end's form, field for field: the kind of
 * post, 标题, the optional 简介, then the body the kind asks for (the editor; the editor and a
 * commission link; or a note and the groups to share), and the cover.
 *
 * **Nothing typed is lost** (R6-042): the form is saved on this device as it changes, per account
 * and per post (`lib/forumDraft.ts`), and restored on the next visit with a line saying so and a
 * way to discard it — which asks first, since that is the one step that throws words away.
 *
 * **A problem is said at its field** (R6-046): 发布 checks every field, puts each message under
 * its field and moves focus to the first; a toast says only that it worked.
 */
export default function PostComposer({ userId, token, post, onDone, onCancel }: PostComposerProps) {
  const editing = post ? post.id : null;
  const [initial] = useState(() => {
    const original = post ? draftOf(post) : { draft: EMPTY_DRAFT, kept: null };
    const saved = readDraft(userId, editing);
    return { ...original, saved };
  });
  const kept = initial.kept;
  const [draft, setDraft] = useState<ForumDraft>(() => initial.saved ?? initial.draft);
  const [restoredAt, setRestoredAt] = useState<number | null>(initial.saved?.savedAt ?? null);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const { confirm, confirmDialog } = useConfirm();

  const titleRef = useRef<HTMLInputElement>(null);
  const excerptRef = useRef<HTMLTextAreaElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const groupsRef = useRef<HTMLFieldSetElement>(null);
  const editor = useRef<RichTextEditorHandle>(null);
  const categoryId = useId();
  const contentId = useId();
  const contentErrorId = useId();

  /* ----- the draft on this device ---------------------------------------------------------- */

  const latest = useRef(draft);
  const done = useRef(false);
  useEffect(() => {
    latest.current = draft;
  });
  useEffect(() => {
    const save = () => {
      if (done.current) return;
      const current = latest.current;
      if (editing !== null && sameDraft(current, initial.draft)) clearDraft(userId, editing);
      else writeDraft(userId, editing, current);
    };
    const timer = window.setTimeout(save, 600);
    return () => window.clearTimeout(timer);
  }, [draft, editing, initial.draft, userId]);
  /* A tab closed, reloaded or sent to the background writes at once; so does leaving. */
  useEffect(() => {
    const flush = () => {
      if (done.current) return;
      const current = latest.current;
      if (editing !== null && sameDraft(current, initial.draft)) clearDraft(userId, editing);
      else writeDraft(userId, editing, current);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, [editing, initial.draft, userId]);

  const discard = async () => {
    const ok = await confirm({
      title: '确认丢弃',
      message: editing === null ? '确定要丢弃此草稿吗？丢弃后无法恢复。' : '确定要丢弃此次修改吗？丢弃后无法恢复。',
    });
    if (!ok) return;
    clearDraft(userId, editing);
    setDraft(initial.draft);
    setRestoredAt(null);
    setErrors({});
    setFailure(null);
  };

  /* ----- editing ------------------------------------------------------------------------- */

  const set = <K extends keyof ForumDraft>(key: K, value: ForumDraft[K], field?: FieldKey) => {
    setDraft((current) => ({ ...current, [key]: value }));
    if (field && errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const addImage = (path: string) =>
    setDraft((current) => (current.images.includes(path) ? current : { ...current, images: [...current.images, path] }));

  /* ----- sending ------------------------------------------------------------------------- */

  const validate = (): Errors => {
    const next: Errors = {};
    const title = draft.title.trim();
    if (!title) next.title = '请输入标题';
    else if (title.length < TITLE_MIN) next.title = `标题至少需要 ${TITLE_MIN} 个字符`;
    else if (title.length > TITLE_MAX) next.title = `标题不能超过 ${TITLE_MAX} 个字符`;
    if (draft.excerpt.trim().length > EXCERPT_MAX) next.excerpt = `简介不能超过 ${EXCERPT_MAX} 个字符`;
    if (draft.category === 'discussion' && isBlankRichText(draft.content)) next.content = '请输入正文';
    if (draft.category === 'commission') {
      const link = draft.commissionLink.trim();
      if (link && !isCommissionLink(link)) next.link = '约稿链接需以 http:// 或 https:// 开头';
      else if (!link && isBlankRichText(draft.content)) next.content = '正文和约稿链接至少填写一项';
    }
    if (draft.category === 'taggroups' && draft.groups.length === 0) next.groups = '请至少选择一个标签组或屏蔽组';
    return next;
  };

  const focusFirst = (found: Errors) => {
    if (found.title) titleRef.current?.focus();
    else if (found.excerpt) excerptRef.current?.focus();
    else if (found.link) linkRef.current?.focus();
    else if (found.content) editor.current?.focus();
    else if (found.groups) groupsRef.current?.focus();
  };

  const bodyOf = (): ForumPostInput => {
    const content = draft.content.trim();
    const category = draft.category;
    let cover: string | null = null;
    if (category !== 'taggroups') {
      const first = draft.firstImageAsCover ? firstImageOf(content) ?? draft.images[0] ?? null : null;
      cover = draft.cover ?? (first ? storedAssetPath(first) : null);
    }
    return {
      title: draft.title.trim(),
      excerpt: draft.excerpt.trim(),
      category,
      content:
        category === 'commission'
          ? encodeCommission(content, draft.commissionLink)
          : category === 'taggroups'
            ? draft.groupsDescription.trim()
            : content,
      cover_image: cover,
      shared_groups:
        category === 'taggroups' ? sharedGroupsOf(draft.groups, shareableGroups.peek({ token }).data, kept) : null,
      draft_images: draft.images,
    };
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending) return;
    const found = validate();
    setErrors(found);
    if (Object.values(found).some(Boolean)) {
      setFailure(null);
      focusFirst(found);
      return;
    }
    if (coverBusy || editorBusy) {
      setFailure('图片还在上传，请稍候');
      return;
    }
    const session = readToken();
    if (!session || session !== token) return;
    const body = bodyOf();
    setFailure(null);
    setSending(true);
    const outcome = await send(session, editing, body);
    setSending(false);
    if (readToken() !== session) return;
    if (!outcome.ok) {
      setFailure(outcome.message);
      return;
    }
    done.current = true;
    clearDraft(userId, editing);
    showToast(editing === null ? '已发布' : '已保存', 'success');
    onDone(outcome.id, body);
  };

  const category = draft.category;
  const showEditor = category !== 'taggroups';

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="space-y-6">
      {restoredAt !== null && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-secondary-container py-2 ps-4 pe-2 text-on-secondary-container">
          <MdHistory size={ICON.control} aria-hidden="true" className="shrink-0" />
          <p className="min-w-0 flex-1 text-body-m">
            {editing === null ? '已恢复上次未完成的草稿' : '已恢复上次未保存的修改'}（{formatShortDateTime(restoredAt)}）
          </p>
          <Button type="button" variant="text" size="xs" onClick={() => void discard()}>
            丢弃草稿
          </Button>
        </div>
      )}

      <div role="radiogroup" aria-labelledby={categoryId} aria-describedby={`${categoryId}-hint`}>
        <p id={categoryId} className="mb-2 text-title-s text-on-surface">
          帖子类型
        </p>
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          {FORUM_CATEGORIES.map((entry) => (
            <Radio
              key={entry.value}
              name={`${categoryId}-category`}
              value={entry.value}
              checked={category === entry.value}
              onChange={() => {
                set('category', entry.value);
                setErrors((current) => ({ ...current, content: undefined, link: undefined, groups: undefined }));
              }}
              label={
                <span className="flex items-center gap-1.5">
                  <span className="text-on-surface-variant [&>svg]:block" aria-hidden="true">
                    <CategoryIcon category={entry.value} size={ICON.dense} />
                  </span>
                  {entry.label}
                </span>
              }
            />
          ))}
        </div>
        <p id={`${categoryId}-hint`} className="mt-1 px-4 text-body-s text-on-surface-variant">
          {CATEGORY_HINTS[category]}
        </p>
      </div>

      <Input
        ref={titleRef}
        label="标题"
        required
        value={draft.title}
        onChange={(event) => set('title', event.target.value, 'title')}
        maxLength={TITLE_MAX}
        count={{ value: draft.title.length, max: TITLE_MAX }}
        error={errors.title}
        helper={`至少 ${TITLE_MIN} 个字符`}
        enterKeyHint="next"
      />

      <Textarea
        ref={excerptRef}
        label="简介（选填）"
        value={draft.excerpt}
        onChange={(event) => set('excerpt', event.target.value, 'excerpt')}
        maxLength={EXCERPT_MAX}
        count={{ value: draft.excerpt.length, max: EXCERPT_MAX }}
        rows={2}
        error={errors.excerpt}
        helper="显示在帖子列表里；留空时自动截取正文"
      />

      {showEditor && (
        <div>
          <p id={contentId} className="mb-2 text-title-s text-on-surface">
            正文
            {category === 'commission' && <span className="text-body-m text-on-surface-variant">（和约稿链接至少填写一项）</span>}
          </p>
          <RichTextEditor
            value={draft.content}
            onChange={(next) => set('content', next, 'content')}
            size="post"
            label="正文"
            placeholder={category === 'commission' ? '介绍你的约稿：价格、周期、要求…' : '写下你的帖子内容…'}
            invalid={Boolean(errors.content)}
            describedBy={errors.content ? contentErrorId : undefined}
            handleRef={editor}
            onUploaded={addImage}
            onUploadingChange={setEditorBusy}
          />
          {errors.content && (
            <p id={contentErrorId} role="alert" className="mt-1.5 px-4 text-body-s text-error">
              {errors.content}
            </p>
          )}
        </div>
      )}

      {category === 'commission' && (
        <Input
          ref={linkRef}
          label="约稿平台链接（选填）"
          type="url"
          inputMode="url"
          autoComplete="url"
          value={draft.commissionLink}
          onChange={(event) => set('commissionLink', event.target.value, 'link')}
          placeholder="https://…"
          error={errors.link}
          helper="读者前往前会看到一段提醒，请使用正规的交易托管平台"
        />
      )}

      {category === 'taggroups' && (
        <>
          <Textarea
            label="说明（选填）"
            value={draft.groupsDescription}
            onChange={(event) => set('groupsDescription', event.target.value)}
            placeholder="简单介绍一下你要分享的组…"
            rows={3}
          />
          <SharedGroupsPicker
            ref={groupsRef}
            token={token}
            selected={draft.groups}
            onChange={(next) => set('groups', next, 'groups')}
            kept={kept}
            error={errors.groups}
          />
        </>
      )}

      {showEditor && (
        <div className="space-y-2">
          <CoverField
            value={draft.cover}
            onChange={(path) => {
              set('cover', path);
              if (path) addImage(path);
            }}
            onBusyChange={setCoverBusy}
          />
          {!draft.cover && (
            <ToggleSwitch
              layout="row"
              checked={draft.firstImageAsCover}
              onChange={(on) => set('firstImageAsCover', on)}
              label="没有封面时，使用正文的第一张图片"
            />
          )}
        </div>
      )}

      {failure && (
        <p role="alert" className="rounded-sm bg-error-container px-4 py-3 text-body-m text-on-error-container">
          {failure}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-outline-variant pt-4">
        {editing === null && (
          <p className="me-auto text-body-s text-on-surface-variant">草稿会自动保存在此设备上</p>
        )}
        <Button type="button" variant="text" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" variant="filled" icon={<MdSend />} loading={sending}>
          {editing === null ? '发布帖子' : '保存修改'}
        </Button>
      </div>
      {confirmDialog}
    </form>
  );
}
