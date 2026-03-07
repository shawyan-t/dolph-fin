import type {
  AnalysisContext,
  ReportSection,
  StructuredNarrativeParagraph,
  StructuredNarrativePayload,
  StructuredNarrativeSection,
} from '@dolph/shared';
import type { AnalysisInsights } from './analyzer.js';
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

function sectionFromParagraphs(paragraphs: StructuredNarrativeParagraph[]): NarrativeSectionBuild {
  return {
    content: paragraphs.map(paragraph => paragraph.text).join('\n\n').trim(),
    paragraphs,
  };
}

function sectionFromBlocks(blocks: Array<{ heading?: string; text: string; fact_ids: string[] }>): NarrativeSectionBuild {
  const parts: string[] = [];
  const paragraphs: StructuredNarrativeParagraph[] = [];
  for (const block of blocks) {
    if (block.heading) {
      parts.push(block.heading);
    }
    parts.push(block.text);
    paragraphs.push({ text: block.text, fact_ids: uniqueFactIds(block.fact_ids) });
    if (block.heading) {
      parts.push('');
    }
  }
  return {
    content: parts.join('\n').trim(),
    paragraphs,
  };
}

function bullet(text: string): string {
  return `- ${text}`;
}

function uniqueFactIds(ids: string[]): string[] {
  return Array.from(new Set(ids.filter(Boolean)));
}

function firstAvailableFactIds(insights: AnalysisInsights, candidates: string[]): string[] {
  const canonical = insights.canonicalFacts || {};
  const out = candidates.filter(candidate => canonical[candidate]);
  return out.length > 0 ? uniqueFactIds(out) : Object.keys(canonical).slice(0, 2);
}

function flagFactIds(flag: string, insights: AnalysisInsights): string[] {
  const lower = flag.toLowerCase();
  if (lower.includes('leverage') || lower.includes('debt')) return firstAvailableFactIds(insights, ['de', 'total_debt', 'stockholders_equity']);
  if (lower.includes('liquidity')) return firstAvailableFactIds(insights, ['current_ratio', 'quick_ratio']);
  if (lower.includes('cash')) return firstAvailableFactIds(insights, ['operating_cash_flow', 'fcf']);
  if (lower.includes('margin') || lower.includes('profit')) return firstAvailableFactIds(insights, ['gross_margin', 'operating_margin', 'net_margin', 'net_income']);
  if (lower.includes('revenue')) return firstAvailableFactIds(insights, ['revenue']);
  return firstAvailableFactIds(insights, ['revenue', 'net_income']);
}

function strengthFactIds(metricKey: string, insights: AnalysisInsights): string[] {
  switch (metricKey) {
    case 'revenue_growth':
      return firstAvailableFactIds(insights, ['revenue']);
    case 'current_ratio':
      return firstAvailableFactIds(insights, ['current_ratio', 'quick_ratio']);
    default:
      return firstAvailableFactIds(insights, [metricKey]);
  }
}

