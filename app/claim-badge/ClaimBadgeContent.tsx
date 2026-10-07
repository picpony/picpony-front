'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { MdEmojiEvents } from 'react-icons/md';
import Button from '@/components/Button';
import { buttonClasses } from '@/components/buttonStyles';
import Card from '@/components/Card';
import ErrorRetry from '@/components/ErrorRetry';
import PageBack from '@/components/PageBack';
import PageHeader from '@/components/PageHeader';
import SignInRequired from '@/components/SignInRequired';
import Skeleton, { SkeletonCircle } from '@/components/Skeleton';
import StatusView, { statusViewBox } from '@/components/StatusView';
import UserBadge from '@/components/UserBadge';
import { claimBadge } from '@/lib/api/badges';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { useBackOrParent } from '@/lib/backNavigation';
import { readToken, useEscapeBack, useSession } from '@/lib/hooks';
import { focusLanding } from '@/lib/focusLanding';
import { ICON } from '@/lib/icons';
import { useResource } from '@/lib/resource';
import { badgeDictionary, myBadges } from '@/lib/resources';
import { settle } from '@/lib/settle';
import { cn } from '@/lib/utils';

/**
 * How long the badge just claimed may hold its result back while its colour and description are
 * read: the result then lands whole (M1-027) — the badge used to arrive neutral and turn its own
 * colour a round trip later. Past this the result shows, and the badge takes its place when it can.
 */
const EARNED_BADGE_WAIT_MS = 1500;

/**
 * The card's own shape while the session is read — `StatusView`'s `pane` block, which every state
 * of the card is: its floor and padding, the glyph, the title, the sentence and the button. A
 * status in words for a screen reader (G4-022): the shape itself is hidden from it.
 */
function ClaimSkeleton() {
  return (
    <Card variant="filled" padding="lg">
      <div role="status" className="sr-only">正在读取登录状态…</div>
      <div data-page-loading aria-hidden="true" className={statusViewBox('pane')}>
        <SkeletonCircle size={48} className="mb-6" />
        <Skeleton className="h-7 w-48 max-w-full" />
        <Skeleton className="mt-2 h-5 w-56 max-w-full" delay={60} />
        <Skeleton className="mt-6 h-10 w-32 rounded-full" delay={120} />
      </div>
    </Card>
  );
}

/** The way out of the card: the account's own page when there is one, else home. */
function ExitLink({ profileHref, emphasized }: { profileHref: string; emphasized: boolean }) {
  return (
    <Link scroll={false} href={profileHref} className={buttonClasses({ variant: emphasized ? 'filled' : 'tonal' })}>
      {profileHref === '/' ? '返回首页' : '返回个人主页'}
    </Link>
  );
}

/**
 * /claim-badge — reached cold, from a link an administrator minted (`components/admin/BadgesTab`),
 * so it is not a drawer row and carries the back affordance in every state (G4-006): back when the
 * app has an entry behind it, otherwise up to home. A link with no claim token says so and offers
 * the same way out, rather than leaving nothing to press.
 */
export default function ClaimBadgeContent({ claimToken }: { claimToken: string }) {
  const { user, token, ready } = useSession();
  const handleBack = useBackOrParent('/');
  useEscapeBack(handleBack);
  const userId = Number(user?.id);
  const profileHref = Number.isSafeInteger(userId) && userId > 0 ? `/user/${userId}` : '/';
  // Each account/link pair owns its result, so changing accounts cannot display
  // the previous account's success or apply its delayed response to this one.
  return (
    <>
      <PageBack onClick={handleBack} />
      <div className="page-back-room-2xl mx-auto max-w-2xl">
        <PageHeader title="领取徽章" />
        {!claimToken ? (
          <ErrorRetry
            title="领取链接无效"
            message="链接中缺少领取凭证，请使用完整的徽章领取链接。"
            action={<ExitLink profileHref={profileHref} emphasized />}
          />
        ) : !ready ? (
          <ClaimSkeleton />
        ) : !token ? (
          <SignInRequired description="登录后即可领取此徽章，领取链接会保留在当前页面。" />
        ) : (
          <ClaimForm key={`${token}:${claimToken}`} token={token} claimToken={claimToken} profileHref={profileHref} />
        )}
      </div>
    </>
  );
}

/** The badge a claim gave, as its result shows it; `null` until it could be read. */
interface EarnedLook {
  color: string;
  description: string | null;
}

