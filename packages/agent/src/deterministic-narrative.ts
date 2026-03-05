import type { AnalysisContext, ReportSection } from '@dolph/shared';
import type { AnalysisInsights } from './analyzer.js';
import { SINGLE_REPORT_SECTIONS, COMPARISON_REPORT_SECTIONS } from './prompts/narrative.js';
import { formatCompactCurrency } from '@dolph/shared';

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

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function fmtRatio(value: number): string {
  return `${value.toFixed(2)}x`;
}

function fmtCurrency(value: number): string {
  return formatCompactCurrency(value, { smallDecimals: 0, compactDecimals: 1 });
}

function metric(insights: AnalysisInsights, name: string): MetricPoint | undefined {
  const m = insights.keyMetrics[name];
  if (!m || !isFinite(m.current)) return undefined;
  return {
    current: m.current,
    prior: m.prior,
    change: m.change,
    unit: m.unit,
  };
}

function extractFacts(insights: AnalysisInsights): NarrativeFacts {
  return {
    revenue: metric(insights, 'Revenue'),
    netIncome: metric(insights, 'Net Income'),
    operatingIncome: metric(insights, 'Operating Income'),
    operatingMargin: metric(insights, 'Operating Margin'),
    netMargin: metric(insights, 'Net Margin'),
    grossMargin: metric(insights, 'Gross Margin'),
    debtToEquity: metric(insights, 'Debt-to-Equity'),
    currentRatio: metric(insights, 'Current Ratio'),
    quickRatio: metric(insights, 'Quick Ratio'),
    operatingCashFlow: metric(insights, 'Operating Cash Flow'),
    freeCashFlow: metric(insights, 'Free Cash Flow'),
    capex: metric(insights, 'Capital Expenditures'),
    roe: metric(insights, 'Return on Equity'),
    roa: metric(insights, 'Return on Assets'),
  };
}

function buildSingleExecutiveSummary(
  ticker: string,
  insights: AnalysisInsights,
): string {
  const f = extractFacts(insights);
  const lines: string[] = [];
  const period = insights.snapshotPeriod || 'latest annual period';

  const thesisParts: string[] = [];
  if (f.revenue && f.netIncome) {
    const revChange = f.revenue.change !== null ? ` (${fmtPct(f.revenue.change)} YoY)` : '';
    const niChange = f.netIncome.change !== null ? ` (${fmtPct(f.netIncome.change)} YoY)` : '';
    thesisParts.push(
      `${ticker} reports ${fmtCurrency(f.revenue.current)} revenue${revChange} and ${fmtCurrency(f.netIncome.current)} net income${niChange} for ${period}.`,
    );
  } else if (f.revenue) {
    thesisParts.push(`${ticker} reports ${fmtCurrency(f.revenue.current)} revenue for ${period}.`);
  }

  if (f.operatingMargin || f.netMargin) {
    const marginBits: string[] = [];
    if (f.operatingMargin) marginBits.push(`operating margin ${fmtPct(f.operatingMargin.current)}`);
    if (f.netMargin) marginBits.push(`net margin ${fmtPct(f.netMargin.current)}`);
    thesisParts.push(`Profitability remains anchored by ${marginBits.join(' and ')}.`);
  }

  if (f.debtToEquity || f.currentRatio) {
    const leverage = f.debtToEquity?.current;
    const liquidity = f.currentRatio?.current;
    if (leverage !== undefined && liquidity !== undefined) {
      if (leverage < 0.3 && liquidity >= 1.5) {
        thesisParts.push(`Balance-sheet posture is conservative (${fmtRatio(leverage)} debt-to-equity, ${fmtRatio(liquidity)} current ratio).`);
      } else if (leverage > 2) {
        thesisParts.push(`Leverage is elevated at ${fmtRatio(leverage)}, making refinancing and rate sensitivity the key watch item.`);
      } else {
        thesisParts.push(`Balance-sheet profile is mixed (${fmtRatio(leverage)} debt-to-equity, ${fmtRatio(liquidity)} current ratio).`);
      }
    }
  }

  if (thesisParts.length === 0) {
    thesisParts.push(`${ticker} has limited period-coherent annual inputs in this run; interpretation should rely on verified statement tables.`);
  }
  lines.push(thesisParts.join(' '));
  lines.push('');

  lines.push('### Profitability');
  if (f.operatingMargin) {
    lines.push(`- Operating margin is ${fmtPct(f.operatingMargin.current)}${formatChangeSuffix(f.operatingMargin.change)}.`);
  }
  if (f.netMargin) {
    lines.push(`- Net margin is ${fmtPct(f.netMargin.current)}${formatChangeSuffix(f.netMargin.change)}.`);
  }
  if (!f.operatingMargin && !f.netMargin) {
    lines.push('- Period-coherent margin inputs are limited in this run.');
  }
  lines.push('');

  lines.push('### Balance Sheet & Liquidity');
  if (f.debtToEquity) {
    lines.push(`- Debt-to-equity is ${fmtRatio(f.debtToEquity.current)}.`);
  }
  if (f.currentRatio) {
    lines.push(`- Current ratio is ${fmtRatio(f.currentRatio.current)}${formatChangeSuffix(f.currentRatio.change)}.`);
  }
  if (f.quickRatio) {
    lines.push(`- Quick ratio is ${fmtRatio(f.quickRatio.current)}.`);
  }
  if (!f.debtToEquity && !f.currentRatio && !f.quickRatio) {
    lines.push('- Balance-sheet liquidity fields are not fully available in this annual snapshot.');
  }
  lines.push('');

  lines.push('### Cash Flow & Risk');
  if (f.operatingCashFlow) {
    lines.push(`- Operating cash flow is ${fmtCurrency(f.operatingCashFlow.current)}${formatChangeSuffix(f.operatingCashFlow.change)}.`);
  }
  if (f.freeCashFlow) {
    lines.push(`- Free cash flow is ${fmtCurrency(f.freeCashFlow.current)}${formatChangeSuffix(f.freeCashFlow.change)}.`);
  }
  if (f.capex) {
    lines.push(`- Capital expenditures are ${fmtCurrency(Math.abs(f.capex.current))}.`);
  }
  if (!f.operatingCashFlow && !f.freeCashFlow) {
    lines.push('- Cash-flow evidence is limited; funding durability should be treated as unresolved.');
  }

  return lines.join('\n');
}

