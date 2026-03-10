import type { Report } from '@dolph/shared';
import { PDF_THEME } from './pdf-theme.js';

const C = PDF_THEME.colors;
const F = PDF_THEME.fonts;
const S = PDF_THEME.spacing;

const CSS = `
  * { box-sizing: border-box; }

  html, body {
    margin: 0;
    padding: 0;
    background: ${C.page};
    color: ${C.primaryText};
    font-family: ${F.body};
    font-size: 10.5pt;
    line-height: 1.6;
  }

  body {
    background: ${C.page};
  }

  .report-page {
    page-break-after: always;
    break-after: page;
    min-height: 9.15in;
    display: flex;
    flex-direction: column;
    gap: ${S.md}px;
    padding: 0;
    width: 100%;
  }

  .report-page:last-of-type {
    page-break-after: auto;
    break-after: auto;
  }

  .module {
    break-inside: avoid;
    page-break-inside: avoid;
    background: transparent;
  }

  h1, h2, h3, h4 {
    margin: 0;
    color: ${C.primaryText};
    break-after: avoid;
    page-break-after: avoid;
  }

  h1 {
    font-family: ${F.title};
    font-size: 28pt;
    font-weight: 700;
    line-height: 1.08;
    letter-spacing: 0.01em;
  }

  h2 {
    font-family: ${F.title};
    font-size: 18pt;
    font-weight: 700;
    line-height: 1.18;
    color: ${C.accentInk};
  }

  h3 {
    font-size: 11.3pt;
    font-weight: 700;
    line-height: 1.3;
    color: ${C.accentInk};
    margin-bottom: ${S.sm}px;
  }

  h4 {
    font-size: 8pt;
    font-weight: 700;
    line-height: 1.2;
    color: ${C.mutedText};
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }

  p {
    margin: 0 0 ${S.sm}px;
    color: ${C.secondaryText};
    line-height: 1.72;
    orphans: 3;
    widows: 3;
  }

  .narrative-paragraph,
  .thesis {
    font-size: 10.7pt;
    line-height: 1.72;
  }

  .thesis {
    color: ${C.primaryText};
  }

  ul, ol {
    margin: 0 0 ${S.sm}px;
    padding-left: 18px;
  }

  li {
    margin-bottom: 6px;
    color: ${C.secondaryText};
  }

  .page-header {
    display: flex;
    flex-direction: column;
    gap: ${S.xs}px;
    padding-bottom: ${S.sm}px;
    border-bottom: 1px solid ${C.rule};
    margin-bottom: ${S.xs}px;
  }

  .page-kicker {
    font-size: 7.8pt;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: ${C.mutedText};
  }

  .page-header-top {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: ${S.sm}px;
  }

  .page-header-meta {
    font-size: 8pt;
    color: ${C.mutedText};
    letter-spacing: 0.08em;
    text-transform: uppercase;
    text-align: right;
  }

  .period-banner {
    padding: ${S.xs}px 0 ${S.sm}px;
    border-bottom: 1px solid ${C.rule};
    margin-top: -${S.xs}px;
  }

  .period-banner-row {
    display: flex;
    flex-wrap: wrap;
    gap: ${S.xs}px;
  }

  .period-chip {
    display: inline-block;
    padding: 3px 8px;
    border: 1px solid ${C.border};
    border-radius: 999px;
    background: ${C.panelAlt};
    font-size: 8pt;
    color: ${C.secondaryText};
  }

  .period-chip strong {
    color: ${C.primaryText};
    font-weight: 700;
  }

  .period-note {
    display: block;
    margin-top: 6px;
    font-size: 8pt;
    color: ${C.mutedText};
  }

  .page-front {
    gap: ${S.lg}px;
  }

  .front-title-block {
    display: flex;
    flex-direction: column;
    gap: ${S.sm}px;
    padding-bottom: ${S.sm}px;
    border-bottom: 1px solid ${C.rule};
  }

  .front-brand-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: ${S.sm}px;
  }

  .cover-brand {
    font-family: ${F.title};
    font-size: 18pt;
    color: ${C.accentInk};
  }

  .front-subtitle {
    font-size: 8pt;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: ${C.mutedText};
  }

  .front-metadata-line {
    display: flex;
    flex-wrap: wrap;
    gap: ${S.sm}px;
    font-size: 8.1pt;
    color: ${C.mutedText};
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .front-summary {
    display: flex;
    flex-direction: column;
    gap: ${S.sm}px;
  }

  .metric-strip {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0;
    padding: ${S.sm}px 0;
    border-top: 1px solid ${C.rule};
    border-bottom: 1px solid ${C.rule};
  }

  .metric-strip-item {
    padding: 0 ${S.sm}px;
    min-height: 68px;
  }

  .metric-strip-item:first-child {
    padding-left: 0;
  }

  .metric-strip-item:last-child {
    padding-right: 0;
  }

  .metric-strip-item + .metric-strip-item {
    border-left: 1px solid ${C.rule};
  }

  .metric-strip-label {
    font-size: 7.8pt;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: ${C.mutedText};
    margin-bottom: ${S.xs}px;
  }

  .metric-strip-value {
    font-family: ${F.title};
    font-size: 19pt;
    line-height: 1.08;
    color: ${C.primaryText};
  }

  .metric-strip-note {
    margin-top: 6px;
    font-size: 8.4pt;
    color: ${C.secondaryText};
  }

  .metric-strip-compare {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .metric-strip-compare-line {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-size: 8.7pt;
    color: ${C.secondaryText};
  }

  .metric-strip-compare-line strong {
    color: ${C.primaryText};
    font-family: ${F.numeric};
    font-weight: 700;
  }

  .executive-scorecard {
    padding-top: ${S.xs}px;
  }

  .executive-copy {
    max-width: 100%;
  }

  .visual-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: ${S.lg}px;
  }

  .visual-card {
    margin: 0;
  }

  .visual-frame {
    border: 1px solid ${C.border};
    border-radius: 7px;
    background: ${C.page};
    padding: ${S.sm}px;
    min-height: 270px;
  }

  .visual-frame svg {
    width: 100%;
    height: auto;
    display: block;
  }

  .visual-card figcaption {
    margin-top: ${S.sm}px;
  }

  .visual-card h3 {
    margin-bottom: ${S.xs}px;
  }

  .visual-card p {
    margin: 0;
    font-size: 9.1pt;
    color: ${C.mutedText};
  }

  .metrics-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: ${S.lg}px;
  }

  .page-dashboard .metrics-grid,
  .page-appendix,
  .page-sources {
    gap: ${S.md}px;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin: 0;
    font-size: 9.35pt;
    break-inside: avoid;
    page-break-inside: avoid;
  }

  thead {
    display: table-header-group;
  }

  thead th {
    background: ${C.panelAlt};
    color: ${C.accentInk};
    border: none;
    border-bottom: 1px solid ${C.borderStrong};
    text-align: left;
    padding: 10px 12px;
    font-size: 8.4pt;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  tbody td {
    padding: 10px 12px;
    border: none;
    border-bottom: 1px solid ${C.rule};
    color: ${C.secondaryText};
    font-family: ${F.numeric};
    font-variant-numeric: tabular-nums;
    vertical-align: top;
  }

  tbody tr:nth-child(even) td {
    background: ${C.panelAlt};
  }

  td:not(:first-child), th:not(:first-child) {
    text-align: right;
  }

  td:first-child, th:first-child {
    width: 38%;
    text-align: left;
    color: ${C.primaryText};
  }

  .table-group {
    break-inside: avoid;
    page-break-inside: avoid;
    margin: 0;
    padding: 0;
  }

  .table-group.tall {
    grid-column: 1 / -1;
  }

  .commentary-block {
    padding-top: ${S.sm}px;
    border-top: 1px solid ${C.rule};
  }

  .checklist-block {
    padding-top: ${S.sm}px;
    border-top: 1px solid ${C.rule};
  }

  .appendix-module,
  .sources-module {
    padding: 0;
  }

  .appendix-section {
    margin-bottom: ${S.md}px;
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .page-appendix table {
    font-size: 8.8pt;
  }

  .page-appendix tbody td,
  .page-appendix thead th {
    padding-top: 8px;
    padding-bottom: 8px;
  }

  .methodology-module {
    padding-top: ${S.sm}px;
    border-top: 1px solid ${C.rule};
    font-size: 9pt;
  }

  .source-note {
    font-size: 8.5pt;
    color: ${C.mutedText};
  }

  .sources-table .source-url {
    text-align: left;
    font-size: 8pt;
    color: ${C.mutedText};
    word-break: break-all;
  }

  .positive { color: ${C.positive}; }
  .warning { color: ${C.caution}; }
  .negative { color: ${C.negative}; }

  a {
    color: ${C.accentInk};
    text-decoration: none;
  }

  .page-cover {
    gap: ${S.lg}px;
  }

  .cover-top {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: ${S.sm}px;
    padding-bottom: ${S.sm}px;
    border-bottom: 1px solid ${C.rule};
  }

  .cover-family,
  .cover-date {
    font-size: 8pt;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: ${C.mutedText};
  }

  .cover-hero {
    display: flex;
    flex-direction: column;
    gap: ${S.sm}px;
  }

  .cover-thesis {
    font-size: 11pt;
    line-height: 1.7;
    color: ${C.secondaryText};
    max-width: 88%;
    border-top: 1px solid ${C.rule};
    padding-top: ${S.sm}px;
  }
`;

export function buildReportHTML(report: Report, bodyHTML: string): string {
  const tickerStr = report.tickers.join(', ');
  const safeTicker = escapeHTML(tickerStr);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Dolph Research — ${safeTicker}</title>
  <style>${CSS}</style>
</head>
<body>
  ${bodyHTML}
</body>
</html>`;
}

function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
