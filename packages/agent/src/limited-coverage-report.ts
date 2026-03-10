import type {
  AnalysisContext,
  ExcludedIssuerSummary,
  IssuerSupportStatus,
  Report,
  ReportSection,
} from '@dolph/shared';

function extractReportDate(generatedAt: string): string {
  return generatedAt.slice(0, 10);
}

function buildSourceList(context: AnalysisContext, tickers: string[]): Array<{ url: string; description: string; date: string }> {
  const sources: Array<{ url: string; description: string; date: string }> = [];
  for (const ticker of tickers) {
    for (const filing of context.filings[ticker] || []) {
      sources.push({
        url: filing.primary_document_url,
        description: `${ticker} ${filing.filing_type}`,
        date: filing.date_filed,
      });
    }
  }
  return sources;
}

function buildCoverageParagraph(status: IssuerSupportStatus): string {
  return `${status.ticker} does not currently support a full annual financial reconstruction through the filing-backed XBRL path. ${status.reason}`;
}

function buildSingleLimitedSections(
  ticker: string,
  status: IssuerSupportStatus,
  context: AnalysisContext,
): ReportSection[] {
  const filings = (context.filings[ticker] || []).slice(0, 5);
  const filingSentence = filings.length > 0
    ? `Recent filing activity is available, including ${filings.map(f => `${f.filing_type} (${f.date_filed})`).join(', ')}.`
    : 'No recent filing set was available for this issuer in the current run.';
  const notes = [
    buildCoverageParagraph(status),
    'A full annual report requires usable annual company facts and at least one annual income statement, balance sheet, and cash flow period.',
    filingSentence,
  ].join('\n\n');

  const sources = filings.length > 0
    ? filings.map(filing => `- [${ticker} ${filing.filing_type} (${filing.date_filed})](${filing.primary_document_url})`).join('\n')
    : '- No filing references were available for this issuer in the current run.';

  return [
    {
      id: 'executive_summary',
      title: 'Coverage Summary',
      content: notes,
    },
    {
      id: 'analyst_notes',
      title: 'Analyst Notes',
      content: `This request resolved cleanly, but Dolph did not publish a full annual financial note because the issuer did not produce a complete annual statement dataset through the current SEC/XBRL path. The result is intentionally limited rather than forcing incomplete metrics or placeholder values.`,
    },
    {
      id: 'data_sources',
      title: 'Data Sources',
      content: `${sources}\n\nSource: SEC EDGAR public filings.\nDisclaimer: For research use only; not investment advice.`,
    },
  ];
}

function buildComparisonLimitedSections(
  requestedTickers: string[],
  supportedTickers: string[],
  exclusions: ExcludedIssuerSummary[],
  context: AnalysisContext,
): ReportSection[] {
  const supportText = supportedTickers.length > 0
    ? `Usable annual financial coverage remained for ${supportedTickers.join(', ')}.`
    : 'No requested issuer produced a usable annual financial dataset for this run.';
  const exclusionText = exclusions.length > 0
    ? exclusions.map(exclusion => `${exclusion.ticker}: ${exclusion.reason}`).join(' ')
    : 'No exclusions were recorded.';

  const sources = requestedTickers
    .flatMap(ticker => (context.filings[ticker] || []).slice(0, 3).map(filing =>
      `- [${ticker} ${filing.filing_type} (${filing.date_filed})](${filing.primary_document_url})`,
    ));

  return [
    {
      id: 'executive_summary',
      title: 'Coverage Summary',
      content: [
        `A full peer comparison could not be published for ${requestedTickers.join(', ')} because at least two issuers did not clear the annual-coverage requirement.`,
        supportText,
        exclusionText,
      ].join('\n\n'),
    },
    {
      id: 'analyst_notes',
      title: 'Analyst Notes',
      content: 'Dolph only publishes a full comparison when at least two requested issuers have usable annual facts plus annual income, balance-sheet, and cash-flow periods. This limited result avoids producing a misleading side-by-side report from incomplete issuer coverage.',
    },
    {
      id: 'data_sources',
      title: 'Data Sources',
      content: `${sources.length > 0 ? sources.join('\n') : '- No filing references were available for the requested issuers in this run.'}\n\nSource: SEC EDGAR public filings.\nDisclaimer: For research use only; not investment advice.`,
    },
  ];
}

export function buildLimitedCoverageReport(args: {
  id: string;
  generatedAt: string;
  requestedTickers: string[];
  context: AnalysisContext;
  issuerSupport: Record<string, IssuerSupportStatus>;
  supportedTickers?: string[];
  exclusions?: ExcludedIssuerSummary[];
  reason?: string;
}): Report {
  const { id, generatedAt, requestedTickers, context, issuerSupport } = args;
  const supportedTickers = args.supportedTickers || [];
  const exclusions = args.exclusions || [];
  const singleStatus = requestedTickers.length === 1 ? issuerSupport[requestedTickers[0]!] : undefined;
  const sections = requestedTickers.length === 1 && singleStatus
    ? buildSingleLimitedSections(requestedTickers[0]!, singleStatus, context)
    : buildComparisonLimitedSections(requestedTickers, supportedTickers, exclusions, context);
  const reportState = singleStatus?.coverage === 'unsupported' && requestedTickers.length === 1
    ? 'unsupported_coverage'
    : 'limited_coverage';
  const summaryReason = args.reason || singleStatus?.reason || exclusions.map(item => item.reason).join(' ');

  return {
    id,
    tickers: requestedTickers,
    type: context.type,
    generated_at: generatedAt,
    policy: context.policy,
    comparison_basis: null,
    sections,
    sources: buildSourceList(context, requestedTickers),
    validation: {
      pass: true,
      checked_at: generatedAt,
      issues: summaryReason ? [{ section: 'coverage', issue: summaryReason, severity: 'warning' }] : [],
    },
    metadata: {
      llm_calls: 0,
      total_duration_ms: 0,
      data_points_used: 0,
      report_state: reportState,
      requested_tickers: [...requestedTickers],
      excluded_tickers: exclusions,
    },
  };
}

export function buildGracefulQAFallbackReport(args: {
  baseReport: Report;
  context: AnalysisContext;
  qaPath: string;
  summary: string;
}): Report {
  const { baseReport, context, qaPath, summary } = args;
  const sections: ReportSection[] = [
    {
      id: 'executive_summary',
      title: 'Coverage Summary',
      content: `${summary}\n\nDolph withheld the full financial note because final validation identified a material issue that could affect the trustworthiness of the published report.`,
    },
    {
      id: 'analyst_notes',
      title: 'Analyst Notes',
      content: 'This limited result is intentional. The underlying filing retrieval completed, but the report was downgraded rather than publishing inconsistent output.',
    },
    {
      id: 'data_sources',
      title: 'Data Sources',
      content: 'Source: SEC EDGAR public filings.\nDisclaimer: For research use only; not investment advice.',
    },
  ];

  return {
    ...baseReport,
    sections,
    comparison_basis: null,
    validation: {
      pass: true,
      checked_at: baseReport.generated_at,
      issues: [{ section: 'coverage', issue: summary, severity: 'warning' }],
    },
    metadata: {
      ...baseReport.metadata,
      report_state: 'limited_coverage',
      requested_tickers: [...(baseReport.metadata.requested_tickers || baseReport.tickers)],
      excluded_tickers: baseReport.metadata.excluded_tickers || context.comparison_exclusions || [],
    },
    narrative: undefined,
  };
}