function buildSingleTrendAnalysis(insights: AnalysisInsights): string {
  if (insights.topTrends.length === 0) {
    return 'Annual trend coverage is limited in this run; interpretation relies on current-period statement consistency.';
  }

  const lines: string[] = [];
  for (const trend of insights.topTrends.slice(0, 4)) {
    const cagrText = trend.cagr !== null ? `${fmtPct(trend.cagr)} CAGR` : 'CAGR unavailable';
    const latestText = trend.latestValue !== null
      ? fmtCurrency(trend.latestValue)
      : 'N/A';
    lines.push(`### ${trend.displayName}`);
    lines.push(`${trend.displayName} is currently ${latestText} with ${cagrText}. ${trend.description}`);
    lines.push('');
  }
  return lines.join('\n').trim();
}

function buildSingleRiskFactors(insights: AnalysisInsights): string {
  if (insights.redFlags.length === 0) {
    return [
      '### Watch Items',
      '- No major quantitative red flags are active in the locked annual snapshot.',
      '- Continue monitoring margin durability and cash conversion in the next filing cycle.',
    ].join('\n');
  }

  return [
    '### Watch Items',
    ...insights.redFlags.slice(0, 5).map(flag => `- **${flag.flag}:** ${flag.detail}`),
  ].join('\n');
}

function buildSingleAnalystNotes(
  ticker: string,
  insights: AnalysisInsights,
): string {
  const strengths = insights.strengths.slice(0, 3);
  const flags = insights.redFlags.slice(0, 3);
  const lines: string[] = [];

  lines.push('### What Stands Out');
  if (strengths.length === 0) {
    lines.push(`- ${ticker}'s profile is currently balanced without a dominant quantitative outperformance signal.`);
  } else {
    for (const strength of strengths) {
      lines.push(`- ${strength.detail}`);
    }
  }

  lines.push('');
  lines.push('### Watch Items');
  if (flags.length === 0) {
    lines.push('- No critical flags are active; monitor execution against current margin and cash benchmarks.');
  } else {
    for (const flag of flags) {
      lines.push(`- ${flag.detail}`);
    }
  }

  lines.push('');
  lines.push('### Analyst Interpretation');
  lines.push(`- Current conclusions are anchored to a period-locked annual basis (${insights.snapshotPeriod ?? 'N/A'}).`);
  if (insights.priorPeriod) {
    lines.push(`- Prior comparisons use ${insights.priorPeriod}; metrics without required inputs remain intentionally unfilled.`);
  }

  return lines.join('\n');
}

