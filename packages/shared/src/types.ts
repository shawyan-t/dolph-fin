// ============================================================
// Filing Types
// ============================================================

export type FilingType = '10-K' | '10-Q' | '8-K' | 'DEF 14A';

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

export interface FinancialFact {
  metric: string;
  periods: Array<{
    period: string;
    value: number;
    unit: string;
    form: string;        // e.g., "10-K", "10-Q"
    filed: string;       // filing date
  }>;
}

export interface CompanyFacts {
  ticker: string;
  cik: string;
  company_name: string;
  facts: FinancialFact[];
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
  | 'pe'
  | 'pb'
  | 'de'
  | 'roe'
  | 'roa'
  | 'current_ratio'
  | 'quick_ratio'
  | 'gross_margin'
  | 'operating_margin'
  | 'net_margin'
  | 'fcf_yield';

export interface Ratio {
  name: RatioName | string;
  display_name: string;
  value: number;
  formula: string;
  components: Record<string, number>;
  period: string;
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
  };
}

// ============================================================
// SSE Event Types (for frontend streaming)
// ============================================================

export type SSEEventType = 'step' | 'partial_report' | 'final_report' | 'error';

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

export type SSEEvent =
  | SSEStepEvent
  | SSEPartialReportEvent
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
  generate(prompt: string, systemPrompt?: string): Promise<LLMResponse>;
}
