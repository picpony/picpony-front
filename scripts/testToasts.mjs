/** Delivery contracts shared by transport failures and the rendered toast container. No DOM. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requireTypeStripping } from './tsResolve.mjs';

requireTypeStripping('testToasts');
const { showToast, subscribeToasts } = await import('../lib/toast.ts');

test('reports before mount arrive in order and are not replayed by a remount', () => {
  showToast('登录已过期，请重新登录', 'warning');
  showToast('设置已保存在本设备，同步到账号失败', 'warning');
  const first = [];
  const stop = subscribeToasts((notice) => first.push(notice));
  assert.deepEqual(first.map(({ message }) => message), [
    '登录已过期，请重新登录', '设置已保存在本设备，同步到账号失败',
  ]);
  assert.ok(first[1].id > first[0].id);
  stop();
  stop();
  const next = [];
  const stopNext = subscribeToasts((notice) => next.push(notice));
  assert.deepEqual(next, [], 'Strict Mode or a remount cannot announce old reports again');
  stopNext();
});

test('an unmounted subscriber receives nothing and its replacement gets pending reports', () => {
  const first = [];
  const stop = subscribeToasts((notice) => first.push(notice));
  showToast('已保存');
  stop();
  showToast('稍后显示', 'info');
  const next = [];
  const stopNext = subscribeToasts((notice) => next.push(notice));
  try {
    assert.deepEqual(first.map(({ message }) => message), ['已保存']);
    assert.deepEqual(next.map(({ message }) => message), ['稍后显示']);
  } finally {
    stopNext();
  }
});

test('delivery preserves the chosen reading time and passes an action without executing it', () => {
  const notices = [];
  let undone = 0;
  const stop = subscribeToasts((notice) => notices.push(notice));
  try {
    showToast('已删除', 'success', { duration: 9000, action: { label: '撤销', onClick: () => undone++ } });
    showToast('普通提示', 'info', 2500);
    showToast('稍后再试', 'warning');
    assert.deepEqual(notices.map(({ duration }) => duration), [9000, 2500, 6000]);
    assert.equal(undone, 0);
    assert.equal(notices[0].action.label, '撤销');
    notices[0].action.onClick();
    assert.equal(undone, 1);
  } finally {
    stop();
  }
});

test('a failing renderer cannot fail the producer or stop delivery to another subscriber', () => {
  const failed = () => { throw new Error('renderer unavailable'); };
  showToast('挂载前的提示', 'info');
  let stopFailed;
  assert.doesNotThrow(() => { stopFailed = subscribeToasts(failed); });
  const notices = [];
  const stop = subscribeToasts((notice) => notices.push(notice));
  try {
    assert.doesNotThrow(() => showToast('请求已完成'));
    assert.deepEqual(notices.map(({ message }) => message), ['请求已完成']);
  } finally {
    stopFailed();
    stop();
  }
});
