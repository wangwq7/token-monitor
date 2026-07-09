'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  volcengineCredentials,
  parseVolcengineAfpUsage,
  parseVolcengineCodingPlanUsage,
  signVolcengineRequest,
  fetchVolcengineLimits
} = require('../../src/shared/volcengineLimits');

test('volcengineCredentials accepts Volcengine AK/SK signed credentials', () => {
  assert.deepEqual(
    volcengineCredentials({
      VOLCENGINE_ACCESS_KEY_ID: '  "AKLT-env"  ',
      VOLCENGINE_SECRET_ACCESS_KEY: 'sk',
      VOLCENGINE_REGION: 'cn-shanghai'
    }),
    { mode: 'signed', accessKeyId: 'AKLT-env', secretAccessKey: 'sk', apiKey: '', region: 'cn-shanghai' }
  );
  assert.deepEqual(
    volcengineCredentials({}, {
      volcengineAccessKeyId: 'AKLT-settings',
      volcengineSecretAccessKey: 'settings-sk'
    }),
    { mode: 'signed', accessKeyId: 'AKLT-settings', secretAccessKey: 'settings-sk', apiKey: '', region: 'cn-beijing' }
  );
});

test('volcengineCredentials returns null for inference-only API keys', () => {
  // 推理 api_key 不能用于控制面 OpenAPI 额度查询（强制 AK/SK 签名）。
  assert.equal(volcengineCredentials({ ARK_API_KEY: 'ark-env' }), null);
  assert.equal(volcengineCredentials({ VOLCENGINE_ACCESS_KEY_ID: 'ark-env' }), null);
  assert.equal(volcengineCredentials({ VOLCENGINE_SECRET_ACCESS_KEY: 'env-sk' }, { volcengineAccessKeyId: 'ark-settings' }), null);
  // 有 AK 但缺 SK 也不可用。
  assert.equal(volcengineCredentials({ VOLCENGINE_ACCESS_KEY_ID: 'AKLT-env' }), null);
  assert.equal(volcengineCredentials({}, { volcengineAccessKeyId: 'AKLT-x' }), null);
});

test('parseVolcengineCodingPlanUsage maps Volcengine Coding Plan quota windows', () => {
  const usage = parseVolcengineCodingPlanUsage({
    Result: {
      Status: 'Active',
      UpdateTimestamp: 1_783_296_000,
      QuotaUsage: [
        { Level: 'session', Percent: 17, ResetTimestamp: 1_783_314_000 },
        { Level: 'weekly', Percent: 22, ResetTimestamp: 1_783_900_800 },
        { Level: 'monthly', Percent: 31, ResetTimestamp: 1_785_542_400 }
      ]
    }
  });

  assert.equal(usage.status, 'Active');
  assert.equal(usage.plan, 'Coding Plan');
  assert.equal(usage.updatedAt, '2026-07-06T00:00:00.000Z');
  assert.equal(usage.windows.length, 3);
  assert.equal(usage.windows[0].kind, 'session');
  assert.equal(usage.windows[0].label, '5-hour');
  assert.equal(usage.windows[0].usedPercent, 17);
  assert.equal(usage.windows[0].windowMinutes, 5 * 60);
  assert.equal(usage.windows[1].kind, 'weekly');
  assert.equal(usage.windows[1].usedPercent, 22);
  assert.equal(usage.windows[2].kind, 'billing');
  assert.equal(usage.windows[2].label, 'Monthly');
  assert.equal(usage.windows[2].usedPercent, 31);
});

