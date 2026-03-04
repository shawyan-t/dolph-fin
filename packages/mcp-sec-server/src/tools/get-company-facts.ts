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

/** Units that should NOT be FX-converted (they aren't monetary values) */
const NON_MONETARY_UNITS = new Set(['pure', 'shares']);

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

  // Extract facts using our XBRL mappings
  const facts: FinancialFact[] = [];

  for (const mapping of XBRL_MAPPINGS) {
    let found = false;

    // Try US-GAAP tags first (most common)
    if (hasUsGaap) {
      for (const tagName of mapping.xbrlTags) {
        const fact = usGaap[tagName];
        if (!fact || !fact.units) continue;

        const periods = extractPeriods(fact, tagName, 'us-gaap', cik);
        if (periods.length > 0) {
          facts.push({ metric: mapping.standardName, periods });
          found = true;
          break;
        }
      }
    }

    // If not found in US-GAAP, try IFRS tags
    if (!found && hasIfrs) {
      for (const tagName of mapping.ifrsTags) {
        const fact = ifrs[tagName];
        if (!fact || !fact.units) continue;

        const periods = extractPeriods(fact, tagName, 'ifrs-full', cik);
        if (periods.length > 0) {
          facts.push({ metric: mapping.standardName, periods });
          found = true;
          break;
        }
      }
    }
  }

  // ── FX Conversion: normalize all non-USD monetary values to USD ──
  const foreignCurrencies = detectForeignCurrencies(facts);
  let fxNote = '';

  if (foreignCurrencies.size > 0) {
    // Fetch conversion rates for all detected currencies
    const rateMap = new Map<string, number>();
    const labels: string[] = [];

    for (const currency of foreignCurrencies) {
      try {
        const rate = await getConversionRate(currency);
        rateMap.set(currency, rate);
        const label = await getFXRateLabel(currency);
        if (label) labels.push(label);
      } catch {
        // If FX conversion fails, leave values unconverted
        console.error(`Warning: Could not fetch FX rate for ${currency}. Values will remain in ${currency}.`);
      }
    }

    // Apply conversion to all facts
    for (const fact of facts) {
      for (const period of fact.periods) {
        const currency = parseCurrency(period.unit);
        if (!currency || currency === 'USD') continue;

        const rate = rateMap.get(currency);
        if (rate) {
          const converted = period.value * rate;
          const decimals = period.unit.includes('/shares') ? 4 : 2;
          const scale = 10 ** decimals;
          period.value = Math.round(converted * scale) / scale;
          // Update unit to reflect USD conversion
          period.unit = period.unit.replace(currency, 'USD');
        }
      }
    }

    fxNote = labels.join('; ');
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
