'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { MdBlock, MdBookmarkAdd, MdBookmarks, MdCheck, MdOpenInNew } from 'react-icons/md';
import RichTextRenderer from '@/components/RichTextRenderer';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import SectionHeading from '@/components/SectionHeading';
import { useConfirm } from '@/components/ConfirmDialog';
import { useAuthModal } from '@/components/AuthModal';
import { showToast } from '@/components/Toast';
import {
  importSharedBlockGroup,
  importSharedTagGroup,
  parseCommission,
  parseSharedGroups,
  type SharedBlockGroup,
  type SharedGroupsBody,
  type SharedTagGroup,
} from '@/lib/api/forum';
import { apiErrorMessage } from '@/lib/api/errors';
import { blockGroups, shareableGroups, tagGroups } from '@/lib/resources';
import { readToken, useSession } from '@/lib/hooks';
import { ICON } from '@/lib/icons';
import type { ForumPost } from '@/lib/types/forum';

/** How many of a group's tags a card names before 「+N」. */
const TAG_PREVIEW = 8;

/**
 * 前往约稿平台. The original front end asked before it let a reader leave for an artist's
 * commission page, and so does this — with the same caution, in the confirm's own register.
 */
function CommissionLink({ href }: { href: string }) {
  const { confirm, confirmDialog } = useConfirm();
  const open = async () => {
    const ok = await confirm({
      title: '确认前往约稿平台',
      message:
        'PicPony 只提供画师的约稿信息，不为交易的任何细节担保。此链接应通向正规的交易托管平台，交易前请与画师仔细沟通。\n确定要前往吗？',
      tone: 'filled',
    });
    if (ok) window.open(href, '_blank', 'noopener,noreferrer');
  };
  let host = href;
  try {
    host = new URL(href).host;
  } catch {
    /* A link the backend accepted but the URL parser does not: shown as written. */
  }
  return (
    <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2">
      <Button variant="filled" icon={<MdOpenInNew />} onClick={() => void open()}>
        前往约稿平台
      </Button>
      <span className="min-w-0 truncate text-body-s text-on-surface-variant" title={href}>
        {host}
      </span>
      {confirmDialog}
    </div>
  );
}

function TagList({ label, tags }: { label?: string; tags: string[] }) {
  if (tags.length === 0) return null;
  const shown = tags.slice(0, TAG_PREVIEW);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      {label && <span className="me-0.5 text-label-m text-on-surface-variant">{label}</span>}
      {shown.map((tag) => (
        <Badge key={tag} title={tag}>
          {tag}
        </Badge>
      ))}
      {tags.length > TAG_PREVIEW && (
        <span className="text-body-s text-on-surface-variant">+{tags.length - TAG_PREVIEW}</span>
      )}
    </div>
  );
}

type ImportTarget = { kind: 'tag'; group: SharedTagGroup } | { kind: 'block'; group: SharedBlockGroup };
type Outcome = { ok: true } | { ok: false; message: string };

/* Module scope: the React Compiler does not lower a `try` with a `finally` in a component. */
async function importGroup(token: string, target: ImportTarget): Promise<Outcome> {
  try {
    if (target.kind === 'tag') await importSharedTagGroup(token, target.group);
    else await importSharedBlockGroup(token, target.group);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: apiErrorMessage(error, '导入失败') };
  }
}

function GroupRow({
  icon,
  name,
  children,
  state,
  onImport,
}: {
  icon: ReactNode;
  name: string;
  children: ReactNode;
  state: 'idle' | 'busy' | 'done';
  onImport: () => void;
}) {
  return (
    <li className="m3-row flex flex-col gap-3 bg-surface-container p-4 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1 space-y-2">
        <p className="flex min-w-0 items-center gap-2 text-title-s text-on-surface">
          <span className="shrink-0 text-on-surface-variant [&>svg]:block" aria-hidden="true">
            {icon}
          </span>
          <span className="min-w-0 truncate" title={name}>
            {name}
          </span>
        </p>
        {children}
      </div>
      {state === 'done' ? (
        /* A mark, not a control: importing twice makes two copies, so the button goes. */
        <Badge tone="success" size="md" icon={<MdCheck />} className="self-start">
          已导入
        </Badge>
      ) : (
        <Button variant="tonal" size="xs" icon={<MdBookmarkAdd />} loading={state === 'busy'} onClick={onImport} className="self-start">
          导入
        </Button>
      )}
    </li>
  );
}

/**
 * A 标签组分享 post's groups, each with the one thing a reader does with it: 导入, into their own
 * tag groups or block groups (`import_shared_tag_group` / `import_shared_block_group`, the
 * original front end's contract). Signed out, 导入 asks for the sign-in it needs; each import is
 * confirmed, because it adds to the reader's account. A block group arrives switched off, as it
 * did in the original — the confirm says so, and the toast offers the screen that switches it on.
 */
