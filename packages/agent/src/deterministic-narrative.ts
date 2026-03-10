import type {
  AnalysisContext,
  ReportSection,
  StructuredNarrativeParagraph,
  StructuredNarrativePayload,
  StructuredNarrativeSection,
} from '@dolph/shared';
import type { AnalysisInsights } from './analyzer.js';
import type { CanonicalReportPackage } from './canonical-report-package.js';
import type { CompanyReportModel, ReportModel } from './report-model.js';
import { SINGLE_REPORT_SECTIONS, COMPARISON_REPORT_SECTIONS } from './prompts/narrative.js';
import { classifyChangeMeaning, formatCompactCurrency, formatCompactShares } from '@dolph/shared';

interface MetricPoint {
  current: number;
  prior: number | null;
  change: number | null;
  unit: string;
}

interface NarrativeFacts {
  revenue?: MetricPoint;
  netIncome?: MetricPoint;
  operatingIncome?: MetricPoint;
  operatingMargin?: MetricPoint;
  netMargin?: MetricPoint;
  grossMargin?: MetricPoint;
  debtToEquity?: MetricPoint;
  currentRatio?: MetricPoint;
  quickRatio?: MetricPoint;
  operatingCashFlow?: MetricPoint;
  freeCashFlow?: MetricPoint;
  capex?: MetricPoint;
  roe?: MetricPoint;
  roa?: MetricPoint;
}

interface NarrativeSectionBuild {
  content: string;
  paragraphs: StructuredNarrativeParagraph[];
}

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function fmtRatio(value: number): string {
  return `${value.toFixed(2)}x`;
}

function fmtCurrency(value: number): string {
  return formatCompactCurrency(value, { smallDecimals: 0, smartDecimals: true });
}

function fmtValue(value: number, unit: string): string {
  if (unit === '%') return fmtPct(value);
  if (unit === 'x') return fmtRatio(value);
  if (unit === 'USD') return fmtCurrency(value);
  if (unit === 'USD/share' || unit === 'USD/shares') return `$${value.toFixed(2)}`;
  if (unit === 'shares') return formatCompactShares(value);
  return `${value}`;
}

function metric(
  company: CompanyReportModel | null,
  insights: AnalysisInsights,
  name: string,
  key?: string,
): MetricPoint | undefined {
  const byKey = key ? company?.metricsByKey.get(key) : undefined;
  const byLabel = company?.metricsByLabel.get(name);
  const m = byKey || byLabel || insights.keyMetrics[name];
  const current = m?.current;
  if (current === null || current === undefined || !isFinite(current)) return undefined;
  return {
    current,
    prior: m.prior,
    change: m.change,
    unit: m.unit,
  };
}

function extractFacts(company: CompanyReportModel | null, insights: AnalysisInsights): NarrativeFacts {
  return {
    revenue: metric(company, insights, 'Revenue', 'revenue'),
    netIncome: metric(company, insights, 'Net Income', 'net_income'),
    operatingIncome: metric(company, insights, 'Operating Income', 'operating_income'),
    operatingMargin: metric(company, insights, 'Operating Margin', 'operating_margin'),
    netMargin: metric(company, insights, 'Net Margin', 'net_margin'),
    grossMargin: metric(company, insights, 'Gross Margin', 'gross_margin'),
    debtToEquity: metric(company, insights, 'Debt-to-Equity', 'de'),
    currentRatio: metric(company, insights, 'Current Ratio', 'current_ratio'),
    quickRatio: metric(company, insights, 'Quick Ratio', 'quick_ratio'),
    operatingCashFlow: metric(company, insights, 'Operating Cash Flow', 'operating_cash_flow'),
    freeCashFlow: metric(company, insights, 'Free Cash Flow', 'fcf'),
    capex: metric(company, insights, 'Capital Expenditures', 'capex'),
    roe: metric(company, insights, 'Return on Equity', 'roe'),
    roa: metric(company, insights, 'Return on Assets', 'roa'),
  };
}

function sectionFromParagraphs(paragraphs: StructuredNarrativeParagraph[]): NarrativeSectionBuild {
  return {
    content: paragraphs.map(paragraph => paragraph.text).join('\n\n').trim(),
    paragraphs,
  };
}

function sectionFromBlocks(blocks: Array<{ heading?: string; text: string; fact_ids: string[] }>): NarrativeSectionBuild {
  const paragraphs: StructuredNarrativeParagraph[] = [];
  for (const block of blocks) {
    paragraphs.push({ text: block.text, fact_ids: uniqueFactIds(block.fact_ids) });
  }
  return sectionFromParagraphs(paragraphs);
}

