'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
// Shared Windows identity: the AppUserModelId (main.js) and the autostart Run
// value are the same string on purpose — one id to find in the registry/shell.
const APP_ID = 'com.javis.tokenmonitor';
const VALUE_NAME = APP_ID;
const RUN_VALUE_PATTERN = new RegExp(`^\\s*${VALUE_NAME.replace(/\./g, '\\.')}\\s+REG_(?:SZ|EXPAND_SZ)\\s+(.+?)\\s*$`);

function executablePath({ env = process.env, execPath = process.execPath } = {}) {
  return String(env.PORTABLE_EXECUTABLE_FILE || execPath || '').trim();
}

function autostartSupported({ platform = process.platform, isPackaged = false, env = process.env, execPath = process.execPath } = {}) {
  if (platform !== 'win32' || !isPackaged) return false;
  const target = executablePath({ env, execPath });
  return Boolean(target && fs.existsSync(target));
}

function runCommand(exePath) {
  return `"${String(exePath).replace(/"/g, '\\"')}" --hidden`;
}

function parseRunValue(output) {
  for (const line of String(output || '').split(/\r?\n/)) {
    const match = RUN_VALUE_PATTERN.exec(line);
    if (match) return match[1];
  }
  return '';
}

function registryValue(options = {}) {
  const execFileSync = options.execFileSync || childProcess.execFileSync;
  try {
    const output = execFileSync('reg.exe', ['query', RUN_KEY, '/v', VALUE_NAME], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
    });
    return parseRunValue(output);
  } catch (_) { return ''; }
}

function isAutostartEnabled(options = {}) {
  const target = executablePath(options);
  if (!target) return false;
  return registryValue(options).toLowerCase() === runCommand(target).toLowerCase();
}

function setAutostartEnabled(enabled, options = {}) {
  const execFileSync = options.execFileSync || childProcess.execFileSync;
  const target = executablePath(options);
  try {
    if (enabled) {
      if (!target || !fs.existsSync(target)) return false;
      execFileSync('reg.exe', ['add', RUN_KEY, '/v', VALUE_NAME, '/t', 'REG_SZ', '/d', runCommand(target), '/f'], {
        windowsHide: true, stdio: 'ignore'
      });
    } else {
      execFileSync('reg.exe', ['delete', RUN_KEY, '/v', VALUE_NAME, '/f'], {
        windowsHide: true, stdio: 'ignore'
      });
    }
  } catch (_) { /* report actual registry state below */ }
  return isAutostartEnabled({ ...options, execFileSync });
}

module.exports = {
  APP_ID,
  RUN_KEY,
  VALUE_NAME,
  autostartSupported,
  executablePath,
  isAutostartEnabled,
  parseRunValue,
  registryValue,
  runCommand,
  setAutostartEnabled
};
