'use client';

import { useState } from 'react';
import { PageLoadingIndicator } from '@/components/LoadingIndicator';
import PageHeader from '@/components/PageHeader';
import { useSession } from '@/lib/hooks';
import MessagesScreen from './MessagesScreen';

/**
 * /messages. The screen is split by what it holds — `MessagesScreen` (tabs, the choice of tab,
 * the address), a pane per tab, and under 私信 the contacts (`ContactList`), the conversation
 * (`Conversation`, `Thread`, `ChatComposer`, `EmojiPicker`) and their pure models
 * (`threadModel`, `composerModel`, `messageText`).
 *
 * The session is read before anything renders — the server's render and hydration show the tab
 * row as a placeholder, so no tab a visitor is not offered can appear first.
 *
 * **One screen per account, and a sign-in is not a change of account**: a visitor's screen holds
 * nothing of anybody's, so it is kept and the personal tabs join it in place (decision 22). A
 * sign-out or another account replaces it, so no private pane, draft or conversation of the
 * previous session survives even the render before an effect could clear it.
 */
export default function MessagesPage() {
  const { token, ready } = useSession();
  const [account, setAccount] = useState({ token, generation: 0 });
  if (account.token !== token) {
    setAccount({
      token,
      generation: account.token === null ? account.generation : account.generation + 1,
    });
  }
  if (!ready) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title="消息" />
        <PageLoadingIndicator size="page" holdFooter delay={160} label="正在读取登录状态…" />
      </div>
    );
  }
  return <MessagesScreen key={account.generation} token={token} />;
}