function uniqueFactIds(ids: string[]): string[] {
  return Array.from(new Set(ids.filter(Boolean)));
}

function firstAvailableFactIds(
  company: CompanyReportModel | null,
  insights: AnalysisInsights,
  candidates: string[],
): string[] {
  const canonical = insights.canonicalFacts || {};
  const out = candidates.filter(candidate => {
    const companyMetric = company?.metricsByKey.get(candidate);
    if (companyMetric && companyMetric.current !== null) return true;
    return !!canonical[candidate] && canonical[candidate]!.current !== null;
  });
  if (out.length > 0) return uniqueFactIds(out);
  return uniqueFactIds(candidates.filter(candidate => !!canonical[candidate] || !!company?.metricsByKey.get(candidate)));
}

function flagFactIds(flag: string, company: CompanyReportModel | null, insights: AnalysisInsights): string[] {
  const lower = flag.toLowerCase();
  if (lower.includes('leverage') || lower.includes('debt')) return firstAvailableFactIds(company, insights, ['de', 'total_debt', 'stockholders_equity']);
  if (lower.includes('liquidity')) return firstAvailableFactIds(company, insights, ['current_ratio', 'quick_ratio']);
  if (lower.includes('cash')) return firstAvailableFactIds(company, insights, ['operating_cash_flow', 'fcf']);
  if (lower.includes('margin') || lower.includes('profit')) return firstAvailableFactIds(company, insights, ['gross_margin', 'operating_margin', 'net_margin', 'net_income']);
  if (lower.includes('revenue')) return firstAvailableFactIds(company, insights, ['revenue']);
  return firstAvailableFactIds(company, insights, ['revenue', 'net_income']);
}

function strengthFactIds(metricKey: string, company: CompanyReportModel | null, insights: AnalysisInsights): string[] {
  switch (metricKey) {
    case 'revenue_growth':
      return firstAvailableFactIds(company, insights, ['revenue']);
    case 'current_ratio':
      return firstAvailableFactIds(company, insights, ['current_ratio', 'quick_ratio']);
    default:
      return firstAvailableFactIds(company, insights, [metricKey]);
  }
}

function hasMeaningfulChange(point: MetricPoint | undefined): boolean {
  return !!point && point.change !== null && classifyChangeMeaning(point.current, point.prior) === 'ok';
}

function joinSentences(parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => !!part && part.trim().length > 0).join(' ');
}

function shortPeriod(period: string | null | undefined): string {
  return period || 'the reporting period used in this note';
}

