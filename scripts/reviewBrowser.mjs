/** Production-route smoke and accessibility checks. All API/media traffic uses fixtures;
 * neither the Next server nor the browser sends business requests to a live service. */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPicponyApi, stubFor } from './netAuditFixtures.mjs';
import { opOf } from './rustRoutes.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = (value) => ({ body: JSON.stringify(value), contentType: 'application/json' });
const STAMP = 'Mon 2024-01-01 8:00 AM CST (UTC+08:00)';

/** The shared fixture's answer for one PicPony operation, parsed, so an override can amend it. */
function base(op, path) {
  const answer = stubFor(`http://fixture.invalid/api/v1${path}`, 'GET');
  return answer && !answer.status ? JSON.parse(answer.body) : {};
}

/** The signed-in reviewer is an administrator; the shared fixture's `fixture` user is not. */
const reviewer = () => ({ ...base('get_user', '/me').user, username: 'Review Admin', role: 'super_admin',
  email: 'review@example.test', email_verified: true });
const notification = { id: 1, kind: 'system', title: 'Fixture notice', content: 'Fixture notification body',
  important: false, broadcast: false, created_at: STAMP, read: false };
const shopItem = { id: 1, name: 'Fixture item', description: 'Fixture description', image_url: null,
  price: 10, stock: 3, active: true, revision: 1, created_at: STAMP };

/**
 * Review-only answers, by the Rust backend's operation (`scripts/rustRoutes.mjs`), in its shapes;
 * everything else is the shared `netAuditFixtures.mjs` answer. These are the values the route
 * checks in `reviewBrowser.py` look for.
 */
const overrides = {
  get_user: () => ({ user: reviewer() }),
  get_forum_post_detail: (url) => {
    const answer = base('get_forum_post_detail', new URL(url).pathname.replace(/^\/api\/v1/, ''));
    return { ...answer, post: { ...answer.post, title: 'Review fixture thread' } };
  },
  get_notifications: () => ({ notifications: [notification], next_cursor: null }),
  get_shop_items: () => ({ items: [shopItem], next_cursor: null }),
  admin_get_users: () => {
    const user = reviewer();
    return { users: [{ id: user.id, username: user.username, email: user.email, email_verified: true,
      role: user.role, is_banned: false, bio: '', avatar: '', banner: '', experience: user.experience,
      coins: user.coins, created_at: STAMP, last_online: STAMP, ip_location: null }], total_pages: 1 };
  },
  admin_get_notifications: () => ({ notifications: [{ id: 1, recipient_id: 1, username: 'Review Admin',
    kind: 'system', title: notification.title, content: notification.content, important: false,
    created_at: STAMP }], next_cursor: null }),
  admin_get_reports: () => ({ reports: [{ id: 1, image_id: 1000, reason: 'Fixture report', status: 'pending',
    revision: 1, created_at: STAMP, updated_at: STAMP, reporter: { id: 2, username: 'Fixture' } }], total_pages: 1 }),
  admin_get_all_messages: () => ({ messages: [{ id: 1, sender_id: 2, sender_name: 'Fixture Contact',
    receiver_id: 1, receiver_name: 'Review Admin', content: 'Review fixture message', read_at: STAMP,
    created_at: STAMP }], next_cursor: null }),
};

function fixture(raw, method = 'GET') {
  const url = new URL(raw);
  if (url.pathname.startsWith('/api/v1/json')) url.hostname = 'trixiebooru.org';
  else if (isPicponyApi(url)) {
    const op = opOf(method, url.href);
    if (op && Object.hasOwn(overrides, op)) return json(overrides[op](url.href));
  }
  return stubFor(url.href, method);
}

const upstream = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/__review_fixture') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(fixture(url.searchParams.get('url'), url.searchParams.get('method') ?? 'GET')));
    return;
  }
  const result = fixture(url.href, req.method);
  if (!result) { res.writeHead(404).end(); return; }
  res.writeHead(result.status ?? 200, { 'content-type': result.contentType, 'cache-control': 'no-store' });
  res.end(result.binary ? Buffer.from(result.body, 'base64') : result.body);
});

async function availablePort() {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

let server;
let python;
try {
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const fixtureUrl = `http://127.0.0.1:${upstream.address().port}`;
  const port = await availablePort();
  const base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port)], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, PICPONY_UPSTREAM_ORIGIN: fixtureUrl,
      PICPONY_DERPI_ORIGIN: `${fixtureUrl}/api/v1/json`, PICPONY_SERVER_MEMO_TTL_MS: '0' },
  });
  let serverError = '';
  server.stderr.on('data', (chunk) => { serverError = (serverError + chunk).slice(-5000); });
  const until = Date.now() + 40_000;
  let ready = false;
  while (Date.now() < until && server.exitCode === null) {
    try { ready = (await fetch(`${base}/manifest.webmanifest`)).ok; } catch { /* starting */ }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error(`Production server did not start: ${serverError}`);
  const args = process.argv.slice(2);
  const browserScript = args.includes('--hero-visuals') ? 'captureHeroMotion.py'
    : args.includes('--hero-stress') ? 'stressHeroReopen.py'
    : args.includes('--hero-open-probe') ? 'probeHeroOpening.py'
    : args.includes('--hero-scroll-thread') ? 'probeHeroScrollThread.py'
    : args.includes('--hero-pending-scroll') ? 'probeHeroPendingScroll.py'
    : args.includes('--hero-gestures') ? 'probeHeroGestures.py'
    : args.includes('--hero-performance') ? 'probeHeroPerformance.py'
    : args.includes('--hero') ? 'testHeroInteractions.py'
    : args.includes('--auth-loading') ? 'testAuthLoading.py'
    : args.includes('--profile-gallery') ? 'testProfileGallery.py'
    : args.includes('--motion') ? 'testMotionRegression.py' : 'reviewBrowser.py';
  python = spawn(process.env.PYTHON ?? 'python', [process.env.HERO_SCRIPT ?? path.join(root, 'scripts', browserScript), base, fixtureUrl,
    ...args.filter((arg) => arg !== '--hero-visuals')], {
    cwd: root, windowsHide: true, stdio: 'inherit', env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  const [code] = await once(python, 'exit');
  process.exitCode = code ?? 1;
} finally {
  python?.kill();
  if (server && server.exitCode === null) {
    server.kill();
    await Promise.race([once(server, 'exit'), new Promise((resolve) => setTimeout(resolve, 3000))]);
  }
  upstream.closeAllConnections();
  await new Promise((resolve) => upstream.close(resolve));
}
