# FilingLens Financials Server (MCP)

An MCP server that provides computed financial metrics, ratios, trend analysis, and company comparisons from SEC XBRL data.

## Tools

### `get_financial_statements`
Normalized financial statement data (income, balance sheet, cash flow) across periods.

**Input:**
```json
{ "ticker": "AAPL", "statement": "income", "period": "annual", "limit": 5 }
```

### `calculate_ratios`
Compute financial ratios with formulas and component values for verification.

**Input:**
```json
{ "ticker": "AAPL", "ratios": ["roe", "de", "gross_margin"] }
```

**Output includes:**
```json
{
  "name": "roe",
  "display_name": "Return on Equity",
  "value": 1.7145,
  "formula": "net_income / stockholders_equity",
  "components": { "net_income": 96995000000, "stockholders_equity": 56572000000 }
}
```

### `get_trend_analysis`
YoY growth rates, CAGR, and anomaly detection for financial metrics.

**Input:**
```json
{ "ticker": "AAPL", "metrics": ["revenue", "net_income"], "periods": 10 }
```

### `compare_companies`
Side-by-side comparison of metrics across multiple tickers with rankings.

**Input:**
```json
{ "tickers": ["AAPL", "MSFT", "GOOGL"], "metrics": ["revenue", "net_income", "operating_margin"] }
```

## Setup

```bash
pnpm install
pnpm build
```

### Claude Desktop Configuration

```json
{
  "mcpServers": {
    "filinglens-financials": {
      "command": "node",
      "args": ["/path/to/filinglens/packages/mcp-financials-server/dist/index.js"],
      "env": {
        "FILINGLENS_SEC_USER_AGENT": "YourName your@email.com"
      }
    }
  }
}
```