function buildSingleExecutiveSummary(
  ticker: string,
  insights: AnalysisInsights,
): NarrativeSectionBuild {
  const f = extractFacts(insights);
  const period = insights.snapshotPeriod || 'latest annual period';
  const paragraphs: StructuredNarrativeParagraph[] = [];

  const p1Parts: string[] = [];
  const p1Facts: string[] = [];
  if (f.revenue && f.netIncome) {
    p1Parts.push(
      `${ticker} posted ${fmtCurrency(f.revenue.current)} in revenue${formatChangeSuffix(f.revenue)} and ${fmtCurrency(f.netIncome.current)} in net income${formatChangeSuffix(f.netIncome)} for ${period}.`,
    );
    p1Facts.push('revenue', 'net_income');
    const revenueChangeIsMeaningful = classifyChangeMeaning(f.revenue.current, f.revenue.prior) === 'ok';
    const netIncomeChangeIsMeaningful = classifyChangeMeaning(f.netIncome.current, f.netIncome.prior) === 'ok';
    if (f.revenue.change !== null && f.netIncome.change !== null && revenueChangeIsMeaningful && netIncomeChangeIsMeaningful) {
      if (f.revenue.change > 0.1 && f.netIncome.change > 0.1) {
        p1Parts.push('Both top-line and bottom-line expansion signal broad-based operational momentum, suggesting the company is capturing demand while maintaining or improving cost discipline.');
      } else if (f.revenue.change > 0.05 && f.netIncome.change < -0.05) {
        p1Parts.push('Revenue growth coupled with declining net income suggests margin pressure or rising operating costs that bear monitoring in subsequent periods.');
      } else if (f.revenue.change < -0.05 && f.netIncome.change > 0) {
        p1Parts.push('The ability to grow earnings on declining revenue points to cost discipline, though top-line contraction raises questions about the sustainability of that trajectory.');
      } else if (f.revenue.change < -0.05 && f.netIncome.change < -0.05) {
        p1Parts.push('Simultaneous revenue and earnings contraction underscores fundamental headwinds in the current operating environment.');
      }
    }
  } else if (f.revenue) {
    p1Parts.push(`${ticker} reports ${fmtCurrency(f.revenue.current)} in revenue${formatChangeSuffix(f.revenue)} for ${period}.`);
    p1Facts.push('revenue');
  } else {
    p1Parts.push(`${ticker} has limited period-coherent annual coverage in this run, so interpretation should stay close to the verified statement tables.`);
    p1Facts.push(...firstAvailableFactIds(insights, ['revenue', 'net_income']));
  }
  if (f.operatingMargin || f.netMargin) {
    const marginBits: string[] = [];
    if (f.operatingMargin) {
      marginBits.push(`operating margin of ${fmtPct(f.operatingMargin.current)}`);
      p1Facts.push('operating_margin');
    }
    if (f.netMargin) {
      marginBits.push(`net margin of ${fmtPct(f.netMargin.current)}`);
      p1Facts.push('net_margin');
    }
    p1Parts.push(`The profitability profile is defined by ${marginBits.join(' and ')}, framing the earnings quality behind the headline figures.`);
  }
  paragraphs.push({ text: p1Parts.join(' '), fact_ids: uniqueFactIds(p1Facts) });

  const p2Parts: string[] = [];
  const p2Facts: string[] = [];
  const cashStress = !!(
    (f.operatingCashFlow && f.operatingCashFlow.current < 0)
    || (f.freeCashFlow && f.freeCashFlow.current < 0)
  );
  if (f.debtToEquity && f.currentRatio) {
    const leverage = f.debtToEquity.current;
    const liquidity = f.currentRatio.current;
    p2Facts.push('de', 'current_ratio');
    if (Math.abs(leverage) < 0.3 && liquidity >= 1.5 && !cashStress) {
      p2Parts.push(`The balance sheet is conservatively positioned, with debt-to-equity at just ${fmtRatio(leverage)} and a current ratio of ${fmtRatio(liquidity)}.`);
      p2Parts.push('This posture provides strategic flexibility against cyclicality and capital-allocation demands.');
    } else if (Math.abs(leverage) < 0.3 && liquidity >= 1.5) {
      p2Parts.push(`Debt-to-equity is modest at ${fmtRatio(leverage)} and the current ratio is ${fmtRatio(liquidity)}, so the balance sheet offers near-term coverage on paper.`);
      p2Parts.push('Negative operating or free cash flow tempers that apparent liquidity strength and keeps funding durability in focus.');
      p2Facts.push('operating_cash_flow', 'fcf');
    } else if (Math.abs(leverage) > 2) {
      p2Parts.push(`Leverage is elevated at ${fmtRatio(leverage)} debt-to-equity, which raises refinancing sensitivity despite a ${fmtRatio(liquidity)} current ratio.`);
      if (liquidity < 1.0) {
        p2Parts.push('The sub-1.0x current ratio compounds the leverage concern and suggests tighter near-term funding headroom.');
      }
    } else {
      p2Parts.push(`The balance sheet carries a moderate profile at ${fmtRatio(leverage)} debt-to-equity and ${fmtRatio(liquidity)} current ratio, which is serviceable but leaves less margin for error under stress.`);
    }
  } else if (f.currentRatio) {
    p2Facts.push('current_ratio');
    if (cashStress) {
      p2Parts.push(`Current ratio stands at ${fmtRatio(f.currentRatio.current)} in the locked annual basis, but negative operating or free cash flow tempers what would otherwise look like a comfortable liquidity buffer.`);
      p2Facts.push('operating_cash_flow', 'fcf');
    } else {
      p2Parts.push(`Current ratio stands at ${fmtRatio(f.currentRatio.current)} in the locked annual basis, providing a baseline liquidity reference.`);
    }
  }
  if (f.quickRatio && p2Parts.length > 0) {
    p2Facts.push('quick_ratio');
    if (cashStress) {
      p2Parts.push(`The quick ratio of ${fmtRatio(f.quickRatio.current)} still shows current-asset coverage after excluding inventory, but it does not offset the current cash burn.`);
    } else {
      p2Parts.push(`The quick ratio of ${fmtRatio(f.quickRatio.current)} confirms liquidity depth after excluding inventory from the coverage calculation.`);
    }
  }
  if (p2Parts.length > 0) {
    paragraphs.push({ text: p2Parts.join(' '), fact_ids: uniqueFactIds(p2Facts) });
  }

  const p3Parts: string[] = [];
  const p3Facts: string[] = [];
  if (f.operatingCashFlow && f.freeCashFlow) {
    p3Facts.push('operating_cash_flow', 'fcf');
    p3Parts.push(`Cash generation is anchored by ${fmtCurrency(f.operatingCashFlow.current)} in operating cash flow${formatChangeSuffix(f.operatingCashFlow)}, which converts to ${fmtCurrency(f.freeCashFlow.current)} in free cash flow${formatChangeSuffix(f.freeCashFlow)}.`);
    if (f.capex) {
      p3Facts.push('capex');
      const capexIntensity = f.revenue ? (Math.abs(f.capex.current) / f.revenue.current * 100).toFixed(1) : null;
      const capexNote = capexIntensity ? ` (${capexIntensity}% of revenue)` : '';
      p3Parts.push(`Capital expenditures of ${fmtCurrency(Math.abs(f.capex.current))}${capexNote} show the reinvestment burden required to sustain the current operating base.`);
      if (f.revenue) p3Facts.push('revenue');
    }
    if (f.operatingCashFlow.current > 0 && f.freeCashFlow.current > 0 && f.netIncome && f.netIncome.current > 0) {
      const cfoToNi = f.operatingCashFlow.current / f.netIncome.current;
      p3Facts.push('net_income');
      if (cfoToNi > 1.2) {
        p3Parts.push('The conversion of earnings into operating cash flow suggests the reported result is supported by cash generation rather than dominated by accruals.');
      } else if (cfoToNi < 0.7 && cfoToNi > 0) {
        p3Parts.push('The gap between reported earnings and cash generation warrants scrutiny of working capital dynamics and accrual quality.');
      }
    }
  } else if (f.operatingCashFlow) {
    p3Facts.push('operating_cash_flow');
    p3Parts.push(`Operating cash flow is ${fmtCurrency(f.operatingCashFlow.current)}${formatChangeSuffix(f.operatingCashFlow)}.`);
  } else {
    p3Facts.push(...firstAvailableFactIds(insights, ['operating_cash_flow', 'fcf', 'revenue']));
    p3Parts.push('Cash-flow evidence is limited in the locked annual period, so funding durability remains unresolved from the available data.');
  }
  if (p3Parts.length > 0) {
    paragraphs.push({ text: p3Parts.join(' '), fact_ids: uniqueFactIds(p3Facts) });
  }

  return sectionFromParagraphs(paragraphs.filter(paragraph => paragraph.text.trim().length > 0));
}

