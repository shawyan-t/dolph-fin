/**
 * HTML template and CSS for professional PDF report generation.
 *
 * Design system:
 * - Body text: 'Times New Roman', serif — 11pt
 * - Section headers (h2): 'Helvetica Neue', sans-serif — navy, 14pt
 * - Sub-headers (h3): 'Helvetica Neue', sans-serif — dark gray, 12pt
 * - Tables: 'Times New Roman' body, 'Helvetica Neue' headers
 * - Report header/footer: 'Helvetica Neue' (brand elements only)
 * - No monospace anywhere in the document
 */

import type { Report } from '@dolph/shared';

const CSS = `
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    font-family: 'Times New Roman', Times, Georgia, serif;
    font-size: 11pt;
    line-height: 1.65;
    color: #1a1a1a;
    background: #fff;
  }

  /* ── Report Header (brand area) ─────────────────── */

  .report-header {
    border-bottom: 3px solid #1a365d;
    padding-bottom: 16px;
    margin-bottom: 28px;
  }

  .report-header .logo {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 28px;
    font-weight: 700;
    color: #1a365d;
    letter-spacing: -0.5px;
  }

  .report-header .subtitle {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 11px;
    color: #718096;
    text-transform: uppercase;
    letter-spacing: 2px;
    margin-top: 4px;
  }

  .report-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid #e2e8f0;
  }

  .report-meta .ticker {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 18px;
    font-weight: 600;
    color: #2d3748;
  }

  .report-meta .date {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 11px;
    color: #718096;
  }

  /* ── Sections ───────────────────────────────────── */

  .section {
    margin-bottom: 28px;
    page-break-inside: auto;
  }

  /* ── Headings ───────────────────────────────────── */

  h2 {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 14pt;
    font-weight: 600;
    color: #1a365d;
    border-bottom: 1px solid #cbd5e0;
    padding-bottom: 5px;
    margin-bottom: 14px;
    margin-top: 8px;
    page-break-after: avoid;
  }

  h3 {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 12pt;
    font-weight: 600;
    color: #2d3748;
    margin-bottom: 8px;
    margin-top: 18px;
    border-bottom: none;
    page-break-after: avoid;
  }

  h4 {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 11pt;
    font-weight: 600;
    color: #4a5568;
    margin-bottom: 6px;
    margin-top: 14px;
  }

  /* ── Body text ──────────────────────────────────── */

  p {
    font-family: 'Times New Roman', Times, Georgia, serif;
    font-size: 11pt;
    margin-bottom: 10px;
    text-align: left;
  }

  ul, ol {
    font-family: 'Times New Roman', Times, Georgia, serif;
    margin-bottom: 10px;
    padding-left: 24px;
  }

  li {
    margin-bottom: 4px;
    font-size: 11pt;
  }

  strong {
    font-weight: 700;
  }

  em {
    font-style: italic;
  }

  /* ── Tables ─────────────────────────────────────── */

  table {
    width: 100%;
    border-collapse: collapse;
    margin: 14px 0 18px;
    font-family: 'Times New Roman', Times, Georgia, serif;
    font-size: 10pt;
    page-break-inside: auto;
  }

  thead {
    display: table-header-group;
  }

  thead th {
    background: #1a365d;
    color: #fff;
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-weight: 600;
    font-size: 8.5pt;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 7px 10px;
    text-align: left;
    border: 1px solid #1a365d;
  }

  tbody td {
    padding: 5px 10px;
    border: 1px solid #e2e8f0;
    font-family: 'Times New Roman', Times, Georgia, serif;
    font-size: 10pt;
    font-variant-numeric: tabular-nums;
  }

  tbody tr:nth-child(even) {
    background: #f7fafc;
  }

  tbody tr {
    page-break-inside: avoid;
  }

  /* Right-align numeric columns (2nd column onwards) */
  td:not(:first-child) {
    text-align: right;
  }

  th:not(:first-child) {
    text-align: right;
  }

  /* Color coding for positive/negative percentage values */
  .positive { color: #276749; }
  .negative { color: #c53030; }

  /* ── Code/Pre: render as normal text ────────────── */
  /* LLM sometimes outputs markdown with backticks or code fences.
     In a financial report these should render as regular text. */

  code {
    font-family: 'Times New Roman', Times, Georgia, serif;
    font-size: inherit;
    background: none;
    padding: 0;
    border-radius: 0;
    color: inherit;
  }

  pre {
    font-family: 'Times New Roman', Times, Georgia, serif;
    font-size: 11pt;
    line-height: 1.65;
    white-space: pre-wrap;
    word-wrap: break-word;
    margin-bottom: 10px;
    background: none;
    padding: 0;
    border: none;
    color: #1a1a1a;
  }

  pre code {
    font-family: 'Times New Roman', Times, Georgia, serif;
    font-size: 11pt;
    background: none;
    padding: 0;
  }

  /* ── Blockquotes: subtle, not dominant ──────────── */

  blockquote {
    border-left: 2px solid #cbd5e0;
    padding-left: 14px;
    margin: 10px 0;
    color: #4a5568;
    font-style: italic;
    font-size: 10.5pt;
  }

  /* ── Charts ───────────────────────────────────────── */

  .charts-section {
    page-break-inside: avoid;
  }

  .charts-grid {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .charts-grid svg {
    border: 1px solid #e2e8f0;
    border-radius: 4px;
  }

  /* ── Horizontal rules ───────────────────────────── */

  hr {
    border: none;
    border-top: 1px solid #e2e8f0;
    margin: 16px 0;
  }

  /* ── Links ──────────────────────────────────────── */

  a {
    color: #2b6cb0;
    text-decoration: none;
  }

  /* ── Footer ─────────────────────────────────────── */

  .report-footer {
    margin-top: 40px;
    padding-top: 14px;
    border-top: 2px solid #1a365d;
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 8pt;
    color: #a0aec0;
    text-align: center;
    line-height: 1.8;
  }
`;

export function buildReportHTML(report: Report, bodyHTML: string): string {
  const tickerStr = report.tickers.join(', ');
  const dateStr = new Date(report.generated_at).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const typeLabel = report.type === 'comparison' ? 'Comparative Analysis' : 'Equity Research Note';
  const safeTicker = escapeHTML(tickerStr);
  const safeDate = escapeHTML(dateStr);
  const safeType = escapeHTML(typeLabel);
  const safeLlmCalls = Number.isFinite(report.metadata.llm_calls) ? report.metadata.llm_calls : 0;
  const safeDataPoints = Number.isFinite(report.metadata.data_points_used) ? report.metadata.data_points_used : 0;
  const safeDurationSec = Number.isFinite(report.metadata.total_duration_ms)
    ? (report.metadata.total_duration_ms / 1000).toFixed(1)
    : '0.0';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Dolph — ${safeTicker} Analysis</title>
  <style>${CSS}</style>
</head>
<body>
  <div class="report-header">
    <div class="logo">Dolph</div>
    <div class="subtitle">${safeType}</div>
    <div class="report-meta">
      <span class="ticker">${safeTicker}</span>
      <span class="date">${safeDate}</span>
    </div>
  </div>

  ${bodyHTML}

  <div class="report-footer">
    <div>Data sourced exclusively from SEC EDGAR public filings.</div>
    <div>This report is generated by Dolph and is not financial advice.</div>
    <div>LLM calls: ${safeLlmCalls} | Data points: ${safeDataPoints} | Generated in ${safeDurationSec}s</div>
  </div>
</body>
</html>`;
}

function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
