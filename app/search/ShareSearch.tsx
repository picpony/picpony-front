'use client';

import { useRef, useState } from 'react';
import { MdClose, MdShare } from 'react-icons/md';
import Button from '@/components/Button';
import IconButton from '@/components/IconButton';
import { showToast } from '@/components/Toast';
import { createShareLink, trackShare } from '@/lib/api/share';
import { readToken, readUserInfo } from '@/lib/hooks';
import { ICON } from '@/lib/icons';
import { SHARED_BY_PARAM } from '@/lib/searchState';
import { copyText } from '@/lib/utils';

/** What the link preview and the recipient's notice call a visitor who is not signed in. */
const ANONYMOUS = '匿名用户';

async function copyShareLink(url: string, token: string | null): Promise<boolean> {
  if (!(await copyText(url))) return false;
  showToast('已复制分享链接', 'success');
  trackShare(token);
  return true;
}

/**
 * 分享搜索结果 — the original front end's feature and contract: a short link from `share.php`
 * (falling back to the long link on any failure), copied, with the share counted toward the
 * account's tasks. The link is this search's own URL, page left out, with `from=<username>` so
 * the recipient's screen can say who sent it.
 *
 * **A copy that fails is offered again, as a tap.** The link is made over the network first,
 * and some browsers only allow a clipboard write inside the gesture that asked for it — by the
 * time the link exists that gesture can be spent. The toast's 复制 is a fresh one.
 */
export function ShareSearchButton({ href, query }: { href: string; query: string }) {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const share = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const token = readToken();
      const username = readUserInfo()?.username;
      const name = (typeof username === 'string' && username.trim()) || ANONYMOUS;
      const target = new URL(href, window.location.origin);
      target.searchParams.delete('page');
      target.searchParams.set(SHARED_BY_PARAM, name);
      const link = await createShareLink(
        {
          targetUrl: target.href,
          title: `分享搜索结果：${query}`,
          desc: `${name} 向您分享了ta的搜索结果，快来看看吧~`,
        },
        { token },
      );
      if (await copyShareLink(link.url, token)) return;
      showToast('分享链接已生成', 'info', {
        action: {
          label: '复制',
          onClick: () => {
            void copyShareLink(link.url, token).then((copied) => {
              if (!copied) showToast('复制失败，请检查浏览器的剪贴板权限', 'error');
            });
          },
        },
      });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <Button
      variant="text"
      className="shrink-0"
      icon={<MdShare />}
      loading={busy}
      responsiveLabel
      aria-label="分享搜索结果"
      onClick={() => void share()}
    >
      分享
    </Button>
  );
}

/**
 * The recipient's side: one 40dp line under the field naming who shared the search, the same
 * geometry as the semantic row under it. Dismissing it takes the name out of the URL, so a
 * reload or a re-share does not bring it back.
 */
export function SharedByNotice({ name, onDismiss }: { name: string; onDismiss: () => void }) {
  return (
    <div className="flex h-10 min-w-0 items-center gap-2 text-body-m text-on-surface-variant" role="status">
      <MdShare size={ICON.control} className="shrink-0 text-primary-ink" aria-hidden="true" />
      <p className="min-w-0 flex-1 truncate">
        <span className="text-body-m-emphasized text-on-surface">{name}</span> 分享了这次搜索
      </p>
      <IconButton size="sm" dismiss aria-label="关闭分享提示" icon={<MdClose />} onClick={onDismiss} />
    </div>
  );
}
