/**
 * Writes `lib/generated/emoji.ts`: the pony emoji the message composer offers — every PNG in
 * `public/img/emoji`, in the order below, with its Chinese name and intrinsic size — and the
 * everyday Unicode set the original front end's picker offered.
 *
 *     node scripts/emoji.mjs           write the file
 *     node scripts/emoji.mjs --check   exit 1 if the file is stale or the table and the folder
 *                                      disagree (a PNG with no name, a name with no PNG)
 *
 * The list used to be a server action reading the folder on every visit of /messages — a POST
 * per mount, in filesystem order, dependent on `public/` sitting under the server's working
 * directory. It is static data now, and the table here is its authority: the names are the
 * community's (小马中文维基 / EquestriaCN), the order groups a character's faces together.
 *
 * `$emoji_<name>$` in a message is the wire format this front end has always sent; the
 * renderer maps it back to the picture.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FOLDER = path.join(ROOT, 'public', 'img', 'emoji');
const OUTPUT = path.join(ROOT, 'lib', 'generated', 'emoji.ts');

/** `[file name, character, face]`, in picker order. */
const TABLE = [
  ['twisheepish', '暮光闪闪', '尴尬'],
  ['facehoof', '暮光闪闪', '捂脸'],
  ['twicrazy', '暮光闪闪', '抓狂'],
  ['twieek', '暮光闪闪', '惊吓'],
  ['twievil', '暮光闪闪', '阴笑'],
  ['soawesome', '云宝黛西', '太酷了'],
  ['rdscared', '云宝黛西', '害怕'],
  ['joy', '碧琪', '喜悦'],
  ['pinkiesugar', '碧琪', '兴奋'],
  ['pinkiesad', '碧琪', '难过'],
  ['pinkiecry', '碧琪', '大哭'],
  ['pinkamina', '碧琪', '直发'],
  ['raritydaww', '瑞瑞', '感动'],
  ['wahaha', '瑞瑞', '大笑'],
  ['raritynews', '瑞瑞', '看报'],
  ['rarishock', '瑞瑞', '震惊'],
  ['rarityyell', '瑞瑞', '哀嚎'],
  ['ajsup', '苹果嘉儿', '挑眉'],
  ['appleroll', '苹果嘉儿', '白眼'],
  ['applehorror', '苹果嘉儿', '惊恐'],
  ['flutteryay', '小蝶', '欢呼'],
  ['fluttercutie', '小蝶', '可爱'],
  ['flutterhay', '小蝶', '吃草'],
  ['flutterfear', '小蝶', '害怕'],
  ['spikepushy', '穗龙', '得意'],
  ['noooo', '穗龙', '不要啊'],
  ['celestiahappy', '塞拉斯蒂娅', '开心'],
  ['celestiahurt', '塞拉斯蒂娅', '委屈'],
  ['lunateehee', '露娜', '偷笑'],
  ['lunagasp', '露娜', '惊讶'],
  ['lunawait', '露娜', '等等'],
  ['lunagrump', '露娜', '不爽'],
  ['sgpopcorn', '星光熠熠', '吃瓜'],
  ['sgsneaky', '星光熠熠', '坏笑'],
  ['starlightrage', '星光熠熠', '暴怒'],
  ['trixiecute', '崔克茜', '可爱'],
  ['trixiesad', '崔克茜', '委屈'],
  ['sunspicious', '余晖烁烁', '怀疑'],
  ['sunsetgrump', '余晖烁烁', '不爽'],
  ['lyra', '天琴', '开心'],
  ['octyhey', '奥塔维亚', '嘿'],
  ['discordgreen', '无序', '恶心'],
  ['abwut', '小苹花', '疑惑'],
  ['ohcomeon', '甜贝儿', '拜托'],
  ['silverstream', '银溪', '兴奋'],
  ['silverkiddingme', '银溪', '无语'],
  ['gallusbeg', '加鲁斯', '求求'],
  ['ocelluspray', '奥瑟蕾丝', '祈祷'],
  ['smolderpissed', '暗焰', '生气'],
  ['cozyglow', '和煦光流', '乖巧'],
  ['cocosympathy', '可可', '同情'],
  ['grannyshocked', '史密斯奶奶', '震惊'],
  ['redheartshocked', '红心护士', '震惊'],
  ['songbirdpose', '莺歌夜曲', '亮相'],
  ['tempestgaze', '狂风暗影', '凝视'],
  ['dice', '骰子', null],
  ['dice_1', '骰子', '一点'],
  ['dice_2', '骰子', '两点'],
  ['dice_3', '骰子', '三点'],
  ['dice_4', '骰子', '四点'],
  ['dice_5', '骰子', '五点'],
  ['dice_6', '骰子', '六点'],
];

