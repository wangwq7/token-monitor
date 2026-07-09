'use strict';

const crypto = require('node:crypto');
const { normalizeLimitProvider } = require('./limits');
const { hashKey } = require('./hashKey');

// 火山方舟控制面 OpenAPI 统一网关（区别于数据面推理域名 ark.cn-beijing.volces.com）。
// 两个 Action 都走它，且都强制火山账号 AK/SK（AccessKey ID + Secret）签名 V4 鉴权--
// 推理用的 ark-... Bearer key 会被网关以 InvalidAuthorization 拒绝。
const VOLCENGINE_OPENAPI_BASE = 'https://open.volcengineapi.com/';
const VOLCENGINE_API_VERSION = '2024-01-01';
const VOLCENGINE_DEFAULT_REGION = 'cn-beijing';
const VOLCENGINE_SERVICE = 'ark';
const VOLCENGINE_SIGNED_HEADERS = 'content-type;host;x-content-sha256;x-date';
const VOLCENGINE_CONTENT_TYPE = 'application/x-www-form-urlencoded; charset=utf-8';

// 保留导出以兼容外部引用（仍指向 GetCodingPlanUsage 的完整 URL）。
const VOLCENGINE_CODING_PLAN_URL = `${VOLCENGINE_OPENAPI_BASE}?Action=GetCodingPlanUsage&Version=${VOLCENGINE_API_VERSION}`;

const VOLCENGINE_SESSION_WINDOW_MINUTES = 5 * 60;
const VOLCENGINE_WEEKLY_WINDOW_MINUTES = 7 * 24 * 60;
const VOLCENGINE_MONTHLY_WINDOW_MINUTES = 30 * 24 * 60;

// Agent Plan (GetAFPUsage) 的三个窗口 -> widget kind。
// AFPDaily 被官方控制台隐藏（其 Quota 常高于周上限，属历史默认值），故跳过。
const AFP_WINDOW_FIELDS = [
  { field: 'AFPFiveHour', kind: 'session', label: '5-hour', windowMinutes: VOLCENGINE_SESSION_WINDOW_MINUTES },
  { field: 'AFPWeekly', kind: 'weekly', label: 'Weekly', windowMinutes: VOLCENGINE_WEEKLY_WINDOW_MINUTES },
  { field: 'AFPMonthly', kind: 'billing', label: 'Monthly', windowMinutes: VOLCENGINE_MONTHLY_WINDOW_MINUTES }
];

function cleanSecret(value) {
  let raw = value;
  if (typeof raw !== 'string') return '';
  raw = raw.trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    raw = raw.slice(1, -1).trim();
  }
  return raw;
}

function pickFirst(env, names) {
  for (const name of names) {
    const value = cleanSecret(env[name]);
    if (value) return value;
  }
  return '';
}

function isVolcengineAccessKeyId(value) {
  return /^AKLT/i.test(String(value || '').trim());
}

// 火山控制面 OpenAPI 额度查询需要火山账号的 AccessKey ID + Secret（与推理 API key 是
// 两套凭据）。这里只产出可用的 signed 凭据；只填了推理 api_key（非 AKLT 开头）或只有
// AK 没有 SK 时返回 null（调用方据此返回 notConfigured）。
function volcengineCredentials(env = process.env, options = {}) {
  const inputKey = cleanSecret(options.volcengineAccessKeyId);
  const secretAccessKey = cleanSecret(options.volcengineSecretAccessKey)
    || pickFirst(env, [
      'VOLCENGINE_SECRET_ACCESS_KEY',
      'VOLCENGINE_SECRET_KEY',
      'VOLCENGINE_ACCESS_KEY_SECRET',
      'VOLC_SECRETKEY',
      'VOLC_SECRET_ACCESS_KEY',
      'DOUBAO_SECRET_ACCESS_KEY'
    ]);
  const region = cleanSecret(options.volcengineRegion)
    || pickFirst(env, ['VOLCENGINE_REGION', 'VOLCENGINE_REGION_ID', 'VOLC_REGION', 'DOUBAO_REGION'])
    || VOLCENGINE_DEFAULT_REGION;
  const envAccessKeyId = pickFirst(env, [
    'VOLCENGINE_ACCESS_KEY_ID',
    'VOLCENGINE_ACCESS_KEY',
    'VOLC_ACCESSKEY',
    'VOLC_ACCESS_KEY_ID',
    'DOUBAO_ACCESS_KEY_ID'
  ]);
  const accessKeyId = inputKey || envAccessKeyId;
  if (accessKeyId && isVolcengineAccessKeyId(accessKeyId) && secretAccessKey) {
    return { mode: 'signed', accessKeyId, secretAccessKey, apiKey: '', region };
  }
  return null;
}

