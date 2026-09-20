/** Production-route smoke and accessibility checks. All API/media traffic uses fixtures;
 * neither the Next server nor the browser sends business requests to a live service. */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stubFor } from './netAuditFixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = (value) => ({ body: JSON.stringify(value), contentType: 'application/json' });
const user = {
  id: 1, username: 'Review Admin', role: 'super_admin', token: 'review-fixture-token',
  api_key: 'review-fixture-key', email: 'review@example.test', email_verified: true,
  avatar: '', banner: '', bio: '', gender: '', birthday: '', experience: 1350, coins: 100,
  equipped_badges: [], created_at: '2024-01-01T00:00:00Z', is_banned: 0,
};
const reviewPost = { id: 1, title: 'Review fixture thread', content: '[b]Fixture content[/b]',
  user_id: 1, username: 'Review Admin', avatar: '', created_at: '2024-01-01T00:00:00Z',
  is_pinned: 0, is_liked: 0, like_count: 0, view_count: 2, comment_count: 0 };
const notifications = [{ id: 1, user_id: 1, receiver_name: 'Review Admin', title: 'Fixture notice',
  content: 'Fixture notification body', is_read: 0, created_at: '2024-01-01T00:00:00Z' }];
const messages = [{ id: 1, sender_id: 2, receiver_id: 1, sender_name: 'Fixture Contact',
  receiver_name: 'Review Admin', content: 'Review fixture message', is_read: 1,
  sender_avatar: '', created_at: '2024-01-01T00:00:00Z' }];
const overrides = {
  get_user: { success: true, user },
  get_forum_post_detail: { success: true, post: reviewPost, comments: [], total_pages: 1 },
  get_unread_counts: { success: true, total_unread: 0, unread_messages: 0, unread_notifications: 0, unread_interactions: 0 },
  get_my_badges: { success: true, badges: [] },
  get_developer_status: { success: true, is_developer: false },
  get_glossary_entries: { success: true, entries: [] },
  get_dictionary: { success: true, tags: [], total_matches: 0, stats: { total: 0, translated: 0, untranslated: 0 } },
  get_dictionary_leaderboard: { success: true, leaderboard: [] },
  get_recent_contacts: { success: true, contacts: [{ id: 2, username: 'Fixture Contact', avatar: '', unread_count: 0, last_msg_time: '2024-01-01T00:00:00Z' }] },
  get_messages: { success: true, messages },
  get_notifications: { success: true, notifications },
  admin_get_users: { success: true, users: [user] },
  admin_get_notifications: { success: true, notifications },
  admin_get_all_messages: { success: true, messages },
  admin_get_reports: { success: true, reports: [{ id: 1, image_id: 1000, username: 'Fixture', reason: 'Fixture report', status: 'pending', created_at: '2024-01-01' }] },
  admin_get_blacklist: { success: true, blacklist: [] },
  admin_list_badge_links: { success: true, links: [] },
  admin_get_developer_password: { success: true, password: 'fixture-password', updated_at: '2024-01-01' },
  admin_get_developer_users: { success: true, users: [] },
  get_shop_items: { success: true, items: [{ id: 1, name: 'Fixture item', description: 'Fixture description', price: 10, stock: 3, active: 1, image_url: null }] },
  get_site_stats: { success: true, stats: { images: 10, tags: 10, comments: 10 } },
  admin_get_tag_feedback: { success: true, feedbacks: [], summary: { pending: 0, processed: 0, rejected: 0 }, pagination: { pages: 1, page: 1 } },
};

function fixture(raw) {
  const url = new URL(raw);
  if (url.pathname.startsWith('/api/v1/json')) url.hostname = 'trixiebooru.org';
  const action = url.searchParams.get('action');
  if (action && Object.hasOwn(overrides, action)) return json(overrides[action]);
  return stubFor(url.href);
}

const upstream = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/__review_fixture') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(fixture(url.searchParams.get('url'))));
    return;
  }
  const result = fixture(url.href);
  if (!result) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': result.contentType, 'cache-control': 'no-store' });
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
    : args.includes('--hero-performance') ? 'probeHeroPerformance.py'
    : args.includes('--hero') ? 'testHeroInteractions.py'
    : args.includes('--profile-gallery') ? 'testProfileGallery.py' : 'reviewBrowser.py';
  python = spawn('python', [path.join(root, 'scripts', browserScript), base, fixtureUrl,
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
