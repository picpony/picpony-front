import { getAppScroller } from '@/lib/appScroller';

/**
 * Focus an element the user did not tab to, without a ring and without scrolling: the
 * landing point of a route change or of the skip link. A non-focusable target gets a
 * temporary `tabindex="-1"`, withdrawn when focus leaves — left in place, every click on
 * the page's plain content would focus it.
 */
export function focusLanding(target: HTMLElement): boolean {
  const added = !target.hasAttribute('tabindex');
  if (added) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
  /* `focus()` fails silently on a node that cannot take focus yet — the incoming page is
     `visibility: hidden` for the route fade's overlap delay. Nothing is left behind then: the
     temporary tab stop and the marker would otherwise outlive a blur that never comes. */
  if (document.activeElement !== target) {
    if (added) target.removeAttribute('tabindex');
    return false;
  }
  target.setAttribute('data-route-focus', '');
  target.addEventListener(
    'blur',
    () => {
      target.removeAttribute('data-route-focus');
      if (added) target.removeAttribute('tabindex');
    },
    { once: true },
  );
  return true;
}

/**
 * Land focus on the page itself: its `<h1>`, else the app scroller. This is for a focus with
 * nowhere left to go: a dialog closing whose opener is gone, with no other surface to take the
 * focus. A password change ends in a sign-out, the session remount removes the page under the
 * sign-in dialog that follows, and closing that dialog used to leave focus on the body.
 */
export function focusPageLanding(): boolean {
  const main = getAppScroller();
  if (!main) return false;
  const heading = main.querySelector<HTMLElement>('[data-page-content] h1');
  if (heading && focusLanding(heading)) return true;
  return focusLanding(main);
}
