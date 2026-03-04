/**
 * XBRL Tag → Standardized Field Name Mappings
 *
 * SEC filings use different XBRL tags for similar concepts across companies.
 * This map normalizes them to consistent names.
 *
 * Supports both US-GAAP tags (domestic filers: 10-K) and IFRS tags
 * (foreign private issuers: 20-F, Canadian: 40-F).
 *
 * Format: standardized name → array of possible XBRL tag names
 * Tags are searched in order across all namespaces; first match wins.
 */

export interface XBRLMapping {
  standardName: string;
  displayName: string;
  /** US-GAAP XBRL tag names, searched in order */
  xbrlTags: string[];
  /** IFRS XBRL tag names for foreign filers, searched in order */
  ifrsTags: string[];
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
      'InterestAndDividendIncomeOperating',
      'TotalRevenuesAndOtherIncome',
    ],
    ifrsTags: [
      'Revenue',
      'RevenueFromContractsWithCustomers',
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
    ifrsTags: [
      'CostOfSales',
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
    ifrsTags: [
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
    ifrsTags: [
      'SellingGeneralAndAdministrativeExpense',
      'AdministrativeExpense',
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
    ifrsTags: [
      'ProfitLossFromOperatingActivities',
      'OperatingProfit',
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
    ifrsTags: [
      'ProfitLoss',
      'ProfitLossAttributableToOwnersOfParent',
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
    ifrsTags: [
      'BasicEarningsLossPerShare',
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
    ifrsTags: [
      'DilutedEarningsLossPerShare',
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
    ifrsTags: [
      'AdjustedWeightedAverageShares',
      'WeightedAverageShares',
      'IssuedCapitalShares',
    ],
    statement: 'balance_sheet',
    unit: 'shares',
    higherIsBetter: false,
  },
  {
    standardName: 'research_and_development',
    displayName: 'R&D Expenses',
    xbrlTags: [
      'ResearchAndDevelopmentExpense',
    ],
    ifrsTags: [
      'ResearchAndDevelopmentExpense',
    ],
    statement: 'income',
    unit: 'USD',
    higherIsBetter: false,
  },
  {
    standardName: 'sga_expenses',
    displayName: 'SG&A Expenses',
    xbrlTags: [
      'SellingGeneralAndAdministrativeExpense',
    ],
    ifrsTags: [
      'SellingGeneralAndAdministrativeExpense',
      'SellingExpense',
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
    ifrsTags: [
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
    ],
    ifrsTags: [
      'Liabilities',
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
    ifrsTags: [
      'Equity',
      'EquityAttributableToOwnersOfParent',
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
    ifrsTags: [
      'CurrentAssets',
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
    ifrsTags: [
      'CurrentLiabilities',
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
    ifrsTags: [
      'CashAndCashEquivalents',
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
      'DebtAndCapitalLeaseObligations',
      'DebtAndFinanceLeaseLiabilities',
      'Debt',
      'DebtInstrumentCarryingAmount',
    ],
    ifrsTags: [
      'Borrowings',
      'LoansAndBorrowings',
      'TotalBorrowings',
    ],
    statement: 'balance_sheet',
    unit: 'USD',
    higherIsBetter: false,
  },
  {
    standardName: 'long_term_debt',
    displayName: 'Long-Term Debt',
    xbrlTags: [
      'LongTermDebt',
      'LongTermDebtNoncurrent',
      'LongTermDebtAndCapitalLeaseObligations',
    ],
    ifrsTags: [
      'NoncurrentPortionOfNoncurrentBorrowings',
      'BorrowingsNoncurrent',
      'NoncurrentFinancialLiabilities',
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
    ifrsTags: [
      'CurrentPortionOfNoncurrentBorrowings',
      'ShorttermBorrowings',
      'CurrentBorrowings',
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
    ifrsTags: [
      'Inventories',
      'CurrentInventories',
    ],
    statement: 'balance_sheet',
    unit: 'USD',
    higherIsBetter: true,
  },
  {
    standardName: 'accounts_receivable',
    displayName: 'Accounts Receivable',
    xbrlTags: [
      'AccountsReceivableNetCurrent',
      'AccountsReceivableNet',
      'ReceivablesNetCurrent',
    ],
    ifrsTags: [
      'TradeAndOtherCurrentReceivables',
      'CurrentTradeReceivables',
    ],
    statement: 'balance_sheet',
    unit: 'USD',
    higherIsBetter: true,
  },
  {
    standardName: 'goodwill',
    displayName: 'Goodwill',
    xbrlTags: [
      'Goodwill',
    ],
    ifrsTags: [
      'Goodwill',
    ],
    statement: 'balance_sheet',
    unit: 'USD',
    higherIsBetter: true,
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
    ifrsTags: [
      'CashFlowsFromUsedInOperatingActivities',
      'CashFlowsFromUsedInOperations',
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
    ifrsTags: [
      'PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities',
      'AcquisitionsOfPropertyPlantAndEquipment',
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
    ifrsTags: [
      'CashFlowsFromUsedInInvestingActivities',
    ],
    statement: 'cash_flow',
    unit: 'USD',
    higherIsBetter: true,
  },
  {
    standardName: 'financing_cash_flow',
    displayName: 'Financing Cash Flow',
    xbrlTags: [
      'NetCashProvidedByUsedInFinancingActivities',
    ],
    ifrsTags: [
      'CashFlowsFromUsedInFinancingActivities',
    ],
    statement: 'cash_flow',
    unit: 'USD',
    higherIsBetter: true,
  },
  {
    standardName: 'dividends_paid',
    displayName: 'Dividends Paid',
    xbrlTags: [
      'PaymentsOfDividends',
      'PaymentsOfDividendsCommonStock',
    ],
    ifrsTags: [
      'DividendsPaidClassifiedAsFinancingActivities',
      'DividendsPaid',
    ],
    statement: 'cash_flow',
    unit: 'USD',
    higherIsBetter: false,
  },
  {
    standardName: 'share_repurchases',
    displayName: 'Share Repurchases',
    xbrlTags: [
      'PaymentsForRepurchaseOfCommonStock',
      'PaymentsForRepurchaseOfEquity',
    ],
    ifrsTags: [
      'PurchaseOfTreasuryShares',
    ],
    statement: 'cash_flow',
    unit: 'USD',
    higherIsBetter: false,
  },
];

/**
 * Build a reverse lookup: xbrlTag → standardName (covers both US-GAAP and IFRS)
 */
export function buildTagToStandardMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const mapping of XBRL_MAPPINGS) {
    for (const tag of mapping.xbrlTags) {
      if (!map.has(tag)) map.set(tag, mapping.standardName);
    }
    for (const tag of mapping.ifrsTags) {
      if (!map.has(tag)) map.set(tag, mapping.standardName);
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
