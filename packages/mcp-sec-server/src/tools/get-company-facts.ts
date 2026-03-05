/**
 * Tool: get_company_facts
 * Retrieves structured financial data via XBRL Company Facts API.
 *
 * Supports both US-GAAP (domestic 10-K filers) and IFRS (foreign 20-F filers).
 * Non-USD values are automatically converted to USD using daily exchange rates.
 */

import { z } from 'zod';
import type { CompanyFacts, FinancialFact } from '@dolph/shared';
import {
  SEC_XBRL_COMPANY_FACTS_URL,
  CACHE_TTL_COMPANY_FACTS,
  XBRL_MAPPINGS,
} from '@dolph/shared';
import { resolveCik, getCompanyName } from '../edgar/cik-lookup.js';
import { edgarFetchJson } from '../edgar/client.js';
import { fileCache } from '../cache/file-cache.js';
import { parseCurrency, getConversionRate, getFXRateLabel } from '../utils/fx-rates.js';

export const GetCompanyFactsInput = z.object({
  ticker: z.string().min(1).max(10),
});

export type GetCompanyFactsParams = z.infer<typeof GetCompanyFactsInput>;

interface XBRLFactEntry {
  end: string;
  val: number;
  accn: string;
  fy: number;
  fp: string;
  form: string;
  filed: string;
  frame?: string;
}

interface XBRLFactUnit {
  [unit: string]: XBRLFactEntry[];
}

interface XBRLFact {
  label: string;
  description: string;
  units: XBRLFactUnit;
}

interface XBRLCompanyFacts {
  cik: number;
  entityName: string;
  facts: {
    'us-gaap'?: Record<string, XBRLFact>;
    'ifrs-full'?: Record<string, XBRLFact>;
    dei?: Record<string, XBRLFact>;
  };
}

/**
 * Filing form types accepted for structured financial facts.
 * EXCLUDES 8-K: current reports contain event-driven data (acquisitions,
 * leadership changes) that is too noisy for financial statement metrics.
 */
const ACCEPTED_FORMS = new Set(['10-K', '10-Q', '20-F', '6-K', '40-F']);
const ANNUAL_FORMS = new Set(['10-K', '20-F', '40-F']);
const MAX_STALE_METRIC_YEAR_GAP = 3;

/** Units that should NOT be FX-converted (they aren't monetary values) */
const NON_MONETARY_UNITS = new Set(['pure', 'shares']);
const STRICT_FX_DATA_MODE = process.env['DOLPH_STRICT_FX_MODE'] === '1';

