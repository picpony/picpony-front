'use client';

import { useId, useRef, useState } from 'react';
import { MdBrightness6, MdOutlineViewSidebar, MdPalette, MdTune } from 'react-icons/md';
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
    description: '宽屏下左侧固定图片、右侧滚动信息流，窄屏自动切回上下布局',
  },
];

/** Schematic preview of one image-detail layout, drawn strictly from surface/container tokens.
 * Layered at `-z-10` inside the card's isolated stacking context (matching `PaletteTileFace`) so
 * the `-1` state layer and `ripple-secondary` press wave sweep cleanly across the whole card while
 * the title and description below remain crisp above the wave. */
function DetailLayoutPreview({ layout, selected }: { layout: DetailLayout; selected: boolean }) {
  return (
    <div
      aria-hidden="true"
      className="relative -z-10 h-28 w-full overflow-hidden rounded-sm bg-surface-container-lowest p-2.5 forced-boundary"
    >
      {layout === 'stacked' ? (
        <div className="mx-auto flex h-full max-w-44 flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="h-1.5 w-14 rounded-full bg-surface-container-highest" />
            <span className="h-1.5 w-10 rounded-full bg-surface-container-highest" />
          </div>
          <div className="flex flex-1 items-center justify-center rounded-xs bg-primary-container p-2">
            <span className="h-6 w-10 rounded-xs bg-primary" />
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-1">
              <span className="h-2.5 w-7 rounded-full bg-primary" />
              <span className="h-2.5 w-6 rounded-full bg-secondary-container" />
            </div>
            <span className="h-2.5 w-10 rounded-full bg-surface-container-highest" />
          </div>
          <div className="flex gap-1">
            <span className="h-2 w-8 rounded-xs bg-surface-container-highest" />
            <span className="h-2 w-10 rounded-xs bg-surface-container-highest" />
            <span className="h-2 w-6 rounded-xs bg-surface-container-highest" />
          </div>
        </div>
      ) : (
        <div className="grid h-full grid-cols-2">
          <div className="relative flex items-center justify-center pr-2.5">
            <span className="absolute top-0 left-0 size-2 rounded-full bg-surface-container-highest" />
            <div className="flex h-16 w-full items-center justify-center rounded-xs bg-primary-container p-2">
              <span className="h-6 w-9 rounded-xs bg-primary" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5 border-l border-outline-variant pl-2.5">
            <div className="flex flex-col gap-1 border-b border-outline-variant pb-1.5">
              <span className="h-1.5 w-14 rounded-full bg-surface-container-highest" />
              <span className="h-1 w-10 rounded-full bg-surface-container-highest" />
            </div>
            <div className="grid grid-cols-2 gap-1">
              <span className="h-2.5 rounded-full bg-primary" />
              <span className="h-2.5 rounded-full bg-secondary-container" />
            </div>
            <div className="flex flex-wrap gap-1">
              <span className="h-2 w-6 rounded-xs bg-surface-container-highest" />
              <span className="h-2 w-8 rounded-xs bg-surface-container-highest" />
              <span className="h-2 w-5 rounded-xs bg-surface-container-highest" />
            </div>
            <div className="mt-auto flex flex-col gap-1">
              <span className="h-1.5 w-full rounded-full bg-surface-container-highest" />
              <span className="h-1.5 w-3/4 rounded-full bg-surface-container-highest" />
            </div>
          </div>
        </div>
      )}
      {selected && (
        <span className="forced-selected absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-primary text-on-primary">
          <CheckGlyph className="size-3.5" />
        </span>
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
        <div
          role="radiogroup"
          aria-label="图片详情页样式"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
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
                  'state-layer focus-ring ripple-secondary flex cursor-pointer flex-col items-start gap-2.5 rounded-md p-3 text-left transition-ui select-none touch-manipulation focus-visible:outline-hidden focus-visible:ring-2',
                  selected
                    ? 'forced-selected bg-secondary-container text-on-secondary-container'
                    : 'forced-boundary bg-surface-container text-on-surface',
                )}
              >
                <DetailLayoutPreview layout={option.value} selected={selected} />
                <div className="min-w-0 px-0.5">
                  <p id={titleId} className="text-label-l">{option.label}</p>
                  <p
                    id={descId}
                    className={cn(
                      'text-body-s mt-0.5',
                      selected ? 'text-on-secondary-container' : 'text-on-surface-variant',
                    )}
                  >
                    {option.description}
                  </p>
                </div>
              </button>
            );
          })}
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
