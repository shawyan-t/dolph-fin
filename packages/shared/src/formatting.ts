/**
 * Shared numeric formatting utilities.
 * Keep all compact financial number output consistent across CLI/PDF/Web.
 */

export interface CompactCurrencyOptions {
  /** Decimal places for absolute values below $1K */
  smallDecimals?: number;
  /** Decimal places for compact K/M/B/T values */
  compactDecimals?: number;
  /**
   * When true, use dynamic decimal precision based on magnitude:
   *   - Millions >= 10: 0 decimals ($126M)
   *   - Millions < 10: 1 decimal ($3.5M)
   *   - Billions >= 100: 0 decimals ($350B)
   *   - Billions >= 10: 1 decimal ($45.2B)
   *   - Billions < 10: 2 decimals ($1.23B)
   * Overrides compactDecimals when set.
   */
  smartDecimals?: boolean;
}

export type ChangeMeaning = 'ok' | 'missing' | 'zero_base' | 'sign_flip' | 'tiny_base';

export interface ChangeDisplayOptions {
  /** Label used when a percent change is mathematically true but not presentation-safe. */
  notMeaningfulLabel?: string;
  /**
   * Treat changes as not meaningful when the prior-period magnitude is below this
   * share of the larger current/prior magnitude.
   */
  tinyBaseRatio?: number;
}

export function formatCompactCurrency(
  value: number,
  options: CompactCurrencyOptions = {},
): string {
  if (!isFinite(value)) return 'N/A';

  const smallDecimals = options.smallDecimals ?? 2;
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  if (options.smartDecimals) {
    if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(abs >= 1e14 ? 0 : 1)}T`;
    if (abs >= 1e9) {
      const b = abs / 1e9;
      return `${sign}$${b.toFixed(b >= 100 ? 0 : b >= 10 ? 1 : 2)}B`;
    }
    if (abs >= 1e6) {
      const m = abs / 1e6;
      return `${sign}$${m.toFixed(m >= 10 ? 0 : 1)}M`;
    }
    if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
    return `${sign}$${abs.toFixed(smallDecimals)}`;
  }

  const compactDecimals = options.compactDecimals ?? 1;
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(compactDecimals)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(compactDecimals)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(compactDecimals)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(compactDecimals)}K`;
  return `${sign}$${abs.toFixed(smallDecimals)}`;
}

export function classifyChangeMeaning(
  current: number | null | undefined,
  prior: number | null | undefined,
  options: ChangeDisplayOptions = {},
): ChangeMeaning {
  if (current === undefined || current === null || prior === undefined || prior === null) return 'missing';
  if (!isFinite(current) || !isFinite(prior)) return 'missing';
  if (current === 0 && prior === 0) return 'zero_base';
  if (prior === 0) return 'zero_base';

  const absCurrent = Math.abs(current);
  const absPrior = Math.abs(prior);
  const scale = Math.max(absCurrent, absPrior);
  if (scale === 0) return 'zero_base';

  if (current !== 0 && prior !== 0 && Math.sign(current) !== Math.sign(prior)) {
    return 'sign_flip';
  }

  const tinyBaseRatio = options.tinyBaseRatio ?? 0.05;
  if (absPrior < scale * tinyBaseRatio) {
    return 'tiny_base';
  }

  return 'ok';
}

export function formatMetricChange(
  change: number | null | undefined,
  current: number | null | undefined,
  prior: number | null | undefined,
  options: ChangeDisplayOptions = {},
): string {
  if (change === undefined || change === null || !isFinite(change)) return 'N/A';

  const meaning = classifyChangeMeaning(current, prior, options);
  if (meaning !== 'ok') return options.notMeaningfulLabel ?? 'NM';

  return `${(change * 100).toFixed(1)}%`;
}

/**
 * Format a fiscal period end date to a human-readable FY label.
 * Periods ending in Q4 (Oct-Dec) show bare FY{year}.
 * Earlier months include the month abbreviation for clarity.
 *
 * Examples:
 *   "2024-12-31" -> "FY2024"
 *   "2024-10-31" -> "FY2024"
 *   "2024-06-30" -> "FY2024 (Jun)"
 *   "2024-09-28" -> "FY2024 (Sep)"
 */
export function formatFiscalPeriodLabel(period: string): string {
  const date = new Date(period);
  if (isNaN(date.getTime())) return period;

  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1; // 1-indexed

  if (month >= 10) return `FY${year}`;

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];
  return `FY${year} (${monthNames[month - 1]})`;
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
