'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const charts = require('../../src/electron/renderer/usageCharts');
const {
  clientColors, modelVendorFor, clampDaily,
  dailyBarsChart, horizontalBarsChart, candleChart, contribHeatmap, statsCards,
  barsChartSvg, horizontalBarsChartSvg, candleChartSvg, heatmapSvg, statsCardsHtml, statCardColumnWidths
} = charts;

test('usageCharts exports every symbol app.js destructures from it', () => {
  // Guards against a renderer ReferenceError that node --check / unit tests cannot
  // see because app.js is never executed (it needs the DOM).
  const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'electron', 'renderer', 'app.js'), 'utf8');
  const m = /const \{ ([^}]+) \} = window\.TokenMonitorUsageCharts;/.exec(app);
  assert.ok(m, 'app.js should destructure from window.TokenMonitorUsageCharts');
  for (const name of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
    assert.ok(name in charts, `usageCharts must export "${name}" (app.js destructures it)`);
  }
});

test('clientColors carries the known palette and a default', () => {
  assert.equal(clientColors.claude, '#cc7c5e');
  // Family-color vendors mirror MODEL_FAMILY_COLORS so a provider looks the
  // same in the activity bars, limits rings, tools list, and Settings picker.
  assert.equal(clientColors.codex, '#22a3c2');
  assert.equal(clientColors.deepseek, '#4dbf7e');
  assert.equal(clientColors.grok, '#a3aef5'); // black brand marks are unreadable on the dark surface
  assert.equal(clientColors.cline, '#323B43');
  assert.equal(clientColors.volcengine, '#37a4ff');
  assert.equal(clientColors.qoder, '#2ADB5C');
  assert.equal(typeof clientColors.default, 'string');
});

test('modelVendorFor maps model names onto vendor families', () => {
  assert.equal(modelVendorFor('claude-sonnet-4'), 'claude');
  assert.equal(modelVendorFor('gpt-5'), 'codex');
  assert.equal(modelVendorFor('doubao-seed-1.6'), 'doubao');
  assert.equal(modelVendorFor('totally-unknown'), null);
});

function hueOf(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
  if (d === 0) return 0;
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return h * 360;
}