test('parseVolcengineAfpUsage maps Volcengine Agent Plan (GetAFPUsage) windows', () => {
  const usage = parseVolcengineAfpUsage({
    Result: {
      Status: 'Active',
      PlanType: 'Pro',
      UpdateTimestamp: 1_783_296_000,
      AFPFiveHour: { Quota: 1000, Used: 170, ResetTime: 1_783_314_000 },
      AFPWeekly: { Quota: 5000, Used: 1100, ResetTime: 1_783_900_800 },
      AFPMonthly: { Quota: 20000, Used: 6200, ResetTime: 1_785_542_400 }
    }
  });

  assert.equal(usage.status, 'Active');
  assert.equal(usage.plan, 'Agent Plan Pro');
  assert.equal(usage.updatedAt, '2026-07-06T00:00:00.000Z');
  assert.equal(usage.windows.length, 3);
  assert.equal(usage.windows[0].kind, 'session');
  assert.equal(usage.windows[0].label, '5-hour');
  assert.equal(usage.windows[0].usedPercent, 17);
  assert.equal(usage.windows[0].used, 170);
  assert.equal(usage.windows[0].limit, 1000);
  assert.equal(usage.windows[0].remaining, 830);
  assert.equal(usage.windows[1].kind, 'weekly');
  assert.equal(usage.windows[1].usedPercent, 22);
  assert.equal(usage.windows[2].kind, 'billing');
  assert.equal(usage.windows[2].label, 'Monthly');
  assert.equal(usage.windows[2].usedPercent, 31);
});

test('parseVolcengineAfpUsage skips windows with non-positive Quota', () => {
  const usage = parseVolcengineAfpUsage({
    Result: {
      AFPFiveHour: { Quota: 1000, Used: 170 },
      AFPWeekly: { Quota: 0, Used: 0 },
      AFPMonthly: { Used: 5 }
    }
  });
  assert.equal(usage.windows.length, 1);
  assert.equal(usage.windows[0].kind, 'session');
});

test('signVolcengineRequest signs the empty POST body with Volcengine V4 headers', () => {
  const signed = signVolcengineRequest({
    url: 'https://open.volcengineapi.com/?Action=GetCodingPlanUsage&Version=2024-01-01',
    method: 'POST',
    body: '',
    accessKeyId: 'ak',
    secretAccessKey: 'sk',
    region: 'cn-beijing',
    date: new Date('2026-07-06T00:00:00Z')
  });

  assert.equal(signed.headers.Host, 'open.volcengineapi.com');
  assert.equal(signed.headers['X-Date'], '20260706T000000Z');
  assert.equal(signed.headers['X-Content-Sha256'], 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.match(
    signed.headers.Authorization,
    /^HMAC-SHA256 Credential=ak\/20260706\/cn-beijing\/ark\/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=[a-f0-9]{64}$/
  );
});

test('fetchVolcengineLimits returns notConfigured without AK/SK credentials', async () => {
  const provider = await fetchVolcengineLimits({}, { env: {}, now: () => Date.parse('2026-07-06T00:00:00Z') });
  assert.equal(provider.provider, 'volcengine');
  assert.equal(provider.source, 'api');
  assert.equal(provider.status, 'notConfigured');
});

test('fetchVolcengineLimits returns notConfigured with only an inference API key', async () => {
  const requests = [];
  const provider = await fetchVolcengineLimits(
    { volcengineAccessKeyId: 'ark-test' },
    {
      env: {},
      now: () => Date.parse('2026-07-06T00:00:00Z'),
      fetch: async (url, init) => {
        requests.push({ url: String(url), init });
        return { ok: true, status: 200, text: async () => '{}' };
      }
    }
  );
  assert.equal(provider.status, 'notConfigured');
  assert.equal(requests.length, 0);
});

function mockOpenApi(handlerByAction) {
  return async (url) => {
    const parsed = new URL(String(url));
    const action = parsed.searchParams.get('Action');
    const response = handlerByAction(action);
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      text: async () => (typeof response.body === 'string' ? response.body : JSON.stringify(response.body || {}))
    };
  };
}

test('fetchVolcengineLimits queries Agent Plan via GetAFPUsage first', async () => {
  const requests = [];
  const provider = await fetchVolcengineLimits(
    { volcengineAccessKeyId: 'AKLT-test', volcengineSecretAccessKey: 'sk', volcengineRegion: 'cn-beijing' },
    {
      env: {},
      now: () => Date.parse('2026-07-06T00:00:00Z'),
      fetch: mockOpenApi((action) => {
        requests.push(action);
        if (action === 'GetAFPUsage') {
          return {
            status: 200,
            body: {
              Result: {
                Status: 'Active',
                PlanType: 'Pro',
                AFPFiveHour: { Quota: 1000, Used: 170, ResetTime: 1_783_314_000 },
                AFPWeekly: { Quota: 5000, Used: 1100, ResetTime: 1_783_900_800 },
                AFPMonthly: { Quota: 20000, Used: 6200, ResetTime: 1_785_542_400 }
              }
            }
          };
        }
        return { status: 200, body: {} };
      })
    }
  );

  assert.equal(provider.status, 'ok');
  assert.equal(provider.accountLabel, 'Agent Plan Pro');
  assert.equal(provider.windows.length, 3);
  assert.equal(provider.windows[0].kind, 'session');
  assert.equal(provider.windows[0].usedPercent, 17);
  assert.deepEqual(requests, ['GetAFPUsage']);
});

