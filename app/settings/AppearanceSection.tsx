'use client';

import { MdBrightness6, MdPalette } from 'react-icons/md';
import Select from '@/components/Select';
import ToggleSwitch from '@/components/ToggleSwitch';
import PaletteSwatches from '@/components/PaletteSwatches';
import { changeScheme } from '@/lib/motionLazy';
import { ICON } from '@/lib/icons';
import { changeSyncedSetting, useSyncedSetting } from '@/lib/settingsSync';
import {
  commitMotion,
  useMotionSetting,
  useMotionSpeed,
  useMotionTier,
  useScheme,
  useSchemeSetting,
  type ColorScheme,
  type MotionSetting,
  type MotionSpeed,
} from '@/lib/appearance';
import { ROW_CLASS, SettingsRow, SettingsSection, SwitchRow } from './SettingsRow';

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
      <div className={`${ROW_CLASS} flex-col items-stretch`} data-palette-block="">
        <PaletteSwatches className="w-full" />
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
 * **跟随系统 is a switch of its own, and 主题模式 only ever says 浅色 or 深色** (decision 20). The
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
  const motionTier = useMotionTier();
  const entrances = useSyncedSetting('introAnimationEnabled');

  /* Speed applies to every tier that has a length: the tier decides the form, the speed decides
     the clock. Disabled rather than hidden when 动画效果 is off — a control that vanishes is a
     control the user has to rediscover. */
  const speedAvailable = motionTier !== 'off';

  return (
    <SettingsSection title="模式与动画" icon={<MdBrightness6 size={ICON.control} />} subtitle="仅保存在本设备">
      {/* One block: the switch is part of the mode setting, not a neighbour of it, so it sits
          under the mode behind an inner rule. */}
      <div className={`${ROW_CLASS} flex-col items-stretch`}>
        <div className="flex items-center gap-4">
          <p className="text-label-l text-on-surface min-w-0 flex-1">主题模式</p>
          <Select
            size="sm"
            value={scheme}
            onChange={(v) => changeScheme(v as ColorScheme)}
            disabled={followsSystem}
            aria-label="主题模式"
            options={[
              { value: 'light', label: '浅色' },
              { value: 'dark', label: '深色' },
            ]}
          />
        </div>
        <div className="border-outline-variant border-t pt-4">
          <ToggleSwitch
            layout="row"
            checked={followsSystem}
            onChange={(on) => changeScheme(on ? 'system' : scheme)}
            label="跟随系统"
          />
        </div>
      </div>

      {/* Three options, not four. 跟随系统 is gone from this list: the OS preference still decides
          what an unset value resolves to, but the control shows the tier in force — a visitor
          whose system asks for less motion sees 减弱动画 selected. */}
      <SettingsRow
        label="动画效果"
        action={
          <Select
            size="sm"
            value={motionTier}
            onChange={(v) => commitMotion(v as MotionSetting, motionSpeed)}
            aria-label="动画效果"
            options={[
              { value: 'off', label: '关闭动画' },
              { value: 'reduced', label: '减弱动画' },
              { value: 'standard', label: '标准动画' },
            ]}
          />
        }
      />
      <SettingsRow
        label="动画速度"
        action={
          <Select
            size="sm"
            value={motionSpeed}
            disabled={!speedAvailable}
            onChange={(v) => commitMotion(motionSetting, v as MotionSpeed)}
            aria-label="动画速度"
            options={[
              { value: 'fast', label: '快速' },
              { value: 'default', label: '默认' },
              { value: 'slow', label: '缓慢' },
            ]}
          />
        }
      />
      {/* The one row here that follows the account (the original front end's `introAnimationEnabled`):
          under a section headed 仅保存在本设备 it says so itself (review P5-F7). */}
      <SwitchRow
        label="入场动画"
        description="此项随账号同步到你登录的设备"
        checked={entrances}
        onChange={(value) => changeSyncedSetting('introAnimationEnabled', value)}
        disabled={motionTier === 'off'}
      />
    </SettingsSection>
  );
}
