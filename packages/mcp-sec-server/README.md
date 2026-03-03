# FilingLens SEC Server (MCP)

An MCP server that gives any LLM structured access to SEC EDGAR data — filings, financial facts, and full-text search.

## Tools

### `get_company_filings`
Retrieve recent SEC filings (10-K, 10-Q, 8-K, DEF 14A) for a stock ticker.

**Input:**
```json
{ "ticker": "AAPL", "filing_type": "10-K", "limit": 5 }
```

**Output:** Array of `{ filing_type, date_filed, accession_number, primary_document_url, description }`

### `get_filing_content`
Fetch and parse the HTML content of a specific filing. Extracts named sections (Business, Risk Factors, MD&A, etc.).

**Input:**
```json
{ "accession_number": "0000320193-24-000123", "document_url": "https://..." }
```

### `get_company_facts`
Retrieve structured XBRL financial data (revenue, net income, EPS, etc.) across reporting periods.

**Input:**
```json
{ "ticker": "AAPL" }
```

### `search_filings`
Full-text search across SEC filings by keyword.

**Input:**
```json
{ "query": "AI strategy", "ticker": "MSFT", "date_from": "2023-01-01" }
```

## Setup

```bash
pnpm install
pnpm build
```

### Claude Desktop Configuration

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "filinglens-sec": {
      "command": "node",
      "args": ["/path/to/filinglens/packages/mcp-sec-server/dist/index.js"],
      "env": {
        "FILINGLENS_SEC_USER_AGENT": "YourName your@email.com"
      }
    }
  }
}
```

## Notes

- **Rate limiting:** Max 10 requests/second to SEC EDGAR (enforced automatically)
- **Caching:** Responses cached in `~/.filinglens/cache/` (24h for listings, 7d for content)
- **User-Agent:** SEC requires identifying User-Agent header — set via `FILINGLENS_SEC_USER_AGENT`