function luminanceOf(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

test('applyModelFamilyOverrides recolors families, honors picker aliases, and restores defaults', () => {
  const glmDefault = charts.modelDisplayColor('glm-5.2');
  const kimiDefault = charts.modelDisplayColor('kimi-k3');
  try {
    charts.applyModelFamilyOverrides({ zai: '#2255aa', kimi: '#aa2255', bogus: '#123456', broken: 'nope' });
    assert.notEqual(charts.modelDisplayColor('glm-5.2'), glmDefault); // zai family recolored
    assert.notEqual(charts.modelDisplayColor('kimi-k3'), kimiDefault); // picker id "kimi" reaches the moonshot family
  } finally {
    charts.applyModelFamilyOverrides({});
  }
  assert.equal(charts.modelDisplayColor('glm-5.2'), glmDefault); // removal restores the family default
  assert.equal(charts.modelDisplayColor('kimi-k3'), kimiDefault);
});

test('modelDisplayColor gives GLM an orange family and DeepSeek a green family', () => {
  const glm = charts.modelDisplayColor('glm-5.2');
  const glmHue = hueOf(glm);
  assert.ok(glmHue >= 20 && glmHue <= 48, `glm hue ${glmHue} should be orange`);
  const deepseek = charts.modelDisplayColor('deepseek-v4-flash');
  const dsHue = hueOf(deepseek);
  assert.ok(dsHue >= 120 && dsHue <= 170, `deepseek hue ${dsHue} should be green`);
});

test('modelDisplayColor separates gpt tiers by shade within one hue family', () => {
  const mini = charts.modelDisplayColor('gpt-5.4-mini-2026-03-17');
  const pro = charts.modelDisplayColor('gpt-5-pro');
  const mid = charts.modelDisplayColor('gpt-5.5');
  assert.notEqual(mini, pro);
  assert.notEqual(mini, mid);
  const hues = [mini, pro, mid].map(hueOf);
  for (const h of hues) assert.ok(Math.abs(h - hues[0]) < 12, `gpt hues stay in one family: ${hues}`);
  assert.ok(luminanceOf(mini) > luminanceOf(pro), 'mini tier is lighter than pro tier');
});

test('modelDisplayColor never yields dark marks, even for black-branded vendors', () => {
  const surface = luminanceOf('#303438');
  for (const model of [
    'glm-5-max', 'gpt-5-pro', 'deepseek-pro', 'claude-opus-4-6-thinking', 'qwen3-max',
    'kimi-k3-think', 'grok-4-heavy', 'mimo-x4.5', 'cursor-max-auto', 'llama-5-max', 'big-pickle', 'totally-unknown-model'
  ]) {
    const color = charts.modelDisplayColor(model);
    const ratio = (luminanceOf(color) + 0.05) / (surface + 0.05);
    assert.ok(ratio >= 3, `${model} → ${color} contrast ${ratio.toFixed(2)} must be >= 3`);
    assert.equal(charts.modelDisplayColor(model), color); // deterministic
  }
});

test('clampDaily keeps the last N days, or all for falsy/all', () => {
  const daily = Array.from({ length: 40 }, (_, i) => ({ date: `d${i}`, tokens: i }));
  assert.equal(clampDaily(daily, 7).length, 7);
  assert.equal(clampDaily(daily, 30).length, 30);
  assert.equal(clampDaily(daily, 'all').length, 40);
  assert.equal(clampDaily(daily, 0).length, 40);
  assert.deepEqual(clampDaily(daily, 7).map((d) => d.date).slice(0, 1), ['d33']);
});

test('barsChartSvg renders one rect per segment with colorFor fill and a per-bar title', () => {
  const model = dailyBarsChart(
    [{ date: '2026-06-01', perClient: { claude: { tokens: 10 }, codex: { tokens: 5 } } }],
    { width: 100, height: 100, padTop: 0, padRight: 0, padBottom: 0, padLeft: 0, gap: 0, stackBy: 'client', metric: 'tokens' }
  );
  const svg = barsChartSvg(model, {
    colorFor: (k) => clientColors[k] || clientColors.default,
    titleOf: (bar) => `total ${bar.total}`,
    axisLabel: () => ''
  });
  assert.match(svg, /^<svg /);
  assert.equal((svg.match(/class="bar-seg"/g) || []).length, 2); // one shape per stacked segment
  assert.match(svg, /<path d="M[\d.,\sLQZ-]+" fill="#22a3c2" class="bar-seg">/); // top segment gets a rounded-top cap
  assert.equal((svg.match(/class="bar-hover"/g) || []).length, 1); // plus a transparent hover overlay
  assert.match(svg, /fill="#cc7c5e"/);
  assert.match(svg, /<title>total 15<\/title>/);
});

test('barsChartSvg can inset stacked segments to create a visible surface gap', () => {
  const model = dailyBarsChart(
    [{ date: '2026-06-01', perClient: { claude: { tokens: 50 }, codex: { tokens: 50 } } }],
    { width: 100, height: 100, padTop: 0, padRight: 0, padBottom: 0, padLeft: 0, gap: 0, stackBy: 'client', metric: 'tokens' }
  );
  const svg = barsChartSvg(model, { colorFor: (k) => clientColors[k] || clientColors.default, stackGap: 2, axisLabel: () => '' });
  assert.match(svg, /<rect x="0" y="52" width="100" height="48" fill="#cc7c5e" class="bar-seg"><\/rect>/);
  assert.match(svg, /<path d="M0,50 L0,3 Q0,0 3,0/);
});

test('horizontalBarsChartSvg draws date rows with right-rounded stacked ends and hover data', () => {
  const model = horizontalBarsChart([
    { date: '2026-07-10', perClient: { claude: { tokens: 80 }, codex: { tokens: 20 } } }
  ], { width: 200, height: 30, padTop: 0, padRight: 0, padBottom: 0, padLeft: 40, gap: 0 });
  const svg = horizontalBarsChartSvg(model, {
    colorFor: (key) => clientColors[key] || clientColors.default,
    rowLabel: () => '7/10',
    radius: 4,
    stackGap: 2
  });

  assert.match(svg, /class="dash-chart dash-chart-horizontal"/);
  assert.match(svg, /class="axis-label row-axis"[^>]*>7\/10<\/text>/);
  assert.match(svg, /data-d="2026-07-10" data-t="100"/);
  assert.match(svg, /class="bar-track"/);
  assert.match(svg, /<path d="M/);
  // Every stacked run identifies its model for the hover tooltip...
  assert.match(svg, /data-model="claude" data-t="80" data-d="2026-07-10"/);
  assert.match(svg, /data-model="codex" data-t="20" data-d="2026-07-10"/);
  // ...and renders AFTER the row-wide hover rect so the pointer hits the run.
  assert.ok(svg.indexOf('class="bar-hover"') < svg.indexOf('data-model="claude"'), 'segments must render above the row hover target');
});

test('barsChartSvg always emits a data-indexed hover target and draws y-axis ticks on request', () => {
  const model = dailyBarsChart(
    [{ date: '2026-06-01', perClient: { claude: { tokens: 10 } } }, { date: '2026-06-02', perClient: { claude: { tokens: 4 } } }],
    { width: 200, height: 120, stackBy: 'client', metric: 'tokens' }
  );
  // No titleOf -> still a hover rect carrying data-i (drives the custom tooltip).
  const plain = barsChartSvg(model, { colorFor: () => '#fff' });
  assert.match(plain, /class="bar-hover"/);
  assert.match(plain, /data-i="0"/);
  assert.match(plain, /data-i="1"/);
  assert.doesNotMatch(plain, /<title>/);
  // yTicks -> gridlines + y-axis labels.
  const withAxis = barsChartSvg(model, { colorFor: () => '#fff', yTicks: 4, formatTick: (v) => `${v}` });
  assert.equal((withAxis.match(/class="grid-line"/g) || []).length, 5); // 0..4 inclusive
  assert.match(withAxis, /class="axis-label y-axis"/);
});

test('candleChartSvg marks up/down candles and renders a wick + body each', () => {
  const model = candleChart(
    [{ date: '2026-06-01', tokens: 10 }, { date: '2026-06-07', tokens: 30 }],
    { width: 100, height: 100, padTop: 0, padRight: 0, padBottom: 0, padLeft: 0, gap: 0, metric: 'tokens' }
  );
  const svg = candleChartSvg(model, { titleOf: (c) => `o${c.open}c${c.close}`, axisLabel: () => '' });
  assert.match(svg, /candle-body candle-up/);
  assert.match(svg, /<line /);            // wick
  assert.match(svg, /<title>o10c30<\/title>/);
});

test('contribHeatmap spans a fixed window when startDate/endDate are given', () => {
  // Only two days of data, but the window forces a full month-plus grid.
  const model = contribHeatmap([{ date: '2026-06-01', intensity: 4 }], { cell: 10, gap: 2, startDate: '2026-05-01', endDate: '2026-06-07' });
  const dates = model.cells.map((c) => c.date);
  assert.ok(dates.includes('2026-05-01'), 'window start padded in');
  assert.ok(dates.includes('2026-06-07'), 'window end padded in');
  assert.equal(model.cells.find((c) => c.date === '2026-06-01').intensity, 4); // real data preserved
  assert.equal(model.cells.find((c) => c.date === '2026-05-15').intensity, 0); // empty day filled
  assert.ok(model.weeks >= 6);
});

test('heatmapSvg colors cells by intensity level class', () => {
  const model = contribHeatmap([{ date: '2026-06-01', intensity: 4 }, { date: '2026-06-02', intensity: 0 }], { cell: 10, gap: 2 });
  const svg = heatmapSvg(model, { titleOf: (c) => c.date });
  assert.match(svg, /heat lvl-4/);
  assert.match(svg, /heat lvl-0/);
  assert.match(svg, /data-d="2026-06-01"/); // drives the custom hover tooltip
  assert.match(svg, /<title>2026-06-01<\/title>/);
});

test('statsCardsHtml renders a card per descriptor with label + formatted value', () => {
  const cards = statsCards({ totalTokens: 1500, activeDays: 3, favoriteModel: 'opus', messages: 9 });
  const html = statsCardsHtml(cards, { label: (k) => k.toUpperCase(), format: (c) => String(c.value) });
  assert.match(html, /TOTALTOKENS/);
  assert.match(html, /class="dash-card"/);
  assert.equal((html.match(/dash-card"/g) || []).length, cards.length);
});

test('statCardColumnWidths keeps stat cards equal when content fits', () => {
  assert.deepEqual(statCardColumnWidths([90, 110, 120, 95], { totalWidth: 800 }), [200, 200, 200, 200]);
});

test('statCardColumnWidths borrows width only when content exceeds the average column', () => {
  const widths = statCardColumnWidths([120, 220, 104, 96], { totalWidth: 800, minWidth: 120 });
  assert.equal(widths.length, 4);
  assert.equal(Math.round(widths.reduce((sum, width) => sum + width, 0)), 800);
  assert.ok(widths[1] >= 220);
  assert.ok(widths[1] > widths[0]);
  assert.ok(widths[0] >= 190);
  assert.ok(widths[2] >= 190);
  assert.ok(widths[3] >= 190);
});
