'use strict';

const WINDOW_BEHAVIORS = new Set(['floating', 'normal', 'desktop']);

const WINDOW_BEHAVIOR_PROFILES = {
  floating: {
    mode: 'floating',
    alwaysOnTop: true,
    draggable: true,
    resizable: true,
    focusable: true,
    mousePassthrough: false,
    showInactive: false,
    requiresTrayControl: false,
    // The widget is a tray-style app: it lives in the notification area and
    // never occupies a taskbar slot, in any mode.
    skipTaskbar: true,
    hideOnBlur: false,
    cssClass: ''
  },
  normal: {
    mode: 'normal',
    alwaysOnTop: false,
    draggable: true,
    resizable: true,
    focusable: true,
    mousePassthrough: false,
    showInactive: false,
    requiresTrayControl: false,
    skipTaskbar: true,
    hideOnBlur: false,
    cssClass: ''
  },
  desktop: {
    mode: 'desktop',
    alwaysOnTop: false,
    draggable: true,
    resizable: true,
    focusable: true,
    mousePassthrough: false,
    showInactive: false,
    requiresTrayControl: false,
    // A floating window that tucks away: clicking elsewhere blurs it and it
    // hides to the tray until summoned again. Still draggable/resizable.
    skipTaskbar: true,
    hideOnBlur: true,
    cssClass: 'desktop-mode'
  }
};

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function normalizeWindowBehavior(value, fallback = 'floating') {
  const normalized = String(value || '').trim().toLowerCase();
  if (WINDOW_BEHAVIORS.has(normalized)) return normalized;
  const fallbackMode = String(fallback || '').trim().toLowerCase();
  return WINDOW_BEHAVIORS.has(fallbackMode) ? fallbackMode : 'floating';
}

function modeFromSettings(settings = {}, fallback = 'floating') {
  if (hasOwn(settings, 'windowBehavior')) {
    return normalizeWindowBehavior(settings.windowBehavior, fallback);
  }
  if (hasOwn(settings, 'alwaysOnTop')) {
    return settings.alwaysOnTop ? 'floating' : 'normal';
  }
  return normalizeWindowBehavior(fallback);
}

function describeWindowBehavior(settings = {}) {
  return { ...WINDOW_BEHAVIOR_PROFILES[modeFromSettings(settings)] };
}

function normalizeWindowBehaviorSettings(settings = {}, patch = {}) {
  const merged = { ...settings, ...patch };
  const previousMode = modeFromSettings(settings);
  let mode;
  if (hasOwn(patch, 'windowBehavior')) {
    mode = normalizeWindowBehavior(patch.windowBehavior, previousMode);
  } else if (hasOwn(patch, 'alwaysOnTop')) {
    mode = patch.alwaysOnTop ? 'floating' : 'normal';
  } else {
    mode = modeFromSettings(merged, previousMode);
  }
  const profile = WINDOW_BEHAVIOR_PROFILES[mode];
  return {
    ...merged,
    windowBehavior: profile.mode,
    alwaysOnTop: profile.alwaysOnTop
  };
}

module.exports = {
  describeWindowBehavior,
  normalizeWindowBehavior,
  normalizeWindowBehaviorSettings
};
