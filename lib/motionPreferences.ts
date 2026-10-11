/** Shared by the server, pre-paint script and client. No renderer or animation engine. */
export const MOTION_PRESETS = [
  { value: 'fast', label: '快速' },
  { value: 'default', label: '默认' },
  { value: 'slow', label: '缓慢' },
] as const;

export type MotionPreset = (typeof MOTION_PRESETS)[number]['value'];
export type MotionSpeed = MotionPreset | 'custom';
export const MOTION_SPEEDS: readonly MotionSpeed[] = [...MOTION_PRESETS.map(({ value }) => value), 'custom'];
export const MOTION_SPEED_SCALE: Record<MotionPreset, number> = { fast: 0.7, default: 1, slow: 1.4 };
export const MOTION_EFFECTS = [
  { value: 'off', label: '关闭' },
  { value: 'reduced', label: '减弱' },
  { value: 'standard', label: '标准' },
] as const;
export type MotionTier = (typeof MOTION_EFFECTS)[number]['value'];
export type MotionMode = MotionTier | 'custom';

/** Categories follow a whole gesture: its movement, fade and delays share one clock. */
export const MOTION_CATEGORIES = [
  { id: 'feedback', label: '控件反馈', description: '按钮、开关、输入框、波纹与状态标记' },
  { id: 'page', label: '页面切换', description: '页面淡入淡出与帖子展开' },
  { id: 'tabs', label: '标签切换', description: '标签指示条与内容面板切换' },
  { id: 'overlay', label: '弹窗与浮层', description: '对话框、抽屉、底部面板、菜单与提示' },
  { id: 'image', label: '图片动效', description: '图片展开、返回、切换与灯箱' },
  { id: 'list', label: '列表与展开', description: '列表增删、排序与内容高度变化' },
  { id: 'entrance', label: '入场动效', description: '开屏标志、内容入场与图片依次出现' },
  { id: 'theme', label: '主题切换', description: '主题模式与配色切换' },
  { id: 'scroll', label: '平滑滚动', description: '回到顶部、翻页与定位内容' },
  { id: 'ambient', label: '装饰动效', description: '动态图标、看板娘、桌面小马与关于页背景' },
] as const;
export type MotionCategory = (typeof MOTION_CATEGORIES)[number]['id'];
export type MotionCustomSpeeds = Record<MotionCategory, MotionPreset>;
export type MotionCustomEffects = Record<MotionCategory, MotionTier>;

export function isMotionPreset(value: unknown): value is MotionPreset {
  return value === 'fast' || value === 'default' || value === 'slow';
}

export function motionPreset(preset: MotionPreset): MotionCustomSpeeds {
  return Object.fromEntries(MOTION_CATEGORIES.map(({ id }) => [id, preset])) as MotionCustomSpeeds;
}

export function motionEffectPreset(tier: MotionTier): MotionCustomEffects {
  return Object.fromEntries(MOTION_CATEGORIES.map(({ id }) => [id, tier])) as MotionCustomEffects;
}

export function isMotionTier(value: unknown): value is MotionTier {
  return value === 'off' || value === 'reduced' || value === 'standard';
}

export function parseMotionEffects(raw: string | null | undefined): MotionCustomEffects {
  const result = motionEffectPreset('standard');
  if (!raw || raw.length > 1024) return result;
  const fields = new Map(raw.split(',').map((field) => field.split(':', 2) as [string, string]));
  for (const { id } of MOTION_CATEGORIES) {
    const value = fields.get(id);
    if (isMotionTier(value)) result[id] = value;
  }
  return result;
}

export function formatMotionEffects(effects: MotionCustomEffects): string {
  return MOTION_CATEGORIES.map(({ id }) => `${id}:${isMotionTier(effects[id]) ? effects[id] : 'standard'}`).join(',');
}

export function motionEffectsAttributes(effects: MotionCustomEffects): Record<`data-motion-${MotionCategory}`, MotionTier> {
  return Object.fromEntries(MOTION_CATEGORIES.map(({ id }) => [`data-motion-${id}`, effects[id]])) as Record<`data-motion-${MotionCategory}`, MotionTier>;
}

export function motionEffectsStyle(effects: MotionCustomEffects): Record<`--motion-custom-enabled-${string}`, number> {
  return Object.fromEntries(MOTION_CATEGORIES.map(({ id }) => [`--motion-custom-enabled-${id}`, effects[id] === 'off' ? 0 : 1]));
}

/** Named fields keep old preferences valid when a category is added or reordered. Cookie safe. */
export function parseMotionCustom(raw: string | null | undefined): MotionCustomSpeeds {
  const result = motionPreset('default');
  if (!raw || raw.length > 1024) return result;
  const fields = new Map(raw.split(',').map((field) => field.split(':', 2) as [string, string]));
  for (const { id } of MOTION_CATEGORIES) {
    const value = fields.get(id);
    if (isMotionPreset(value)) result[id] = value;
  }
  return result;
}

export function formatMotionCustom(speeds: MotionCustomSpeeds): string {
  return MOTION_CATEGORIES.map(({ id }) => `${id}:${isMotionPreset(speeds[id]) ? speeds[id] : 'default'}`).join(',');
}

/** Raw custom scales never override the off tier; CSS opts into them only in custom mode. */
export function motionCustomStyle(speeds: MotionCustomSpeeds): Record<`--motion-custom-${string}`, number> {
  return Object.fromEntries(MOTION_CATEGORIES.map(({ id }) => [
    `--motion-custom-${id}`, MOTION_SPEED_SCALE[speeds[id]],
  ]));
}

/** Kept here with the parser's vocabulary, so cold paint and hydration validate the same fields. */
export const motionCustomBootScript = `
var mc=get('picpony_motion_custom'),mf={},ms=${JSON.stringify(MOTION_SPEED_SCALE)};
if(mc&&mc.length<=1024)mc.split(',').forEach(function(f){var a=f.split(':',2);mf[a[0]]=a[1]});
var mv=${JSON.stringify(MOTION_CATEGORIES.map(({ id }) => id))}.map(function(id){
var v=mf[id];if(v!=='fast'&&v!=='default'&&v!=='slow')v='default';
d.style.setProperty('--motion-custom-'+id,ms[v]);return id+':'+v;
});
if(mc)d.dataset.motionCustom=mv.join(',');else delete d.dataset.motionCustom;
var me=get('picpony_motion_effects'),mt={};
if(me&&me.length<=1024)me.split(',').forEach(function(f){var a=f.split(':',2);mt[a[0]]=a[1]});
var et=${JSON.stringify(MOTION_CATEGORIES.map(({ id }) => id))}.map(function(id){
var v=mt[id];if(v!=='off'&&v!=='reduced'&&v!=='standard')v='standard';
d.setAttribute('data-motion-'+id,v);d.style.setProperty('--motion-custom-enabled-'+id,v==='off'?0:1);return id+':'+v;
});
if(me)d.dataset.motionEffects=et.join(',');else delete d.dataset.motionEffects;
`;
