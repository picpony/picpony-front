'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Fragment, useState, type ReactNode } from 'react';
import { parseShare } from '@/lib/api/messages';
import { messageTokens, notificationTokens, type MessageToken } from './messageText';
import ShareCard from './ShareCard';

/** A run of tokens as inline content: text, links, emoji pictures, a legacy message's pictures. */
export function MessageTokens({ tokens }: { tokens: readonly MessageToken[] }) {
  return tokens.map((token, index) => {
    switch (token.type) {
      case 'text':
        return <Fragment key={index}>{token.text}</Fragment>;
      case 'emoji':
        return (
          <Image
            key={index}
            src={`/img/emoji/${token.emoji.name}.png`}
            alt={`[${token.emoji.label}]`}
            width={24}
            height={24}
            unoptimized
            draggable={false}
            className="mx-px inline-block size-6 align-text-bottom"
          />
        );
      case 'link':
        return token.internal ? (
          <Link key={index} scroll={false} href={token.href} className="prose-link focus-visible:ring-2 focus-ring">
            {token.text}
          </Link>
        ) : (
          <a
            key={index}
            href={token.href}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            className="prose-link focus-visible:ring-2 focus-ring"
          >
            {token.text}
          </a>
        );
      case 'image':
        return <LegacyImage key={index} src={token.src} />;
    }
  });
}

/**
 * A picture the original front end's editor embedded (`[img]`): from anywhere, of any shape,
 * so a plain `<img>` at its own aspect, capped in height. A picture that does not load says so
 * in words and stays a link to where it was — rather than the engine's broken-image glyph.
 */
function LegacyImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer nofollow ugc"
      aria-label={failed ? undefined : '打开图片'}
      className={
        failed
          ? 'prose-link focus-visible:ring-2 focus-ring'
          : 'my-1 block w-fit max-w-full rounded-md focus-visible:outline-hidden focus-visible:ring-2 focus-ring'
      }
    >
      {failed ? (
        '[图片无法显示]'
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element -- a picture from anywhere, in a message the original front end sent */
        <img
          src={src}
          alt="消息中的图片"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="block max-h-60 max-w-full rounded-md object-contain"
        />
      )}
    </a>
  );
}

/** Up to this many emoji, and nothing else, draw large and without a bubble — as messengers do. */
const JUMBO_LIMIT = 3;

/**
 * A message's body, and whether it is an attachment (no bubble around it): a share card, or a
 * message of one to three emoji alone, drawn large.
 */
export function renderMessageBody(content: string, own: boolean): { attachment: boolean; node: ReactNode } {
  const share = parseShare(content);
  if (share) return { attachment: true, node: <ShareCard target={share} own={own} /> };
  const origin = typeof window === 'undefined' ? undefined : window.location.origin;
  const tokens = messageTokens(content, origin);
  const emoji = tokens.filter((token) => token.type === 'emoji');
  const onlyEmoji = emoji.length > 0 && emoji.length <= JUMBO_LIMIT &&
    tokens.every((token) => token.type === 'emoji' || (token.type === 'text' && token.text.trim() === ''));
  if (onlyEmoji) {
    return {
      attachment: true,
      node: (
        <span className="flex gap-1">
          {emoji.map((token, index) =>
            token.type === 'emoji' ? (
              <Image
                key={index}
                src={`/img/emoji/${token.emoji.name}.png`}
                alt={`[${token.emoji.label}]`}
                width={48}
                height={48}
                unoptimized
                draggable={false}
                className="size-12 object-contain"
              />
            ) : null,
          )}
        </span>
      ),
    };
  }
  return { attachment: false, node: <MessageTokens tokens={tokens} /> };
}

/** A notification's body: its link markers as links, its URLs clickable, its line breaks kept. */
export function NotificationBody({ content }: { content: string }) {
  const origin = typeof window === 'undefined' ? undefined : window.location.origin;
  return <MessageTokens tokens={notificationTokens(content, origin)} />;
}