type Outcome =
  | { kind: 'claimed'; name: string | null; look: EarnedLook | null }
  /** The server refused (an expired, disabled or spent link): trying again would say the same. */
  | { kind: 'refused'; message: string }
  /** The answer never came back, or could not be read: whether it applied is unknown. */
  | { kind: 'unknown'; message: string; retryable: boolean };

/**
 * The badge just claimed, read again — the account's list for its colour, the dictionary for its
 * description — for the result to show with it, waiting up to `EARNED_BADGE_WAIT_MS`; `null` past
 * that. The list is the one the profile's wall and the equip dialog read, so this is their refresh
 * too; a list that cannot be read is left stale for them to try again.
 */
async function readEarnedBadge(token: string, name: string): Promise<EarnedLook | null> {
  let timer = 0;
  const look = Promise.allSettled([myBadges.read({ token }, { force: true }), badgeDictionary.read({})]).then(
    ([held, dictionary]): EarnedLook => {
      if (held.status === 'rejected') myBadges.expire({ token });
      return {
        color: held.status === 'fulfilled' ? (held.value.badges.find((badge) => badge.name === name)?.color ?? '') : '',
        description: dictionary.status === 'fulfilled' ? (dictionary.value[name] ?? null) : null,
      };
    },
  );
  const late = new Promise<null>((resolve) => {
    timer = window.setTimeout(() => resolve(null), EARNED_BADGE_WAIT_MS);
  });
  const result = await Promise.race([look, late]);
  window.clearTimeout(timer);
  return result;
}

/** The badge just earned, as it will appear on the profile, under its description. */
function EarnedBadgeLook({ name, look, className }: { name: string; look: EarnedLook; className?: string }) {
  return (
    <div className={cn('mt-4 flex flex-col items-center gap-2', className)}>
      <UserBadge name={name} color={look.color} size="md" />
      {look.description && <p className="max-w-md text-body-s text-on-surface-variant">{look.description}</p>}
    </div>
  );
}

/**
 * The badge just earned when the result could not wait for it: a placeholder in the badge's own
 * place until the account's list and the dictionary have both answered, then the badge and its
 * description as one block, fading in over it.
 */
function LateEarnedBadge({ token, name }: { token: string; name: string }) {
  const held = useResource(myBadges, { token });
  const dictionary = useResource(badgeDictionary, {});
  const badge = held.data?.badges.find((item) => item.name === name);
  const colourKnown = badge !== undefined || held.error !== undefined || (held.data !== undefined && !held.isLoading);
  const descriptionKnown = dictionary.data !== undefined || dictionary.error !== undefined;
  if (!colourKnown || !descriptionKnown) {
    return (
      <div className="mt-4 flex flex-col items-center gap-2" aria-hidden="true">
        <Skeleton className="h-6 w-24 rounded-xs" />
      </div>
    );
  }
  return (
    <EarnedBadgeLook
      name={name}
      look={{ color: badge?.color ?? '', description: dictionary.data?.[name] ?? null }}
      className="animate-fade-in"
    />
  );
}

/**
 * A state of the card. Mounted after a press it fades in on the pane swap's clock; decided when it
 * mounts, so the offer the page opened on never replays it.
 */
function CardState({ swap, children }: { swap: boolean; children: React.ReactNode }) {
  const [play] = useState(swap);
  return <div className={play ? 'animate-page-transition' : undefined}>{children}</div>;
}

/**
 * The claim, in one card whose content is centred in every state — the offer, the result and a
 * failure are one object (R7-035): a failure is the app's own failure view in the card, never a
 * grey sentence wedged between left-aligned text and a button. The button keeps its label while
 * the claim is out (the busy rule), and a success shows the badge it gave.
 *
 * **A result is announced once**: focus lands on its title (G4-022) — the card used to be a live
 * region as well, so the same sentence was said twice. **And it is status feedback, the tier's
 * business** (M1-027): after a press the new state arrives with the pane swap's fade whatever the
 * 入场动画 switch says, and `StatusView` stands its own entrance down for it (`entrance={false}`)
 * — the two must not both run on one block, and the result must not depend on the switch.
 */
