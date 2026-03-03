/**
 * XBRL Tag → Standardized Field Name Mappings
 *
 * SEC filings use different XBRL tags for similar concepts across companies.
 * This map normalizes them to consistent names.
 *
 * Format: standardized name → array of possible XBRL tag names
 * Tags are searched in order; first match wins.
 */

export interface XBRLMapping {
  standardName: string;
  displayName: string;
  xbrlTags: string[];
  statement: 'income' | 'balance_sheet' | 'cash_flow';
  unit: 'USD' | 'USD/shares' | 'shares' | 'pure';
  higherIsBetter: boolean;
}

export const XBRL_MAPPINGS: XBRLMapping[] = [
  // ──────────────────────────────────────────────
  // Income Statement
  // ──────────────────────────────────────────────
  {
    standardName: 'revenue',
    displayName: 'Revenue',
    xbrlTags: [
      'RevenueFromContractWithCustomerExcludingAssessedTax',
      'Revenues',
      'SalesRevenueNet',
      'RevenueFromContractWithCustomerIncludingAssessedTax',
      'SalesRevenueGoodsNet',
      'SalesRevenueServicesNet',
      'InterestAndDividendIncomeOperating', // banks
      'TotalRevenuesAndOtherIncome',
    ],
    statement: 'income',
    unit: 'USD',
    higherIsBetter: true,
  },
  {
    standardName: 'cost_of_revenue',
    displayName: 'Cost of Revenue',
    xbrlTags: [
      'CostOfGoodsAndServicesSold',
      'CostOfRevenue',
      'CostOfGoodsSold',
      'CostOfServices',
    ],
    statement: 'income',
    unit: 'USD',
    higherIsBetter: false,
  },
  {
    standardName: 'gross_profit',
    displayName: 'Gross Profit',
    xbrlTags: [
      'GrossProfit',
    ],
    statement: 'income',
    unit: 'USD',
    higherIsBetter: true,
  },
  {
    standardName: 'operating_expenses',
    displayName: 'Operating Expenses',
    xbrlTags: [
      'OperatingExpenses',
      'CostsAndExpenses',
    ],
    statement: 'income',
    unit: 'USD',
    higherIsBetter: false,
  },
  {
    standardName: 'operating_income',
    displayName: 'Operating Income',
    xbrlTags: [
      'OperatingIncomeLoss',
    ],
    statement: 'income',
    unit: 'USD',
    higherIsBetter: true,
  },
  {
    standardName: 'net_income',
    displayName: 'Net Income',
    xbrlTags: [
      'NetIncomeLoss',
      'ProfitLoss',
      'NetIncomeLossAvailableToCommonStockholdersBasic',
    ],
    statement: 'income',
    unit: 'USD',
    higherIsBetter: true,
  },
  {
    standardName: 'eps_basic',
    displayName: 'EPS (Basic)',
    xbrlTags: [
      'EarningsPerShareBasic',
    ],
    statement: 'income',
    unit: 'USD/shares',
    higherIsBetter: true,
  },
  {
    standardName: 'eps_diluted',
    displayName: 'EPS (Diluted)',
    xbrlTags: [
      'EarningsPerShareDiluted',
    ],
    statement: 'income',
    unit: 'USD/shares',
    higherIsBetter: true,
  },
  {
    standardName: 'shares_outstanding',
    displayName: 'Shares Outstanding',
    xbrlTags: [
      'CommonStockSharesOutstanding',
      'WeightedAverageNumberOfShareOutstandingBasicAndDiluted',
      'WeightedAverageNumberOfDilutedSharesOutstanding',
      'EntityCommonStockSharesOutstanding',
    ],
    statement: 'income',
    unit: 'shares',
    higherIsBetter: false,
  },
  {
    standardName: 'research_and_development',
    displayName: 'R&D Expenses',
    xbrlTags: [
      'ResearchAndDevelopmentExpense',
    ],
    statement: 'income',
    unit: 'USD',
    higherIsBetter: false, // context-dependent
  },
  {
    standardName: 'sga_expenses',
    displayName: 'SG&A Expenses',
    xbrlTags: [
      'SellingGeneralAndAdministrativeExpense',
    ],
    statement: 'income',
    unit: 'USD',
    higherIsBetter: false,
  },

  // ──────────────────────────────────────────────
  // Balance Sheet
  // ──────────────────────────────────────────────
  {
    standardName: 'total_assets',
    displayName: 'Total Assets',
    xbrlTags: [
      'Assets',
    ],
    statement: 'balance_sheet',
    unit: 'USD',
    higherIsBetter: true,
  },
  {
    standardName: 'total_liabilities',
    displayName: 'Total Liabilities',
    xbrlTags: [
      'Liabilities',
      'LiabilitiesAndStockholdersEquity', // fallback: need to subtract equity
    ],
    statement: 'balance_sheet',
    unit: 'USD',
    higherIsBetter: false,
  },
  {
    standardName: 'stockholders_equity',
    displayName: "Stockholders' Equity",
    xbrlTags: [
      'StockholdersEquity',
      'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
    ],
    statement: 'balance_sheet',
    unit: 'USD',
    higherIsBetter: true,
  },
  {
    standardName: 'current_assets',
    displayName: 'Current Assets',
    xbrlTags: [
      'AssetsCurrent',
    ],
    statement: 'balance_sheet',
    unit: 'USD',
    higherIsBetter: true,
  },
  {
    standardName: 'current_liabilities',
    displayName: 'Current Liabilities',
    xbrlTags: [
      'LiabilitiesCurrent',
    ],
    statement: 'balance_sheet',
    unit: 'USD',
    higherIsBetter: false,
  },
  {
    standardName: 'cash_and_equivalents',
    displayName: 'Cash & Equivalents',
    xbrlTags: [
      'CashAndCashEquivalentsAtCarryingValue',
      'CashCashEquivalentsAndShortTermInvestments',
      'Cash',
    ],
    statement: 'balance_sheet',
    unit: 'USD',
    higherIsBetter: true,
  },
  {
    standardName: 'total_debt',
    displayName: 'Total Debt',
    xbrlTags: [
      'LongTermDebt',
      'LongTermDebtNoncurrent',
      'DebtInstrumentCarryingAmount',
      'LongTermDebtAndCapitalLeaseObligations',
    ],
    statement: 'balance_sheet',
    unit: 'USD',
    higherIsBetter: false,
  },
  {
    standardName: 'short_term_debt',
    displayName: 'Short-Term Debt',
    xbrlTags: [
      'ShortTermBorrowings',
      'LongTermDebtCurrent',
      'DebtCurrent',
    ],
    statement: 'balance_sheet',
    unit: 'USD',
    higherIsBetter: false,
  },
  {
    standardName: 'inventory',
    displayName: 'Inventory',
    xbrlTags: [
      'InventoryNet',
      'InventoryGross',
    ],
    statement: 'balance_sheet',
    unit: 'USD',
    higherIsBetter: true, // context-dependent
  },
  {
    standardName: 'accounts_receivable',
    displayName: 'Accounts Receivable',
    xbrlTags: [
      'AccountsReceivableNetCurrent',
      'AccountsReceivableNet',
      'ReceivablesNetCurrent',
    ],
    statement: 'balance_sheet',
    unit: 'USD',
    higherIsBetter: true, // context-dependent
  },
  {
    standardName: 'goodwill',
    displayName: 'Goodwill',
    xbrlTags: [
      'Goodwill',
    ],
    statement: 'balance_sheet',
    unit: 'USD',
    higherIsBetter: true, // context-dependent
  },

  // ──────────────────────────────────────────────
  // Cash Flow Statement
  // ──────────────────────────────────────────────
  {
    standardName: 'operating_cash_flow',
    displayName: 'Operating Cash Flow',
    xbrlTags: [
      'NetCashProvidedByUsedInOperatingActivities',
      'NetCashProvidedByOperatingActivities',
    ],
    statement: 'cash_flow',
    unit: 'USD',
    higherIsBetter: true,
  },
  {
    standardName: 'capex',
    displayName: 'Capital Expenditures',
    xbrlTags: [
      'PaymentsToAcquirePropertyPlantAndEquipment',
      'PaymentsToAcquireProductiveAssets',
      'CapitalExpendituresIncurredButNotYetPaid',
    ],
    statement: 'cash_flow',
    unit: 'USD',
    higherIsBetter: false,
  },
  {
    standardName: 'investing_cash_flow',
    displayName: 'Investing Cash Flow',
    xbrlTags: [
      'NetCashProvidedByUsedInInvestingActivities',
    ],
    statement: 'cash_flow',
    unit: 'USD',
    higherIsBetter: true, // context-dependent
  },
  {
    standardName: 'financing_cash_flow',
    displayName: 'Financing Cash Flow',
    xbrlTags: [
      'NetCashProvidedByUsedInFinancingActivities',
    ],
    statement: 'cash_flow',
    unit: 'USD',
    higherIsBetter: true, // context-dependent
  },
  {
    standardName: 'dividends_paid',
    displayName: 'Dividends Paid',
    xbrlTags: [
      'PaymentsOfDividends',
      'PaymentsOfDividendsCommonStock',
    ],
    statement: 'cash_flow',
    unit: 'USD',
    higherIsBetter: false, // higher payout = returning more to shareholders
  },
  {
    standardName: 'share_repurchases',
    displayName: 'Share Repurchases',
    xbrlTags: [
      'PaymentsForRepurchaseOfCommonStock',
      'PaymentsForRepurchaseOfEquity',
    ],
    statement: 'cash_flow',
    unit: 'USD',
    higherIsBetter: false, // context-dependent
  },
];

/**
 * Build a reverse lookup: xbrlTag → standardName
 */
export function buildTagToStandardMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const mapping of XBRL_MAPPINGS) {
    for (const tag of mapping.xbrlTags) {
      if (!map.has(tag)) {
        map.set(tag, mapping.standardName);
      }
    }
  }
  return map;
}

/**
 * Get mapping by standard name
 */
export function getMappingByName(standardName: string): XBRLMapping | undefined {
  return XBRL_MAPPINGS.find(m => m.standardName === standardName);
}

/**
 * Get all mappings for a specific financial statement
 */
export function getMappingsForStatement(statement: 'income' | 'balance_sheet' | 'cash_flow'): XBRLMapping[] {
  return XBRL_MAPPINGS.filter(m => m.statement === statement);
}
