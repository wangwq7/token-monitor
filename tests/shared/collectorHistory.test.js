'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  localTodayKey, collectHistoryOnce, collectUsageOnce, shouldIncludeHistory
} = require('../../src/shared/collector');

test('localTodayKey returns a YYYY-MM-DD string for the given date', () => {
  const key = localTodayKey(new Date(2026, 5, 7, 15, 30)); // local June 7 2026
  assert.equal(key, '2026-06-07');
  assert.match(localTodayKey(), /^\d{4}-\d{2}-\d{2}$/);
});

const SAMPLE_GRAPH = {
  contributions: [
    { date: '2026-06-07', clients: [
      { client: 'claude', modelId: 'opus', tokens: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, reasoning: 0 }, cost: 1, messages: 2 }
    ] }
  ]
};

test('collectHistoryOnce normalizes injected graph JSON into a History', async () => {
  const history = await collectHistoryOnce({
    clients: 'claude', todayKey: '2026-06-07',
    runGraph: async () => SAMPLE_GRAPH
  });
  assert.equal(history.daily.length, 1);
  assert.equal(history.daily[0].tokens, 30);
  assert.equal(history.summary.totalTokens, 30);
});

test('collectHistoryOnce returns null when the graph run throws', async () => {
  const history = await collectHistoryOnce({
    clients: 'claude', todayKey: '2026-06-07',
    runGraph: async () => { throw new Error('boom'); }
  });
  assert.equal(history, null);
});

test('collectHistoryOnce returns null when there are no clients', async () => {
  let called = false;
  const history = await collectHistoryOnce({ clients: '', runGraph: async () => { called = true; return SAMPLE_GRAPH; } });
  assert.equal(history, null);
  assert.equal(called, false);
});

test('collectHistoryOnce skips graph collection when history is disabled', async () => {
  let graphCalled = false;
  const history = await collectHistoryOnce({
    clients: 'claude',
    historyEnabled: false,
    runGraph: async () => { graphCalled = true; return SAMPLE_GRAPH; }
  });
  assert.equal(graphCalled, false);
  assert.equal(history, null);
});

test('collectUsageOnce sends explicit null history when history collection is disabled', async () => {
  const summary = await collectUsageOnce({
    clients: '',
    deviceId: 'device-a',
    historyEnabled: false,
    limitsEnabled: false
  });
  assert.equal(summary.history, null);
});

test('shouldIncludeHistory: first call, throttle window, and force', () => {
  const INT = 15 * 60 * 1000;
  const NOW = 1_000_000_000_000;                                        // realistic epoch ms
  assert.equal(shouldIncludeHistory(NOW, 0, INT, false), true);          // first call: lastAt 0, huge elapsed
  assert.equal(shouldIncludeHistory(NOW, NOW - 900, INT, false), false); // 900ms ago, within window
  assert.equal(shouldIncludeHistory(NOW, NOW - INT, INT, false), true);  // exactly the window elapsed
  assert.equal(shouldIncludeHistory(NOW, NOW - 900, INT, true), true);   // forced
});

test('shouldIncludeHistory returns false when history collection is disabled', () => {
  assert.equal(shouldIncludeHistory(1_000_000_000_000, 0, 0, true, false), false);
});
