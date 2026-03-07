/**
 * XBRL data normalizer — transforms raw XBRL company facts
 * into standardized financial statement data.
 *
 * Supports both domestic filers (10-K/10-Q) and foreign filers (20-F/6-K/40-F).
 */

import type { CompanyFacts, FinancialStatement, StatementType, Period } from '@dolph/shared';
import { getMappingsForStatement, getMappingByName } from '@dolph/shared';

/**
 * Annual filing form types in priority order.
 * Domestic: 10-K, Foreign private issuers: 20-F, Canadian: 40-F
 */
const ANNUAL_FORMS = ['10-K', '20-F', '40-F'];
const QUARTERLY_FORMS = ['10-Q', '6-K'];

function yearFromPeriod(period: string): number | null {
  const match = period.match(/^(\d{4})-/);
  return match ? Number.parseInt(match[1]!, 10) : null;
}

function isAnnualFactPeriod(period: CompanyFacts['facts'][number]['periods'][number]): boolean {
  if (!ANNUAL_FORMS.includes(period.form)) return false;
  return period.fiscal_period ? period.fiscal_period === 'FY' : true;
}

function isQuarterlyFactPeriod(period: CompanyFacts['facts'][number]['periods'][number]): boolean {
  if (!QUARTERLY_FORMS.includes(period.form)) return false;
  return period.fiscal_period ? period.fiscal_period !== 'FY' : true;
}

/**
 * Detect which annual form type a company uses by checking their filing data.
 */
function detectAnnualForm(facts: CompanyFacts): string[] {
  const formCounts: Record<string, number> = {};

  for (const fact of facts.facts) {
    for (const period of fact.periods) {
      if (isAnnualFactPeriod(period)) {
        formCounts[period.form] = (formCounts[period.form] || 0) + 1;
      }
    }
  }

  // Return forms sorted by frequency (most data first), falling back to all annual forms
  const detected = Object.entries(formCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([form]) => form);

  return detected.length > 0 ? detected : ANNUAL_FORMS;
}

/**
 * Normalize raw XBRL facts into structured financial statements.
 */
export function normalizeToStatements(
  facts: CompanyFacts,
  statementType: StatementType,
  periodType: Period,
  limit: number = 5,
): FinancialStatement {
  const mappings = getMappingsForStatement(statementType);
  const formFilters = periodType === 'annual'
    ? detectAnnualForm(facts)
    : QUARTERLY_FORMS;

  // Collect all periods across all metrics
  const periodSet = new Set<string>();
  const metricData = new Map<string, Map<string, {
    value: number;
    filed: string;
    form: string;
    fiscal_year?: number;
    fiscal_period?: string;
  }>>();

  for (const mapping of mappings) {
    const fact = facts.facts.find(f => f.metric === mapping.standardName);
    if (!fact) continue;

    const periodMap = new Map<string, {
      value: number;
      filed: string;
      form: string;
      fiscal_year?: number;
      fiscal_period?: string;
    }>();

    for (const period of fact.periods) {
      if (periodType === 'annual') {
        if (!formFilters.includes(period.form) || !isAnnualFactPeriod(period)) continue;
      } else if (!formFilters.includes(period.form) || !isQuarterlyFactPeriod(period)) {
        continue;
      }
      periodSet.add(period.period);
      periodMap.set(period.period, {
        value: period.value,
        filed: period.filed,
        form: period.form,
        fiscal_year: period.fiscal_year,
        fiscal_period: period.fiscal_period,
      });
    }

    if (periodMap.size > 0) {
      metricData.set(mapping.standardName, periodMap);
    }
  }

  // Sort periods descending and take the most recent N
  let sortedPeriods = Array.from(periodSet)
    .sort((a, b) => b.localeCompare(a));

  if (periodType === 'annual') {
    const byYear = new Map<number, string>();
    for (const period of sortedPeriods) {
      const year = yearFromPeriod(period);
      if (year === null || byYear.has(year)) continue;
      byYear.set(year, period);
    }
    sortedPeriods = Array.from(byYear.values()).sort((a, b) => b.localeCompare(a));
  }

  sortedPeriods = sortedPeriods.slice(0, limit);

  // Build output periods
  const periods = sortedPeriods.map(period => {
    const data: Record<string, number> = {};
    let filed = '';
    let form: string | undefined;
    let fiscal_year: number | undefined;
    let fiscal_period: string | undefined;

    for (const [metric, periodMap] of metricData) {
      const entry = periodMap.get(period);
      if (entry) {
        data[metric] = entry.value;
        if (!filed) filed = entry.filed;
        if (!form) form = entry.form;
        if (fiscal_year === undefined && entry.fiscal_year !== undefined) fiscal_year = entry.fiscal_year;
        if (!fiscal_period && entry.fiscal_period) fiscal_period = entry.fiscal_period;
      }
    }

    return { period, filed, form, fiscal_year, fiscal_period, data };
  });

  return {
    ticker: facts.ticker,
    statement_type: statementType,
    period_type: periodType,
    periods,
  };
}

