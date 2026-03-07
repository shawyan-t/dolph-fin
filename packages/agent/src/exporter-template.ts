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
    color: ${C.primaryText};
    background: #ffffff;
    font-family: ${F.body};
    font-size: 10pt;
    line-height: 1.45;
  }

  .report-page {
    page-break-after: always;
    break-after: page;
    min-height: 9.2in;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .report-page:last-of-type {
    page-break-after: auto;
    break-after: auto;
  }

  .page-header {
    border-bottom: 1px solid ${C.stoneBeige};
    padding-bottom: 8px;
  }

  .period-banner {
    border: 1px solid ${C.stoneBeige};
    border-radius: 10px;
    background: ${C.parchment};
    padding: 8px 12px;
    margin-top: 2px;
  }

  .period-banner-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .period-chip {
    display: inline-block;
    font-size: 8.6pt;
    color: ${C.secondaryText};
    background: ${C.warmIvory};
    border: 1px solid ${C.stoneBeige};
    border-radius: 999px;
    padding: 3px 8px;
  }

  .period-chip strong {
    color: ${C.primaryText};
    font-weight: 600;
  }

  .period-note {
    display: block;
    margin-top: 6px;
    font-size: 8.3pt;
    color: ${C.mutedText};
  }

  h1, h2, h3, h4 {
    margin: 0;
    break-after: avoid;
    page-break-after: avoid;
    color: ${C.primaryText};
  }

  h1 {
    font-family: ${F.title};
    font-size: 32pt;
    font-weight: 600;
    line-height: 1.1;
    letter-spacing: 0.15px;
  }

  h2 {
    font-family: ${F.title};
    font-size: 19pt;
    font-weight: 600;
    line-height: 1.2;
  }

  h3 {
    font-family: ${F.body};
    font-size: 11.5pt;
    font-weight: 600;
    line-height: 1.25;
    color: ${C.secondaryText};
    margin-bottom: ${S.xs}px;
  }

  h4 {
    font-family: ${F.body};
    font-size: 9pt;
    font-weight: 600;
    color: ${C.mutedText};
    margin: 0;
  }

  p {
    margin: 0 0 12px;
    color: ${C.secondaryText};
    line-height: 1.5;
    orphans: 3;
    widows: 3;
  }

  ul, ol {
    margin: 0;
    padding-left: 20px;
  }

  li {
    margin-bottom: 6px;
    color: ${C.secondaryText};
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .module {
    break-inside: avoid;
    page-break-inside: avoid;
    background: transparent;
  }

  /* Cover */
  .page-cover {
    background: linear-gradient(180deg, ${C.inkWalnut} 0%, ${C.smokedOak} 48%, ${C.burntUmber} 100%);
    color: ${C.warmIvory};
    border-radius: 14px;
    padding: ${S.lg}px ${S.lg}px ${S.md}px;
    box-shadow: inset 0 0 0 1px rgba(176, 141, 87, 0.25);
    min-height: 8.9in;
  }

  .page-cover .cover-top {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: ${S.sm}px;
    align-items: baseline;
    padding-bottom: ${S.sm}px;
    border-bottom: 1px solid rgba(216, 204, 189, 0.35);
  }

  .cover-brand {
    font-family: ${F.title};
    font-size: 22pt;
    color: ${C.warmIvory};
  }

  .cover-family {
    font-size: 8.5pt;
    letter-spacing: 0.35px;
    color: ${C.stoneBeige};
    text-transform: uppercase;
  }

  .cover-date {
    font-size: 8.5pt;
    color: ${C.stoneBeige};
  }

  .cover-hero {
    margin-top: ${S.lg}px;
  }

  .cover-hero h1 {
    color: ${C.warmIvory};
  }

  .cover-thesis {
    margin-top: ${S.sm}px;
    margin-bottom: 10px;
    font-size: 11pt;
    line-height: 1.5;
    color: ${C.stoneBeige};
    max-width: 95%;
    word-break: break-word;
  }

  .cover-kpis {
    margin-top: ${S.sm}px;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: ${S.sm}px;
  }

  .peer-kpi-strip {
    margin-top: ${S.sm}px;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: ${S.sm}px;
  }

  .peer-kpi-col {
    background: ${C.parchment};
    color: ${C.primaryText};
    border-radius: 12px;
    padding: 12px 14px;
    box-shadow: inset 0 0 0 1px rgba(30, 26, 23, 0.16);
  }

  .peer-kpi-col h3 {
    color: ${C.primaryText};
    font-family: ${F.title};
    font-size: 12pt;
    margin-bottom: 8px;
  }

  .peer-kpi-col h3 span {
    font-family: ${F.body};
    font-size: 9pt;
    color: ${C.mutedText};
  }

  .peer-kpi-col ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .peer-kpi-col li {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
    color: ${C.secondaryText};
  }

  .peer-kpi-col li strong {
    color: ${C.primaryText};
    font-family: ${F.numeric};
    font-weight: 700;
  }

  .kpi-card {
    background: ${C.parchment};
    color: ${C.primaryText};
    border-radius: 12px;
    padding: 12px 14px;
    box-shadow: inset 0 0 0 1px rgba(30, 26, 23, 0.16);
  }

  .kpi-label {
    font-size: 8.5pt;
    color: ${C.mutedText};
    margin-bottom: 6px;
  }

  .kpi-value {
    font-family: ${F.title};
    font-size: 22pt;
    line-height: 1.1;
    color: ${C.primaryText};
  }

  .kpi-note {
    margin-top: 6px;
    font-size: 8.3pt;
    color: ${C.secondaryText};
  }

  .cover-glance {
    margin-top: auto;
    border-top: 1px solid rgba(216, 204, 189, 0.3);
    padding-top: ${S.sm}px;
  }

  .cover-glance h3 {
    color: ${C.parchment};
    margin-bottom: ${S.xs}px;
  }

  .cover-glance li {
    color: ${C.stoneBeige};
    margin-bottom: 6px;
  }

  /* Executive */
  .executive-copy {
    background: ${C.warmIvory};
    border: 1px solid ${C.stoneBeige};
    border-radius: 10px;
    padding: 14px 16px;
  }

  .thesis {
    font-size: 10.6pt;
    color: ${C.secondaryText};
    margin-bottom: 0;
  }

  .thesis-secondary {
    margin-top: 10px;
    font-size: 9.5pt;
    color: ${C.mutedText};
  }

  .exec-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: ${S.sm}px;
    align-items: stretch;
  }

  .exec-block {
    background: ${C.warmIvory};
    border: 1px solid ${C.stoneBeige};
    border-radius: 10px;
    padding: ${S.sm}px;
    min-height: 120px;
  }

  .executive-strip {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
    border: 1px solid ${C.stoneBeige};
    border-radius: 10px;
    background: ${C.parchment};
    padding: 10px;
  }

  .executive-scorecard {
    border: 1px solid ${C.stoneBeige};
    border-radius: 10px;
    background: ${C.parchment};
    padding: 10px 10px 2px;
  }

  .executive-scorecard h3 {
    color: ${C.primaryText};
    margin-bottom: 8px;
  }

  .mini-kpi {
    border: 1px solid ${C.stoneBeige};
    border-radius: 8px;
    background: ${C.warmIvory};
    padding: 8px 10px;
    min-height: 56px;
  }

  .mini-kpi p {
    margin: 4px 0 0;
    font-size: 12pt;
    line-height: 1.15;
    color: ${C.primaryText};
    font-weight: 600;
  }

  /* Visual pages */
  .visual-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .visual-grid.single {
    grid-template-columns: 1fr;
  }

  .visual-card {
    margin: 0;
    border: 1px solid ${C.stoneBeige};
    border-radius: 12px;
    background: ${C.warmIvory};
    padding: 12px;
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .visual-frame {
    border: 1px solid ${C.stoneBeige};
    border-radius: 10px;
    background: #ffffff;
    padding: 10px;
    min-height: 270px;
  }

  .visual-frame svg {
    width: 100%;
    height: auto;
    display: block;
  }

  .visual-card figcaption {
    margin-top: ${S.xs}px;
  }

  .visual-card h3 {
    font-size: 12pt;
    color: ${C.primaryText};
  }

  .visual-card p {
    font-size: 9.2pt;
    margin: 0;
    color: ${C.mutedText};
  }

  .visual-insight {
    background: ${C.parchment};
    border: 1px solid ${C.stoneBeige};
    border-radius: 12px;
    padding: 14px 16px;
  }

  .visual-insight h3 {
    margin-bottom: 8px;
    color: ${C.primaryText};
    font-size: 12.5pt;
  }

  .visual-insight p {
    margin-bottom: 10px;
    color: ${C.secondaryText};
    font-size: 9.6pt;
  }

  .visual-insight ul {
    margin: 0;
    padding-left: 18px;
  }

  .visual-insight li {
    margin-bottom: 8px;
    color: ${C.secondaryText};
  }

  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 12px;
    align-content: start;
    grid-auto-flow: row dense;
  }

  .metrics-grid.stacked {
    grid-template-columns: 1fr;
  }

  /* Dashboard / appendix tables */
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 0 0 ${S.sm}px;
    font-size: 9.4pt;
    break-inside: avoid;
    page-break-inside: avoid;
  }

  thead {
    display: table-header-group;
  }

  thead th {
    background: ${C.inkWalnut};
    color: ${C.parchment};
    border: 1px solid ${C.inkWalnut};
    text-align: left;
    padding: 9px 10px;
    font-size: 8.9pt;
    font-weight: 600;
    letter-spacing: 0.35px;
  }

  tbody td {
    padding: 8px 10px;
    border: 1px solid ${C.stoneBeige};
    color: ${C.secondaryText};
    font-family: ${F.numeric};
    font-variant-numeric: tabular-nums;
  }

  tbody tr:nth-child(odd) td {
    background: ${C.parchment};
  }

  tbody tr:nth-child(even) td {
    background: ${C.warmIvory};
  }

  td:not(:first-child), th:not(:first-child) {
    text-align: right;
  }

  td:first-child, th:first-child {
    width: 40%;
  }

  .table-group {
    break-inside: avoid;
    page-break-inside: avoid;
    margin: 0;
    border: 1px solid ${C.stoneBeige};
    border-radius: 12px;
    background: ${C.warmIvory};
    padding: 10px 10px 4px;
  }

  .table-group.tall {
    grid-column: 1 / -1;
  }

  .derived-strip,
  .method-notes {
    border: 1px solid ${C.stoneBeige};
    border-radius: 12px;
    background: ${C.warmIvory};
    padding: 12px;
    grid-column: 1 / -1;
  }

  .derived-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
  }

  .derived-card {
    border: 1px solid ${C.stoneBeige};
    border-radius: 10px;
    background: ${C.parchment};
    padding: 8px 10px;
  }

  .derived-card h4 {
    margin: 0 0 5px 0;
    color: ${C.mutedText};
    font-size: 8.2pt;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .derived-card p {
    margin: 0;
    font-family: ${F.title};
    font-size: 12pt;
    color: ${C.primaryText};
    line-height: 1.15;
  }

  .derived-card span {
    display: block;
    margin-top: 4px;
    font-size: 7.8pt;
    color: ${C.mutedText};
  }

  .method-notes h3 {
    margin-bottom: 8px;
    color: ${C.primaryText};
  }

  /* Commentary */
  .commentary-block {
    background: ${C.parchment};
    border: 1px solid ${C.stoneBeige};
    border-radius: 12px;
    padding: 14px 16px;
    margin-bottom: 12px;
    min-height: 108px;
  }

  .commentary-block:nth-of-type(1) h3 { color: ${C.forestOlive}; }
  .commentary-block:nth-of-type(2) h3 { color: ${C.mutedCopper}; }
  .commentary-block:nth-of-type(3) h3 { color: ${C.burntUmber}; }

  .checklist-block {
    background: ${C.warmIvory};
    border: 1px solid ${C.stoneBeige};
    border-radius: 12px;
    padding: 12px 16px;
  }

  .checklist-block h3 {
    color: ${C.primaryText};
    margin-bottom: 8px;
  }

  /* Appendix */
  .page-appendix h3,
  .page-appendix h4 {
    color: ${C.secondaryText};
  }

  .appendix-module {
    font-size: 8.9pt;
    background: ${C.warmIvory};
    border: 1px solid ${C.stoneBeige};
    border-radius: 12px;
    padding: 12px;
  }

  .appendix-section {
    break-inside: avoid;
    page-break-inside: avoid;
    margin-bottom: 12px;
  }

  .appendix-module hr {
    border: none;
    border-top: 1px solid ${C.stoneBeige};
    margin: ${S.sm}px 0;
  }

  .page-sources .sources-module {
    background: ${C.warmIvory};
    border: 1px solid ${C.stoneBeige};
    border-radius: 10px;
    padding: ${S.sm}px;
    font-size: 9pt;
    margin-bottom: 10px;
  }

  .page-sources .methodology-module {
    background: ${C.warmIvory};
    border: 1px solid ${C.stoneBeige};
    border-radius: 10px;
    padding: ${S.sm}px;
    font-size: 9pt;
  }

  .page-sources ul {
    margin-bottom: ${S.sm}px;
  }

  .page-sources p,
  .page-sources li {
    color: ${C.secondaryText};
  }

  .sources-table .source-url {
    text-align: left;
    font-size: 8.1pt;
    color: ${C.mutedText};
    word-break: break-all;
  }

  a {
    color: ${C.burntUmber};
    text-decoration: none;
  }

  .positive { color: ${C.forestOlive}; }
  .warning { color: ${C.mutedCopper}; }
  .negative { color: ${C.burgundy}; }
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