function buildSingleExecutiveSummary(
  ticker: string,
  company: CompanyReportModel | null,
  insights: AnalysisInsights,
): NarrativeSectionBuild {
  const f = extractFacts(company, insights);
  const period = shortPeriod(insights.snapshotPeriod);
  const paragraphs: StructuredNarrativeParagraph[] = [];

  const p1Facts = uniqueFactIds([
    ...firstAvailableFactIds(company, insights, ['revenue', 'net_income', 'operating_margin', 'net_margin']),
  ]);
  const p1 = joinSentences([
    f.revenue && f.netIncome
      ? `${ticker} closes ${period} with ${fmtCurrency(f.revenue.current)} of revenue${formatChangeSuffix(f.revenue)} and ${fmtCurrency(f.netIncome.current)} of net income${formatChangeSuffix(f.netIncome)}.`
      : f.revenue
        ? `${ticker} closes ${period} with ${fmtCurrency(f.revenue.current)} of revenue${formatChangeSuffix(f.revenue)}.`
        : `${ticker} has limited top-line disclosure for ${period}, so the report leans more heavily on the verified statement tables than on a simple headline read.`,
    f.operatingMargin && f.netMargin
      ? `The period ended with an operating margin of ${fmtPct(f.operatingMargin.current)} and a net margin of ${fmtPct(f.netMargin.current)}, which frames how much of the reported scale translated into retained profitability.`
      : f.operatingMargin
        ? `The operating margin of ${fmtPct(f.operatingMargin.current)} is the clearest guide to operating efficiency in the reporting period used here.`
        : f.netMargin
          ? `The net margin of ${fmtPct(f.netMargin.current)} is the clearest guide to how much of reported revenue reached the bottom line.`
          : null,
    f.revenue && f.netIncome && hasMeaningfulChange(f.revenue) && hasMeaningfulChange(f.netIncome)
      ? (
        f.revenue.change! > 0 && f.netIncome.change! > 0
          ? (f.operatingMargin && f.operatingMargin.change !== null && f.operatingMargin.change < 0
            ? 'Revenue growth outpaced margin retention, so earnings improved without the same degree of operating efficiency.'
            : 'Revenue and earnings improved together, indicating that the growth story carried through to reported profitability.')
          : (f.revenue.change! > 0 && f.netIncome.change! < 0
            ? 'Top-line growth did not carry through to the bottom line, which points to margin pressure or cost absorption that offset the added scale.'
            : (f.revenue.change! < 0 && f.netIncome.change! > 0
              ? 'Earnings held up better than revenue, suggesting that expense control or mix changes partially offset the softer top line.'
              : 'Revenue and earnings both weakened, leaving the period without a clear offsetting strength on the income statement.'))
      )
      : null,
  ]);
  paragraphs.push({ text: p1, fact_ids: p1Facts });

  const cashStress = !!(
    (f.operatingCashFlow && f.operatingCashFlow.current < 0)
    || (f.freeCashFlow && f.freeCashFlow.current < 0)
  );
  const p2Facts = uniqueFactIds([
    ...firstAvailableFactIds(company, insights, ['operating_cash_flow', 'fcf', 'capex', 'net_income', 'revenue']),
  ]);
  const p2 = joinSentences([
    f.operatingCashFlow && f.freeCashFlow
      ? `Operating cash flow reached ${fmtCurrency(f.operatingCashFlow.current)}${formatChangeSuffix(f.operatingCashFlow)}, and after ${f.capex ? `${fmtCurrency(Math.abs(f.capex.current))} of capital spending` : 'capital spending'} the business produced ${fmtCurrency(f.freeCashFlow.current)} of free cash flow${formatChangeSuffix(f.freeCashFlow)}.`
      : f.operatingCashFlow
        ? `Operating cash flow was ${fmtCurrency(f.operatingCashFlow.current)}${formatChangeSuffix(f.operatingCashFlow)}${f.capex ? `, with capital expenditures of ${fmtCurrency(Math.abs(f.capex.current))}` : ''}.`
        : 'Cash-flow coverage is thinner than the income statement coverage in the locked period, so the balance between earnings and cash conversion requires caution.',
    f.operatingCashFlow && f.netIncome
      ? (() => {
        if (f.netIncome.current <= 0 && f.operatingCashFlow.current > 0) {
          return 'Cash generation held up better than reported earnings, which suggests that non-cash charges or working-capital release softened the impact of weak profitability.';
        }
        if (f.netIncome.current > 0 && f.operatingCashFlow.current <= 0) {
          return 'Reported earnings were not matched by operating cash generation, so the quality of earnings deserves closer attention.';
        }
        if (f.freeCashFlow && f.operatingCashFlow.current > 0 && f.freeCashFlow.current > 0 && f.netIncome.current > 0) {
          const cashConversion = f.operatingCashFlow.current / f.netIncome.current;
          if (cashConversion > 1.2) return 'Cash generation exceeded reported earnings, a sign that the period converted accounting profit into liquidity with relatively little friction.';
          if (cashConversion < 0.7) return 'Operating cash flow lagged reported earnings, which points to working-capital drag or timing effects even though the company stayed profitable.';
        }
        return null;
      })()
      : null,
    f.capex && f.revenue && f.operatingCashFlow
      ? `Capital spending absorbed ${(Math.abs(f.capex.current) / Math.max(Math.abs(f.revenue.current), 1) * 100).toFixed(1)}% of revenue, which helps frame how much internal cash flow remained available after reinvestment.`
      : null,
  ]);
  paragraphs.push({ text: p2, fact_ids: p2Facts });

  const p3Facts = uniqueFactIds([
    ...firstAvailableFactIds(company, insights, ['de', 'current_ratio', 'quick_ratio', 'stockholders_equity']),
  ]);
  const p3 = joinSentences([
    f.debtToEquity && f.currentRatio
      ? (() => {
        if (f.debtToEquity.current < 0) {
          return `Stockholders' equity is negative, which makes the reported debt-to-equity ratio of ${fmtRatio(f.debtToEquity.current)} more a sign of balance-sheet distortion than a conventional leverage read. In that setting, the current ratio of ${fmtRatio(f.currentRatio.current)} is the cleaner short-term solvency reference.`;
        }
        if (f.currentRatio.current < 1 && f.debtToEquity.current < 1) {
          return `The balance sheet presents a mixed picture: leverage is moderate at ${fmtRatio(f.debtToEquity.current)} debt-to-equity, but the current ratio of ${fmtRatio(f.currentRatio.current)} still points to a tight liquidity position.`;
        }
        if (f.currentRatio.current >= 1.5 && f.debtToEquity.current > 2) {
          return `Liquidity appears serviceable at ${fmtRatio(f.currentRatio.current)}, but debt-to-equity of ${fmtRatio(f.debtToEquity.current)} leaves the capital structure more levered than the liquidity ratio alone might suggest.`;
        }
        if (f.currentRatio.current >= 1.5 && !cashStress) {
          return `Liquidity and leverage are both relatively manageable, with a current ratio of ${fmtRatio(f.currentRatio.current)} and debt-to-equity of ${fmtRatio(f.debtToEquity.current)}.`;
        }
        return `Current liquidity of ${fmtRatio(f.currentRatio.current)} and debt-to-equity of ${fmtRatio(f.debtToEquity.current)} point to a balance sheet that is neither clearly stressed nor clearly overcapitalized.`;
      })()
      : f.currentRatio
        ? `On the balance sheet, the current ratio of ${fmtRatio(f.currentRatio.current)} is the clearest short-term solvency reference available for the reporting period used here.`
        : null,
    f.quickRatio && f.currentRatio
      ? (() => {
        const gap = f.currentRatio.current - f.quickRatio.current;
        if (gap > 0.35) {
          return `The quick ratio of ${fmtRatio(f.quickRatio.current)} sits below the current ratio, indicating that inventory or other less-liquid current assets carry part of the coverage burden.`;
        }
        if (Math.abs(gap) <= 0.1) {
          return `The quick ratio of ${fmtRatio(f.quickRatio.current)} sits close to the current ratio, so near-term coverage does not rely heavily on inventory liquidation.`;
        }
        return null;
      })()
      : null,
    cashStress
      ? 'That balance-sheet reading should still be weighed against weak cash generation when operating or free cash flow is negative.'
      : null,
  ]);
  paragraphs.push({ text: p3, fact_ids: p3Facts });

  return sectionFromParagraphs(paragraphs.filter(paragraph => paragraph.text.trim().length > 0));
}