/**
 * Get the latest value for a specific metric from company facts.
 * Tries annual form types in order: 10-K → 20-F → 40-F.
 * If no form specified, returns the most recent value regardless of form.
 */
export function getLatestValue(
  facts: CompanyFacts,
  metricName: string,
  form?: string,
): number | null {
  const fact = facts.facts.find(f => f.metric === metricName);
  if (!fact || fact.periods.length === 0) return null;

  if (form) {
    // If specific form requested, also try foreign equivalents
    const formsToTry = form === '10-K' ? ANNUAL_FORMS
      : form === '10-Q' ? QUARTERLY_FORMS
        : [form];

    for (const f of formsToTry) {
      const match = fact.periods.find(p => (
        p.form === f
        && (f === '10-K' || f === '20-F' || f === '40-F' ? isAnnualFactPeriod(p) : isQuarterlyFactPeriod(p))
      ));
      if (match) return match.value;
    }
    return null;
  }

  return fact.periods[0]?.value ?? null;
}

/**
 * Get values for a metric across N periods.
 * Supports both domestic (10-K/10-Q) and foreign (20-F/6-K) filers.
 */
export function getMetricTimeSeries(
  facts: CompanyFacts,
  metricName: string,
  periodType: Period = 'annual',
  limit: number = 10,
): Array<{ period: string; value: number }> {
  const fact = facts.facts.find(f => f.metric === metricName);
  if (!fact) return [];

  const formFilters = periodType === 'annual'
    ? detectAnnualForm(facts)
    : QUARTERLY_FORMS;
  const filtered = fact.periods
    .filter(p => periodType === 'annual'
      ? formFilters.includes(p.form) && isAnnualFactPeriod(p)
      : formFilters.includes(p.form) && isQuarterlyFactPeriod(p))
    .map(p => ({ period: p.period, value: p.value }));

  if (periodType !== 'annual') {
    return filtered.slice(0, limit);
  }

  // Annual-series hygiene: some annual filings include quarter-level points.
  // Collapse to one representative point per fiscal year.
  const mapping = getMappingByName(metricName);
  const isFlowMetric = mapping?.statement === 'income' || mapping?.statement === 'cash_flow';
  const byYear = new Map<number, { period: string; value: number }>();

  for (const point of filtered) {
    const date = new Date(point.period);
    if (isNaN(date.getTime())) continue;
    const year = date.getUTCFullYear();
    const prev = byYear.get(year);
    if (!prev) {
      byYear.set(year, point);
      continue;
    }

    if (isFlowMetric) {
      const prevAbs = Math.abs(prev.value);
      const nextAbs = Math.abs(point.value);
      if (nextAbs > prevAbs || (nextAbs === prevAbs && point.period > prev.period)) {
        byYear.set(year, point);
      }
      continue;
    }

    if (point.period > prev.period) {
      byYear.set(year, point);
    }
  }

  return Array.from(byYear.values())
    .sort((a, b) => b.period.localeCompare(a.period))
    .slice(0, limit);
}
