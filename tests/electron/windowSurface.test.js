'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const main = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'electron', 'main.js'), 'utf8');

test('app pins the DWM backdrop theme to the widget palette so exposed frames are never white', () => {
  // A light-theme OS draws a WHITE acrylic backdrop; any dropped renderer frame
  // exposes it as a white flash on the desktop widget.
  assert.match(main, /nativeTheme\.themeSource = themePresetsApi\.isLightHex\(source\?\.themeColors\?\.bg\) \? 'light' : 'dark'/);
  assert.match(main, /applyNativeThemeSource\(null\);/); // dark before any window exists
  assert.match(main, /rendererViewState = normalizeInitialRendererViewState\(settings\.lastViewState, rendererViewState\);\s*\n\s*applyNativeThemeSource\(settings\);/);
});

test('desktop-pinned windows opt out of DWM acrylic for a stable opaque surface', () => {
  assert.match(main, /if \(process\.platform === 'win32' && source\?\.windowBehavior === 'desktop'\) return false;/);
});

test('one windowSurface descriptor drives both window factories', () => {
  assert.match(main, /function windowSurface\(source = settings\)/);
  // Acrylic keeps a transparent clear color; only the opaque surface gets a
  // real one, and it comes from the theme so no white frame can be exposed.
  assert.match(main, /\(transparent \|\| glass\)\s*\n?\s*\? '#00000000'/);
  assert.match(main, /themePresetsApi\.isValidHex\(bg\) \? bg : themePresetsApi\.DEFAULT_THEME\.bg/);
  const factoryUses = main.match(/const \{ glass, transparent, backgroundColor \} = windowSurface\(settings\);/g) || [];
  assert.equal(factoryUses.length, 2, 'main window and dashboard window both consume windowSurface');
  assert.doesNotMatch(main, /backgroundColor: '#00000000'/);
});

test('window is rebuilt when the composited surface shape changes', () => {
  assert.match(main, /const previousSurface = windowSurface\(settings\);/);
  assert.match(main, /previousSurface\.glass !== nextSurface\.glass \|\| previousSurface\.transparent !== nextSurface\.transparent/);
});

test('Windows autostart goes through the stable portable-path module, not setLoginItemSettings', () => {
  assert.match(main, /windowsAutostart\.autostartSupported\(\{ isPackaged: app\.isPackaged \}\)/);
  assert.match(main, /windowsAutostart\.isAutostartEnabled\(\)/);
  assert.match(main, /windowsAutostart\.setAutostartEnabled\(Boolean\(startAtLogin\)\)/);
  assert.doesNotMatch(main, /setLoginItemSettings\(\{[^}]*args:/);
  // The shell identity and the Run value share one id.
  assert.match(main, /app\.setAppUserModelId\(windowsAutostart\.APP_ID\)/);
});

test('login-item state is cached so startup and getInfo do not spawn reg.exe repeatedly', () => {
  assert.match(main, /let loginItemStateCache = null;/);
  assert.match(main, /if \(loginItemStateCache !== null\) return loginItemStateCache;/);
  // Applying a change refreshes the cache with the actual resulting state.
  assert.match(main, /loginItemStateCache = state;\s*\n\s*return state;\s*\n\}\s*\n\nfunction syncLoginItemSettingFromOs/);
});
