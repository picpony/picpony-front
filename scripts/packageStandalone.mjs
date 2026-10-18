/**
 * `npm run package:standalone` — turn the `next build` output into one directory that starts with
 * `node server.js`.
 *
 * `output: 'standalone'` writes `.next/standalone/`: the server entry plus the `node_modules` its
 * file trace found. It deliberately leaves out the two things every deployment has to add itself —
 * `.next/static/` (client chunks, CSS, fonts) and `public/` (icons, the service worker, the
 * companion bundle). An archive missing them starts and answers HTML, but every stylesheet, script
 * and picture 404s, so this script copies both in, trims the build's own `package.json` down to
 * what the server reads, and writes the launcher and README someone downloading the artifact needs.
 *
 * The folder is named for the platform that built it, and that is not cosmetic: the trace carries
 * sharp's platform libraries (`node_modules/@img/sharp-<platform>-<arch>/`, libvips included),
 * copied from the build host. A package built on Linux runs only on Linux, so publish it from the
 * Linux CI job; a Windows checkout produces a Windows package, useful for testing the shape.
 *
 * Run after `npm run build`. `dist/picpony-front-<platform>-<arch>/` is the artifact.
 */
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const standalone = path.join(root, '.next/standalone');

/** `--platform linux-x64` names the package; the default is the host that built it. */
const args = process.argv.slice(2);
const platformFlag = args.indexOf('--platform');
const platform =
  platformFlag === -1 ? `${process.platform}-${process.arch}` : (args[platformFlag + 1] ?? '');
if (!/^[a-z0-9]+-[a-z0-9]+$/.test(platform)) {
  console.error(`package:standalone: bad platform ${JSON.stringify(platform)}`);
  process.exit(1);
}
const host = `${process.platform}-${process.arch}`;
if (platform !== host) {
  console.error(
    `package:standalone: --platform ${platform} does not match the build host ${host}. ` +
      `sharp's native libraries come from the host, so the package would not run where its name says.`,
  );
  process.exit(1);
}

const out = path.join(root, 'dist', `picpony-front-${platform}`);
const windows = platform.startsWith('win32');

for (const [label, dir] of [
  ['the standalone server', standalone],
  ['.next/static', path.join(root, '.next/static')],
  ['public/', path.join(root, 'public')],
]) {
  if (!existsSync(dir)) {
    console.error(
      `package:standalone: ${label} is missing (${path.relative(root, dir)}), run \`npm run build\` first.`,
    );
    process.exit(1);
  }
}

/** Copy a directory's entries into `to`, so nothing is nested under the source's own name. */
function copyContents(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    cpSync(path.join(from, entry), path.join(to, entry), { recursive: true });
  }
}

rmSync(out, { recursive: true, force: true });
copyContents(standalone, out);
copyContents(path.join(root, '.next/static'), path.join(out, '.next/static'));
copyContents(path.join(root, 'public'), path.join(out, 'public'));

const buildIdFile = path.join(out, '.next/BUILD_ID');
const buildId = existsSync(buildIdFile) ? readFileSync(buildIdFile, 'utf8').trim() : 'unknown';

/**
 * The build's `package.json` still lists `scripts`, `devDependencies` and the lock overrides. None
 * of them travel with a standalone trace, and a `npm run dev` pointing at a missing script only
 * invites someone to try it. `name`, `version` and `engines` stay — the engine is the one runtime
 * requirement that is not inside `node_modules`.
 */
const packageFile = path.join(out, 'package.json');
const { name, version, engines } = JSON.parse(readFileSync(packageFile, 'utf8'));
writeFileSync(packageFile, `${JSON.stringify({ name, version, private: true, engines }, null, 2)}\n`);

const launch = windows ? 'run.cmd' : 'sh run.sh';
const portExample = windows ? 'set PORT=8080 && run.cmd' : 'PORT=8080 sh run.sh';
const hostExample = windows
  ? 'set HOSTNAME=127.0.0.1 && set PORT=3100 && run.cmd'
  : 'HOSTNAME=127.0.0.1 sh run.sh';
/* Set by GitHub Actions; a local package is from whatever the checkout happened to hold. */
const commit = process.env.GITHUB_SHA?.slice(0, 12);

if (windows) {
  writeFileSync(
    path.join(out, 'run.cmd'),
    [
      '@echo off',
      'rem Start this build. PORT and HOSTNAME are read by server.js; their defaults are 3100 and 0.0.0.0.',
      'setlocal',
      'if not defined PORT set "PORT=3100"',
      'echo PicPony: http://localhost:%PORT%',
      'node "%~dp0server.js"',
      '',
    ].join('\r\n'),
  );
} else {
  const sh = path.join(out, 'run.sh');
  writeFileSync(
    sh,
    [
      '#!/bin/sh',
      '# Start this build. PORT and HOSTNAME are read by server.js; their defaults are 3100 and 0.0.0.0.',
      'set -eu',
      'cd "$(dirname "$0")"',
      'if ! command -v node >/dev/null 2>&1; then',
      '  echo "PicPony needs Node.js 22.18 or newer on PATH." >&2',
      '  exit 1',
      'fi',
      'PORT="${PORT:-3100}"',
      'export PORT',
      'echo "PicPony: http://localhost:${PORT}"',
      'exec node server.js',
      '',
    ].join('\n'),
  );
  /* An artifact download drops modes to 644, so `sh run.sh` is the documented form; the bit still
     makes `./run.sh` work in a checkout that packages into dist/. */
  chmodSync(sh, 0o755);
}

writeFileSync(
  path.join(out, 'README.txt'),
  [
    'PicPony 前端 · 生产构建产物',
    '================================',
    '',
    `平台       ${platform}`,
    `构建号     ${buildId}`,
    ...(commit ? [`提交       ${commit}`] : []),
    `打包时间   ${new Date().toISOString()}`,
    '运行环境   Node.js 22.18 或更新（依赖已内置，无需 npm install）',
    '',
    '启动',
    '----',
    `  ${windows ? 'run.cmd' : 'sh run.sh'}`,
    '默认监听 http://localhost:3100 。',
    '',
    '换端口 / 监听地址',
    '-----------------',
    `  ${portExample}`,
    `  ${hostExample}    # 只监听本机`,
    '',
    '环境变量',
    '--------',
    '  PORT                     监听端口，默认 3100',
    '  HOSTNAME                 监听地址，默认 0.0.0.0',
    '  PICPONY_UPSTREAM_ORIGIN  后端来源，默认 https://picpony.top ，启动时读取',
    '',
    '注意',
    '----',
    '  * 整个目录要一起保留：缺少 .next/static 或 public ，页面样式、脚本和图标会 404。',
    '  * 运行目录需要可写，图片优化的缓存写在 .next/cache 。',
    `  * 本包由 ${platform} 构建，sharp 与 libvips 原生库跟随构建平台，换平台需要重新构建。`,
    '  * 单进程运行；多实例部署前需要共享的缓存与限流（见仓库 docs/architecture-guide.md）。',
    '',
  ].join('\n'),
);

/** Files and bytes in the finished package, for the log line CI will show. */
function measure(dir) {
  let files = 0;
  let bytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const inner = measure(full);
      files += inner.files;
      bytes += inner.bytes;
    } else {
      files += 1;
      bytes += statSync(full).size;
    }
  }
  return { files, bytes };
}

const { files, bytes } = measure(out);
console.log(
  `package:standalone: ${path.relative(root, out)} — ${files} files, ` +
    `${(bytes / 1024 / 1024).toFixed(1)} MB; start with \`${launch}\` on ${platform}.`,
);
