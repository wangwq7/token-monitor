'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  describeWindowBehavior,
  normalizeWindowBehavior,
  normalizeWindowBehaviorSettings
} = require('../../src/electron/windowBehavior');

test('normalizes supported window behavior modes', () => {
  assert.equal(normalizeWindowBehavior('floating'), 'floating');
  assert.equal(normalizeWindowBehavior('NORMAL'), 'normal');
  assert.equal(normalizeWindowBehavior(' desktop '), 'desktop');
  assert.equal(normalizeWindowBehavior('unknown', 'normal'), 'normal');
});

test('maps window behavior modes to window flags', () => {
  assert.deepEqual(describeWindowBehavior({ windowBehavior: 'floating' }), {
    mode: 'floating',
    alwaysOnTop: true,
    draggable: true,
    resizable: true,
    focusable: true,
    mousePassthrough: false,
    showInactive: false,
    requiresTrayControl: false,
    skipTaskbar: false,
    cssClass: ''
  });
  assert.deepEqual(describeWindowBehavior({ windowBehavior: 'normal' }), {
    mode: 'normal',
    alwaysOnTop: false,
    draggable: true,
    resizable: true,
    focusable: true,
    mousePassthrough: false,
    showInactive: false,
    requiresTrayControl: false,
    skipTaskbar: false,
    cssClass: ''
  });
  // Desktop-pinned is a wallpaper widget, not an app window: it stays out of
  // the taskbar (tray access only). macOS Dock is governed separately by
  // LSUIElement/activation policy.
  assert.deepEqual(describeWindowBehavior({ windowBehavior: 'desktop' }), {
    mode: 'desktop',
    alwaysOnTop: false,
    draggable: false,
    resizable: false,
    focusable: true,
    mousePassthrough: false,
    showInactive: false,
    requiresTrayControl: false,
    skipTaskbar: true,
    cssClass: 'desktop-mode'
  });
});

test('migrates legacy alwaysOnTop settings when no behavior is saved', () => {
  assert.equal(normalizeWindowBehaviorSettings({ alwaysOnTop: true }).windowBehavior, 'floating');
  assert.equal(normalizeWindowBehaviorSettings({ alwaysOnTop: false }).windowBehavior, 'normal');
});

test('keeps alwaysOnTop synchronized with behavior updates', () => {
  assert.deepEqual(
    normalizeWindowBehaviorSettings({ windowBehavior: 'floating', alwaysOnTop: true }, { windowBehavior: 'desktop' }),
    { windowBehavior: 'desktop', alwaysOnTop: false }
  );
  assert.deepEqual(
    normalizeWindowBehaviorSettings({ windowBehavior: 'desktop', alwaysOnTop: false }, { alwaysOnTop: true }),
    { windowBehavior: 'floating', alwaysOnTop: true }
  );
  assert.deepEqual(
    normalizeWindowBehaviorSettings({ windowBehavior: 'floating', alwaysOnTop: true }, { alwaysOnTop: false }),
    { windowBehavior: 'normal', alwaysOnTop: false }
  );
});
