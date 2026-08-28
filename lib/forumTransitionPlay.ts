'use client';

import { DURATION, gsap, spring } from '@/lib/motion';
import { motionTier } from '@/lib/appearance';
import type { ForumOrigin } from '@/lib/forumTransition';

/**
 * Grows `card` from `origin` to wherever it has just been laid out.
 *
 * A FLIP: the card is already in its final position, so the tween only has to
 * put it back at the origin and release it. The scale is non-uniform, which
 * would smear the text — hence `content`, which is held out and faded in over
 * the back half. That is the spec's own answer, and it is why a container
 * transform reads as one surface changing shape rather than as a page being
 * zoomed.
 *
 * Returns a cleanup that reverts everything, for a navigation that unmounts
 * mid-flight.
 */
export function playForumContainerTransform(
  card: HTMLElement,
  content: HTMLElement | null,
  origin: ForumOrigin,
): () => void {
  const to = card.getBoundingClientRect();
  if (to.width === 0 || to.height === 0) return () => {};

  /* Reduced: the card fades up in place. A container transform is travel *and* a
     non-uniform scale — the two things the tier's rule removes — so what is left of the
     gesture is "the post you pressed is now the surface in front of you", which a fade
     says. Held to one clock so it cannot read as two events. */
  if (motionTier() === 'reduced') {
    const fade = gsap.fromTo(
      [card, content].filter((el): el is HTMLElement => Boolean(el)),
      { autoAlpha: 0 },
      { autoAlpha: 1, ...spring('defaultEffects'), clearProps: 'opacity,visibility' },
    );
    return () => {
      fade.kill();
      gsap.set([card, content].filter(Boolean) as HTMLElement[], {
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
      /* `emphasized` at 500ms, which is the pairing for a large container
         transform — and this file's own header calls this a container transform.
         It read a literal `0.4` on `decelerate`: the wrong row of the table (that
         pairing is for something *entering* the screen) and a hand-typed number
         where `DURATION` was already imported. The shared axis was raised to 500
         for the same reason. */
      duration: DURATION.emphasized,
      ease: 'emphasized',
      /* Nothing may keep a transform: this card is an ancestor of the post's
           images, and a residual one would make it a containing block for any
           fixed descendant. */
      clearProps: 'transform,transformOrigin,willChange',
    },
    0,
  );

  if (content) {
    timeline.fromTo(
      content,
      { autoAlpha: 0 },
      /* `defaultEffects`, the critically-damped spring — a fade is an *effects*
         change, and `ease: 'none'` was a linear fade, which this file's own rules
         allow only for a spinner's rotation or a pre-sampled track. The 150ms offset
         stays: the container morphs first, its contents arrive behind it, which is
         the same split `Popover` uses. */
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
