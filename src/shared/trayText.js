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

  function pickWorstLimit(stats) {
    const providers = stats?.limits?.providers || [];
    let worst = null;
    for (const provider of providers) {
      if (provider.status !== 'ok' || provider.stale) continue;
      for (const window of provider.windows || []) {
        const remaining = Number(window.remainingPercent);
        if (!Number.isFinite(remaining)) continue;
        if (!worst || remaining < worst.remaining) {
          worst = { remaining, provider: provider.provider };
        }
      }
    }
    return worst;
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

  return { formatCompactNumber, pickWorstLimit, formatTrayText };
});