function buildSingleTrendAnalysis(insights: AnalysisInsights): NarrativeSectionBuild {
  if (insights.topTrends.length === 0) {
    return sectionFromParagraphs([
      {
        text: 'Annual trend coverage is limited in this run; interpretation relies on current-period statement consistency.',
        fact_ids: firstAvailableFactIds(insights, ['revenue', 'net_income']),
      },
    ]);
  }

  const blocks = insights.topTrends.slice(0, 4).map(trend => {
    const cagrText = trend.cagr !== null ? `${fmtPct(trend.cagr)} CAGR` : 'CAGR unavailable';
    const latestText = trend.latestValue !== null ? fmtCurrency(trend.latestValue) : 'N/A';
    return {
      heading: `### ${trend.displayName}`,
      text: `${trend.displayName} is currently ${latestText} with ${cagrText}. ${trend.description}`,
      fact_ids: [trend.metric],
    };
  });
  return sectionFromBlocks(blocks);
}

function buildSingleRiskFactors(insights: AnalysisInsights): NarrativeSectionBuild {
  const lines: Array<{ heading?: string; text: string; fact_ids: string[] }> = insights.redFlags.length === 0
    ? [{
      heading: '### Watch Items',
      text: bullet('No major quantitative red flags are active in the locked annual snapshot; continue monitoring margin durability and cash conversion.'),
      fact_ids: firstAvailableFactIds(insights, ['operating_margin', 'fcf', 'operating_cash_flow']),
    }]
    : insights.redFlags.slice(0, 5).map(flag => ({
      heading: undefined,
      text: bullet(`**${flag.flag}:** ${flag.detail}`),
      fact_ids: flagFactIds(flag.flag, insights),
    }));

  if (insights.redFlags.length > 0) {
    lines.unshift({
      heading: '### Watch Items',
      text: bullet('The following governed risk signals are active in the locked annual basis.'),
      fact_ids: firstAvailableFactIds(insights, ['revenue', 'net_income']),
    });
  }

  return sectionFromBlocks(lines);
}

