// Motion CSS: a plain invocation verifies; --write installs.
//
// The springs are `lib/spring.ts`, not here — this only renders them into the one generated block
// of `app/globals.css` (between `@motion-generated:start` and `@motion-generated:end`): the three
// shape tables as `linear()`, the seven settle times and the page hand-off. The prose, the role
// eases and the utilities around the block are hand-written and never touched.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const spring = await import('../lib/spring.ts');

const CSS = fileURLToPath(new URL('../app/globals.css', import.meta.url));
const START = '  /* @motion-generated:start */\n';
const END = '  /* @motion-generated:end */\n';

const kebab = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const wrap = (linear) => {
  const inner = linear.slice('linear('.length, -1).split(', ');
  const lines = [];
  for (let i = 0; i < inner.length; i += 6) lines.push(`    ${inner.slice(i, i + 6).join(', ')}`);
  return `linear(\n${lines.join(',\n')}\n  )`;
};

const lines = [];
const shapeName = { effects: 'effects', spatial: 'spatial', spatialFast: 'spatial-fast' };
const shapeNote = {
  effects: 'ζ1, critically damped: the effects roles and layout',
  spatial: 'ζ0.8: default- and slow-spatial',
  spatialFast: 'ζ0.6: fast-spatial',
};
for (const [shape, spec] of Object.entries(spring.SHAPE_SPEC)) {
  lines.push(`  /* ${shapeNote[shape]} */`);
  lines.push(`  --motion-shape-${shapeName[shape]}: ${wrap(spring.springToLinear(spec))};`);
}
for (const [name, spec] of Object.entries(spring.SPRINGS)) {
  lines.push(`  --motion-base-spring-${kebab(name)}: ${spring.SPRING_MS[name]}ms; /* ζ${spec.damping} k${spec.stiffness} */`);
}
for (const [name, spec] of Object.entries(spring.COMPONENT_SPRINGS)) {
  lines.push(`  --motion-base-spring-${kebab(name)}: ${spring.springDurationMs(spec)}ms; /* ζ${spec.damping} k${spec.stiffness} */`);
}
lines.push(`  --motion-base-handoff: ${Math.round(spring.SPRING_MS.fastEffects / 2)}ms; /* half a fast-effects fade: a follower starts as its leader is ~90% there */`);
const block = `${START}${lines.join('\n')}\n${END}`;

const css = readFileSync(CSS, 'utf8');
const a = css.indexOf(START);
const b = css.indexOf(END);
if (a < 0 || b < a) {
  console.error('globals.css has no @motion-generated block');
  process.exit(1);
}
const next = css.slice(0, a) + block + css.slice(b + END.length);
if (process.argv.includes('--write')) {
  writeFileSync(CSS, next);
  console.log('motion tokens written');
} else if (next !== css) {
  console.error('globals.css motion tokens are stale — run `npm run motion:write`');
  process.exit(1);
} else {
  console.log('motion tokens are current');
}