export async function getCompanyFacts(params: GetCompanyFactsParams): Promise<CompanyFacts> {
  const { ticker } = params;
  const cik = await resolveCik(ticker);
  const cacheKey = ticker.toUpperCase();

  // Check cache
  const cached = await fileCache.get<CompanyFacts>('company_facts', cacheKey, CACHE_TTL_COMPANY_FACTS);
  if (cached) return cached;

  // Fetch XBRL data
  const url = SEC_XBRL_COMPANY_FACTS_URL.replace('{cik}', cik);
  const data = await edgarFetchJson<XBRLCompanyFacts>(url);

  const usGaap = data.facts['us-gaap'] || {};
  const ifrs = data.facts['ifrs-full'] || {};
  const companyName = data.entityName || await getCompanyName(ticker);

  // Determine which namespace has data
  const hasUsGaap = Object.keys(usGaap).length > 0;
  const hasIfrs = Object.keys(ifrs).length > 0;
  const globalLatestAnnualYear = getGlobalLatestAnnualYear(usGaap, ifrs);

  // Extract facts using our XBRL mappings
  const facts: FinancialFact[] = [];

  for (const mapping of XBRL_MAPPINGS) {
    let found = false;

    // Try US-GAAP tags first (most common), selecting the freshest/most-complete tag.
    if (hasUsGaap && mapping.xbrlTags.length > 0) {
      const best = selectBestTagPeriods(
        usGaap,
        mapping.xbrlTags,
        'us-gaap',
        cik,
        globalLatestAnnualYear,
      );
      if (best) {
        facts.push({ metric: mapping.standardName, periods: best.periods });
        found = true;
      }
    }

    // If not found in US-GAAP, try IFRS tags with the same freshness heuristic.
    if (!found && hasIfrs && mapping.ifrsTags.length > 0) {
      const best = selectBestTagPeriods(
        ifrs,
        mapping.ifrsTags,
        'ifrs-full',
        cik,
        globalLatestAnnualYear,
      );
      if (best) {
        facts.push({ metric: mapping.standardName, periods: best.periods });
        found = true;
      }
    }
  }

  // ── FX Conversion: normalize all non-USD monetary values to USD ──
  const foreignCurrencies = detectForeignCurrencies(facts);
  let fxNote = '';

  if (foreignCurrencies.size > 0) {
    const rateMap = new Map<string, number>();
    const labelsByCurrency = new Map<string, string>();
    const droppedByCurrency = new Map<string, number>();
    let droppedPoints = 0;

    // Apply conversion to all facts
    for (const fact of facts) {
      const keptPeriods: typeof fact.periods = [];
      for (const period of fact.periods) {
        const currency = parseCurrency(period.unit);
        if (!currency || currency === 'USD') {
          keptPeriods.push(period);
          continue;
        }

        const periodDate = period.period;
        const key = `${currency}:${periodDate}`;
        let rate = rateMap.get(key);
        if (!rate) {
          try {
            rate = await getConversionRate(currency, periodDate);
            rateMap.set(key, rate);
            if (!labelsByCurrency.has(currency)) {
              const label = await getFXRateLabel(currency, periodDate);
              if (label) labelsByCurrency.set(currency, label);
            }
          } catch (err) {
            if (STRICT_FX_DATA_MODE) {
              throw new Error(
                `FX conversion failed for ${ticker.toUpperCase()} ${currency} (${periodDate}) in strict mode: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
            }
            droppedPoints++;
            droppedByCurrency.set(currency, (droppedByCurrency.get(currency) || 0) + 1);
            continue;
          }
        }

        if (rate) {
          const converted = period.value * rate;
          const decimals = period.unit.includes('/shares') ? 4 : 2;
          const scale = 10 ** decimals;
          period.value = Math.round(converted * scale) / scale;
          // Update unit to reflect USD conversion
          period.unit = period.unit.replace(currency, 'USD');
          keptPeriods.push(period);
        }
      }
      fact.periods = keptPeriods;
    }

    // Drop empty metrics so downstream consumers never see non-convertible noise.
    for (let i = facts.length - 1; i >= 0; i--) {
      if ((facts[i]?.periods.length || 0) === 0) {
        facts.splice(i, 1);
      }
    }

    const labels = Array.from(labelsByCurrency.values()).sort();
    if (labels.length > 0) {
      fxNote = `Period-end historical FX conversion applied (${labels.join('; ')})`;
    }
    if (droppedPoints > 0) {
      const droppedStr = Array.from(droppedByCurrency.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([ccy, count]) => `${count} ${ccy}`)
        .join(', ');
      const droppedNote =
        `Excluded ${droppedPoints} data point${droppedPoints === 1 ? '' : 's'} due to unavailable FX conversion` +
        (droppedStr ? ` (${droppedStr})` : '');
      fxNote = fxNote ? `${fxNote}; ${droppedNote}` : droppedNote;
    }
  }

  const result: CompanyFacts = {
    ticker: ticker.toUpperCase(),
    cik,
    company_name: companyName,
    facts,
    ...(fxNote ? { fx_note: fxNote } : {}),
  };

  // Cache (with converted values)
  await fileCache.set('company_facts', cacheKey, result);

  return result;
}

function yearFromPeriod(period: string): number | null {
  const m = period.match(/^(\d{4})-/);
  return m ? parseInt(m[1]!, 10) : null;
}

function getLatestAnnualYearFromPeriods(periods: FinancialFact['periods']): number | null {
  let latest: number | null = null;
  for (const p of periods) {
    if (!ANNUAL_FORMS.has(p.form)) continue;
    const y = yearFromPeriod(p.period);
    if (y === null) continue;
    if (latest === null || y > latest) latest = y;
  }
  return latest;
}

function getGlobalLatestAnnualYear(
  usGaap: Record<string, XBRLFact>,
  ifrs: Record<string, XBRLFact>,
): number | null {
  let latest: number | null = null;
  const updateLatest = (entry: XBRLFactEntry): void => {
    if (!ANNUAL_FORMS.has(entry.form)) return;
    const y = yearFromPeriod(entry.end);
    if (y === null) return;
    if (latest === null || y > latest) latest = y;
  };

  for (const namespace of [usGaap, ifrs]) {
    for (const fact of Object.values(namespace)) {
      if (!fact.units) continue;
      for (const entries of Object.values(fact.units)) {
        for (const entry of entries) updateLatest(entry);
      }
    }
  }

  return latest;
}

interface TagCandidate {
  tagName: string;
  tagRank: number;
  periods: FinancialFact['periods'];
  latestAnnualYear: number | null;
  annualCount: number;
  latestPeriod: string;
}

function selectBestTagPeriods(
  namespaceFacts: Record<string, XBRLFact>,
  tagNames: string[],
  namespace: string,
  cik: string,
  globalLatestAnnualYear: number | null,
): { tagName: string; periods: FinancialFact['periods'] } | null {
  const candidates: TagCandidate[] = [];

  for (const [tagRank, tagName] of tagNames.entries()) {
    const fact = namespaceFacts[tagName];
    if (!fact || !fact.units) continue;
    const periods = extractPeriods(fact, tagName, namespace, cik);
    if (periods.length === 0) continue;

    const latestAnnualYear = getLatestAnnualYearFromPeriods(periods);
    // Discard stale tags for active issuers so we don't surface ancient series
    // as current metrics (e.g., decade-old shares_outstanding/gross_profit).
    if (
      latestAnnualYear !== null &&
      globalLatestAnnualYear !== null &&
      globalLatestAnnualYear - latestAnnualYear > MAX_STALE_METRIC_YEAR_GAP
    ) {
      continue;
    }

    const annualCount = periods.filter(p => ANNUAL_FORMS.has(p.form)).length;
    const latestPeriod = periods[0]?.period || '';
    candidates.push({ tagName, tagRank, periods, latestAnnualYear, annualCount, latestPeriod });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const aAnnual = a.latestAnnualYear ?? -1;
    const bAnnual = b.latestAnnualYear ?? -1;
    if (aAnnual !== bAnnual) return bAnnual - aAnnual;
    if (a.annualCount !== b.annualCount) return b.annualCount - a.annualCount;
    if (a.latestPeriod !== b.latestPeriod) return b.latestPeriod.localeCompare(a.latestPeriod);
    if (a.tagRank !== b.tagRank) return a.tagRank - b.tagRank;
    return b.periods.length - a.periods.length;
  });

  const best = candidates[0]!;
  return { tagName: best.tagName, periods: best.periods };
}

/**
 * Detect all non-USD currencies present in the facts.
 */
function detectForeignCurrencies(facts: FinancialFact[]): Set<string> {
  const currencies = new Set<string>();

  for (const fact of facts) {
    for (const period of fact.periods) {
      if (NON_MONETARY_UNITS.has(period.unit)) continue;
      const currency = parseCurrency(period.unit);
      if (currency && currency !== 'USD') {
        currencies.add(currency);
      }
    }
  }

  return currencies;
}

/**
 * Extract and deduplicate periods from an XBRL fact entry.
 * Evaluates ALL unit buckets and picks the best one:
 * - Prefers currency units (USD, EUR, etc.) over pure/shares
 * - If multiple currency units exist, picks the one with more entries
 */
function extractPeriods(
  fact: XBRLFact,
  tagName: string,
  namespace: string,
  cik: string,
): FinancialFact['periods'] {
  const unitKeys = Object.keys(fact.units);
  if (unitKeys.length === 0) return [];

  // Pick the best unit bucket:
  // 1. Prefer currency units (3-letter ISO codes, not 'pure' or 'shares')
  // 2. Among currencies, pick the one with the most entries
  // 3. Fall back to the first bucket if no currency found
  let bestUnit = unitKeys[0]!;
  let bestScore = 0;

  for (const unit of unitKeys) {
    const baseUnit = unit.split('/')[0]!;
    const isCurrency = /^[A-Z]{3}$/.test(baseUnit) && !NON_MONETARY_UNITS.has(baseUnit);
    const entryCount = (fact.units[unit] || []).length;
    // Score: currency gets 10000 bonus + entry count for tiebreaking
    const score = (isCurrency ? 10000 : 0) + entryCount;

    if (score > bestScore) {
      bestScore = score;
      bestUnit = unit;
    }
  }

  const entries = fact.units[bestUnit] || [];
  const seen = new Set<string>();
  const periods: FinancialFact['periods'] = [];

  for (const entry of entries) {
    if (!ACCEPTED_FORMS.has(entry.form)) continue;

    const periodKey = `${entry.end}-${entry.form}`;
    if (seen.has(periodKey)) continue;
    seen.add(periodKey);

    // Build provenance receipt: exact EDGAR source for this data point
    const accnFormatted = entry.accn.replace(/-/g, '');
    const filingUrl = `https://www.sec.gov/Archives/edgar/data/${cik.replace(/^0+/, '')}/${accnFormatted}/${entry.accn}-index.htm`;

    periods.push({
      period: entry.end,
      value: entry.val,
      unit: bestUnit,
      form: entry.form,
      filed: entry.filed,
      provenance: {
        xbrl_tag: tagName,
        namespace,
        accession_number: entry.accn,
        filing_url: filingUrl,
        extracted_at: new Date().toISOString(),
      },
    });
  }

  // Sort by period descending (most recent first)
  periods.sort((a, b) => b.period.localeCompare(a.period));

  return periods;
}