function numberOrNull(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function clampPercent(value) {
  const parsed = numberOrNull(value);
  if (parsed === null) return null;
  return Math.max(0, Math.min(100, parsed));
}

function epochToIso(value) {
  const parsed = numberOrNull(value);
  if (parsed === null || parsed <= 0) return null;
  const date = new Date(parsed < 20_000_000_000 ? parsed * 1000 : parsed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function displayPlanText(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw
    .replace(/^PLAN_TIER_/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace(/\bAi\b/g, 'AI');
}

function volcenginePlanLabel(result, prefix = '') {
  for (const field of ['PlanName', 'planName', 'PlanTier', 'planTier', 'PlanType', 'planType', 'ProductName', 'productName', 'PackageName', 'packageName']) {
    const label = displayPlanText(result?.[field]);
    if (label) return prefix ? `${prefix} ${label}` : label;
  }
  return prefix;
}

// ── Coding Plan (GetCodingPlanUsage)：回百分比 ───────────────
function quotaWindow(quota) {
  const level = String(quota?.Level ?? quota?.level ?? '').trim().toLowerCase();
  const usedPercent = clampPercent(quota?.Percent ?? quota?.percent);
  if (usedPercent === null) return null;
  const resetsAt = epochToIso(quota?.ResetTimestamp ?? quota?.resetTimestamp ?? quota?.ResetTime ?? quota?.reset_time);
  if (['session', '5-hour', 'five_hour', '5h'].includes(level)) {
    return {
      kind: 'session',
      label: '5-hour',
      usedPercent,
      remainingPercent: Math.max(0, Math.min(100, 100 - usedPercent)),
      resetsAt,
      windowMinutes: VOLCENGINE_SESSION_WINDOW_MINUTES,
      showMeter: true
    };
  }
  if (['weekly', 'week'].includes(level)) {
    return {
      kind: 'weekly',
      label: 'Weekly',
      usedPercent,
      remainingPercent: Math.max(0, Math.min(100, 100 - usedPercent)),
      resetsAt,
      windowMinutes: VOLCENGINE_WEEKLY_WINDOW_MINUTES,
      showMeter: true
    };
  }
  if (['monthly', 'month'].includes(level)) {
    return {
      kind: 'billing',
      label: 'Monthly',
      usedPercent,
      remainingPercent: Math.max(0, Math.min(100, 100 - usedPercent)),
      resetsAt,
      windowMinutes: VOLCENGINE_MONTHLY_WINDOW_MINUTES,
      showMeter: true
    };
  }
  return null;
}

function parseVolcengineCodingPlanUsage(body) {
  const result = body?.Result || body?.result || body || {};
  const quotas = Array.isArray(result.QuotaUsage || result.quotaUsage) ? (result.QuotaUsage || result.quotaUsage) : [];
  return {
    status: String(result.Status || result.status || '').trim(),
    plan: volcenginePlanLabel(result, 'Coding Plan'),
    updatedAt: epochToIso(result.UpdateTimestamp ?? result.updateTimestamp),
    windows: quotas.map(quotaWindow).filter(Boolean)
  };
}

// ── Agent Plan (GetAFPUsage)：回绝对额度 Quota/Used ──────────
function parseVolcengineAfpUsage(body) {
  const result = body?.Result || body?.result || body || {};
  const windows = [];
  for (const { field, kind, label, windowMinutes } of AFP_WINDOW_FIELDS) {
    const win = result[field];
    if (!win) continue;
    const quota = numberOrNull(win.Quota ?? win.quota);
    if (quota === null || quota <= 0) continue; // Quota<=0 视为该窗口未订阅
    const used = numberOrNull(win.Used ?? win.used) ?? 0;
    const usedPercent = (used / quota) * 100; // 不做范围裁剪，下游 normalizeLimitWindow 处理
    const resetsAt = epochToIso(win.ResetTime ?? win.resetTime ?? win.ResetTimestamp ?? win.resetTimestamp);
    windows.push({
      kind,
      label,
      usedPercent,
      remainingPercent: Math.max(0, 100 - usedPercent),
      used,
      limit: quota,
      remaining: Math.max(0, quota - used),
      resetsAt,
      windowMinutes,
      showMeter: true
    });
  }
  return {
    status: String(result.Status || result.status || '').trim(),
    plan: volcenginePlanLabel(result, 'Agent Plan'),
    updatedAt: epochToIso(result.UpdateTimestamp ?? result.updateTimestamp),
    windows
  };
}

// ── 火山引擎签名 V4（AK/SK）──────────────────────────────────
// AWS SigV4 的火山变体：canonical headers 用固定顺序、algorithm 串 HMAC-SHA256、
// credential scope 结尾 `request`、签名密钥 kDate=HMAC(SK, date)（SK 不加 AWS4 前缀）。
function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmac(key, message) {
  return crypto.createHmac('sha256', key).update(message).digest();
}

function hmacHex(key, message) {
  return crypto.createHmac('sha256', key).update(message).digest('hex');
}

function formatUtc(date, pattern) {
  const d = date instanceof Date ? date : new Date(date);
  const yyyy = String(d.getUTCFullYear()).padStart(4, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  if (pattern === 'date') return `${yyyy}${mm}${dd}`;
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`;
}

function percentEncode(value, encodeSlash = true) {
  const encoded = encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return encodeSlash ? encoded : encoded.replace(/%2F/g, '/');
}

function canonicalQueryString(url) {
  const pairs = Array.from(url.searchParams.entries()).map(([key, value]) => ({
    key: percentEncode(key),
    value: percentEncode(value)
  }));
  pairs.sort((a, b) => (a.key === b.key ? a.value.localeCompare(b.value) : a.key.localeCompare(b.key)));
  return pairs.map((pair) => `${pair.key}=${pair.value}`).join('&');
}

function signVolcengineRequest({
  url,
  method = 'POST',
  body = '',
  accessKeyId,
  secretAccessKey,
  region = VOLCENGINE_DEFAULT_REGION,
  date = new Date(),
  contentType = VOLCENGINE_CONTENT_TYPE
}) {
  const parsedUrl = new URL(url);
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  const payloadHash = sha256Hex(payload);
  const timestamp = formatUtc(date);
  const dateStamp = formatUtc(date, 'date');
  const host = parsedUrl.host;
  const canonicalRequest = [
    method,
    percentEncode(parsedUrl.pathname || '/', false),
    canonicalQueryString(parsedUrl),
    `content-type:${contentType}`,
    `host:${host}`,
    `x-content-sha256:${payloadHash}`,
    `x-date:${timestamp}`,
    '',
    VOLCENGINE_SIGNED_HEADERS,
    payloadHash
  ].join('\n');
  const credentialScope = `${dateStamp}/${region}/${VOLCENGINE_SERVICE}/request`;
  const stringToSign = [
    'HMAC-SHA256',
    timestamp,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join('\n');
  const dateKey = hmac(Buffer.from(secretAccessKey, 'utf8'), dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, VOLCENGINE_SERVICE);
  const signingKey = hmac(serviceKey, 'request');
  const signature = hmacHex(signingKey, stringToSign);
  return {
    body: payload,
    headers: {
      Accept: 'application/json',
      'Content-Type': contentType,
      Host: host,
      'X-Date': timestamp,
      'X-Content-Sha256': payloadHash,
      Authorization: `HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${VOLCENGINE_SIGNED_HEADERS}, Signature=${signature}`
    }
  };
}

// 构造控制面 OpenAPI URL。query 按 key 字母序拼装，与签名 canonical query 一致。
function buildOpenApiUrl(action, region) {
  const pairs = [
    ['Action', action],
    ['Region', region],
    ['Version', VOLCENGINE_API_VERSION]
  ].sort((a, b) => a[0].localeCompare(b[0]));
  const query = pairs.map(([key, value]) => `${percentEncode(key)}=${percentEncode(value)}`).join('&');
  return `${VOLCENGINE_OPENAPI_BASE}?${query}`;
}

// 提取火山 OpenAPI 响应里的 ResponseMetadata.Error（或顶层 Error）。
function volcengineResponseError(body) {
  const err = body?.ResponseMetadata?.Error || body?.Error || body?.responseMetadata?.error;
  if (!err) return null;
  const code = String(err.Code ?? err.code ?? '').trim();
  const message = String(err.Message ?? err.message ?? '').trim();
  if (!code && !message) return null;
  return { code, message };
}

function isAuthErrorCode(code) {
  const c = String(code || '').toLowerCase();
  return c.includes('auth')
    || c.includes('signature')
    || c.includes('accessdenied')
    || c.includes('denied')
    || c.includes('unauthorized')
    || c.includes('forbidden')
    || c.includes('credential')
    || c.includes('token');
}

// 单次 OpenAPI 调用：签名 + POST 空体，返回解析后的 body；失败抛带 .status 的 Error。
//   - 鉴权类错误（401/403 或业务码含 auth/signature/accessdenied）-> error.status = 'unauthorized'
//   - 其他非 2xx / 业务 Error / 解析失败 -> error.status = 'unavailable'（软错误，可继续 fallback）
function callVolcengineOpenApi(action, credentials, deps, now) {
  const url = buildOpenApiUrl(action, credentials.region);
  const date = new Date(now);
  const signed = signVolcengineRequest({
    url,
    method: 'POST',
    body: '',
    date,
    ...credentials
  });
  return (deps.fetch || fetch)(url, {
    method: 'POST',
    headers: signed.headers,
    body: signed.body
  }).then(async (response) => {
    const text = await response.text().catch(() => '');
    let body = null;
    if (text) body = await Promise.resolve().then(() => JSON.parse(text)).catch(() => null);
    if (response.status === 401 || response.status === 403) {
      const error = new Error(`Volcengine ${action} authentication failed (HTTP ${response.status})`);
      error.status = 'unauthorized';
      throw error;
    }
    const envelopeError = volcengineResponseError(body);
    if (envelopeError && isAuthErrorCode(envelopeError.code)) {
      const error = new Error(`Volcengine ${action} authentication failed (${envelopeError.code}): ${envelopeError.message}`);
      error.status = 'unauthorized';
      throw error;
    }
    if (!response.ok) {
      const detail = envelopeError ? `${envelopeError.code}: ${envelopeError.message}` : text.slice(0, 300);
      const error = new Error(`Volcengine ${action} returned ${response.status}${detail ? ` (${detail})` : ''}`);
      error.status = 'unavailable';
      throw error;
    }
    if (envelopeError) {
      const error = new Error(`Volcengine ${action} API error (${envelopeError.code}): ${envelopeError.message}`);
      error.status = 'unavailable';
      throw error;
    }
    return body || {};
  });
}

// cc-switch 探测顺序：先 GetAFPUsage（Agent Plan），空结果再 fallback GetCodingPlanUsage。
async function fetchVolcengineLimits(options = {}, deps = {}) {
  const env = deps.env || process.env;
  const now = (deps.now || Date.now)();
  const updatedAt = new Date(now).toISOString();
  const credentials = volcengineCredentials(env, options);
  if (!credentials) {
    return normalizeLimitProvider({
      provider: 'volcengine',
      source: 'api',
      status: 'notConfigured',
      updatedAt,
      windows: []
    });
  }

  const accountKey = hashKey('volcengine', credentials.accessKeyId, credentials.region);

  const callPlan = async (action, parser, defaultLabel) => {
    const body = await callVolcengineOpenApi(action, credentials, deps, now);
    const usage = parser(body);
    if (!usage.windows.length) return null; // 已鉴权但无订阅 -> 交回主流程决定是否 fallback
    return normalizeLimitProvider({
      provider: 'volcengine',
      accountKey,
      accountLabel: usage.plan || defaultLabel,
      source: 'api',
      status: 'ok',
      updatedAt: usage.updatedAt || updatedAt,
      windows: usage.windows,
      region: credentials.region
    });
  };

  const softErrors = [];
  try {
    const agent = await callPlan('GetAFPUsage', parseVolcengineAfpUsage, 'Agent Plan');
    if (agent) return agent;
  } catch (error) {
    if (error?.status === 'unauthorized') {
      return normalizeLimitProvider({
        provider: 'volcengine',
        accountKey,
        source: 'api',
        status: 'unauthorized',
        updatedAt,
        windows: [],
        region: credentials.region
      });
    }
    softErrors.push(error?.message || String(error));
  }

  try {
    const coding = await callPlan('GetCodingPlanUsage', parseVolcengineCodingPlanUsage, 'Coding Plan');
    if (coding) return coding;
  } catch (error) {
    if (error?.status === 'unauthorized') {
      return normalizeLimitProvider({
        provider: 'volcengine',
        accountKey,
        source: 'api',
        status: 'unauthorized',
        updatedAt,
        windows: [],
        region: credentials.region
      });
    }
    softErrors.push(error?.message || String(error));
  }

  // 两个 plan 都签名通过但无可解析额度，或都软失败 -> unavailable。
  return normalizeLimitProvider({
    provider: 'volcengine',
    accountKey,
    source: 'api',
    status: softErrors.length ? 'unavailable' : 'unavailable',
    updatedAt,
    windows: [],
    region: credentials.region
  });
}

module.exports = {
  VOLCENGINE_CODING_PLAN_URL,
  volcengineCredentials,
  parseVolcengineAfpUsage,
  parseVolcengineCodingPlanUsage,
  signVolcengineRequest,
  fetchVolcengineLimits
};