test('fetchVolcengineLimits falls back to Coding Plan when Agent Plan is empty', async () => {
  const requests = [];
  const provider = await fetchVolcengineLimits(
    { volcengineAccessKeyId: 'AKLT-test', volcengineSecretAccessKey: 'sk' },
    {
      env: {},
      now: () => Date.parse('2026-07-06T00:00:00Z'),
      fetch: mockOpenApi((action) => {
        requests.push(action);
        if (action === 'GetAFPUsage') {
          // 已鉴权但无 Agent Plan 订阅（所有窗口 Quota<=0）。
          return { status: 200, body: { Result: { AFPFiveHour: { Quota: 0 } } } };
        }
        return {
          status: 200,
          body: {
            Result: {
              Status: 'Active',
              PlanName: 'ark pro',
              UpdateTimestamp: 1_783_296_000,
              QuotaUsage: [
                { Level: 'session', Percent: 10, ResetTimestamp: 1_783_314_000 }
              ]
            }
          }
        };
      })
    }
  );

  assert.equal(provider.status, 'ok');
  assert.equal(provider.accountLabel, 'Coding Plan Ark Pro');
  assert.equal(provider.windows.length, 1);
  assert.deepEqual(requests, ['GetAFPUsage', 'GetCodingPlanUsage']);
});

test('fetchVolcengineLimits posts the signed Volcengine OpenAPI request', async () => {
  const requests = [];
  const provider = await fetchVolcengineLimits(
    { volcengineAccessKeyId: 'AKLT-test', volcengineSecretAccessKey: 'sk', volcengineRegion: 'cn-beijing' },
    {
      env: {},
      now: () => Date.parse('2026-07-06T00:00:00Z'),
      fetch: async (url, init) => {
        requests.push({ url: String(url), init });
        return { ok: true, status: 200, text: async () => JSON.stringify({ Result: {} }) };
      }
    }
  );

  assert.equal(requests[0].url, 'https://open.volcengineapi.com/?Action=GetAFPUsage&Region=cn-beijing&Version=2024-01-01');
  assert.equal(requests[0].init.method, 'POST');
  assert.match(requests[0].init.headers.Authorization, /^HMAC-SHA256 Credential=AKLT-test\//);
  assert.equal(provider.status, 'unavailable');
  assert.equal(provider.windows.length, 0);
});

test('fetchVolcengineLimits returns unauthorized on HTTP 401', async () => {
  const requests = [];
  const provider = await fetchVolcengineLimits(
    { volcengineAccessKeyId: 'AKLT-test', volcengineSecretAccessKey: 'bad-sk' },
    {
      env: {},
      now: () => Date.parse('2026-07-06T00:00:00Z'),
      fetch: async (url) => {
        requests.push(String(url));
        return { ok: false, status: 401, text: async () => '' };
      }
    }
  );

  assert.equal(provider.status, 'unauthorized');
  // 鉴权类错误硬停，不再尝试 GetCodingPlanUsage。
  assert.equal(requests.length, 1);
  assert.ok(requests[0].includes('Action=GetAFPUsage'));
});

test('fetchVolcengineLimits returns unauthorized on AccessDenied business error', async () => {
  const requests = [];
  const provider = await fetchVolcengineLimits(
    { volcengineAccessKeyId: 'AKLT-test', volcengineSecretAccessKey: 'bad-sk' },
    {
      env: {},
      now: () => Date.parse('2026-07-06T00:00:00Z'),
      fetch: async (url) => {
        requests.push(String(url));
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            ResponseMetadata: { Error: { Code: 'AccessDenied', Message: 'bad signature' } }
          })
        };
      }
    }
  );

  assert.equal(provider.status, 'unauthorized');
  assert.equal(requests.length, 1);
});