function buildSingleTrendAnalysis(company: CompanyReportModel | null, insights: AnalysisInsights): NarrativeSectionBuild {
  if (insights.topTrends.length === 0) {
    return sectionFromParagraphs([
      {
        text: 'Annual trend coverage is limited in this run; interpretation relies on current-period statement consistency.',
        fact_ids: firstAvailableFactIds(company, insights, ['revenue', 'net_income']),
      },
    ]);
  }
  const f = extractFacts(company, insights);
  const top = insights.topTrends.slice(0, 3);
  const paragraphs: StructuredNarrativeParagraph[] = [];
  const secondaryTrendText = top[1]?.description?.trim() || null;
  const tertiaryTrendText = top[2]?.description?.trim() || null;
  const firstFacts = uniqueFactIds(top.flatMap(trend => [trend.metric]).concat(firstAvailableFactIds(company, insights, ['revenue', 'operating_margin', 'net_income'])));
  const firstText = joinSentences([
    top[0]
      ? `Across the annual periods shown here, ${top[0].displayName.toLowerCase()} provides the clearest recurring pattern, with the latest value at ${top[0].latestValue !== null ? fmtValue(top[0].latestValue, top[0].metric.includes('margin') ? '%' : 'USD') : 'N/A'}${top[0].cagr !== null ? ` and a compound annual growth rate of ${fmtPct(top[0].cagr)}` : ''}.`
      : null,
    secondaryTrendText
      ? `${secondaryTrendText}`
      : null,
    f.revenue && f.operatingMargin && hasMeaningfulChange(f.revenue) && hasMeaningfulChange(f.operatingMargin)
      ? (f.revenue.change! > 0 && f.operatingMargin.change! < 0
        ? 'The main trend relationship is therefore one of scale improving faster than margin retention.'
        : (f.revenue.change! < 0 && f.operatingMargin.change! > 0
          ? 'The main trend relationship is one of weaker scale but better operating discipline.'
          : null))
      : null,
  ]);
  paragraphs.push({ text: firstText, fact_ids: firstFacts });

  const secondFacts = uniqueFactIds(firstAvailableFactIds(company, insights, ['operating_cash_flow', 'fcf', 'de', 'current_ratio']).concat(top[2] ? [top[2].metric] : []));
  const secondText = joinSentences([
    tertiaryTrendText && tertiaryTrendText !== secondaryTrendText ? `${tertiaryTrendText}` : null,
    f.operatingCashFlow && f.freeCashFlow
      ? (f.operatingCashFlow.current > 0 && f.freeCashFlow.current > 0
        ? `Cash generation remained constructive, with ${fmtCurrency(f.operatingCashFlow.current)} of operating cash flow translating into ${fmtCurrency(f.freeCashFlow.current)} of free cash flow.`
        : `Cash generation remains the main point of pressure, with ${fmtCurrency(f.operatingCashFlow.current)} of operating cash flow and ${fmtCurrency(f.freeCashFlow.current)} of free cash flow in the current period.`)
      : null,
    f.debtToEquity && f.currentRatio
      ? `Balance-sheet pressure should be read through both leverage (${fmtRatio(f.debtToEquity.current)} debt-to-equity) and liquidity (${fmtRatio(f.currentRatio.current)} current ratio), because those measures do not always point to the same conclusion about financial flexibility.`
      : null,
  ]);
  paragraphs.push({ text: secondText, fact_ids: secondFacts });

  return sectionFromParagraphs(paragraphs.filter(paragraph => paragraph.text.trim().length > 0));
}

