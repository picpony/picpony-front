'use client';

import Button from '@/components/Button';
import Modal from '@/components/Modal';
import Select from '@/components/Select';
import { commitMotionCustom, commitMotionEffects, useMotionCustom, useMotionEffects } from '@/lib/appearance';
import {
  MOTION_CATEGORIES, MOTION_PRESETS, MOTION_EFFECTS, motionPreset, motionEffectPreset,
  type MotionCategory,
} from '@/lib/motionPreferences';
import { SettingsRow } from './SettingsRow';

interface DialogProps { isOpen: boolean; onClose: () => void }

export function MotionSpeedDialog(props: DialogProps) {
  const speeds = useMotionCustom();
  return <MotionOptionsDialog {...props} kind="速度" values={speeds} options={[...MOTION_PRESETS]} makePreset={motionPreset} onChange={commitMotionCustom} />;
}

export function MotionEffectsDialog(props: DialogProps) {
  const effects = useMotionEffects();
  return <MotionOptionsDialog {...props} kind="效果" values={effects} options={[...MOTION_EFFECTS]} makePreset={motionEffectPreset} onChange={commitMotionEffects} />;
}

function MotionOptionsDialog<T extends string>({
  isOpen, onClose, kind, values, options, makePreset, onChange,
}: DialogProps & {
  kind: '速度' | '效果';
  values: Record<MotionCategory, T>;
  options: { value: T; label: string }[];
  makePreset: (value: T) => Record<MotionCategory, T>;
  onChange: (values: Record<MotionCategory, T>) => void;
}) {
  const first = values[MOTION_CATEGORIES[0].id];
  const preset = MOTION_CATEGORIES.every(({ id }) => values[id] === first) ? first : '';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`自定义动画${kind}`}
      footer={<Button onClick={onClose}>完成</Button>}
    >
      <div className="mb-4">
        <SettingsRow
          label="预设"
          supporting="选择后覆盖下方全部设置"
          action={
            <Select
              size="sm"
              aria-label={`全部动画${kind}预设`}
              value={preset}
              placeholder="逐项配置"
              options={options}
              onChange={(value) => { if (value !== '') onChange(makePreset(value)); }}
            />
          }
        />
        <p className="mt-3 text-body-s text-on-surface-variant">
          修改后立即生效，仅保存在本设备。
        </p>
      </div>
      <div>
        {MOTION_CATEGORIES.map(({ id, label, description }) => (
          <SettingsRow
            key={id}
            label={label}
            supporting={description}
            action={
              <Select
                size="sm"
                value={values[id]}
                aria-label={`${label}${kind}`}
                options={options}
                onChange={(value) => onChange({ ...values, [id]: value })}
              />
            }
          />
        ))}
      </div>
    </Modal>
  );
}
