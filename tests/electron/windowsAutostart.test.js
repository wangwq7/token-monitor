'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  RUN_KEY,
  VALUE_NAME,
  autostartSupported,
  executablePath,
  isAutostartEnabled,
  parseRunValue,
  runCommand,
  setAutostartEnabled
} = require('../../src/electron/windowsAutostart');

function tempExe() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-monitor-win-autostart-'));
  const exe = path.join(dir, 'Token Monitor 0.22.1.exe');
  fs.writeFileSync(exe, 'MZ');
  return exe;
}

function registryMock() {
  let value = '';
  const calls = [];
  const execFileSync = (file, args) => {
    calls.push([file, args]);
    if (args[0] === 'query') {
      if (!value) throw Object.assign(new Error('missing'), { status: 1 });
      return `\n${RUN_KEY}\n    ${VALUE_NAME}    REG_SZ    ${value}\n`;
    }
    if (args[0] === 'add') {
      value = args[args.indexOf('/d') + 1];
      return '';
    }
    if (args[0] === 'delete') {
      value = '';
      return '';
    }
    throw new Error(`unexpected reg command: ${args.join(' ')}`);
  };
  return { execFileSync, calls, value: () => value };
}

test('portable executable path wins over the temporary extracted process path', () => {
  assert.equal(executablePath({
    env: { PORTABLE_EXECUTABLE_FILE: 'D:\\Apps\\Token Monitor 0.22.1.exe' },
    execPath: 'C:\\Temp\\random\\Token Monitor.exe'
  }), 'D:\\Apps\\Token Monitor 0.22.1.exe');
});

test('Windows portable autostart command quotes the stable outer exe and starts hidden', () => {
  assert.equal(runCommand('D:\\Apps\\Token Monitor 0.22.1.exe'), '"D:\\Apps\\Token Monitor 0.22.1.exe" --hidden');
});

test('parseRunValue reads the Token Monitor Run value', () => {
  const output = `HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\r\n    ${VALUE_NAME}    REG_SZ    "D:\\Apps\\Token Monitor.exe" --hidden\r\n`;
  assert.equal(parseRunValue(output), '"D:\\Apps\\Token Monitor.exe" --hidden');
});

test('autostart is supported only for packaged Windows builds with a real stable executable', () => {
  const exe = tempExe();
  assert.equal(autostartSupported({ platform: 'win32', isPackaged: true, env: { PORTABLE_EXECUTABLE_FILE: exe } }), true);
  assert.equal(autostartSupported({ platform: 'win32', isPackaged: false, env: { PORTABLE_EXECUTABLE_FILE: exe } }), false);
  assert.equal(autostartSupported({ platform: 'linux', isPackaged: true, env: { PORTABLE_EXECUTABLE_FILE: exe } }), false);
  assert.equal(autostartSupported({ platform: 'win32', isPackaged: true, env: { PORTABLE_EXECUTABLE_FILE: `${exe}.missing` } }), false);
});

test('setAutostartEnabled writes and removes the stable portable Run entry', () => {
  const exe = tempExe();
  const mock = registryMock();
  const options = { env: { PORTABLE_EXECUTABLE_FILE: exe }, execPath: 'C:\\Temp\\Token Monitor.exe', execFileSync: mock.execFileSync };

  assert.equal(setAutostartEnabled(true, options), true);
  assert.equal(mock.value(), runCommand(exe));
  assert.equal(isAutostartEnabled(options), true);
  assert.ok(mock.calls.some(([, args]) => args[0] === 'add' && args.includes(RUN_KEY) && args.includes(VALUE_NAME)));

  assert.equal(setAutostartEnabled(false, options), false);
  assert.equal(mock.value(), '');
  assert.equal(isAutostartEnabled(options), false);
  assert.ok(mock.calls.some(([, args]) => args[0] === 'delete'));
});