function buildSingleRiskFactors(
  company: CompanyReportModel | null,
  insights: AnalysisInsights,
): NarrativeSectionBuild {
  const f = extractFacts(company, insights);
  if (insights.redFlags.length === 0) {
    return sectionFromParagraphs([{
      text: joinSentences([
        'No single balance-sheet or earnings issue dominates the reporting period used in this note.',
        f.operatingMargin || f.freeCashFlow
          ? `The main areas to monitor remain profitability${f.operatingMargin ? ` at ${fmtPct(f.operatingMargin.current)}` : ''} and free cash flow${f.freeCashFlow ? ` at ${fmtCurrency(f.freeCashFlow.current)}` : ''}, because those lines usually determine whether the balance sheet is strengthening or merely holding steady.`
          : 'Even so, the absence of a hard red flag does not eliminate the need to monitor margin durability, cash conversion, and balance-sheet flexibility.'
      ]),
      fact_ids: firstAvailableFactIds(company, insights, ['operating_margin', 'fcf', 'operating_cash_flow', 'current_ratio']),
    }]);
  }

  const flags = insights.redFlags.slice(0, 4);
  const first = flags.slice(0, 2).map(flag => flag.detail).join(' ');
  const second = flags.slice(2).map(flag => flag.detail).join(' ');
  const paragraphs: StructuredNarrativeParagraph[] = [{
    text: joinSentences([
      'The most important risks in the current numbers are concentrated in the areas where profitability, cash generation, or balance-sheet support are not moving together.',
      first,
    ]),
    fact_ids: uniqueFactIds(flags.slice(0, 2).flatMap(flag => flagFactIds(flag.flag, company, insights))),
  }];
  if (second) {
    paragraphs.push({
      text: second,
      fact_ids: uniqueFactIds(flags.slice(2).flatMap(flag => flagFactIds(flag.flag, company, insights))),
    });
  }
  return sectionFromParagraphs(paragraphs);
}

function buildSingleAnalystNotes(
  ticker: string,
  company: CompanyReportModel | null,
  insights: AnalysisInsights,
): NarrativeSectionBuild {
  const f = extractFacts(company, insights);
  const strengths = insights.strengths.slice(0, 3);
  const paragraphs: StructuredNarrativeParagraph[] = [{
    text: joinSentences([
      strengths.length > 0
        ? `The most constructive part of ${ticker}'s profile is straightforward: ${strengths[0]!.detail}`
        : `${ticker}'s profile does not reduce to a single standout strength or weakness; the more relevant question is how the income statement, cash flow statement, and balance sheet interact.`,
      strengths.length > 1 ? strengths[1]!.detail : null,
      f.debtToEquity && f.currentRatio && f.freeCashFlow
        ? `That matters because leverage (${fmtRatio(f.debtToEquity.current)} debt-to-equity), liquidity (${fmtRatio(f.currentRatio.current)} current ratio), and free cash flow (${fmtCurrency(f.freeCashFlow.current)}) need to be read together rather than in isolation.`
        : null,
    ]),
    fact_ids: uniqueFactIds([
      ...strengths.slice(0, 2).flatMap(strength => strengthFactIds(strength.metric, company, insights)),
      ...firstAvailableFactIds(company, insights, ['de', 'current_ratio', 'fcf']),
    ]),
  }];

  paragraphs.push({
    text: `This note is anchored to the annual period ending ${insights.snapshotPeriod ?? 'N/A'}${insights.priorPeriod ? `, with the prior period set at ${insights.priorPeriod}` : ''}. Metrics without the required statement support remain blank rather than estimated, so the analysis stays tied to the filing evidence rather than to gap-filled assumptions.`,
    fact_ids: firstAvailableFactIds(company, insights, ['revenue', 'net_income', 'current_ratio']),
  });

  return sectionFromParagraphs(paragraphs);
}