function buildSingleAnalystNotes(
  ticker: string,
  insights: AnalysisInsights,
): NarrativeSectionBuild {
  const strengths = insights.strengths.slice(0, 3);
  const flags = insights.redFlags.slice(0, 3);
  const blocks: Array<{ heading?: string; text: string; fact_ids: string[] }> = [];

  blocks.push({ heading: '### What Stands Out', text: strengths.length === 0
    ? bullet(`${ticker}'s profile is currently balanced without a dominant quantitative outperformance signal.`)
    : bullet(strengths[0]!.detail), fact_ids: strengths.length === 0 ? firstAvailableFactIds(insights, ['revenue', 'net_income']) : strengthFactIds(strengths[0]!.metric, insights) });
  for (const strength of strengths.slice(1)) {
    blocks.push({ text: bullet(strength.detail), fact_ids: strengthFactIds(strength.metric, insights) });
  }

  blocks.push({ heading: '### Watch Items', text: flags.length === 0
    ? bullet('No critical flags are active; monitor execution against the current margin and cash benchmarks.')
    : bullet(flags[0]!.detail), fact_ids: flags.length === 0 ? firstAvailableFactIds(insights, ['operating_margin', 'operating_cash_flow']) : flagFactIds(flags[0]!.flag, insights) });
  for (const flag of flags.slice(1)) {
    blocks.push({ text: bullet(flag.detail), fact_ids: flagFactIds(flag.flag, insights) });
  }

  blocks.push({
    heading: '### Analyst Interpretation',
    text: bullet(`Current conclusions are anchored to a period-locked annual basis (${insights.snapshotPeriod ?? 'N/A'}).`),
    fact_ids: firstAvailableFactIds(insights, ['revenue', 'net_income']),
  });
  if (insights.priorPeriod) {
    blocks.push({
      text: bullet(`Prior comparisons use ${insights.priorPeriod}; metrics without required inputs remain intentionally unfilled.`),
      fact_ids: firstAvailableFactIds(insights, ['revenue', 'net_income']),
    });
  }

  return sectionFromBlocks(blocks);
}

