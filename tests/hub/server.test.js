'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const { createHub, resolveBindHost } = require('../../src/hub/server');

function tempDataFile() {
  return path.join(os.tmpdir(), `tm-hub-test-${process.pid}-${Math.random().toString(16).slice(2)}.json`);
}

test('resolveBindHost keeps the requested host when a secret is set', () => {
  assert.equal(resolveBindHost('0.0.0.0', 's3cret'), '0.0.0.0');
  assert.equal(resolveBindHost('192.168.1.10', 's3cret'), '192.168.1.10');
});

test('resolveBindHost forces localhost when no secret and a non-loopback host is requested', () => {
  assert.equal(resolveBindHost('0.0.0.0', ''), '127.0.0.1');
  assert.equal(resolveBindHost('192.168.1.10', ''), '127.0.0.1');
  assert.equal(resolveBindHost('', ''), '127.0.0.1');
});

test('resolveBindHost leaves an already-loopback host unchanged without a secret', () => {
  assert.equal(resolveBindHost('127.0.0.1', ''), '127.0.0.1');
  assert.equal(resolveBindHost('localhost', ''), 'localhost');
  assert.equal(resolveBindHost('::1', ''), '::1');
});

test('a hub without a secret binds to localhost only even when asked to bind every interface', async () => {
  const dataFile = tempDataFile();
  const hub = createHub({ port: 0, host: '0.0.0.0', secret: '', dataFile, logger: { error() {}, warn() {} } });
  await hub.start();
  try {
    assert.equal(hub.bindHost, '127.0.0.1');
    assert.equal(hub.server.address().address, '127.0.0.1');
  } finally {
    await hub.stop();
    fs.rmSync(dataFile, { force: true });
  }
});

test('ingest inserts a device and is visible in getStats', () => {
  const dataFile = tempDataFile();
  const hub = createHub({ port: 0, host: '127.0.0.1', secret: '', dataFile, logger: { error() {} } });
  try {
    const record = hub.ingest({ deviceId: 'dev-a', today: { totalTokens: 5, costUsd: 0.1 } });
    assert.equal(record.deviceId, 'dev-a');
    assert.equal(hub.getStats().devices.length, 1);
  } finally {
    fs.rmSync(dataFile, { force: true });
  }
});

test('ingest without a deviceId throws', () => {
  const dataFile = tempDataFile();
  const hub = createHub({ port: 0, host: '127.0.0.1', secret: '', dataFile, logger: { error() {} } });
  try {
    assert.throws(() => hub.ingest({ today: { totalTokens: 1 } }), /deviceId/);
  } finally {
    fs.rmSync(dataFile, { force: true });
  }
});

test('persisted history remains available when the device presence record is stale', () => {
  const dataFile = tempDataFile();
  const old = '2026-06-01T00:00:00.000Z';
  fs.writeFileSync(dataFile, JSON.stringify({
    version: 1,
    devices: {
      'dev-old': {
        deviceId: 'dev-old',
        updatedAt: old,
        receivedAt: old,
        today: { totalTokens: 5 },
        history: {
          daily: [{ date: '2026-06-01', tokens: 42, cost: 1, perClient: {}, perModel: {} }],
          monthly: [{ month: '2026-06', tokens: 42, cost: 1, perClient: {}, perModel: {} }],
          summary: { totalTokens: 42 }
        }
      }
    }
  }));
  const hub = createHub({ port: 0, host: '127.0.0.1', secret: '', staleAfterMs: 10 * 60 * 1000, dataFile, logger: { error() {} } });
  try {
    const stats = hub.getStats();
    assert.equal(stats.devices[0].stale, true); // presence still reports stale
    assert.equal(stats.historyPreview.daily.length, 1);
    assert.equal(stats.historyPreview.daily[0].tokens, 42);
    assert.equal(hub.getHistory().daily[0].tokens, 42);
    // The merged history is cached between reads; a new ingest must invalidate it.
    hub.ingest({
      deviceId: 'dev-old',
      history: {
        daily: [{ date: '2026-06-01', tokens: 50, cost: 1, perClient: {}, perModel: {} }],
        monthly: [{ month: '2026-06', tokens: 50, cost: 1, perClient: {}, perModel: {} }],
        summary: { totalTokens: 50 }
      }
    });
    assert.equal(hub.getHistory().daily[0].tokens, 50);
  } finally {
    fs.rmSync(dataFile, { force: true });
  }
});

test('onStats fires on ingest and on deleteDevice, and unsubscribe stops it', () => {
  const dataFile = tempDataFile();
  const hub = createHub({ port: 0, host: '127.0.0.1', secret: '', dataFile, logger: { error() {} } });
  try {
    let calls = 0;
    let lastDeviceCount = -1;
    const unsub = hub.onStats((stats) => { calls += 1; lastDeviceCount = stats.devices.length; });
    hub.ingest({ deviceId: 'dev-a', today: { totalTokens: 5 } });
    assert.equal(calls, 1);
    assert.equal(lastDeviceCount, 1);
    hub.deleteDevice('dev-a');
    assert.equal(calls, 2);
    assert.equal(lastDeviceCount, 0);
    unsub();
    hub.ingest({ deviceId: 'dev-b', today: { totalTokens: 1 } });
    assert.equal(calls, 2);
  } finally {
    fs.rmSync(dataFile, { force: true });
  }
});