function buildComparisonExecutiveSummary(
  context: AnalysisContext,
  reportModel: ReportModel | null,
  insights: Record<string, AnalysisInsights>,
): NarrativeSectionBuild {
  const summaries = context.tickers.map(t => {
    const i = insights[t];
    const company = reportModel?.companiesByTicker.get(t) || null;
    const facts = extractFacts(company, i);
    return {
      ticker: t,
      revenue: facts.revenue?.current ?? null,
      revenueChange: facts.revenue?.change ?? null,
      revenuePrior: facts.revenue?.prior ?? null,
      netIncome: facts.netIncome?.current ?? null,
      netMargin: facts.netMargin?.current ?? null,
      debtToEquity: facts.debtToEquity?.current ?? null,
      freeCashFlow: facts.freeCashFlow?.current ?? null,
      period: i.snapshotPeriod ?? 'N/A',
    };
  });

  const paragraphs: StructuredNarrativeParagraph[] = [];
  const periods = summaries.map(s => s.period).filter(p => p !== 'N/A');
  const uniquePeriods = [...new Set(periods)];
  const periodNote = uniquePeriods.length === 1
    ? `based on ${uniquePeriods[0]} annual filings`
    : `using each company's most recent annual filing`;
  paragraphs.push({
    text: `This comparison of ${context.tickers.join(' and ')} uses ${periodNote.replace(/^using /, '')} and should be read as a comparison of financial profiles rather than as a claim that each company is economically identical.`,
    fact_ids: ['revenue', 'net_income', 'de', 'fcf'],
  });
  for (const s of summaries) {
    paragraphs.push({
      text: joinSentences([
        s.revenue !== null && s.netIncome !== null
        ? `${s.ticker} reports ${fmtCurrency(s.revenue)} of revenue${formatChangeSuffixFromValues(s.revenueChange, s.revenue, s.revenuePrior, 'USD')} and ${fmtCurrency(s.netIncome)} of net income in ${s.period}.`
          : s.revenue !== null
            ? `${s.ticker} reports ${fmtCurrency(s.revenue)} of revenue${formatChangeSuffixFromValues(s.revenueChange, s.revenue, s.revenuePrior, 'USD')} in ${s.period}, although earnings coverage is less complete.`
            : `${s.ticker} has thinner financial disclosure in the reporting period used for this peer set than the rest of the group.`,
        s.netMargin !== null || s.debtToEquity !== null || s.freeCashFlow !== null
          ? `${s.ticker}'s profile is further defined by ${[
            s.netMargin !== null ? `net margin of ${fmtPct(s.netMargin)}` : null,
            s.debtToEquity !== null ? `debt-to-equity of ${fmtRatio(s.debtToEquity)}` : null,
            s.freeCashFlow !== null ? `free cash flow of ${fmtCurrency(s.freeCashFlow)}` : null,
          ].filter(Boolean).join(', ')}.`
          : null,
      ]),
      fact_ids: uniqueFactIds(['revenue', 'net_income', 'net_margin', 'de', 'fcf']),
    });
  }

  const revenueLeader = [...summaries].filter(s => s.revenue !== null).sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0))[0];
  const marginLeader = [...summaries].filter(s => s.netMargin !== null).sort((a, b) => (b.netMargin ?? 0) - (a.netMargin ?? 0))[0];
  if (revenueLeader && marginLeader && revenueLeader.ticker !== marginLeader.ticker) {
    paragraphs.push({
      text: `${revenueLeader.ticker} is the larger company on reported annual revenue, while ${marginLeader.ticker} carries the highest net margin, so scale and efficiency do not point to the same leader.`,
      fact_ids: ['revenue', 'net_margin'],
    });
  } else if (revenueLeader) {
    paragraphs.push({
      text: `${revenueLeader.ticker} is the larger company on reported annual revenue.`,
      fact_ids: ['revenue'],
    });
  }

  const profitable = summaries.filter(s => s.netMargin !== null && s.netMargin > 0);
  const unprofitable = summaries.filter(s => s.netMargin !== null && s.netMargin < 0);
  if (profitable.length > 0 && unprofitable.length > 0) {
    const profitableTickers = profitable.map(s => s.ticker).join(' and ');
    const unprofitableTickers = unprofitable.map(s => s.ticker).join(' and ');
    const profitableVerb = profitable.length > 1 ? 'remain' : 'remains';
    const unprofitableVerb = unprofitable.length > 1 ? 'are' : 'is';
    paragraphs.push({
      text: `${profitableTickers} ${profitableVerb} profitable in the periods used for this note, while ${unprofitableTickers} ${unprofitableVerb} still operating from a weaker earnings base. That split matters because revenue scale alone does not make cash generation and margin structure economically comparable across the group.`,
      fact_ids: ['revenue', 'net_margin', 'fcf'],
    });
  }

  return sectionFromParagraphs(paragraphs);
}

