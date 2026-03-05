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
  /** SEC accession number (unique filing identifier) */
  accession_number: string;
  /** Filing URL on EDGAR */
  filing_url: string;
  /** Timestamp when this data was extracted */
  extracted_at: string;
}

export interface FinancialFact {
  metric: string;
  periods: Array<{
    period: string;
    value: number;
    unit: string;
    form: string;        // e.g., "10-K", "10-Q"
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
    /** Snapshot ID for reproducibility (set if snapshot_date was provided) */
    snapshot_id?: string;
  };
  /** Provenance manifest: maps "ticker:metric:period" → provenance receipt */
  provenance?: Record<string, ProvenanceReceipt>;
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
    options?: { temperature?: number; signal?: AbortSignal },
  ): Promise<LLMResponse>;
}
