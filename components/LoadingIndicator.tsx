'use client';

import { useEffect, useRef, useState, type CSSProperties, type HTMLAttributes } from 'react';
import { INITIAL_LOADING_PATH, subscribeLoadingIndicator } from '@/lib/loadingIndicator';
import { cn } from '@/lib/utils';

export type LoadingIndicatorSize = 'xs' | 'sm' | 'md' | 'lg';
export type LoadingIndicatorVariant = 'default' | 'contained';
export type LoadingIndicatorTone = 'primary' | 'on-media' | 'on-container' | 'inherit';

interface LoadingIndicatorProps {
  /**
   * `default` draws the morphing polygon directly on the host surface (`primary-ink`).
   * `contained` frames it inside a circular container (`primary-container` + `on-primary-container`),
   * matching Compose's `ContainedLoadingIndicator` (38 dp active shape in a 48 dp disc at `md`).
   */
  variant?: LoadingIndicatorVariant;
  /** `md` (48 dp) is M3E's `LoadingIndicatorTokens.ContainerWidth/Height`. */
  size?: LoadingIndicatorSize;
  tone?: LoadingIndicatorTone;
  /** Accessible name when not decorative. */
  label?: string;
  /** Hide from assistive technology when a parent already announces loading status. */
  decorative?: boolean;
  /** Pause animation and detach from the shared clock (e.g. exiting overlays or settled media). */
  paused?: boolean;
  /**
   * Grace period (ms) before revealing and animating the indicator. Keeps fast hydration or
   * warm-cache modals calm without a 1–2 frame flash, fading in on `spring-fast-effects`.
   */
  delay?: number;
  /** Pause automatically while off-screen or `@container`-hidden via the driver's observer pool. */
  autoPause?: boolean;
  /** Let `.media-loading-placeholder` CSS control `display` and 2D container-query sizing. */
  responsive?: boolean;
  className?: string;
}

const CONTAINER_SIZE: Record<LoadingIndicatorSize, string> = {
  xs: 'size-6',
  sm: 'size-8',
  md: 'size-12',
  lg: 'size-16',
};

const DEFAULT_SHAPE_SIZE: Record<LoadingIndicatorSize, string> = {
  xs: 'size-5',
  sm: 'size-7',
  md: 'size-10',
  lg: 'size-12',
};

const CONTAINED_TONE: Record<LoadingIndicatorTone, string> = {
  primary: 'bg-primary-container text-on-primary-container forced-boundary',
  'on-media': 'bg-media-plate text-on-media forced-boundary',
  'on-container': 'bg-surface-container-highest text-on-surface forced-boundary',
  inherit: 'forced-boundary',
};

const UNCONTAINED_TONE: Record<LoadingIndicatorTone, string> = {
  primary: 'text-primary-ink',
  'on-media': 'text-on-media',
  'on-container': '',
  inherit: '',
};

const HAS_SIZE = /(?:^|\s)(?:size|w|h)-\S+/;
const HAS_DISPLAY =
  /(?:^|\s)(?:hidden|block|flex|inline-flex|grid|inline-grid|inline|inline-block)(?:\s|$)/;

/**
 * Delays showing an indicator past fast hydration/cache gates without synchronous `setState`
 * inside effects. Latches once revealed so modal exit (`paused=true`) freezes motion cleanly
 * instead of double-fading, and changing `delay` never blinks or re-announces live text.
 */
function useRevealDelay(delay: number, paused: boolean): boolean {
  const [revealed, setRevealed] = useState(delay <= 0);
  const waiting = !revealed && delay > 0 && !paused;

  useEffect(() => {
    if (!waiting) return;
    const timer = window.setTimeout(() => setRevealed(true), delay);
    return () => window.clearTimeout(timer);
  }, [waiting, delay]);

  return delay <= 0 || revealed;
}

/**
 * Material 3 Expressive loading indicator — a rounded polygon that morphs continuously
 * through the seven Material shapes on a shared spring clock (`lib/loadingIndicator.ts`).
 *
 * Motion tiers follow `docs/motion-system.md`:
 * - `standard`: bouncy spring morph + dual rotation (`ζ = 0.6, k = 200`, 650 ms cadence)
 * - `reduced`: critically damped morph without overshoot, keeping the cadence
 * - `off`: morphing stops on `SoftBurst` and CSS rotates it slowly (`app/globals.css`)
 */
