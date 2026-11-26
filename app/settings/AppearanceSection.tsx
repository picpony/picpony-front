'use client';

import { useId, useRef, useState } from 'react';
import { MdPalette, MdTune } from '@/components/icons/common';
import { MdBrightness6, MdOutlineViewSidebar } from '@/components/icons/settings';
import CheckGlyph from '@/components/CheckGlyph';
import Select from '@/components/Select';
import ToggleSwitch from '@/components/ToggleSwitch';
import PaletteSwatches from '@/components/PaletteSwatches';
import { changeScheme } from '@/lib/motionLazy';
import { ICON } from '@/lib/icons';
import { changeSyncedSetting, useSyncedSetting, type DetailLayout } from '@/lib/settingsSync';
import { cn } from '@/lib/utils';
import {
  commitMotion,
  useMotionSetting,
  useMotionSpeed,
  useMotionTier,
  useMotionMode,
  useMotionEnabled,
  useScheme,
  useSchemeSetting,
  type ColorScheme,
  type EntranceMode,
  type MotionSetting,
  type MotionSpeed,
} from '@/lib/appearance';
import { ROW_STACK_CLASS, RowButton, SettingsRow, SettingsSection } from './SettingsRow';
import { MOTION_PRESETS, MOTION_EFFECTS } from '@/lib/motionPreferences';
import { MotionSpeedDialog, MotionEffectsDialog } from './MotionPreferencesDialog';

/** What each 入场动画 does, under the row. */
const ENTRANCE_DESCRIPTIONS: Record<EntranceMode, string> = {
  blocking: '完整播放开屏动画后再显示页面',
  'non-blocking': '页面就绪后即结束开屏动画',
  off: '不播放入场动画',
};

/**
 * 主题配色 — one self-contained block around `PaletteSwatches`, the colour system's own section:
 * the eleven palettes, 配色方案 (多色 / 单色) and the custom colour. **It follows the account**
 * (the original front end's `theme`, and this app's `themeHues` and custom 副色相 beside it —
 * `lib/settingsSync.ts`, which sees a change through `lib/appearance`'s subscription). The block's
 * contents belong to the colour system.
 */
export function PaletteSection({ signedIn }: { signedIn: boolean }) {
  return (
    <SettingsSection
      title="主题配色"
      icon={<MdPalette size={ICON.control} />}
      subtitle={signedIn ? '随账号同步到你登录的设备' : undefined}
    >
      <div className={ROW_STACK_CLASS} data-palette-block="">
        <PaletteSwatches className="w-full" />
      </div>
    </SettingsSection>
  );
}

const DETAIL_LAYOUT_OPTIONS: readonly {
  value: DetailLayout;
  label: string;
  description: string;
}[] = [
  {
    value: 'stacked',
    label: '上下布局',
    description: '图片居中展示，向下滚动浏览信息与评论',
  },
  {
    value: 'split',
    label: '左右分栏',
    description: '宽屏左侧固定图片、右侧滚动，窄屏自动切回',
  },
];

/** Minimal scenic artwork glyph inside a layout preview's media canvas, painted in `primary-ink`
 * on `primary-container` so it reads clearly as a picture across light, dark and every theme. */