function buildComparisonExecutiveSummary(
  context: AnalysisContext,
  insights: Record<string, AnalysisInsights>,
): string {
  const summaries = context.tickers.map(t => {
    const i = insights[t];
    const facts = extractFacts(i);
    return {
      ticker: t,
      revenue: facts.revenue?.current ?? null,
      netIncome: facts.netIncome?.current ?? null,
      netMargin: facts.netMargin?.current ?? null,
      debtToEquity: facts.debtToEquity?.current ?? null,
      period: i.snapshotPeriod ?? 'N/A',
    };
  });

  const lines: string[] = ['### Peer Snapshot'];
  for (const s of summaries) {
    const rev = s.revenue !== null ? fmtCurrency(s.revenue) : 'N/A';
    const ni = s.netIncome !== null ? fmtCurrency(s.netIncome) : 'N/A';
    const margin = s.netMargin !== null ? fmtPct(s.netMargin) : 'N/A';
    const de = s.debtToEquity !== null ? fmtRatio(s.debtToEquity) : 'N/A';
    lines.push(`- **${s.ticker}:** Revenue ${rev}, net income ${ni}, net margin ${margin}, debt-to-equity ${de} (period ${s.period}).`);
  }

  const revenueLeader = [...summaries]
    .filter(s => s.revenue !== null)
    .sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0))[0];
  if (revenueLeader) {
    lines.push('');
    lines.push(`**Takeaway:** ${revenueLeader.ticker} is the scale leader by current annual revenue in this peer set.`);
  }

  return lines.join('\n');
}

function buildRelativeStrengths(
  context: AnalysisContext,
  insights: Record<string, AnalysisInsights>,
): string {
  const lines: string[] = [];
  for (const ticker of context.tickers) {
    lines.push(`### ${ticker} — What Stands Out`);
    const strengths = insights[ticker]?.strengths || [];
    if (strengths.length === 0) {
      lines.push(`- No clear quantitative outperformance signal is active for ${ticker} in the current period lock.`);
    } else {
      for (const strength of strengths.slice(0, 4)) {
        lines.push(`- ${strength.detail}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

function buildComparisonRisk(
  context: AnalysisContext,
  insights: Record<string, AnalysisInsights>,
): string {
  const lines = ['### Watch Items'];
  for (const ticker of context.tickers) {
    const flags = insights[ticker]?.redFlags || [];
    if (flags.length === 0) {
      lines.push(`- **${ticker}:** No major quantitative red flag is active in the current annual snapshot.`);
      continue;
    }
    lines.push(`- **${ticker}:** ${flags.slice(0, 2).map(f => f.detail).join(' ')}`);
  }
  return lines.join('\n');
}

function buildComparisonNotes(
  context: AnalysisContext,
  insights: Record<string, AnalysisInsights>,
): string {
  const lines = ['### Analyst Follow-Up'];
  for (const ticker of context.tickers) {
    const strengthCount = insights[ticker]?.strengths.length ?? 0;
    const riskCount = insights[ticker]?.redFlags.length ?? 0;
    lines.push(`- **${ticker}:** ${strengthCount} strength signals and ${riskCount} active risk signals in the locked annual basis.`);
  }
  lines.push('');
  lines.push('Prioritize next-pass work on margin durability, balance-sheet flexibility, and cash conversion differentials across the peer set.');
  return lines.join('\n');
}

function buildNarrativeContent(
  sectionId: string,
  context: AnalysisContext,
  insights: Record<string, AnalysisInsights>,
): string {
  if (context.type === 'single') {
    const ticker = context.tickers[0]!;
    const tickerInsights = insights[ticker] || {
      snapshotPeriod: null,
      priorPeriod: null,
      topTrends: [],
      redFlags: [],
      strengths: [],
      keyMetrics: {},
    };

    switch (sectionId) {
      case 'executive_summary':
        return buildSingleExecutiveSummary(ticker, tickerInsights);
      case 'trend_analysis':
        return buildSingleTrendAnalysis(tickerInsights);
      case 'risk_factors':
        return buildSingleRiskFactors(tickerInsights);
      case 'analyst_notes':
        return buildSingleAnalystNotes(ticker, tickerInsights);
      default:
        return '';
    }
  }

  switch (sectionId) {
    case 'executive_summary':
      return buildComparisonExecutiveSummary(context, insights);
    case 'relative_strengths':
      return buildRelativeStrengths(context, insights);
    case 'risk_factors':
      return buildComparisonRisk(context, insights);
    case 'analyst_notes':
      return buildComparisonNotes(context, insights);
    default:
      return '';
  }
}

export function generateDeterministicNarrative(
  context: AnalysisContext,
  insights: Record<string, AnalysisInsights>,
): { sections: ReportSection[]; llmCallCount: number } {
  const defs = context.type === 'comparison' ? COMPARISON_REPORT_SECTIONS : SINGLE_REPORT_SECTIONS;

  const sections: ReportSection[] = defs.map(def => {
    if (def.deterministic) {
      return { id: def.id, title: def.title, content: '' };
    }
    return {
      id: def.id,
      title: def.title,
      content: buildNarrativeContent(def.id, context, insights).trim(),
    };
  });

  return { sections, llmCallCount: 0 };
}

function formatChangeSuffix(change: number | null): string {
  if (change === null || !isFinite(change)) return '';
  return ` (${fmtPct(change)} YoY)`;
}