export default function LoadingIndicator({
  variant = 'default',
  size = 'md',
  tone = 'primary',
  label,
  decorative = false,
  paused = false,
  delay = 0,
  autoPause = false,
  responsive = false,
  className = '',
}: LoadingIndicatorProps) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const groupRef = useRef<SVGGElement>(null);
  const shown = useRevealDelay(delay, paused);
  const effectivePaused = paused || !shown;

  useEffect(() => {
    if (effectivePaused) return;
    const path = pathRef.current;
    const group = groupRef.current;
    if (!path || !group) return;
    return subscribeLoadingIndicator({
      path,
      group,
      observe: autoPause ? hostRef.current : null,
    });
  }, [effectivePaused, autoPause]);

  const contained = variant === 'contained';
  const hiddenByDelay = delay > 0 && !shown;
  return (
    <span
      ref={hostRef}
      role={decorative || hiddenByDelay ? undefined : 'progressbar'}
      aria-label={decorative || hiddenByDelay ? undefined : label || '加载中'}
      aria-hidden={decorative || hiddenByDelay || undefined}
      data-indicator-responsive={responsive ? variant : undefined}
      className={cn(
        'm3e-loading-indicator shrink-0 items-center justify-center',
        responsive ? 'media-loading-responsive' : !HAS_DISPLAY.test(className) && 'inline-flex',
        contained && 'rounded-full',
        !responsive &&
          !HAS_SIZE.test(className) &&
          (contained ? CONTAINER_SIZE[size] : DEFAULT_SHAPE_SIZE[size]),
        contained ? CONTAINED_TONE[tone] : UNCONTAINED_TONE[tone],
        delay > 0 && 'm3e-loading-reveal',
        delay > 0 && (shown ? 'opacity-100 scale-100' : 'opacity-0 scale-90'),
        effectivePaused && 'm3e-loading-paused',
        className,
      )}
    >
      <svg
        viewBox="0 0 100 100"
        focusable="false"
        aria-hidden="true"
        /* 38 / 48 ≈ 79.17% inside a contained disc (`LoadingIndicatorTokens.ActiveSize`); full box uncontained. */
        className={cn(
          'm3e-loading-shape block forced-colors:text-[color:CanvasText]',
          contained ? 'size-[79.17%]' : 'size-full',
        )}
      >
        <g ref={groupRef}>
          <path ref={pathRef} d={INITIAL_LOADING_PATH} fill="currentColor" />
        </g>
      </svg>
    </span>
  );
}

const HAS_BG = /(?:^|\s)bg-\S+/;
const HAS_RADIUS = /(?:^|\s)rounded(?:-\S+)?/;
const HAS_POSITION = /(?:^|\s)(?:absolute|fixed|relative|sticky|static)(?:\s|$)/;

interface MediaLoadingPlaceholderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Pause the morph clock when offline or inside an inactive surface. */
  paused?: boolean;
  /**
   * The media has landed and this placeholder is cross-fading out underneath it.
   * Stops the morph clock and dismisses the inner indicator glyph so transparent
   * PNG/WebP/SVG artwork never shows a lingering tinted shape behind it.
   */
  settled?: boolean;
  /** Drop the inner glyph immediately (no fade) once `settled` (SSR paintAsServed, previews, video play badge). */
  instantHide?: boolean;
  /** Render only the quiet surface plate without an indicator SVG (pre-hydration or offline hold). */
  quiet?: boolean;
  /** `default` for repeated tiles; `contained` for focal single-stage wells (detail, banner, captcha). */
  variant?: LoadingIndicatorVariant;
  /** Explicit indicator size; omit to adapt automatically to both container axes via 2D `@container`. */
  size?: LoadingIndicatorSize;
  /** Pause automatically off-screen or when `@container`-hidden (`display: none`). On by default. */
  autoPause?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Quiet surface plate with a centred M3E loading indicator for media frames (`FadeInImage`,
 * `ImageCard`, `ImageCardVideo`, `DetailImage`, `DetailVideo`, `FeaturedBanner`, `SliderCaptcha`).
 *
 * Paints the indicator immediately (zero reveal delay, so scrolling into unloaded tiles never
 * shows empty grey gaps; cached images skip mounting this placeholder synchronously in
 * `useLayoutEffect`), while off-screen and `< 3rem` `@container`-hidden instances pause inside
 * the driver's pooled observer with zero React re-renders.
 */
