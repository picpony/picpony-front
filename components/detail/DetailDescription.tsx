'use client';

import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { MdTranslate } from 'react-icons/md';
import Button from '@/components/Button';
import Card from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import RichTextRenderer from '@/components/RichTextRenderer';
import { showToast } from '@/components/Toast';
import { derpiMarkdown, plainTextOf } from '@/lib/derpiMarkup';
import { useTextTranslation } from '@/lib/translation';

/** The folded height (10rem). The overflow test measures against this rather than the body's own
 *  box, so its answer does not flip with the fold it is deciding. */
const COLLAPSED_MAX_HEIGHT = 160;

/** The folded height fades out rather than stopping mid-line: the mask is alpha, not colour, and
 *  unfolding carries its stop down to the bottom edge so the fade leaves with the clip. Two
 *  two-stop gradients interpolate, so this rides the height's own transition. */
const fadeMask = (open: boolean) => `linear-gradient(to bottom, black ${open ? 100 : 65}%, transparent)`;

/**
 * The picture's description, rendered — Derpibooru writes Markdown, with its own picture
 * references and root-relative links (`lib/derpiMarkup.ts`) — rather than printed as source.
 *
 * It is content, not a control: the whole card used to be a `<button>` that toggled on any
 * press, so text could not be selected, a link inside could not be followed, and the entire
 * description became the button's name. Expanding is its own control now, offered only when
 * the collapsed card actually hides something (measured, not guessed from a character count),
 * and 翻译 shows the translation under it (the original front end's A/文 翻译).
 */
export default function DetailDescription({ description }: { description?: string | null }) {
  const text = description?.trim() ?? '';
  const headingId = useId();
  const bodyId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const open = expanded === text;
  const [overflowing, setOverflowing] = useState(false);
  const [contentHeight, setContentHeight] = useState(0);
  const translation = useTextTranslation(plainTextOf(text), (message) => showToast(message, 'error'));

  /* Whether the folded card hides anything, and how tall it stands unfolded — re-measured when
     its width changes, when a picture inside the description finishes loading and grows it, and
     across the fold. A scroll height reads the whole content in either state, so one measurement
     answers both, and unfolding has a number to travel to: `none` cannot be interpolated. */
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const measure = () => {
      setContentHeight(body.scrollHeight);
      setOverflowing(body.scrollHeight > COLLAPSED_MAX_HEIGHT + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    const content = body.firstElementChild;
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [open, text]);

  const bodyStyle: CSSProperties = {
    maxHeight: open ? contentHeight || 'none' : COLLAPSED_MAX_HEIGHT,
  };
  if (overflowing || open) bodyStyle.maskImage = fadeMask(open);

  return (
    <section aria-labelledby={headingId}>
      <div className="mb-2 flex min-h-8 items-center justify-between gap-2">
        {/* No wider letter-spacing here: the label roles carry their own tracking token. */}
        <h2 id={headingId} className="text-label-m-emphasized text-on-surface-variant">
          简介
        </h2>
        {text && (
          <Button variant="text" size="xs" icon={<MdTranslate />} loading={translation.busy} onClick={translation.toggle}>
            {translation.translation !== null ? '隐藏译文' : '翻译'}
          </Button>
        )}
      </div>
      <Card variant="outlined">
        {text ? (
          <>
            <div
              id={bodyId}
              ref={bodyRef}
              /* Clipped in both states: the fold travels as `max-height`, and unclipped content
                 would paint past the moving edge. `spring-slow-effects` at the far end of the
                 travel table's range — a description is hundreds of pixels, not a banner strip —
                 and critically damped, so the fold never overshoots its own content. */
              className="text-body-m text-on-surface wrap-anywhere overflow-hidden transition-[max-height,mask-image] spring-slow-effects"
              style={bodyStyle}
            >
              <RichTextRenderer content={derpiMarkdown(text)} />
            </div>
            {(overflowing || open) && (
              <Button
                variant="text"
                size="xs"
                className="mt-2"
                aria-expanded={open}
                aria-controls={bodyId}
                onClick={() => setExpanded(open ? null : text)}
              >
                {open ? '收起简介' : '展开简介'}
              </Button>
            )}
            {translation.translation !== null && (
              <div className="mt-3 border-t border-outline-variant pt-3">
                <p className="text-label-m text-on-surface-variant">译文</p>
                <p className="mt-1 whitespace-pre-wrap text-body-m text-on-surface wrap-anywhere">
                  {translation.translation}
                </p>
              </div>
            )}
          </>
        ) : (
          <EmptyState size="inline" title="暂无简介" />
        )}
      </Card>
    </section>
  );
}