function buildComparisonExecutiveSummary(
  context: AnalysisContext,
  insights: Record<string, AnalysisInsights>,
): NarrativeSectionBuild {
  const summaries = context.tickers.map(t => {
    const i = insights[t];
    const facts = extractFacts(i);
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
  paragraphs.push({
    text: `This comparison evaluates ${context.tickers.join(', ')} across their locked annual filing periods, examining revenue scale, profitability, leverage, and cash generation to surface relative positioning within the peer set.`,
    fact_ids: ['revenue', 'net_income', 'de', 'fcf'],
  });

  for (const s of summaries) {
    const parts: string[] = [];
    const factIds = ['revenue'];
    const rev = s.revenue !== null ? fmtCurrency(s.revenue) : null;
    const ni = s.netIncome !== null ? fmtCurrency(s.netIncome) : null;
    const revChg = formatChangeSuffixFromValues(s.revenueChange, s.revenue, s.revenuePrior, 'USD');

    if (rev && ni) {
      parts.push(`${s.ticker} reports ${rev} in revenue${revChg} and ${ni} in net income for period ${s.period}.`);
      factIds.push('net_income');
    } else if (rev) {
      parts.push(`${s.ticker} reports ${rev} in revenue${revChg} for period ${s.period}.`);
    } else {
      parts.push(`${s.ticker} has limited data coverage for period ${s.period}.`);
    }

    const profileBits: string[] = [];
    if (s.netMargin !== null) {
      profileBits.push(`net margin of ${fmtPct(s.netMargin)}`);
      factIds.push('net_margin');
    }
    if (s.debtToEquity !== null) {
      profileBits.push(`debt-to-equity of ${fmtRatio(s.debtToEquity)}`);
      factIds.push('de');
    }
    if (s.freeCashFlow !== null) {
      profileBits.push(`free cash flow of ${fmtCurrency(s.freeCashFlow)}`);
      factIds.push('fcf');
    }
    if (profileBits.length > 0) {
      parts.push(`Key profile markers include ${profileBits.join(', ')}.`);
    }

    paragraphs.push({ text: parts.join(' '), fact_ids: uniqueFactIds(factIds) });
  }

  const revenueLeader = [...summaries].filter(s => s.revenue !== null).sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0))[0];
  const marginLeader = [...summaries].filter(s => s.netMargin !== null).sort((a, b) => (b.netMargin ?? 0) - (a.netMargin ?? 0))[0];
  if (revenueLeader && marginLeader && revenueLeader.ticker !== marginLeader.ticker) {
    paragraphs.push({
      text: `${revenueLeader.ticker} leads the peer set in absolute revenue scale, while ${marginLeader.ticker} carries the highest net margin, illustrating a scale-versus-efficiency tradeoff in the current locked basis.`,
      fact_ids: ['revenue', 'net_margin'],
    });
  } else if (revenueLeader) {
    paragraphs.push({
      text: `${revenueLeader.ticker} leads the peer set in annual revenue, anchoring the scale dimension of the comparison.`,
      fact_ids: ['revenue'],
    });
  }

  return sectionFromParagraphs(paragraphs);
}

