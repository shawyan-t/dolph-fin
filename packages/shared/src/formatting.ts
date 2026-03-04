/**
 * Shared numeric formatting utilities.
 * Keep all compact financial number output consistent across CLI/PDF/Web.
 */

export interface CompactCurrencyOptions {
  /** Decimal places for absolute values below $1K */
  smallDecimals?: number;
  /** Decimal places for compact K/M/B/T values */
  compactDecimals?: number;
}

export function formatCompactCurrency(
  value: number,
  options: CompactCurrencyOptions = {},
): string {
  if (!isFinite(value)) return 'N/A';

  const smallDecimals = options.smallDecimals ?? 2;
  const compactDecimals = options.compactDecimals ?? 1;
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(compactDecimals)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(compactDecimals)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(compactDecimals)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(compactDecimals)}K`;
  return `${sign}$${abs.toFixed(smallDecimals)}`;
}

export function formatCompactShares(value: number): string {
  if (!isFinite(value)) return 'N/A';

  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(0)}K`;
  return `${sign}${abs.toFixed(0)}`;
}