function ClaimForm({ token, claimToken, profileHref }: { token: string; claimToken: string; profileHref: string }) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  /* Pressed at least once: from then on every change of state is a swap, never an arrival. */
  const [pressed, setPressed] = useState(false);
  const inFlight = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = outcome
      ? cardRef.current?.querySelector('h2')
      : busy ? cardRef.current?.querySelector('button') : null;
    if (!target) return;
    const focus = () => {
      if (outcome) return focusLanding(target);
      // A retry replaces its error action with the busy claim button.
      target.focus({ preventScroll: true });
      return document.activeElement === target;
    };
    if (focus()) return;
    // Reveal holds the new title hidden during its entrance delay. Follow that animation,
    // and leave focus alone if the person has already tabbed to another control meanwhile.
    let current = true;
    const landAfterReveal = async () => {
      while (current && target.isConnected) {
        const animations = target.getAnimations();
        if (animations.length === 0) return;
        await Promise.allSettled(animations.map((animation) => animation.finished));
        if (!current || document.activeElement !== document.body || focus()) return;
        // A development effect replay can cancel the first entrance and start another.
      }
    };
    void landAfterReveal();
    return () => { current = false; };
  }, [outcome, busy]);

  const submit = async () => {
    if (inFlight.current || outcome?.kind === 'claimed' || readToken() !== token) return;
    inFlight.current = true;
    setPressed(true);
    setBusy(true);
    setOutcome(null);
    const claimed = await settle(claimBadge(token, claimToken));
    let next: Outcome;
    if (claimed.ok && claimed.value.success) {
      const name = claimed.value.badge_name?.trim() || null;
      /* The profile's wall and the equip dialog read this list. */
      if (!name) myBadges.invalidate({ token });
      next = { kind: 'claimed', name, look: name ? await readEarnedBadge(token, name) : null };
    } else if (claimed.ok) {
      next = { kind: 'refused', message: claimed.value.error || '领取失败，链接可能已停用或过期' };
    } else {
      next = {
        kind: 'unknown',
        message: apiErrorMessage(claimed.error, '未能确认领取结果'),
        retryable: isRetryable(claimed.error),
      };
    }
    inFlight.current = false;
    setBusy(false);
    if (readToken() !== token) return;
    setOutcome(next);
  };

  const home = <ExitLink profileHref={profileHref} emphasized={outcome?.kind === 'claimed'} />;

  /* Every state is the same centred block in the card — the offer, the badge it gave, a refusal —
     so a result lands where the offer was. A result is keyed, so it arrives as a block; the offer
     keeps its node while busy, so the button keeps focus. The trophy keeps the neutral glyph ink
     in both (D1-013): the accent's moments are the user's own things, and what celebrates a
     claim is the earned badge itself, in its own colour, under the title. */
  let content;
  if (outcome?.kind === 'claimed') {
    content = (
      <StatusView
        size="pane"
        entrance={!pressed}
        icon={<MdEmojiEvents size={ICON.display} />}
        title={outcome.name ? `已领取「${outcome.name}」` : '已领取徽章'}
        description="徽章已加入当前账号，可以在个人主页佩戴。"
        action={home}
      >
        {outcome.name && (outcome.look
          ? <EarnedBadgeLook name={outcome.name} look={outcome.look} />
          : <LateEarnedBadge token={token} name={outcome.name} />)}
      </StatusView>
    );
  } else if (outcome?.kind === 'refused') {
    content = <ErrorRetry size="pane" entrance={!pressed} title="未能领取徽章" message={outcome.message} action={home} />;
  } else if (outcome?.kind === 'unknown') {
    content = (
      <ErrorRetry
        size="pane"
        entrance={!pressed}
        title="未能确认领取结果"
        message={`${outcome.message}。重试时如果提示已经领取过，徽章就已在你的账号里。`}
        onRetry={outcome.retryable ? () => void submit() : undefined}
        action={outcome.retryable ? undefined : home}
      />
    );
  } else {
    content = (
      <StatusView
        size="pane"
        entrance={!pressed}
        icon={<MdEmojiEvents size={ICON.display} />}
        title="有一枚徽章等你领取"
        description="领取后，此徽章将加入当前账号。"
        action={
          <Button variant="filled" onClick={() => void submit()} loading={busy} icon={<MdEmojiEvents />}>
            领取徽章
          </Button>
        }
      />
    );
  }

  return (
    <Card ref={cardRef} variant="filled" padding="lg">
      {/* After a press every state arrives on the swap's fade, with no entrance of its own. */}
      <CardState key={outcome?.kind ?? 'offer'} swap={pressed}>
        {content}
      </CardState>
    </Card>
  );
}
