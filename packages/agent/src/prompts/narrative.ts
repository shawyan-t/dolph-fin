/**
 * Prompt templates for LLM narrative synthesis.
 * These are the ONLY prompts used — the LLM is called for narrative writing only.
 */

import type { AnalysisContext } from '@filinglens/shared';
import type { AnalysisInsights } from '../analyzer.js';

export function buildNarrativePrompt(
  context: AnalysisContext,
  insights: Record<string, AnalysisInsights>,
): string {
  const ticker = context.tickers[0]!;
  const tickerInsights = insights[ticker];
  const facts = context.facts[ticker];
  const ratios = context.ratios[ticker] || [];
  const trends = context.trends[ticker] || [];
  const filingContent = context.filing_content[ticker];

  // Build a structured data dump for the LLM
  const sections: string[] = [];

  sections.push(`# Financial Analysis Data for ${ticker}`);
  sections.push(`Company: ${facts?.company_name || ticker}`);
  sections.push('');

  // Key metrics
  if (tickerInsights?.keyMetrics) {
    sections.push('## Key Metrics');
    for (const [name, data] of Object.entries(tickerInsights.keyMetrics)) {
      const changeStr = data.change !== null ? ` (YoY: ${(data.change * 100).toFixed(1)}%)` : '';
      sections.push(`- ${name}: ${formatValue(data.current, data.unit)}${changeStr}`);
    }
    sections.push('');
  }

  // Ratios
  if (ratios.length > 0) {
    sections.push('## Financial Ratios');
    for (const r of ratios) {
      sections.push(`- ${r.display_name}: ${r.value.toFixed(4)} (Formula: ${r.formula})`);
    }
    sections.push('');
  }

  // Trends
  if (trends.length > 0) {
    sections.push('## Trends');
    for (const t of trends) {
      const cagrStr = t.cagr !== null ? `CAGR: ${(t.cagr * 100).toFixed(1)}%` : 'CAGR: N/A';
      const values = t.values.slice(-5).map(v =>
        `${v.period}: ${formatLargeNumber(v.value)}`,
      ).join(', ');
      sections.push(`- ${t.metric}: ${cagrStr} | Recent: ${values}`);
    }
    sections.push('');
  }

  // Red flags
  if (tickerInsights?.redFlags && tickerInsights.redFlags.length > 0) {
    sections.push('## Red Flags Identified');
    for (const f of tickerInsights.redFlags) {
      sections.push(`- [${f.severity}] ${f.flag}: ${f.detail}`);
    }
    sections.push('');
  }

  // Strengths
  if (tickerInsights?.strengths && tickerInsights.strengths.length > 0) {
    sections.push('## Strengths Identified');
    for (const s of tickerInsights.strengths) {
      sections.push(`- ${s.detail}`);
    }
    sections.push('');
  }

  // Risk factors from filing (if available)
  if (filingContent) {
    const riskSection = filingContent.sections.find(s =>
      s.title.toLowerCase().includes('risk factor'),
    );
    if (riskSection) {
      sections.push('## Risk Factors from 10-K Filing (excerpt)');
      sections.push(riskSection.content.slice(0, 3000));
      sections.push('');
    }
  }

  const dataBlock = sections.join('\n');

  return `You are a senior financial analyst writing a report based on SEC filing data.

DATA:
${dataBlock}

Write the following sections in Markdown. Each section should be specific with real numbers — never use vague language like "growing steadily" or "performing well". Every claim must reference a specific number, period, or percentage from the data above.

## Executive Summary
Write 3-4 sentences that a non-finance person could understand. Include the most important headline numbers.

## Key Metrics Dashboard
Create a Markdown table with columns: Metric | Current Value | Prior Period | Change (%).
Include at least 8-10 key metrics.

## Trend Analysis
For each of the top 3-5 trends, write 2-3 sentences explaining what happened and why it matters. Reference specific numbers and time periods.

## Risk Factors
Summarize the top 3-5 risks in 1-2 sentences each. If risk factor text from the 10-K is available, synthesize those. Otherwise, derive risks from the financial data.

## Financial Statements
Format the most recent 3 periods of the income statement, balance sheet, and cash flow statement as clean Markdown tables. Use proper number formatting (billions/millions with 1 decimal place).

## Analyst Notes
Write 2-3 paragraphs of synthesis: what story do the numbers tell? What questions should an analyst investigate further? Be specific.

IMPORTANT:
- Use specific numbers from the data, not approximations
- Format large numbers as $X.XB (billions) or $X.XM (millions)
- Every section must have concrete data points
- Do not hallucinate any numbers — only use what's in the DATA section above`;
}

export function buildComparisonNarrativePrompt(
  context: AnalysisContext,
  insights: Record<string, AnalysisInsights>,
): string {
  const sections: string[] = [];
  sections.push(`# Comparison Analysis: ${context.tickers.join(' vs ')}`);
  sections.push('');

  for (const ticker of context.tickers) {
    const tickerInsights = insights[ticker];
    const ratios = context.ratios[ticker] || [];

    sections.push(`## ${ticker}`);
    if (tickerInsights?.keyMetrics) {
      for (const [name, data] of Object.entries(tickerInsights.keyMetrics)) {
        sections.push(`- ${name}: ${formatValue(data.current, data.unit)}`);
      }
    }
    sections.push('');
  }

  if (context.comparison) {
    sections.push('## Comparison Matrix');
    for (const m of context.comparison.metrics) {
      const values = context.tickers
        .map(t => `${t}: ${m.values[t] !== null ? formatLargeNumber(m.values[t]!) : 'N/A'}`)
        .join(', ');
      sections.push(`- ${m.metric}: ${values}`);
    }
  }

  const dataBlock = sections.join('\n');

  return `You are a senior financial analyst writing a comparison report.

DATA:
${dataBlock}

Write a comparison report in Markdown with these sections:

## Executive Summary
3-4 sentences comparing these companies at a high level.

## Key Metrics Comparison
A table comparing the most important metrics side by side.

## Relative Strengths
For each company, 2-3 bullet points on their competitive advantages based on the numbers.

## Risk Comparison
Which company has more financial risk and why?

## Analyst Notes
2-3 paragraphs of synthesis on how these companies compare.

Use specific numbers only — no vague language.`;
}

function formatValue(value: number, unit: string): string {
  if (unit === '%') return `${(value * 100).toFixed(1)}%`;
  if (unit === 'x') return `${value.toFixed(2)}x`;
  if (unit === 'USD') return formatLargeNumber(value);
  return `${value}`;
}

function formatLargeNumber(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}