/**
 * The original front end's picker, minus the two Emoji 14 faces (heart hands, salute) that
 * systems a few years old draw as an empty box — that picker drew every glyph as a Twemoji
 * image, this one uses the system's own font.
 */
const UNICODE = [
  '😀', '😁', '😂', '🤣', '😊', '😍', '🥰', '😘', '😜', '🤪', '😎', '🥳', '😭', '😢', '😅', '😆',
  '😋', '🤔', '🤗', '😴', '🥵', '🥶', '😱', '😡', '🤬', '😇', '🤫', '🤭', '🥺', '😏', '🙄', '😬',
  '👍', '👎', '👏', '🙏', '💪', '👌', '✌️', '🤞', '🤝', '👀', '❤️', '🧡', '💛', '💚', '💙', '💜',
  '🖤', '💖', '💕', '💔', '❣️', '💘', '✨', '🌟', '⭐', '🔥', '💯', '🎉', '🎊', '🎁', '🌈', '☀️',
  '🌙', '⚡', '🍰', '🍭', '🍎', '🍺', '🎂', '🎈', '🏆', '🎀', '🐴', '🦄', '🐾', '🐱', '🐶', '🐰',
  '🦊', '🐻',
];

/** A PNG's width and height, from its IHDR chunk — no image library for eight bytes. */
function pngSize(file) {
  const bytes = readFileSync(file);
  if (bytes.toString('latin1', 1, 4) !== 'PNG' || bytes.toString('latin1', 12, 16) !== 'IHDR') {
    throw new Error(`${path.basename(file)} is not a PNG`);
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function build() {
  const files = readdirSync(FOLDER).filter((name) => name.endsWith('.png')).map((name) => name.slice(0, -4));
  const named = new Set(TABLE.map(([name]) => name));
  const problems = [
    ...files.filter((name) => !named.has(name)).map((name) => `${name}.png has no entry in the table`),
    ...TABLE.filter(([name]) => !files.includes(name)).map(([name]) => `${name} is named but has no PNG`),
  ];
  const duplicates = TABLE.map(([name]) => name).filter((name, index, all) => all.indexOf(name) !== index);
  problems.push(...duplicates.map((name) => `${name} is named twice`));
  for (const [name] of TABLE) {
    if (!/^[a-zA-Z0-9_]+$/.test(name)) problems.push(`${name} cannot travel in a $emoji_…$ marker`);
  }
  if (problems.length) {
    for (const problem of problems) console.error(`emoji: ${problem}`);
    process.exit(1);
  }

  const rows = TABLE.map(([name, character, face]) => {
    const { width, height } = pngSize(path.join(FOLDER, `${name}.png`));
    const label = face ? `${character}·${face}` : character;
    return `  { name: ${JSON.stringify(name)}, label: ${JSON.stringify(label)}, width: ${width}, height: ${height} },`;
  });

  return [
    '/*',
    ' * Generated by `node scripts/emoji.mjs` from public/img/emoji. Do not edit — change the',
    ' * table in the script and run it again (`--check` reports a stale file).',
    ' */',
    '',
    'export interface PonyEmoji {',
    '  /** The file name under /img/emoji, and what a `$emoji_<name>$` marker carries. */',
    '  readonly name: string;',
    '  /** Its name in Chinese: character·face. */',
    '  readonly label: string;',
    '  readonly width: number;',
    '  readonly height: number;',
    '}',
    '',
    'export const PONY_EMOJI: readonly PonyEmoji[] = [',
    ...rows,
    '];',
    '',
    '/** The everyday Unicode set, drawn by the system font. */',
    'export const UNICODE_EMOJI: readonly string[] = [',
    ...chunk(UNICODE.map((glyph) => JSON.stringify(glyph)), 16).map((line) => `  ${line.join(', ')},`),
    '];',
    '',
  ].join('\n');
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const output = build();
if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(OUTPUT, 'utf8');
  } catch {
    /* A missing file is a stale one. */
  }
  if (current !== output) {
    console.error('emoji: lib/generated/emoji.ts is stale — run `node scripts/emoji.mjs`');
    process.exit(1);
  }
  console.log(`emoji: lib/generated/emoji.ts is current (${TABLE.length} pony, ${UNICODE.length} Unicode)`);
} else {
  writeFileSync(OUTPUT, output);
  console.log(`emoji: wrote lib/generated/emoji.ts (${TABLE.length} pony, ${UNICODE.length} Unicode)`);
}
