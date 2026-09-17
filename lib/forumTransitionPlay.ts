'use client';

import { DURATION, gsap, spring } from '@/lib/motion';
import { motionTier } from '@/lib/appearance';
import { routeTransitActive } from '@/lib/pageTransit';
import type { ForumOrigin } from '@/lib/forumTransition';

/**
 * Grows `card` from `origin` to wherever it has just been laid out.
 *
 * A FLIP: the card is already in its final position, so the tween only puts it back at the origin
 * and releases it. The scale is non-uniform, which would smear the text — hence `content`, held
 * out and faded in over the back half, so it reads as one surface changing shape, not a page zoom.
 *
 * Returns a cleanup that reverts everything, for a navigation that unmounts mid-flight.
 */
export function playForumContainerTransform(
  card: HTMLElement,
  content: HTMLElement | null,
  origin: ForumOrigin,
): () => void {
  const tier = motionTier();
  /* In the reduced tier the route already provides this surface's one fade.
     Starting a nested fade would multiply the opacity and delay the content.
     A standalone appearance still gets the reduced fallback below. */
  if (tier === 'off' || (tier === 'reduced' && routeTransitActive(card))) return () => {};
  const to = card.getBoundingClientRect();
  if (to.width === 0 || to.height === 0) return () => {};

  /* Reduced: the card fades up in place. Travel and non-uniform scale are the two things the
     tier removes, and a fade is what "the post you pressed is now in front of you" becomes. One
     clock so it cannot read as two events. */
  if (tier === 'reduced') {
    const fade = gsap.fromTo(
      card,
      { autoAlpha: 0 },
      { autoAlpha: 1, ...spring('defaultEffects'), clearProps: 'opacity,visibility' },
    );
    return () => {
      fade.kill();
      gsap.set(card, {
        clearProps: 'opacity,visibility',
      });
    };
  }

  const timeline = gsap.timeline().fromTo(
    card,
    {
      x: origin.left - to.left,
      y: origin.top - to.top,
      scaleX: origin.width / to.width,
      scaleY: origin.height / to.height,
      transformOrigin: 'top left',
    },
    {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      /* The pairing for a large container transform: `emphasized` at 500ms. */
      duration: DURATION.emphasized,
      ease: 'emphasized',
      /* Nothing may keep a transform: this card is an ancestor of the post's images, and a
         residual one would make it a containing block for any fixed descendant. */
      clearProps: 'transform,transformOrigin,willChange',
    },
    0,
  );

  if (content) {
    timeline.fromTo(
      content,
      { autoAlpha: 0 },
      /* `defaultEffects` — a fade is an *effects* change, so the critically damped spring. The
         150ms offset stays: the container morphs first, its contents arrive behind it. */
      { autoAlpha: 1, ...spring('defaultEffects'), clearProps: 'opacity,visibility' },
      0.15,
    );
  }

  return () => {
    timeline.kill();
    gsap.set(content ? [card, content] : card, {
      clearProps: 'transform,transformOrigin,opacity,visibility,willChange',
    });
  };
}
