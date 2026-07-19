'use strict';

(function exposeTrayText(root, factory) {
  const currency = (typeof require === 'function')
    ? require('./currency')
    : (root && root.TokenMonitorCurrency);
  const api = factory(currency);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TokenMonitorTrayText = api;
})(typeof window !== 'undefined' ? window : null, function createTrayText(currency) {
  const { formatCurrencyFromUsd } = currency;

  function formatCompactNumber(value) {
    const n = Math.round(Number(value) || 0);
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  }

  function limitRemainingPercent(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function limitWindowRemainingPercent(window) {
    const remaining = limitRemainingPercent(window?.remainingPercent);
    if (remaining !== null) return remaining;
    const used = limitRemainingPercent(window?.usedPercent);
    return used === null ? null : 100 - used;
  }

  function trayLimitBarPercents(provider) {
    const windows = provider?.windows || [];
    const quotaPercents = ['session', 'weekly']
      .map((kind) => windows.find((window) => window.kind === kind))
      .map(limitWindowRemainingPercent)
      .filter((remaining) => remaining !== null);
    if (quotaPercents.length > 0) return quotaPercents;
    const billing = windows.find((window) => window.kind === 'billing');
    const billingPercent = limitWindowRemainingPercent(billing);
    return billingPercent === null ? [] : [billingPercent];
  }

  function pickWorstLimitEntry(stats, windowFilter) {
    const providers = stats?.limits?.providers || [];
    let worst = null;
    for (const provider of providers) {
      if (provider.status !== 'ok' || provider.stale) continue;
      for (const window of provider.windows || []) {
        if (windowFilter && !windowFilter(window)) continue;
        const remaining = limitWindowRemainingPercent(window);
        if (remaining === null) continue;
        if (!worst || remaining < worst.remaining) {
          worst = { remaining, provider, window };
        }
      }
    }
    return worst;
  }

  function pickWorstLimitProvider(stats, windowFilter) {
    return pickWorstLimitEntry(stats, windowFilter)?.provider || null;
  }

  function pickWorstLimit(stats) {
    const worst = pickWorstLimitEntry(stats);
    return worst ? { remaining: worst.remaining, provider: worst.provider.provider } : null;
  }

  function formatTrayText(stats, contentMode = 'tokens', currencyCode = 'USD') {
    if (contentMode === 'icon') return '';
    if (contentMode === 'bars' || contentMode === 'barsSession' || contentMode === 'barsWeekly' || contentMode === 'barsAllSessions') {
      // Icon carries all the info; only show text if we have no limit data at all.
      if (pickWorstLimit(stats)) return '';
    }
    const today = stats?.periods?.today || {};
    const allTime = stats?.periods?.allTime || {};
    if (contentMode === 'cost') return formatCurrencyFromUsd(today.costUsd, currencyCode);
    if (contentMode === 'costAll') return formatCurrencyFromUsd(allTime.costUsd, currencyCode);
    if (contentMode === 'tokensAll') return formatCompactNumber(allTime.totalTokens);
    if (contentMode === 'bothAll') return `${formatCompactNumber(allTime.totalTokens)} · ${formatCurrencyFromUsd(allTime.costUsd, currencyCode)}`;
    if (contentMode === 'both') return `${formatCompactNumber(today.totalTokens)} · ${formatCurrencyFromUsd(today.costUsd, currencyCode)}`;
    return formatCompactNumber(today.totalTokens);
  }

  return {
    formatCompactNumber,
    limitRemainingPercent,
    limitWindowRemainingPercent,
    trayLimitBarPercents,
    pickWorstLimitProvider,
    pickWorstLimit,
    formatTrayText
  };
});
