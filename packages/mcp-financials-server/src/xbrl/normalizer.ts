/**
 * XBRL data normalizer — transforms raw XBRL company facts
 * into standardized financial statement data.
 */

import type { CompanyFacts, FinancialStatement, StatementType, Period } from '@filinglens/shared';
import { XBRL_MAPPINGS, getMappingsForStatement } from '@filinglens/shared';

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
  const formFilter = periodType === 'annual' ? '10-K' : '10-Q';

  // Collect all periods across all metrics
  const periodSet = new Set<string>();
  const metricData = new Map<string, Map<string, { value: number; filed: string }>>();

  for (const mapping of mappings) {
    const fact = facts.facts.find(f => f.metric === mapping.standardName);
    if (!fact) continue;

    const periodMap = new Map<string, { value: number; filed: string }>();

    for (const period of fact.periods) {
      if (period.form !== formFilter) continue;
      periodSet.add(period.period);
      periodMap.set(period.period, { value: period.value, filed: period.filed });
    }

    if (periodMap.size > 0) {
      metricData.set(mapping.standardName, periodMap);
    }
  }

  // Sort periods descending and take the most recent N
  const sortedPeriods = Array.from(periodSet)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, limit);

  // Build output periods
  const periods = sortedPeriods.map(period => {
    const data: Record<string, number> = {};
    let filed = '';

    for (const [metric, periodMap] of metricData) {
      const entry = periodMap.get(period);
      if (entry) {
        data[metric] = entry.value;
        if (!filed) filed = entry.filed;
      }
    }

    return { period, filed, data };
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
 * Prefers annual (10-K) data.
 */
export function getLatestValue(
  facts: CompanyFacts,
  metricName: string,
  form?: string,
): number | null {
  const fact = facts.facts.find(f => f.metric === metricName);
  if (!fact || fact.periods.length === 0) return null;

  if (form) {
    const filtered = fact.periods.find(p => p.form === form);
    return filtered?.value ?? null;
  }

  return fact.periods[0]?.value ?? null;
}

/**
 * Get values for a metric across N periods.
 */
export function getMetricTimeSeries(
  facts: CompanyFacts,
  metricName: string,
  periodType: Period = 'annual',
  limit: number = 10,
): Array<{ period: string; value: number }> {
  const fact = facts.facts.find(f => f.metric === metricName);
  if (!fact) return [];

  const formFilter = periodType === 'annual' ? '10-K' : '10-Q';

  return fact.periods
    .filter(p => p.form === formFilter)
    .slice(0, limit)
    .map(p => ({ period: p.period, value: p.value }));
}
