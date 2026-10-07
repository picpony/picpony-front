/**
 * The profile's two enumerated fields, gender and race — one vocabulary for every screen that
 * writes or shows them: /settings (the owner's editor), the profile header, and the admin user
 * editor.
 *
 * The **stored values are the ones the original front end writes** and the backend already holds
 * for existing users, so they are canonical here too: gender `保密` / `男` / `女` / `武装直升机`
 * (shown as 其他 — a fandom joke the stored value keeps), race in Chinese (`陆马` … `伪天角`).
 * Three vocabularies had drifted apart: /settings wrote English race values (`Earth Pony`), the
 * admin editor wrote `male` / `female` / `other` / `secret`, and the profile printed whatever was
 * stored — so 其他 appeared as 「武装直升机」, and an admin's edit read as 请选择 in the owner's own
 * editor. Every legacy spelling this app has written is mapped on read.
 *
 * A value outside both lists (free text from another client) is kept as it is: it is the user's
 * own words, shown verbatim and never silently rewritten by a save.
 */

export interface FieldOption {
  value: string;
  label: string;
}

/** Stored gender values, in the order an editor lists them. `保密` is the default. */
export const GENDER_OPTIONS: readonly FieldOption[] = [
  { value: '保密', label: '保密' },
  { value: '男', label: '男' },
  { value: '女', label: '女' },
  { value: '武装直升机', label: '其他' },
];

const GENDER_LEGACY: Record<string, string> = {
  male: '男',
  female: '女',
  other: '武装直升机',
  secret: '保密',
  其他: '武装直升机',
};

/** Stored race values. The original front end's list, plus 其他 for what it does not name. */
export const RACE_OPTIONS: readonly FieldOption[] = [
  { value: '', label: '未设置' },
  { value: '陆马', label: '陆马' },
  { value: '天马', label: '天马' },
  { value: '独角兽', label: '独角兽' },
  { value: '夜骐', label: '夜骐' },
  { value: '龙', label: '龙' },
  { value: '幻形灵', label: '幻形灵' },
  { value: '狮鹫', label: '狮鹫' },
  { value: '斑马', label: '斑马' },
  { value: '海马', label: '海马' },
  { value: '骏鹰', label: '骏鹰' },
  { value: '麒麟', label: '麒麟' },
  { value: '伪天角', label: '伪天角' },
  { value: '其他', label: '其他' },
];

/** The English values this app's /settings once wrote. */
const RACE_LEGACY: Record<string, string> = {
  'Earth Pony': '陆马',
  Pegasus: '天马',
  Unicorn: '独角兽',
  Alicorn: '伪天角',
  'Bat Pony': '夜骐',
  Changeling: '幻形灵',
  Other: '其他',
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** The canonical stored gender for any spelling; empty or missing is `保密`. */
export function normalizeGender(value: unknown): string {
  const raw = text(value);
  if (!raw) return '保密';
  if (Object.hasOwn(GENDER_LEGACY, raw)) return GENDER_LEGACY[raw];
  return Object.hasOwn(GENDER_LEGACY, raw.toLowerCase()) ? GENDER_LEGACY[raw.toLowerCase()] : raw;
}

/** The canonical stored race for any spelling; empty or missing is `''` (未设置). */
export function normalizeRace(value: unknown): string {
  const raw = text(value);
  if (!raw) return '';
  return Object.hasOwn(RACE_LEGACY, raw) ? RACE_LEGACY[raw] : raw;
}

/**
 * What a profile shows for a gender, or `null` when it shows nothing — `保密` is a choice to not
 * say, so the header omits the line rather than printing 保密.
 */
export function genderLabel(value: unknown): string | null {
  const stored = normalizeGender(value);
  if (stored === '保密') return null;
  return GENDER_OPTIONS.find((option) => option.value === stored)?.label ?? stored;
}

/** What a profile shows for a race, or `null` when none is set. */
export function raceLabel(value: unknown): string | null {
  const stored = normalizeRace(value);
  if (!stored) return null;
  return RACE_OPTIONS.find((option) => option.value === stored)?.label ?? stored;
}

/**
 * An editor's options for a stored value that is not in the list: the value is offered as it is
 * (first after the defaults), so opening the editor and saving something else does not quietly
 * erase words the user wrote elsewhere.
 */
export function optionsWith(options: readonly FieldOption[], stored: string): FieldOption[] {
  if (!stored || options.some((option) => option.value === stored)) return [...options];
  return [...options, { value: stored, label: stored }];
}
