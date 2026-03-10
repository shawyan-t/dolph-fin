// ============================================================
// Filing Types
// ============================================================

export type FilingType = '10-K' | '10-Q' | '8-K' | 'DEF 14A' | '20-F' | '6-K' | '40-F';

export interface Filing {
  filing_type: FilingType;
  date_filed: string;
  accession_number: string;
  primary_document_url: string;
  description: string;
}

export interface FilingSection {
  title: string;
  content: string;
}

export interface FilingContent {
  sections: FilingSection[];
  raw_text: string;
  word_count: number;
}

export interface FilingSearchResult {
  filing_type: string;
  date_filed: string;
  accession_number: string;
  company_name: string;
  snippet: string;
  primary_document_url: string;
}

// ============================================================
// Financial Types
// ============================================================

export type StatementType = 'income' | 'balance_sheet' | 'cash_flow';
export type Period = 'annual' | 'quarterly';

/** Provenance receipt for a single data point — traces back to exact SEC source */
export interface ProvenanceReceipt {
  /** XBRL tag name used (e.g., "RevenueFromContractWithCustomerExcludingAssessedTax") */
  xbrl_tag: string;
  /** XBRL namespace (e.g., "us-gaap", "ifrs-full") */
  namespace: string;
  /** Governed concept-selection policy used for this tag, if applicable */
  selection_policy?: string;
  /** Concept scope that won under the governed selection policy */
  concept_scope?: string;
  /** Candidate tags considered during governed concept resolution */
  candidate_tags_considered?: string[];
  /** Human-readable rationale for the selected tag */
  selection_rationale?: string;
  /** SEC accession number (unique filing identifier) */
  accession_number: string;
  /** Filing URL on EDGAR */
  filing_url: string;
  /** Timestamp when this data was extracted */
  extracted_at: string;
}

export interface FinancialFact {
  metric: string;
  label?: string;
  description?: string;
  periods: Array<{
    period: string;
    value: number;
    unit: string;
    form: string;        // e.g., "10-K", "10-Q"
    fiscal_year?: number;
    fiscal_period?: string;
    filed: string;       // filing date
    /** Provenance tracking — traces this value to its SEC source */
    provenance?: ProvenanceReceipt;
  }>;
}

export interface CompanyFacts {
  ticker: string;
  cik: string;
  company_name: string;
  facts: FinancialFact[];
  /** FX conversion note if values were converted from a foreign currency to USD */
  fx_note?: string;
}

export interface FinancialStatement {
  ticker: string;
  statement_type: StatementType;
  period_type: Period;
  periods: Array<{
    period: string;
    filed: string;
    form?: string;
    fiscal_year?: number;
    fiscal_period?: string;
    data: Record<string, number>;
  }>;
}

export type RatioName =
  | 'eps'
  | 'bvps'
  | 'de'
  | 'roe'
  | 'roa'
  | 'current_ratio'
  | 'quick_ratio'
  | 'gross_margin'
  | 'operating_margin'
  | 'net_margin'
  | 'fcf';

export interface Ratio {
  name: RatioName | string;
  display_name: string;
  value: number;
  formula: string;
  components: Record<string, number>;
  period: string;
  /** Provenance: maps component metric name → its provenance receipt */
  provenance?: Record<string, ProvenanceReceipt>;
  /** QA notes (e.g. missing inventory for quick ratio) */
  notes?: string[];
}

export interface TrendData {
  metric: string;
  values: Array<{
    period: string;
    value: number;
    yoy_growth: number | null;  // null for first period
  }>;
  cagr: number | null;           // null if insufficient data
  anomalies: Array<{
    period: string;
    description: string;
    yoy_growth: number;
  }>;
}

export interface CompanyComparison {
  tickers: string[];
  metrics: Array<{
    metric: string;
    values: Record<string, number | null>;  // ticker → value
    rankings: Record<string, number>;        // ticker → rank (1 = best)
  }>;
}

// ============================================================
// Reporting Governance Types
// ============================================================

export type ReportingMode = 'institutional' | 'screening';
export type ComparisonBasisMode =
  | 'overlap_normalized'
  | 'latest_per_peer_screening'
  | 'latest_per_peer_with_prominent_disclosure';