function buildRelativeStrengths(
  context: AnalysisContext,
  insights: Record<string, AnalysisInsights>,
): NarrativeSectionBuild {
  const blocks: Array<{ heading?: string; text: string; fact_ids: string[] }> = [];
  for (const ticker of context.tickers) {
    const strengths = insights[ticker]?.strengths || [];
    blocks.push({
      heading: `### ${ticker} — What Stands Out`,
      text: strengths.length === 0
        ? bullet(`No clear quantitative outperformance signal is active for ${ticker} in the current period lock.`)
        : bullet(strengths[0]!.detail),
      fact_ids: strengths.length === 0
        ? firstAvailableFactIds(insights[ticker]!, ['revenue', 'net_income'])
        : strengthFactIds(strengths[0]!.metric, insights[ticker]!),
    });
    for (const strength of strengths.slice(1, 4)) {
      blocks.push({ text: bullet(strength.detail), fact_ids: strengthFactIds(strength.metric, insights[ticker]!) });
    }
  }
  return sectionFromBlocks(blocks);
}

function buildComparisonRisk(
  context: AnalysisContext,
  insights: Record<string, AnalysisInsights>,
): NarrativeSectionBuild {
  const blocks: Array<{ heading?: string; text: string; fact_ids: string[] }> = [
    {
      heading: '### Watch Items',
      text: bullet('Relative risk is assessed only on surfaced, period-locked peer metrics and does not force false comparability.'),
      fact_ids: ['revenue', 'de', 'fcf'],
    },
  ];
  for (const ticker of context.tickers) {
    const flags = insights[ticker]?.redFlags || [];
    if (flags.length === 0) {
      blocks.push({
        text: bullet(`**${ticker}:** No major quantitative red flag is active in the current annual snapshot.`),
        fact_ids: firstAvailableFactIds(insights[ticker]!, ['revenue', 'net_income']),
      });
      continue;
    }
    blocks.push({
      text: bullet(`**${ticker}:** ${flags.slice(0, 2).map(f => f.detail).join(' ')}`),
      fact_ids: uniqueFactIds(flags.slice(0, 2).flatMap(flag => flagFactIds(flag.flag, insights[ticker]!))),
    });
  }
  return sectionFromBlocks(blocks);
}

function buildComparisonNotes(
  context: AnalysisContext,
  insights: Record<string, AnalysisInsights>,
): NarrativeSectionBuild {
  const blocks: Array<{ heading?: string; text: string; fact_ids: string[] }> = [
    {
      heading: '### Analyst Follow-Up',
      text: bullet('Peer conclusions should be read through the locked annual basis, surfaced metric coverage, and explicit comparison-governance policy.'),
      fact_ids: ['revenue', 'net_income', 'de', 'fcf'],
    },
  ];
  for (const ticker of context.tickers) {
    const strengthCount = insights[ticker]?.strengths.length ?? 0;
    const riskCount = insights[ticker]?.redFlags.length ?? 0;
    blocks.push({
      text: bullet(`**${ticker}:** ${strengthCount} strength signals and ${riskCount} active risk signals in the locked annual basis.`),
      fact_ids: firstAvailableFactIds(insights[ticker]!, ['revenue', 'net_income']),
    });
  }
  blocks.push({
    text: bullet('Prioritize next-pass work on margin durability, balance-sheet flexibility, and cash conversion differentials across the peer set.'),
    fact_ids: ['operating_margin', 'de', 'fcf'],
  });
  return sectionFromBlocks(blocks);
}

function buildNarrativeSection(
  sectionId: string,
  context: AnalysisContext,
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
        return sectionFromParagraphs([]);
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
      return sectionFromParagraphs([]);
  }
}

export function generateDeterministicNarrative(
  context: AnalysisContext,
  insights: Record<string, AnalysisInsights>,
): { sections: ReportSection[]; llmCallCount: number; narrative: StructuredNarrativePayload } {
  const defs = context.type === 'comparison' ? COMPARISON_REPORT_SECTIONS : SINGLE_REPORT_SECTIONS;
  const sections: ReportSection[] = [];
  const narrativeSections: StructuredNarrativeSection[] = [];

  for (const def of defs) {
    if (def.deterministic) {
      sections.push({ id: def.id, title: def.title, content: '' });
      continue;
    }

    const built = buildNarrativeSection(def.id, context, insights);
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
