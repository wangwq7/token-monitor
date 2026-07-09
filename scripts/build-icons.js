#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(ROOT, 'build');
const ICONS_DIR = path.join(BUILD_DIR, 'icons');
const WIN_STAGE_DIR = path.join(BUILD_DIR, '.win-stage');
const MAC_SOURCE = path.join(ROOT, 'assets', 'icon.png');
const WIN_SOURCE = path.join(ROOT, 'assets', 'icon-win.png');
const ICON_BUILDER_CLI = require.resolve('electron-icon-builder/index.js');

function runIconBuilder(input, output) {
  const result = spawnSync(process.execPath, [ICON_BUILDER_CLI, `--input=${input}`, `--output=${output}`, '--flatten'], {
    stdio: 'inherit',
    cwd: ROOT
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

fs.mkdirSync(BUILD_DIR, { recursive: true });
fs.rmSync(WIN_STAGE_DIR, { recursive: true, force: true });

runIconBuilder(MAC_SOURCE, BUILD_DIR);

if (fs.existsSync(WIN_SOURCE)) {
  runIconBuilder(WIN_SOURCE, WIN_STAGE_DIR);
  fs.copyFileSync(path.join(WIN_STAGE_DIR, 'icons', 'icon.ico'), path.join(ICONS_DIR, 'icon.ico'));
  fs.rmSync(WIN_STAGE_DIR, { recursive: true, force: true });
  console.log('Built icons: .icns from assets/icon.png, .ico from assets/icon-win.png');
} else {
  console.warn('assets/icon-win.png not found — .ico will use the macOS source (less ideal on Windows)');
}
