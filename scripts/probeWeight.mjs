/* Route JS weight: sum the bytes of every <script src> a document pulls, raw and brotli.
   Scratch probe; `npm run net:audit` measures requests, this measures bytes. */
import { spawn } from 'node:child_process';
import { statSync, readFileSync } from 'node:fs';
import { brotliCompressSync } from 'node:zlib';
import path from 'node:path';
import { createServer } from 'node:http';
import { stubFor } from './netAuditFixtures.mjs';

const ROOT = process.cwd();
const PORT = 3946, UP = 3947;

const upstream = createServer((req, res) => {
  const asUpstream = req.url?.startsWith('/api/v1/json')
    ? `https://trixiebooru.org${req.url}`
    : `http://127.0.0.1:${UP}${req.url}`;
  const stub = stubFor(asUpstream);
  if (!stub) return void res.writeHead(404).end();
  res.writeHead(200, { 'content-type': stub.contentType, 'cache-control': 'no-store' });
  res.end(stub.binary ? Buffer.from(stub.body, 'base64') : stub.body);
});
await new Promise((r) => upstream.listen(UP, '127.0.0.1', r));

const NEXT_BIN = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
const server = spawn(process.execPath, [NEXT_BIN, 'start', '-p', String(PORT)], {
  cwd: ROOT,
  stdio: 'ignore',
  env: {
    ...process.env,
    PICPONY_UPSTREAM_ORIGIN: `http://127.0.0.1:${UP}`,
    PICPONY_DERPI_ORIGIN: `http://127.0.0.1:${UP}/api/v1/json`,
  },
});
const end = Date.now() + 40000;
let up = false;
while (Date.now() < end && !up) {
  try { up = (await fetch(`http://127.0.0.1:${PORT}/policy`)).ok; } catch {}
  if (!up) await new Promise((r) => setTimeout(r, 250));
}
if (!up) throw new Error('no server');

const brSize = (file) => {
  try { return brotliCompressSync(readFileSync(file)).length; } catch { return 0; }
};
const rawSize = (file) => { try { return statSync(file).size; } catch { return 0; } };

for (const target of process.argv.slice(2)) {
  const html = await (await fetch(`http://127.0.0.1:${PORT}${target}`)).text();
  const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  const seen = new Set();
  let raw = 0, br = 0;
  const rows = [];
  for (const src of srcs) {
    if (!src.startsWith('/_next/') || seen.has(src)) continue;
    seen.add(src);
    const file = path.join(ROOT, '.next', src.replace('/_next/', ''));
    const r = rawSize(file), b = brSize(file);
    raw += r; br += b;
    rows.push([src.split('/').pop(), r, b]);
  }
  rows.sort((a, b) => b[2] - a[2]);
  console.log(`\n${target}  ${srcs.length} scripts   raw ${raw.toLocaleString()}   br ${br.toLocaleString()}`);
  for (const [name, r, b] of rows.slice(0, 8)) {
    console.log(`  ${String(b).padStart(7)} br  ${String(r).padStart(8)} raw  ${name}`);
  }
}

server.kill();
upstream.close();
setTimeout(() => process.exit(0), 300);