export type ReturnMetricBasisMode = 'average_balance' | 'ending_balance';
export type SparseDerivationMode = 'standard' | 'expanded';
export type NarrativeGovernanceMode = 'deterministic' | 'structured_llm';
export type ComparisonFallbackMode =
  | 'latest_per_peer_screening'
  | 'latest_per_peer_with_prominent_disclosure';
export type ShareBasisKind =
  | 'period_end_shares'
  | 'ending_diluted_shares'
  | 'weighted_average_basic'
  | 'weighted_average_diluted'
  | 'cross_validated_fallback';
export type MetricAvailabilityReasonCode =
  | 'reported'
  | 'derived'
  | 'intentionally_suppressed'
  | 'ratio_fallback'
  | 'missing_inputs'
  | 'policy_disallowed'
  | 'sanity_excluded'
  | 'basis_conflict'
  | 'comparability_policy'
  | 'source_unavailable'
  | 'statement_gap';

export type IssuerCoverageState = 'full_annual' | 'partial_filing' | 'unsupported';
export type ConceptReliabilityState = 'high_confidence' | 'suppressed_conflict' | 'insufficient_data';

export interface IssuerSupportStatus {
  ticker: string;
  coverage: IssuerCoverageState;
  reason: string;
  facts_count: number;
  annual_filings_count: number;
  annual_statement_periods: {
    income: number;
    balance_sheet: number;
    cash_flow: number;
  };
  debt_reliability: ConceptReliabilityState;
  liquidity_reliability: ConceptReliabilityState;
  safe_for_standalone: boolean;
  safe_for_comparison: boolean;
}

export interface ExcludedIssuerSummary {
  ticker: string;
  coverage: IssuerCoverageState;
  reason: string;
}

export interface ReportingPolicy {
  mode: ReportingMode;
  comparisonBasisMode: ComparisonBasisMode;
  requestedComparisonBasisMode?: ComparisonBasisMode;
  statementHistoryPeriods: number;
  trendHistoryPeriods: number;
  returnMetricBasisMode: ReturnMetricBasisMode;
  sparseDerivationMode: SparseDerivationMode;
  strictLayoutQA: boolean;
  persistAuditArtifacts: boolean;
  narrativeGovernanceMode: NarrativeGovernanceMode;
  allowExternalContext: boolean;
  comparisonRequireOverlap: boolean;
  comparisonFallbackMode?: ComparisonFallbackMode | null;
  comparisonMaxPeriodSpreadDays: number;
  metricNAInference: 'governed' | 'minimal';
  displayDerivedLabels: boolean;
  percentMeaningfulBase: number;
}

export interface MetricBasisUsage {
  metric: string;
  displayName: string;
  basis: ShareBasisKind | ReturnMetricBasisMode | 'reported' | 'derived';
  note?: string;
  disclosureText?: string;
  alternativesConsidered?: string[];
  fallbackUsed?: boolean;
}

export interface AuditArtifactManifest {
  directory: string;
  generated_at: string;
  files: Record<string, string>;
}

export interface StructuredNarrativeParagraph {
  text: string;
  fact_ids: string[];
}

export interface StructuredNarrativeSection {
  id: string;
  title: string;
  rendered_content?: string;
  paragraphs: StructuredNarrativeParagraph[];
  warnings?: string[];
}

export interface StructuredNarrativePayload {
  mode: NarrativeGovernanceMode;
  sections: StructuredNarrativeSection[];
}

export interface ComparisonPeerPeriodBinding {
  current_period: string | null;
  prior_period: string | null;
}

export interface ComparisonBasisResolution {
  requested_mode: ComparisonBasisMode;
  effective_mode: ComparisonBasisMode;
  status: 'resolved' | 'downgraded' | 'unavailable';
  resolution_kind:
    | 'none'
    | 'exact_date_overlap'
    | 'fiscal_cohort_tolerance'
    | 'latest_per_peer';
  comparable_current_key: string | null;
  comparable_prior_key: string | null;
  max_current_spread_days: number | null;
  max_prior_spread_days: number | null;
  note: string;
  fallback_reason?: string | null;
  peer_periods: Record<string, ComparisonPeerPeriodBinding>;
}

// ============================================================
// Agent Types
// ============================================================

export type AnalysisType = 'single' | 'comparison';

export interface AgentStep {
  tool: string;
  params: Record<string, unknown>;
  purpose: string;
}