function SharedGroups({ groups }: { groups: SharedGroupsBody }) {
  const router = useRouter();
  const { token } = useSession();
  const { openAuth } = useAuthModal();
  const { confirm, confirmDialog } = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [imported, setImported] = useState<ReadonlySet<string>>(() => new Set());

  const run = async (key: string, target: ImportTarget) => {
    if (!token) {
      openAuth('login');
      return;
    }
    const ok = await confirm({
      title: target.kind === 'tag' ? '确认导入标签组' : '确认导入屏蔽组',
      message:
        target.kind === 'tag'
          ? `确定要将标签组「${target.group.name}」导入到你的标签组吗？`
          : `确定要将屏蔽组「${target.group.name}」导入到你的屏蔽组吗？导入后需要在屏蔽组页面启用才会生效。`,
      tone: 'filled',
    });
    if (!ok) return;
    setBusy(key);
    const outcome = await importGroup(token, target);
    setBusy((current) => (current === key ? null : current));
    if (readToken() !== token) return;
    if (!outcome.ok) {
      showToast(outcome.message, 'error');
      return;
    }
    setImported((previous) => new Set(previous).add(key));
    shareableGroups.invalidate({ token });
    if (target.kind === 'block') {
      blockGroups.invalidate({ token });
      showToast('已导入屏蔽组', 'success', {
        action: { label: '查看', onClick: () => router.push('/block-groups', { scroll: false }) },
      });
    } else {
      tagGroups.invalidate({ token });
      showToast('已导入标签组', 'success');
    }
  };

  const stateOf = (key: string) => (imported.has(key) ? 'done' : busy === key ? 'busy' : 'idle');

  if (groups.tagGroups.length === 0 && groups.blockGroups.length === 0) {
    return <p className="mt-4 text-body-m text-on-surface-variant">这篇帖子没有分享任何组</p>;
  }

  return (
    <div className="mt-6 space-y-6">
      {groups.tagGroups.length > 0 && (
        <section>
          <SectionHeading as="h3" aside={groups.tagGroups.length} className="mb-3">
            标签组
          </SectionHeading>
          <ul>
            {groups.tagGroups.map((group, index) => {
              const key = `tag:${index}`;
              return (
                <GroupRow
                  key={key}
                  icon={<MdBookmarks size={ICON.dense} />}
                  name={group.name}
                  state={stateOf(key)}
                  onImport={() => void run(key, { kind: 'tag', group })}
                >
                  {group.tags.length > 0 ? (
                    <TagList tags={group.tags} />
                  ) : (
                    <p className="text-body-s text-on-surface-variant">没有标签</p>
                  )}
                </GroupRow>
              );
            })}
          </ul>
        </section>
      )}
      {groups.blockGroups.length > 0 && (
        <section>
          <SectionHeading as="h3" aside={groups.blockGroups.length} className="mb-3">
            屏蔽组
          </SectionHeading>
          <ul>
            {groups.blockGroups.map((group, index) => {
              const key = `block:${index}`;
              const empty = group.hidden_tags.length === 0 && group.spoilered_tags.length === 0;
              return (
                <GroupRow
                  key={key}
                  icon={<MdBlock size={ICON.dense} />}
                  name={group.name}
                  state={stateOf(key)}
                  onImport={() => void run(key, { kind: 'block', group })}
                >
                  <TagList label="隐藏" tags={group.hidden_tags} />
                  <TagList label="打码" tags={group.spoilered_tags} />
                  {empty && <p className="text-body-s text-on-surface-variant">没有标签</p>}
                </GroupRow>
              );
            })}
          </ul>
        </section>
      )}
      {confirmDialog}
    </div>
  );
}

/**
 * A post's body, by kind: a discussion is its BBCode; a commission is its description and the
 * way to the artist's page; a tag-group share is its note and the groups it shares. A body that
 * does not parse as its kind says (an older post, a hand-written one) is shown as text.
 *
 * Render it inside a container that names the type role — the rich-text rhythm is in `em`.
 */
export default function ForumPostBody({ post }: { post: Pick<ForumPost, 'category' | 'content'> }) {
  if (post.category === 'commission') {
    const commission = parseCommission(post.content);
    if (commission) {
      return (
        <>
          {commission.description.trim() && <RichTextRenderer content={commission.description} format="bbcode" />}
          {commission.link && <CommissionLink href={commission.link} />}
        </>
      );
    }
  }
  if (post.category === 'taggroups') {
    const groups = parseSharedGroups(post.content);
    if (groups) {
      return (
        <>
          {/* Plain text: the original front end took it from a text box, not the editor. */}
          {groups.description.trim() && <p className="whitespace-pre-line">{groups.description.trim()}</p>}
          <SharedGroups groups={groups} />
        </>
      );
    }
  }
  return <RichTextRenderer content={post.content} format="bbcode" />;
}
