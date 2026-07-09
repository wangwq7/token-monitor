'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { fetchAntigravityLimits } = require('../../src/shared/limitCollector');

test('fetchAntigravityLimits returns notConfigured when probe says LS not running', async () => {
  const result = await fetchAntigravityLimits({}, {
    antigravityProbe: async () => {
      const err = new Error('not running');
      err.status = 'notConfigured';
      throw err;
    }
  });
  assert.equal(result.provider, 'antigravity');
  assert.equal(result.status, 'notConfigured');
  assert.equal(result.windows.length, 0);
});

test('fetchAntigravityLimits returns ok with 3 weekly windows when probe succeeds', async () => {
  const result = await fetchAntigravityLimits({}, {
    antigravityProbe: async () => ({
      accountPlan: 'Pro',
      accountEmail: 'a@b.com',
      pools: [
        { name: 'Gemini Pro',   remainingFraction: 0.5, resetTime: '2026-06-03T02:00:00Z' },
        { name: 'Gemini Flash', remainingFraction: 0.9, resetTime: '2026-06-03T01:00:00Z' },
        { name: 'Claude',       remainingFraction: 0.7, resetTime: '2026-06-03T04:00:00Z' }
      ]
    })
  });
  assert.equal(result.provider, 'antigravity');
  assert.equal(result.status, 'ok');
  assert.equal(result.source, 'rpc');
  assert.equal(result.accountLabel, 'Pro');
  assert.deepEqual(result.windows.map((w) => w.label), ['Gemini Pro', 'Gemini Flash', 'Claude']);
  for (const window of result.windows) {
    assert.equal(window.kind, 'weekly');
    assert.equal(window.windowMinutes, null);
  }
  assert.equal(Math.round(result.windows[0].usedPercent), 50);
  assert.equal(Math.round(result.windows[1].usedPercent), 10);
  assert.equal(Math.round(result.windows[2].usedPercent), 30);
});

test('fetchAntigravityLimits maps unauthorized errors', async () => {
  const result = await fetchAntigravityLimits({}, {
    antigravityProbe: async () => {
      const err = new Error('401');
      err.status = 'unauthorized';
      throw err;
    }
  });
  assert.equal(result.status, 'unauthorized');
});
