// ============================================================
// SEC EDGAR API Endpoints
// ============================================================

export const SEC_SUBMISSIONS_URL = 'https://data.sec.gov/submissions/CIK{cik}.json';
export const SEC_XBRL_COMPANY_FACTS_URL = 'https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json';
export const SEC_FULL_TEXT_SEARCH_URL = 'https://efts.sec.gov/LATEST/search-index';
export const SEC_COMPANY_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
export const SEC_EDGAR_ARCHIVES_URL = 'https://www.sec.gov/Archives/edgar/data';

// ============================================================
// Rate Limiting
// ============================================================

export const SEC_MAX_REQUESTS_PER_SECOND = 10;
export const SEC_REQUEST_INTERVAL_MS = Math.ceil(1000 / SEC_MAX_REQUESTS_PER_SECOND);

// ============================================================
// Cache TTLs (milliseconds)
// ============================================================

export const CACHE_TTL_FILINGS_LIST = 24 * 60 * 60 * 1000;     // 24 hours
export const CACHE_TTL_FILING_CONTENT = 7 * 24 * 60 * 60 * 1000; // 7 days
export const CACHE_TTL_COMPANY_FACTS = 24 * 60 * 60 * 1000;     // 24 hours
export const CACHE_TTL_SEARCH = 6 * 60 * 60 * 1000;             // 6 hours
export const CACHE_TTL_TICKERS = 30 * 24 * 60 * 60 * 1000;      // 30 days
export const CACHE_TTL_FX_RATES = 24 * 60 * 60 * 1000;          // 24 hours

// ============================================================
// Default Configuration
// ============================================================

export const DEFAULT_CACHE_DIR = '~/.dolph/cache';
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_MAX_VALIDATION_LOOPS = 2;
export const DEFAULT_FILINGS_LIMIT = 10;

// ============================================================
// Filing Section Patterns (for 10-K/10-Q parsing)
// ============================================================

export const FILING_10K_SECTIONS: Record<string, string> = {
  'Item 1': 'Business Overview',
  'Item 1A': 'Risk Factors',
  'Item 1B': 'Unresolved Staff Comments',
  'Item 2': 'Properties',
  'Item 3': 'Legal Proceedings',
  'Item 4': 'Mine Safety Disclosures',
  'Item 5': 'Market for Common Equity',
  'Item 6': 'Reserved',
  'Item 7': "Management's Discussion and Analysis (MD&A)",
  'Item 7A': 'Quantitative and Qualitative Disclosures about Market Risk',
  'Item 8': 'Financial Statements and Supplementary Data',
  'Item 9': 'Changes in and Disagreements with Accountants',
  'Item 9A': 'Controls and Procedures',
  'Item 9B': 'Other Information',
  'Item 10': 'Directors and Executive Officers',
  'Item 11': 'Executive Compensation',
  'Item 12': 'Security Ownership',
  'Item 13': 'Certain Relationships and Related Transactions',
  'Item 14': 'Principal Accountant Fees and Services',
  'Item 15': 'Exhibits and Financial Statement Schedules',
};

// ============================================================
// Report Required Sections
// ============================================================

/** Required sections for single-company reports */
export const REQUIRED_SINGLE_SECTIONS = [
  'executive_summary',
  'key_metrics',
  'trend_analysis',
  'risk_factors',
  'financial_statements',
  'analyst_notes',
  'data_sources',
] as const;

/** Required sections for comparison reports */
export const REQUIRED_COMPARISON_SECTIONS = [
  'executive_summary',
  'key_metrics',
  'relative_strengths',
  'risk_factors',
  'financial_statements',
  'analyst_notes',
  'data_sources',
] as const;

/**
 * @deprecated Use REQUIRED_SINGLE_SECTIONS or REQUIRED_COMPARISON_SECTIONS instead.
 * Kept for backwards compatibility.
 */
export const REQUIRED_REPORT_SECTIONS = REQUIRED_SINGLE_SECTIONS;

/** Sections generated deterministically in code (never by LLM) */
export const DETERMINISTIC_SECTION_IDS = [
  'key_metrics',
  'financial_statements',
  'data_sources',
] as const;

/** Filing forms used by search and listing flows */
export const SUPPORTED_FILING_FORMS = [
  '10-K',
  '10-Q',
  '8-K',
  'DEF 14A',
  '20-F',
  '6-K',
  '40-F',
] as const;

/** Comma-separated value for SEC full-text search `forms` query param */
export const SUPPORTED_FILING_FORMS_CSV = SUPPORTED_FILING_FORMS.join(',');

// ============================================================
// Validation: Filler Phrases to Flag
// ============================================================

export const FILLER_PHRASES = [
  'growing steadily',
  'performing well',
  'remains strong',
  'continues to grow',
  'solid performance',
  'healthy growth',
  'significant potential',
  'well-positioned',
  'strong fundamentals',
  'positive trajectory',
  'robust growth',
  'notable improvement',
];