export function MediaLoadingPlaceholder({
  paused = false,
  settled = false,
  instantHide = false,
  quiet = false,
  variant = 'default',
  size,
  autoPause = true,
  className = '',
  style,
  ...rest
}: MediaLoadingPlaceholderProps) {
  const responsive = !size && !quiet;
  return (
    <div
      aria-hidden="true"
      data-loading-placeholder=""
      className={cn(
        responsive && 'media-loading-placeholder',
        'flex items-center justify-center overflow-hidden',
        !HAS_POSITION.test(className) && 'absolute inset-0',
        !HAS_BG.test(className) && 'bg-surface-container-high',
        !HAS_RADIUS.test(className) && 'rounded-none',
        className,
      )}
      style={style}
      {...rest}
    >
      {!quiet && (
        <LoadingIndicator
          variant={variant}
          size={size ?? 'md'}
          decorative
          responsive={responsive}
          autoPause={autoPause}
          paused={paused || settled}
          className={cn(
            settled && instantHide ? 'transition-none' : 'm3e-loading-dismiss',
            settled ? 'opacity-0 scale-90' : 'opacity-100 scale-100',
          )}
        />
      )}
    </div>
  );
}

interface PageLoadingIndicatorProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Matches `StatusView` enclosure presets so loading and settled states share a calm box. */
  size?: 'page' | 'pane' | 'inline';
  /** Visible loading remark beneath the indicator (also announced via `role="status"` once revealed). */
  label?: string;
  /** Render `label` visibly beneath the indicator (defaults to `true`; set `false` in ultra-narrow icon rails). */
  showLabel?: boolean;
  /** Hold the page footer back (`data-page-loading`) while a first-load screen waits. */
  holdFooter?: boolean;
  /** Visual variant; `contained` is M3E's default for page and modal loading states. */
  variant?: LoadingIndicatorVariant;
  indicatorSize?: LoadingIndicatorSize;
  /** Pause animation (e.g. while a host dialog/panel is closing). */
  paused?: boolean;
  /**
   * Grace period (ms) before revealing the indicator and announcing `label`. Keeps layout box
   * and footer hold (`data-page-loading`) active from frame 0 while avoiding 1-frame flashes
   * and stale screen-reader announcements on hydration or warm-cache transitions.
   */
  delay?: number;
  className?: string;
}

const HAS_MIN_H = /(?:^|\s)min-h-\S+/;

const PAGE_LOADING_SIZE: Record<'page' | 'pane' | 'inline', { pad: string; floor: string }> = {
  page: { pad: 'py-8', floor: 'min-h-[50dvh]' },
  pane: { pad: 'py-8', floor: 'min-h-[32dvh]' },
  inline: { pad: 'py-6', floor: '' },
};

/**
 * Centred M3E loading indicator with a calm status remark for uncertain-structure views,
 * routes, gates, forms and dialogs where layout count or geometry is not yet known.
 */
export function PageLoadingIndicator({
  size = 'pane',
  label = '加载中…',
  showLabel = true,
  holdFooter = false,
  variant = 'contained',
  indicatorSize,
  paused = false,
  delay = 0,
  className = '',
  ...rest
}: PageLoadingIndicatorProps) {
  const shown = useRevealDelay(delay, paused);
  const resolvedSize: LoadingIndicatorSize =
    indicatorSize ?? (size === 'page' ? 'lg' : size === 'inline' ? 'sm' : 'md');
  const { pad, floor } = PAGE_LOADING_SIZE[size];
  return (
    <div
      role="status"
      data-page-loading={holdFooter ? '' : undefined}
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-4 text-center',
        pad,
        !HAS_MIN_H.test(className) && floor,
        className,
      )}
      {...rest}
    >
      <LoadingIndicator
        variant={variant}
        size={resolvedSize}
        decorative
        paused={paused || !shown}
        className={
          delay > 0
            ? cn('m3e-loading-reveal', shown ? 'opacity-100 scale-100' : 'opacity-0 scale-90')
            : undefined
        }
      />
      {showLabel ? (
        shown ? (
          <p className={cn('text-body-m text-on-surface-variant', delay > 0 && 'animate-fade-in')}>
            {label}
          </p>
        ) : (
          /* Hold the remark's exact single-line height during a delayed grace period without
             emitting premature live-region text, so revealing the caption never shifts the disc. */
          <p
            aria-hidden="true"
            className="select-none text-body-m text-on-surface-variant opacity-0"
          >
            &nbsp;
          </p>
        )
      ) : (
        shown && <span className="sr-only">{label}</span>
      )}
    </div>
  );
}
