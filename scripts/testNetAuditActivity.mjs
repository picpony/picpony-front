import assert from 'node:assert/strict';
import test from 'node:test';
import { createStepActivity, isRouteRequest } from './netAuditActivity.mjs';

const origin = 'http://127.0.0.1:3100';
const request = (path, headers = {}) => ({ url: `${origin}${path}`, headers });

test('route completion includes documents and RSC prefetches, without treating chunks as data', () => {
  assert.equal(isRouteRequest(request('/favorites'), 'Document', origin), true);
  assert.equal(isRouteRequest(request('/user/1?_rsc=fixture'), 'Fetch', origin), true);
  assert.equal(isRouteRequest(request('/user/1', { RSC: '1' }), 'Fetch', origin), true);
  assert.equal(isRouteRequest(request('/user/1', { rsc: '1' }), 'Fetch', origin), true);
  assert.equal(isRouteRequest(request('/_next/static/chunk.js'), 'Script', origin), false);
  assert.equal(isRouteRequest(request('/api/v1/me/favorites?page=1'), 'Fetch', origin), false);
  assert.equal(isRouteRequest({ url: 'https://elsewhere.test/?_rsc=x' }, 'Fetch', origin), false);
  assert.equal(isRouteRequest({ url: 'bad-url' }, 'Document', origin), false);
});

test('a late profile prefetch stays in the favorites step after its browser APIs have finished', () => {
  let now = 0;
  const activity = createStepActivity(origin, 900, () => now);
  activity.start('faves', request('/api/v1/me/favorites?page=1'), 'Fetch', true);
  activity.start('profile', request('/user/1?_rsc=fixture'), 'Fetch', false);
  now = 200;
  activity.finish('faves');
  now = 1101;
  assert.equal(activity.isQuiet(), false, 'the old API-only idle test would already start the next step');
  now = 1400;
  activity.touch(); // the route payload starts get_user_profile on the server
  now = 1600;
  activity.finish('profile');
  now = 2499;
  assert.equal(activity.isQuiet(), false);
  now = 2500;
  assert.equal(activity.isQuiet(), true);
});

test('server activity restarts the quiet interval even without a new browser API', () => {
  let now = 0;
  const activity = createStepActivity(origin, 900, () => now);
  now = 850;
  activity.touch();
  now = 900;
  assert.equal(activity.isQuiet(), false);
  now = 1750;
  assert.equal(activity.isQuiet(), true);
});

test('failed and redirected route requests release the completion gate once', () => {
  let now = 0;
  const activity = createStepActivity(origin, 900, () => now);
  activity.start('route', request('/favorites'), 'Document', false);
  activity.start('route', request('/favorites?tab=derpi'), 'Document', false);
  now = 100;
  activity.finish('route'); // either loadingFinished or loadingFailed
  now = 700;
  activity.finish('route'); // an unrelated/duplicate event cannot postpone quiescence
  now = 1000;
  assert.equal(activity.isQuiet(), true);
});

test('a cached step is still observed for the full quiet interval', () => {
  let now = 0;
  const activity = createStepActivity(origin, 900, () => now);
  activity.start('chunk', request('/_next/static/chunk.js'), 'Script', false);
  now = 899;
  assert.equal(activity.isQuiet(), false);
  now = 900;
  assert.equal(activity.isQuiet(), true, 'uncounted static work must not create a data request');
});