export interface AgentPlan {
  type: AnalysisType;
  tickers: string[];
  steps: AgentStep[];
}

export interface StepResult {
  tool: string;
  success: boolean;
  data: unknown;
  error?: string;
  duration_ms: number;
}

export interface AnalysisContext {
  tickers: string[];
  type: AnalysisType;
  policy?: ReportingPolicy;
  comparison_basis?: ComparisonBasisResolution | null;
  issuer_support?: Record<string, IssuerSupportStatus>;
  comparison_exclusions?: ExcludedIssuerSummary[];
  plan: AgentPlan;
  results: StepResult[];
  filings: Record<string, Filing[]>;
  filing_content: Record<string, FilingContent>;
  facts: Record<string, CompanyFacts>;
  statements: Record<string, FinancialStatement[]>;
  ratios: Record<string, Ratio[]>;
  trends: Record<string, TrendData[]>;
  comparison?: CompanyComparison;
}

// ============================================================
// Validation Types
// ============================================================

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
  section: string;
  issue: string;
  severity: ValidationSeverity;
}

export interface ValidationResult {
  pass: boolean;
  issues: ValidationIssue[];
  checked_at: string;
}

// ============================================================
// Report Types
// ============================================================

export type ReportSectionId =
  | 'executive_summary'
  | 'key_metrics'
  | 'trend_analysis'
  | 'relative_strengths'
  | 'risk_factors'
  | 'financial_statements'
  | 'analyst_notes'
  | 'data_sources';

export interface ReportSection {
  id: ReportSectionId | string;
  title: string;
  content: string;
}

export interface Report {
  id: string;
  tickers: string[];
  type: AnalysisType;
  generated_at: string;
  policy?: ReportingPolicy;
  comparison_basis?: ComparisonBasisResolution | null;
  sections: ReportSection[];
  sources: Array<{
    url: string;
    description: string;
    date: string;
  }>;
  validation: ValidationResult;
  metadata: {
    llm_calls: number;
    total_duration_ms: number;
    data_points_used: number;
    report_state?: 'full' | 'limited_coverage' | 'unsupported_coverage';
    requested_tickers?: string[];
    excluded_tickers?: ExcludedIssuerSummary[];
    /** Snapshot ID for reproducibility (set if snapshot_date was provided) */
    snapshot_id?: string;
    policy_mode?: ReportingMode;
    comparison_basis_mode?: ComparisonBasisMode;
  };
  /** Provenance manifest: maps "ticker:metric:period" → provenance receipt */
  provenance?: Record<string, ProvenanceReceipt>;
  audit?: AuditArtifactManifest;
  narrative?: StructuredNarrativePayload;
}

// ============================================================
// SSE Event Types (for frontend streaming)
// ============================================================

export type SSEEventType = 'step' | 'partial_report' | 'charts' | 'final_report' | 'error';

export interface SSEStepEvent {
  type: 'step';
  data: {
    step: string;
    status: 'running' | 'complete' | 'error';
    detail?: string;
  };
}

export interface SSEPartialReportEvent {
  type: 'partial_report';
  data: {
    section: ReportSectionId | string;
    content: string;
  };
}

export interface SSEFinalReportEvent {
  type: 'final_report';
  data: Report;
}

export interface SSEErrorEvent {
  type: 'error';
  data: {
    message: string;
    code?: string;
  };
}

export interface SSEChartsEvent {
  type: 'charts';
  data: {
    revenueMarginChart: string | null;
    fcfBridgeChart: string | null;
    peerScorecardChart: string | null;
    returnLeverageChart: string | null;
    growthDurabilityChart: string | null;
  };
}

export type SSEEvent =
  | SSEStepEvent
  | SSEPartialReportEvent
  | SSEChartsEvent
  | SSEFinalReportEvent
  | SSEErrorEvent;

// ============================================================
// LLM Provider Types
// ============================================================

export type LLMProviderName = 'openai' | 'gemini' | 'groq';

export interface LLMConfig {
  provider: LLMProviderName;
  model: string;
  apiKey: string;
}

export interface LLMResponse {
  content: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  model: string;
}

export interface LLMProvider {
  name: LLMProviderName;
  generate(
    prompt: string,
    systemPrompt?: string,
    options?: { temperature?: number; signal?: AbortSignal; maxTokens?: number; jsonMode?: boolean },
  ): Promise<LLMResponse>;
}