function buildRelativeStrengths(
  context: AnalysisContext,
  reportModel: ReportModel | null,
  insights: Record<string, AnalysisInsights>,
): NarrativeSectionBuild {
  const paragraphs: StructuredNarrativeParagraph[] = [];
  for (const ticker of context.tickers) {
    const strengths = insights[ticker]?.strengths || [];
    const facts = extractFacts(reportModel?.companiesByTicker.get(ticker) || null, insights[ticker]!);
    paragraphs.push({
      text: strengths.length === 0
        ? `${ticker} does not show one clear numerical advantage over the rest of the group, so the comparison depends more on the balance among growth, margins, leverage, and cash generation than on any one ratio.`
        : joinSentences([
          `For ${ticker}, the most favorable feature in the current figures is straightforward: ${strengths[0]!.detail}`,
          strengths[1]?.detail,
          facts.freeCashFlow && facts.debtToEquity
            ? `That picture sits alongside free cash flow of ${fmtCurrency(facts.freeCashFlow.current)} and debt-to-equity of ${fmtRatio(facts.debtToEquity.current)}, which helps show how profitability is balanced against financing risk.`
            : null,
        ]),
      fact_ids: strengths.length === 0
        ? firstAvailableFactIds(reportModel?.companiesByTicker.get(ticker) || null, insights[ticker]!, ['revenue', 'net_income', 'de', 'fcf'])
        : uniqueFactIds(strengths.slice(0, 2).flatMap(strength => strengthFactIds(strength.metric, reportModel?.companiesByTicker.get(ticker) || null, insights[ticker]!))),
    });
  }
  return sectionFromParagraphs(paragraphs);
}

function buildComparisonRisk(
  context: AnalysisContext,
  reportModel: ReportModel | null,
  insights: Record<string, AnalysisInsights>,
): NarrativeSectionBuild {
  const blocks: Array<{ heading?: string; text: string; fact_ids: string[] }> = [{
    text: 'The risk discussion is limited to what each annual filing supports directly, and missing peer metrics are left blank rather than forced into a misleading side-by-side comparison.',
    fact_ids: ['revenue', 'de', 'fcf'],
  }];
  for (const ticker of context.tickers) {
    const flags = insights[ticker]?.redFlags || [];
    if (flags.length === 0) {
      blocks.push({
        text: `${ticker} does not present one dominant financial stress point in the reporting period used here, although that should not be mistaken for a risk-free profile.`,
        fact_ids: firstAvailableFactIds(reportModel?.companiesByTicker.get(ticker) || null, insights[ticker]!, ['revenue', 'net_income']),
      });
      continue;
    }
    blocks.push({
      text: `For ${ticker}, the main areas of financial pressure in the reporting period are as follows. ${flags.slice(0, 2).map(f => f.detail).join(' ')}`,
      fact_ids: uniqueFactIds(flags.slice(0, 2).flatMap(flag => flagFactIds(flag.flag, reportModel?.companiesByTicker.get(ticker) || null, insights[ticker]!))),
    });
  }
  return sectionFromBlocks(blocks);
}

function buildComparisonNotes(
  context: AnalysisContext,
  reportModel: ReportModel | null,
  insights: Record<string, AnalysisInsights>,
): NarrativeSectionBuild {
  const blocks: Array<{ heading?: string; text: string; fact_ids: string[] }> = [{
    text: 'All peer figures are drawn from annual filings. Missing metrics remain blank, so the note should be read as a comparison of what each filing supports rather than as a fully normalized screen.',
    fact_ids: ['revenue', 'net_income', 'de', 'fcf'],
  }];
  for (const ticker of context.tickers) {
    const strengths = insights[ticker]?.strengths ?? [];
    const flags = insights[ticker]?.redFlags ?? [];
    blocks.push({
      text: strengths.length > 0 || flags.length > 0
        ? joinSentences([
          `${ticker} enters the comparison with ${strengths.length > 0 ? 'clear areas of support in the numbers' : 'no obvious financial advantage'} and ${flags.length > 0 ? 'at least one area that deserves caution' : 'no single dominant area of immediate financial stress'}.`,
          strengths[0]?.detail,
          flags[0]?.detail,
        ])
        : `${ticker} enters the comparison without one overwhelming positive or negative feature, so the overall profile has to be judged by how the main statements fit together.`,
      fact_ids: firstAvailableFactIds(reportModel?.companiesByTicker.get(ticker) || null, insights[ticker]!, ['revenue', 'net_income', 'de', 'fcf']),
    });
  }
  return sectionFromBlocks(blocks);
}