function MiniatureArtwork() {
  return (
    <svg
      viewBox="0 0 36 24"
      className="h-6 w-9 text-primary-ink forced-colors:text-[color:CanvasText]"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="9.5" cy="7.5" r="2.5" fill="currentColor" />
      <path
        d="M3.5 20.2 11.4 12.6a1.4 1.4 0 0 1 2 0l3 3 5.4-6.4a1.4 1.4 0 0 1 2.1 0l8.6 11A1.4 1.4 0 0 1 31.4 22.5H4.6a1.4 1.4 0 0 1-1.1-2.3Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Miniature replica of `DetailVotes` — quiet neutral ratio track flanked by count dots. */
function MiniatureVotes({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-1', className)}>
      <span className="size-1.5 shrink-0 rounded-full bg-surface-container-highest forced-boundary" />
      <span className="flex h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-container-high forced-boundary">
        <span className="h-full w-4/5 rounded-full bg-outline-variant forced-mark" />
      </span>
      <span className="size-1.5 shrink-0 rounded-full bg-surface-container-highest forced-boundary" />
    </div>
  );
}

/** Miniature replica of `TagList` chips — scaled 1:4 from real 32dp chips with 8dp corners
 * (`8px` tall, `rx="2"`), so tags stay visibly shorter than the `10px` pill action buttons above
 * while reading cleanly as rounded rectangles rather than pills. */
function MiniatureTags({ widths }: { widths: readonly number[] }) {
  const gap = 4;
  const totalWidth = widths.reduce((sum, width, index) => sum + width + (index > 0 ? gap : 0), 0);
  const rects = widths.reduce<{ x: number; w: number }[]>((acc, w) => {
    const prev = acc[acc.length - 1];
    acc.push({ x: prev ? prev.x + prev.w + gap : 0, w });
    return acc;
  }, []);
  return (
    <svg
      viewBox={`0 0 ${totalWidth} 8`}
      width={totalWidth}
      height={8}
      className="block h-2 max-w-full shrink-0 text-surface-container-highest"
      fill="none"
      aria-hidden="true"
    >
      {rects.map(({ x, w }) => (
        <rect
          key={x}
          x={x + 0.5}
          y={0.5}
          width={w - 1}
          height={7}
          rx={2}
          fill="currentColor"
          className="forced-colors:fill-none forced-colors:stroke-[color:CanvasText]"
        />
      ))}
    </svg>
  );
}

/** Schematic preview of one image-detail layout, drawn strictly from surface/container tokens.
 * Mirrors the real `PicDetail` anatomy at ~1:4 scale (header, artwork, primary actions, matched-
 * width action capsule, quiet vote meter, rounded-rectangle tags and stacked comment rows).
 * Concentric inside the 12dp card's 4dp bezel (12 − 4 = 8dp, `rounded-sm`). Layered at `-z-10`
 * inside the card's isolated stacking context (matching `PaletteTileFace`) so the `-1` state layer
 * and `ripple-secondary` press wave sweep cleanly across the whole card while the text below stays
 * crisp above the wave. Restores `forced-color-adjust: auto` so a selected card's opt-out never
 * leaks colour fills into only one preview under forced colours. */
function DetailLayoutPreview({ layout }: { layout: DetailLayout }) {
  return (
    <div
      aria-hidden="true"
      className="forced-boundary forced-color-adjust-auto forced-colors:text-[color:CanvasText] relative -z-10 h-44 w-full overflow-hidden rounded-sm bg-surface-container-lowest"
    >
      {layout === 'stacked' ? (
        <div className="relative flex h-full w-full flex-col px-9 pt-2.5 pb-2">
          <span className="forced-boundary absolute top-2.5 left-2.5 size-2 rounded-full bg-surface-container-highest" />
          <div className="absolute top-2.5 right-2.5 flex gap-1">
            <span className="forced-boundary size-2 rounded-full bg-surface-container-highest" />
            <span className="forced-boundary size-2 rounded-full bg-surface-container-highest" />
          </div>
          <div className="mx-auto flex min-h-0 w-full max-w-56 flex-1 flex-col gap-1.5">
            <div className="flex h-2 items-center justify-between gap-2">
              <span className="forced-boundary h-1.5 w-14 rounded-full bg-surface-container-highest" />
              <span className="forced-boundary h-1.5 w-14 rounded-full bg-surface-container-highest" />
            </div>
            <div className="forced-boundary flex min-h-0 flex-1 items-center justify-center rounded-xs bg-primary-container">
              <MiniatureArtwork />
            </div>
            <div className="flex items-center gap-2">
              <div className="flex shrink-0 items-center gap-1">
                <span className="forced-mark h-2.5 w-7 rounded-full bg-primary" />
                <span className="forced-boundary h-2.5 w-6 rounded-full bg-secondary-container" />
              </div>
              <MiniatureVotes className="min-w-0 flex-1" />
              <span className="forced-boundary h-2.5 w-14 shrink-0 rounded-full bg-surface-container-highest" />
            </div>
            <MiniatureTags widths={[20, 30, 24, 18]} />
            <div className="border-t border-outline-variant pt-1.5">
              <div className="forced-boundary flex items-center gap-1.5 rounded-xs bg-surface-container px-1.5 py-1.5">
                <span className="forced-boundary size-2.5 shrink-0 rounded-full bg-primary-container" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="forced-mark h-1 w-2/3 rounded-full bg-outline-variant" />
                  <span className="h-1 w-2/5 rounded-full bg-surface-container-highest" />
                </div>
              </div>
            </div>
          </div>
          <span className="forced-mark absolute top-8 right-1 h-10 w-0.5 rounded-full bg-outline-variant" />
        </div>
      ) : (
        <div className="relative grid h-full w-full grid-cols-2">
          <div className="relative flex items-center justify-center px-2.5 pt-7 pb-3">
            <span className="forced-boundary absolute top-2.5 left-2.5 size-2 rounded-full bg-surface-container-highest" />
            <div className="absolute top-2.5 right-2.5 flex gap-1">
              <span className="forced-boundary size-2 rounded-full bg-surface-container-highest" />
              <span className="forced-boundary size-2 rounded-full bg-surface-container-highest" />
            </div>
            <div className="forced-boundary flex h-28 w-full items-center justify-center rounded-xs bg-primary-container">
              <MiniatureArtwork />
            </div>
          </div>
          <div className="flex min-w-0 flex-col border-l border-outline-variant">
            <div className="flex flex-col gap-1 border-b border-outline-variant py-2 pl-2.5 pr-3.5">
              <span className="forced-boundary h-1.5 w-16 rounded-full bg-surface-container-highest" />
              <span className="h-1 w-12 rounded-full bg-surface-container-high" />
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 py-2 pl-2.5 pr-3.5">
              <div className="flex flex-col gap-1">
                <div className="grid grid-cols-2 gap-1">
                  <span className="forced-mark h-2.5 rounded-full bg-primary" />
                  <span className="forced-boundary h-2.5 rounded-full bg-secondary-container" />
                </div>
                <span className="forced-boundary h-2.5 w-full rounded-full bg-surface-container-highest" />
                <MiniatureVotes />
              </div>
              <MiniatureTags widths={[18, 28, 22]} />
              <div className="flex min-h-0 flex-1 flex-col gap-1 border-t border-outline-variant pt-1.5">
                <span className="mb-0.5 h-1 w-7 shrink-0 rounded-full bg-outline-variant" />
                <div className="forced-boundary flex items-center gap-1.5 rounded-xs bg-surface-container px-1.5 py-1.5">
                  <span className="forced-boundary size-2.5 shrink-0 rounded-full bg-primary-container" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="forced-mark h-1 w-4/5 rounded-full bg-outline-variant" />
                    <span className="h-1 w-1/2 rounded-full bg-surface-container-highest" />
                  </div>
                </div>
                <div className="forced-boundary flex items-center gap-1.5 rounded-xs bg-surface-container px-1.5 py-1.5">
                  <span className="forced-boundary size-2.5 shrink-0 rounded-full bg-secondary-container" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="forced-mark h-1 w-3/4 rounded-full bg-outline-variant" />
                    <span className="h-1 w-2/5 rounded-full bg-surface-container-highest" />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <span className="forced-mark absolute top-9 right-1 h-10 w-0.5 rounded-full bg-outline-variant" />
        </div>
      )}
    </div>
  );
}

/**
 * 图片详情页样式 — visual radio-card selector inside 个性化, matching `PaletteSection`'s
 * tone-separated selection style and roving-tabindex radiogroup keyboard navigation.
 */
export function DetailLayoutSection({ signedIn }: { signedIn: boolean }) {
  const layout = useSyncedSetting('detailLayout');
  const idPrefix = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    let next: number | null = null;
    if (step !== undefined) next = (index + step + DETAIL_LAYOUT_OPTIONS.length) % DETAIL_LAYOUT_OPTIONS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = DETAIL_LAYOUT_OPTIONS.length - 1;
    if (next === null) return;
    event.preventDefault();
    refs.current[next]?.focus();
    changeSyncedSetting('detailLayout', DETAIL_LAYOUT_OPTIONS[next]!.value);
  };

  return (
    <SettingsSection
      title="图片详情页"
      icon={<MdOutlineViewSidebar size={ICON.control} />}
      subtitle={signedIn ? '随账号同步到你登录的设备' : undefined}
    >
      <div className={ROW_STACK_CLASS}>
        <div className="@container w-full">
          <div
            role="radiogroup"
            aria-label="图片详情页样式"
            className="grid grid-cols-1 gap-3 @md:grid-cols-2"
          >
            {DETAIL_LAYOUT_OPTIONS.map((option, index) => {
              const selected = option.value === layout;
              const titleId = `${idPrefix}-${option.value}-title`;
              const descId = `${idPrefix}-${option.value}-desc`;
              return (
                <button
                  key={option.value}
                  ref={(node) => {
                    refs.current[index] = node;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-labelledby={titleId}
                  aria-describedby={descId}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => changeSyncedSetting('detailLayout', option.value)}
                  onKeyDown={(event) => onKeyDown(event, index)}
                  data-ripple
                  className={cn(
                    'state-layer focus-ring ripple-secondary flex min-w-0 cursor-pointer flex-col items-stretch gap-3 rounded-md p-1 pb-3 text-left transition-ui select-none touch-manipulation focus-visible:outline-hidden focus-visible:ring-2',
                    selected
                      ? 'forced-selected bg-secondary-container text-on-secondary-container'
                      : 'forced-boundary bg-surface-container-high text-on-surface',
                  )}
                >
                  <DetailLayoutPreview layout={option.value} />
                  <div className="my-auto flex items-center justify-between gap-3 px-2">
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <p id={titleId} className={selected ? 'text-label-l-emphasized' : 'text-label-l'}>
                        {option.label}
                      </p>
                      <p id={descId} className={cn('text-body-s', !selected && 'text-on-surface-variant')}>
                        {option.description}
                      </p>
                    </div>
                    <span
                      aria-hidden="true"
                      className={cn(
                        'grid size-5 shrink-0 place-items-center rounded-full',
                        selected &&
                          'bg-primary-ink text-on-primary-ink forced-colors:bg-[color:HighlightText] forced-colors:text-[color:Highlight]',
                      )}
                    >
                      {selected && <CheckGlyph className="size-3.5" />}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}

/**
 * 模式与动画 — the four preferences that describe the screen rather than the person, so they stay
 * on this device: a phone in a dark room and a desktop in daylight are different screens. Owned
 * by `lib/appearance`, which keeps the stored keys, the cookie, the `<html>` attribute and the
 * subscription in one place. 入场动画 also follows the account through the synced registry;
 * its local value and first-paint cookie remain the same.
 *
 * **跟随系统 is a switch of its own, and 主题模式 only ever says 月之亮面 or 月之暗面** (decision 20). The
 * stored model was always two answers — follow the system or not, and which scheme when not — and
 * one three-way list hid the second behind the first. While the switch is on, the mode is disabled
 * rather than hidden and shows the scheme the system resolves to right now; turning the switch off
 * keeps that scheme, so nothing on screen changes. The app bar's button writes an explicit scheme,
 * which turns the switch off — the same model.
 */
export function ModeAndMotionSection() {
  const schemeSetting = useSchemeSetting();
  /* The scheme in force (the root class), which is what the disabled mode displays. */
  const scheme = useScheme();
  const followsSystem = schemeSetting === 'system';
  const motionSetting = useMotionSetting();
  const motionSpeed = useMotionSpeed();
  const motionMode = useMotionMode();
  const entranceTier = useMotionTier('entrance');
  const entrances = useSyncedSetting('introAnimation');
  const [speedDialogOpen, setSpeedDialogOpen] = useState(false);
  const [effectsDialogOpen, setEffectsDialogOpen] = useState(false);

  /* Speed applies to every tier that has a length: the tier decides the form, the speed decides
     the clock. Disabled rather than hidden when 动画效果 is off — a control that vanishes is a
     control the user has to rediscover. */
  const speedAvailable = useMotionEnabled();

  return (
    <SettingsSection title="模式与动画" icon={<MdBrightness6 size={ICON.control} />} subtitle="仅保存在本设备">
      {/* One block: 跟随系统 controls whether 主题模式 is active, so it leads the mode selector
          above an inner rule. */}
      <div className={ROW_STACK_CLASS}>
        <ToggleSwitch
          layout="row"
          checked={followsSystem}
          onChange={(on) => changeScheme(on ? 'system' : scheme)}
          label="跟随系统"
        />
        <div className="border-outline-variant flex items-center gap-4 border-t pt-4">
          <p className="text-label-l text-on-surface min-w-0 flex-1">主题模式</p>
          <Select
            size="sm"
            value={scheme}
            onChange={(v) => changeScheme(v as ColorScheme)}
            disabled={followsSystem}
            aria-label="主题模式"
            options={[
              { value: 'light', label: '月之亮面' },
              { value: 'dark', label: '月之暗面' },
            ]}
          />
        </div>
      </div>

      {/* An unset choice still follows the OS; the row shows the resolved tier or 自定义. */}
      <SettingsRow
        label="动画效果"
        action={
          <>
            {motionMode === 'custom' && (
              <RowButton label="配置动画效果" icon={<MdTune />} onClick={() => setEffectsDialogOpen(true)}>
                配置
              </RowButton>
            )}
            <Select
              size="sm"
              value={motionMode}
              onChange={(v) => commitMotion(v as MotionSetting, motionSpeed)}
              aria-label="动画效果"
              options={[
                ...MOTION_EFFECTS.map((option) => ({ ...option, label: `${option.label}动画` })),
                { value: 'custom', label: '自定义' },
              ]}
            />
          </>
        }
      />
      <SettingsRow
        label="动画速度"
        action={
          <>
            {motionSpeed === 'custom' && (
              <RowButton label="配置动画速度" icon={<MdTune />} disabled={!speedAvailable} onClick={() => setSpeedDialogOpen(true)}>
                配置
              </RowButton>
            )}
            <Select
              size="sm"
              value={motionSpeed}
              disabled={!speedAvailable}
              onChange={(v) => commitMotion(motionSetting, v as MotionSpeed)}
              aria-label="动画速度"
              options={[
                ...MOTION_PRESETS,
                { value: 'custom', label: '自定义' },
              ]}
            />
          </>
        }
      />
      {/* The one row here that follows the account (the original front end's `introAnimationEnabled`,
          and `introAnimationBlocking` beside it): under a section headed 仅保存在本设备 it says so
          itself (review P5-F7). Three ways rather than a switch: 阻塞 and 不阻塞 both play the
          full-screen splash — the first leaves once the mark has landed, the second (the default)
          as soon as the page has loaded — and 关闭 turns every entrance off. */}
      <SettingsRow
        label="入场动画"
        supporting={
          <>
            <span className="block">{ENTRANCE_DESCRIPTIONS[entrances]}</span>
            <span className="block">此项随账号同步到你登录的设备</span>
          </>
        }
        action={
          <Select
            size="sm"
            value={entrances}
            disabled={entranceTier === 'off'}
            onChange={(value) => changeSyncedSetting('introAnimation', value)}
            aria-label="入场动画"
            options={[
              { value: 'blocking', label: '完整播放' },
              { value: 'non-blocking', label: '快速进入' },
              { value: 'off', label: '关闭' },
            ]}
          />
        }
      />
      <MotionSpeedDialog isOpen={speedDialogOpen} onClose={() => setSpeedDialogOpen(false)} />
      <MotionEffectsDialog isOpen={effectsDialogOpen} onClose={() => setEffectsDialogOpen(false)} />
    </SettingsSection>
  );
}
