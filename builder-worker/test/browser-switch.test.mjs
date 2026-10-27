import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserSwitch } from '../src/browser-switch.mjs';

test('defaults off; only explicit true enables browser startup', async () => {
  let setting;
  const control = createBrowserSwitch({ readEnabled: async () => setting, closeBrowser: async () => {}, isBusy: () => false });
  assert.equal(control.isEnabled(), false);
  for (setting of [undefined, null, 1, 'true', false]) assert.equal(await control.refresh(), false);
  setting = true;
  assert.equal(await control.refresh(), true);
});

test('off closes idle/login browser but lets an active task finish', async () => {
  let enabled = true;
  let busy = false;
  let closes = 0;
  const control = createBrowserSwitch({ readEnabled: async () => enabled, closeBrowser: async () => { closes++; }, isBusy: () => busy });
  await control.refresh();
  assert.equal(closes, 0);
  busy = true;
  enabled = false;
  await control.refresh();
  assert.equal(control.isEnabled(), false);
  assert.equal(closes, 0);
  busy = false;
  await control.refresh();
  assert.equal(closes, 1);
});

test('API failure disables browser without interrupting active work', async () => {
  let failed = false;
  let busy = true;
  let closes = 0;
  const control = createBrowserSwitch({ readEnabled: async () => { if (failed) throw new Error('offline'); return true; }, closeBrowser: async () => { closes++; }, isBusy: () => busy });
  await control.refresh();
  failed = true;
  assert.equal(await control.refresh(), false);
  assert.equal(closes, 0);
  busy = false;
  await control.refresh();
  assert.equal(closes, 1);
});