function buildNarrativeSection(
  sectionId: string,
  context: AnalysisContext,
  reportModel: ReportModel | null,
  insights: Record<string, AnalysisInsights>,
): NarrativeSectionBuild {
  if (context.type === 'single') {
    const ticker = context.tickers[0]!;
    const tickerInsights = insights[ticker] || {
      snapshotPeriod: null,
      priorPeriod: null,
      topTrends: [],
      redFlags: [],
      strengths: [],
      keyMetrics: {},
      canonicalFacts: {},
    } as AnalysisInsights;
    const company = reportModel?.companiesByTicker.get(ticker) || null;

    switch (sectionId) {
      case 'executive_summary':
        return buildSingleExecutiveSummary(ticker, company, tickerInsights);
      case 'trend_analysis':
        return buildSingleTrendAnalysis(company, tickerInsights);
      case 'risk_factors':
        return buildSingleRiskFactors(company, tickerInsights);
      case 'analyst_notes':
        return buildSingleAnalystNotes(ticker, company, tickerInsights);
      default:
        return sectionFromParagraphs([]);
    }
  }

  switch (sectionId) {
    case 'executive_summary':
      return buildComparisonExecutiveSummary(context, reportModel, insights);
    case 'relative_strengths':
      return buildRelativeStrengths(context, reportModel, insights);
    case 'risk_factors':
      return buildComparisonRisk(context, reportModel, insights);
    case 'analyst_notes':
      return buildComparisonNotes(context, reportModel, insights);
    default:
      return sectionFromParagraphs([]);
  }
}

export function generateDeterministicNarrative(
  contextOrPackage: AnalysisContext | CanonicalReportPackage,
  insightsArg?: Record<string, AnalysisInsights>,
): { sections: ReportSection[]; llmCallCount: number; narrative: StructuredNarrativePayload } {
  const context = isCanonicalPackage(contextOrPackage)
    ? contextOrPackage.context
    : contextOrPackage;
  const insights = isCanonicalPackage(contextOrPackage)
    ? contextOrPackage.insights
    : (insightsArg || {});
  const reportModel = isCanonicalPackage(contextOrPackage)
    ? contextOrPackage.reportModel
    : null;
  const defs = context.type === 'comparison' ? COMPARISON_REPORT_SECTIONS : SINGLE_REPORT_SECTIONS;
  const sections: ReportSection[] = [];
  const narrativeSections: StructuredNarrativeSection[] = [];

  for (const def of defs) {
    if (def.deterministic) {
      sections.push({ id: def.id, title: def.title, content: '' });
      continue;
    }

    const built = buildNarrativeSection(def.id, context, reportModel, insights);
    sections.push({
      id: def.id,
      title: def.title,
      content: built.content.trim(),
    });
    narrativeSections.push({
      id: def.id,
      title: def.title,
      rendered_content: built.content.trim(),
      paragraphs: built.paragraphs,
    });
  }

  return {
    sections,
    llmCallCount: 0,
    narrative: {
      mode: 'deterministic',
      sections: narrativeSections,
    },
  };
}

function isCanonicalPackage(
  value: AnalysisContext | CanonicalReportPackage,
): value is CanonicalReportPackage {
  return typeof value === 'object' && value !== null && 'reportModel' in value && 'insights' in value;
}

function formatChangeSuffix(point: MetricPoint | undefined): string {
  if (!point) return '';
  return formatChangeSuffixFromValues(point.change, point.current, point.prior, point.unit);
}

function formatChangeSuffixFromValues(
  change: number | null,
  current: number | null,
  prior: number | null,
  unit: string,
): string {
  if (change === null || current === null || !isFinite(change) || !isFinite(current)) return '';

  const meaning = classifyChangeMeaning(current, prior);
  if (meaning === 'ok') return ` (${fmtPct(change)} YoY)`;
  if (prior === null || !isFinite(prior)) return '';

  const priorText = fmtValue(prior, unit);
  if (meaning === 'sign_flip') {
    return ` versus ${priorText} in the prior period`;
  }
  if (meaning === 'tiny_base' || meaning === 'zero_base') {
    return ` versus ${priorText} in the prior period (base too small for a meaningful percentage comparison)`;
  }
  return '';
}
