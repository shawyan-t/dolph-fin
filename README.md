# Dolph

Dolph is a filing-grounded financial analysis system built around SEC EDGAR and XBRL data.

It does four things:

1. Retrieves public company filing data directly from SEC EDGAR
2. Reconstructs annual financial statements and canonical metrics deterministically
3. Generates standalone and peer-comparison research-note style reports
4. Exports both full audit data and chart-ready CSV datasets

The system is designed to be deterministic first. The finance engine, statement normalization, reconciliation logic, metric derivation, and QA gates are code-driven. Narrative can run in fully deterministic mode or use a tightly constrained LLM path for the executive summary only.

## What Dolph Produces

For a supported issuer or peer set, Dolph can produce:

- terminal report output
- PDF report output
- full unified data export: `*_data.csv`
- chart-ready per-chart CSV exports: `*_chart_data/*.csv`
- audit artifacts written beside PDFs
- filing text downloads from SEC search results

If a company does not have usable annual XBRL-backed coverage, Dolph degrades gracefully into:

- a limited-coverage result
- or an unsupported explanation

instead of throwing a raw backend failure at the user.

## Core Principles

- SEC/EDGAR first: no third-party market/fundamental API is required for the core product
- deterministic finance engine: calculations and statement logic are code-based, not LLM-generated
- canonical report package: rendering, QA, charts, and exports all consume the same sealed report data
- fail closed internally, degrade gracefully externally: internal QA is strict, but the user experience is product-oriented
- evidence-first reporting: appendix sections and provenance artifacts preserve source traceability

## Workspace Layout

```text
dolph/
├── docs/
│   └── reporting-governance.md
├── packages/
│   ├── agent/                   # Main analysis/report pipeline and CLI
│   ├── bootup/                  # Terminal splash animation
│   ├── mcp-financials-server/   # Deterministic financial math and normalized statements
│   ├── mcp-sec-server/          # SEC EDGAR retrieval and filing/XBRL access
│   ├── shared/                  # Shared types, mappings, constants
│   └── web/                     # Next.js frontend
├── .env.example
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## Package Responsibilities

### `packages/agent`

The main product package.

It contains:

- CLI entrypoint
- end-to-end pipeline orchestration
- coverage preflight and graceful downgrade logic
- deterministic narrative generation
- narrative quality and QA
- PDF generation
- Datawrapper chart preparation and rendering
- CSV export
- audit artifact writing

Important files:

- [packages/agent/src/cli.ts](/Users/shawyant/Documents/projs/fagent/packages/agent/src/cli.ts)
- [packages/agent/src/pipeline.ts](/Users/shawyant/Documents/projs/fagent/packages/agent/src/pipeline.ts)
- [packages/agent/src/exporter.ts](/Users/shawyant/Documents/projs/fagent/packages/agent/src/exporter.ts)
- [packages/agent/src/charts.ts](/Users/shawyant/Documents/projs/fagent/packages/agent/src/charts.ts)
- [packages/agent/src/exporter-csv.ts](/Users/shawyant/Documents/projs/fagent/packages/agent/src/exporter-csv.ts)

### `packages/mcp-sec-server`

The SEC/EDGAR access layer.

It provides tools for:

- recent filing retrieval
- filing search
- filing text extraction
- company facts retrieval
- ticker resolution

Important files:

- [packages/mcp-sec-server/src/index.ts](/Users/shawyant/Documents/projs/fagent/packages/mcp-sec-server/src/index.ts)
- [packages/mcp-sec-server/README.md](/Users/shawyant/Documents/projs/fagent/packages/mcp-sec-server/README.md)

### `packages/mcp-financials-server`

The deterministic financial computation layer.

It provides:

- normalized financial statements
- ratio calculations
- trend analysis
- company comparisons

Important files:

- [packages/mcp-financials-server/src/index.ts](/Users/shawyant/Documents/projs/fagent/packages/mcp-financials-server/src/index.ts)
- [packages/mcp-financials-server/README.md](/Users/shawyant/Documents/projs/fagent/packages/mcp-financials-server/README.md)

### `packages/shared`

Shared domain model and mappings:

- report types
- canonical metric availability states
- XBRL mappings
- constants and formatting contracts

### `packages/web`

The web UI package.

It is a Next.js application that uses the workspace packages rather than duplicating pipeline logic.

### `packages/bootup`

The terminal splash animation package used by the CLI at startup.

## End-to-End Runtime Flow

The main execution flow lives in [packages/agent/src/pipeline.ts](/Users/shawyant/Documents/projs/fagent/packages/agent/src/pipeline.ts).

At a high level:

1. Resolve report policy
2. Create a deterministic execution plan
3. Execute SEC and financial tool calls
4. Classify issuer support before analysis
5. Lock annual periods
6. Align filing context to the locked annual basis
7. Build one canonical report package
8. Generate narrative
9. Fill deterministic sections
10. Run narrative quality pass
11. Run deterministic QA
12. Return:
   - full report
   - limited-coverage report
   - or unsupported explanation

The PDF path then:

1. consumes the sealed canonical package
2. renders charts
3. generates HTML
4. renders PDF through Puppeteer
5. writes audit artifacts

## Coverage Model

Dolph classifies issuers before full report generation.

That logic lives in [packages/agent/src/issuer-support.ts](/Users/shawyant/Documents/projs/fagent/packages/agent/src/issuer-support.ts).

Coverage states:

- `full_annual`
- `partial_filing`
- `unsupported`

Full reports only run when Dolph has:

- usable annual company facts
- at least one annual income statement period
- at least one annual balance sheet period
- at least one annual cash flow period

If not, Dolph degrades into a clean limited-coverage or unsupported result.

## Reporting Modes

Narrative behavior:

- `deterministic`
- `llm`

Default behavior is deterministic unless explicitly configured otherwise.

LLM usage is intentionally constrained. The live path only uses it for the executive summary. The finance engine and report math remain deterministic.

Comparison behavior:

- compare mode defaults to screening-style comparison policy
- arbitrary user-selected compare sets are allowed
- unsupported issuers are excluded cleanly when possible

## Generated Outputs

By default, report files go into:

- [packages/agent/reports](/Users/shawyant/Documents/projs/fagent/packages/agent/reports)

That path is resolved by:

- [packages/agent/src/report-paths.ts](/Users/shawyant/Documents/projs/fagent/packages/agent/src/report-paths.ts)

Typical output set for a full PDF run:

- `TICKER-YYYY-MM-DDTHH-MM-SS.pdf`
- `TICKER-...-audit/`
- `TICKER_data.csv`
- `TICKER_chart_data/`

Comparison outputs use ticker slugs like:

- `NVDA-WPC-2026-03-10T00-00-00.pdf`

### CSV Export Contract

CSV export is handled by [packages/agent/src/exporter-csv.ts](/Users/shawyant/Documents/projs/fagent/packages/agent/src/exporter-csv.ts).

Each export now writes:

1. `*_data.csv`
   - full unified audit/data file
   - includes facts, metrics, and ratios
   - good for analysis, provenance, debugging, and data inspection

2. `*_chart_data/`
   - one chart-ready CSV per chart
   - each file is shaped for Datawrapper or other chart tools
   - these are not raw record tables

Examples:

- `01_revenue_trend.csv`
- `02_margin_trend.csv`
- `03_cash_flow_profile.csv`
- `04_balance_sheet_posture.csv`

## Chart System

Chart preparation is deterministic and chart-specific.

Important files:

- [packages/agent/src/charts.ts](/Users/shawyant/Documents/projs/fagent/packages/agent/src/charts.ts)
- [packages/agent/src/datawrapper.ts](/Users/shawyant/Documents/projs/fagent/packages/agent/src/datawrapper.ts)

Design rules:

- one chart = one chart-ready dataset
- no raw metadata matrix upload to Datawrapper
- no raw XBRL facts used as first-pass chart input
- `metrics.csv`-style canonical values drive absolute charts
- ratio rows drive ratio charts
- Datawrapper is the renderer, not the chart decision engine

Current behavior:

- SVG export is preferred
- PNG fallback is automatic if SVG export is unavailable
- one failed chart does not kill the whole report

## Audit Artifacts

Successful PDF runs persist audit packages beside the report.

Important documentation:

- [docs/reporting-governance.md](/Users/shawyant/Documents/projs/fagent/docs/reporting-governance.md)

Artifacts include:

- `policy-manifest.json`
- `period-basis-manifest.json`
- `canonical-ledger.json`
- `report-model.json`
- `source-manifest.json`
- `qa-result.json`
- `narrative-payload.json`
- `layout-qa-report.json`
- `render-manifest.json`
- chart render diagnostics
- chart-ready dataset previews

## Environment Variables

Base environment contract from [`.env.example`](/Users/shawyant/Documents/projs/fagent/.env.example):

```bash
# LLM Provider Configuration
DOLPH_LLM_PROVIDER=openai
DOLPH_LLM_MODEL=gpt-4o-mini

# API Keys
DOLPH_OPENAI_API_KEY=
DOLPH_GEMINI_API_KEY=
DOLPH_GROQ_API_KEY=

# SEC EDGAR Configuration
DOLPH_SEC_USER_AGENT="Dolph contact@youremail.com"

# Cache
DOLPH_CACHE_DIR=~/.dolph/cache

# Agent Configuration
DOLPH_MAX_RETRIES=2
DOLPH_MAX_VALIDATION_LOOPS=2
```

Additional runtime variables used by the current system:

- `DATAWRAPPER_API_KEY`
  - optional
  - enables remote Datawrapper chart rendering
- `DOLPH_NARRATIVE_MODE`
  - `deterministic` or `llm`
- `DOLPH_CHART_EXPORT_PREFERRED`
  - preferred chart asset export format
  - current supported values: `svg`, `png`
- `DOLPH_CHART_ALLOW_PNG_FALLBACK`
  - defaults to `true`
- `PUPPETEER_EXECUTABLE_PATH`
  - optional override for Chrome/Chromium path

## Installation

### Prerequisites

- Node.js 20+
- pnpm
- a valid SEC user-agent string
- Chrome or Chromium for PDF generation

### Install

```bash
pnpm install
cp .env.example .env
```

Then edit `.env` and set at minimum:

```bash
DOLPH_SEC_USER_AGENT="Your Name your@email.com"
```

If you want LLM-backed executive summaries:

```bash
DOLPH_OPENAI_API_KEY=...
```

If you want Datawrapper rendering:

```bash
DATAWRAPPER_API_KEY=...
```

## Root Commands

From the workspace root:

```bash
pnpm install
pnpm build
pnpm test
pnpm dev
pnpm start
pnpm analyze
pnpm bootup
```

What they do:

- `pnpm build`
  - runs `pnpm -r build`
- `pnpm test`
  - runs tests across packages when present
- `pnpm dev`
  - starts the web app
- `pnpm start`
  - starts the agent CLI
- `pnpm analyze`
  - same as `pnpm start`
- `pnpm bootup`
  - runs only the splash animation

## Package-Level Commands

### Agent

```bash
pnpm --filter @dolph/agent build
pnpm --filter @dolph/agent start
pnpm --filter @dolph/agent start:headless
pnpm --filter @dolph/agent dev
pnpm --filter @dolph/agent test
pnpm --filter @dolph/agent typecheck
```

### Bootup

```bash
pnpm --filter @dolph/bootup build
pnpm --filter @dolph/bootup start
pnpm --filter @dolph/bootup dev
```

### SEC server

```bash
pnpm --filter @dolph/mcp-sec-server build
pnpm --filter @dolph/mcp-sec-server start
pnpm --filter @dolph/mcp-sec-server dev
pnpm --filter @dolph/mcp-sec-server typecheck
```

### Financials server

```bash
pnpm --filter @dolph/mcp-financials-server build
pnpm --filter @dolph/mcp-financials-server start
pnpm --filter @dolph/mcp-financials-server dev
pnpm --filter @dolph/mcp-financials-server test
pnpm --filter @dolph/mcp-financials-server typecheck
```

### Web

```bash
pnpm --filter @dolph/web dev
pnpm --filter @dolph/web build
pnpm --filter @dolph/web start
```

## CLI Features

The interactive CLI currently supports:

- Analyze a Company
- Compare Companies
- Search SEC Filings
- Resolve Ticker (`/map`)
- Settings

The CLI entrypoint is:

- [packages/agent/src/cli.ts](/Users/shawyant/Documents/projs/fagent/packages/agent/src/cli.ts)

### Analyze flow

The analyze flow prompts for:

- ticker
- output format: `Terminal`, `PDF`, or `Both`
- optional snapshot date

Then it:

- resolves the ticker
- runs bootup
- runs the pipeline
- optionally generates PDF
- optionally exports CSV

### Compare flow

The compare flow prompts for:

- 2 to 5 tickers
- output format
- optional snapshot date

Compare mode uses screening comparison policy by default:

- `mode: screening`
- `comparisonBasisMode: latest_per_peer_with_prominent_disclosure`
- `comparisonRequireOverlap: false`

### Search flow

The SEC search tool supports:

- free-text search
- optional ticker filter
- date range
- preview filing text
- download filing text to `reports/filings`
- browser open of filing URLs

## Programmatic API

The agent package exports:

- `runPipeline`
- `generatePDF`
- `exportCSV`
- `buildFinancialStatementsSection`
- `buildKeyMetricsSection`

From:

- [packages/agent/src/index.ts](/Users/shawyant/Documents/projs/fagent/packages/agent/src/index.ts)

Example:

```ts
import { runPipeline, generatePDF, exportCSV } from '@dolph/agent';
```

## Report States

Reports can resolve into different product states:

- `full`
- `limited_coverage`
- `unsupported_coverage`

That distinction matters:

- `full`: canonical annual analysis succeeded
- `limited_coverage`: some filing data exists, but full annual reconstruction was not trustworthy
- `unsupported_coverage`: current SEC/XBRL path could not support the issuer

## Current Report Structure

Dolph preserves a fixed research-note style structure.

The main report sections include:

- cover / header block
- executive summary
- snapshot scorecard
- visual highlights
- key metrics dashboard
- commentary
- appendix financial statements
- sources

The appendix remains evidence-heavy and statement-grounded.

## Validation and QA

Deterministic QA is the authoritative internal quality gate.

It validates:

- cross-section consistency
- no fake missing values
- accounting identities
- statement coherence
- debt and liquidity reliability
- narrative consistency with canonical metrics
- comparison basis rules
- render/layout constraints

When possible, Dolph repairs, suppresses, downgrades, or excludes instead of surfacing a brittle backend failure.

## Tests

Current test entrypoints include:

- analyzer tests
- deterministic QA tests
- report integrity tests
- report governance tests
- exporter period banner tests
- financial ratio tests

Root test command:

```bash
pnpm test
```

Agent test command:

```bash
pnpm --filter @dolph/agent test
```

## MCP Usage

Both MCP servers are usable outside Dolph as standalone components.

See:

- [packages/mcp-sec-server/README.md](/Users/shawyant/Documents/projs/fagent/packages/mcp-sec-server/README.md)
- [packages/mcp-financials-server/README.md](/Users/shawyant/Documents/projs/fagent/packages/mcp-financials-server/README.md)

This means the SEC and financial layers can also be wired into:

- Claude Desktop
- Cursor
- other MCP-capable clients

## Notes on the Current Web Package

The current [packages/web/README.md](/Users/shawyant/Documents/projs/fagent/packages/web/README.md) is still mostly the default Next.js scaffold. The real product behavior is driven by the workspace packages, especially `@dolph/agent`, `@dolph/mcp-sec-server`, and `@dolph/mcp-financials-server`.

## Recommended Starting Commands

If you want the shortest path to a working local setup:

```bash
pnpm install
cp .env.example .env
# set DOLPH_SEC_USER_AGENT and optional provider keys
pnpm build
pnpm --filter @dolph/agent start
```

If you want the web app:

```bash
pnpm dev
```

If you want only the bootup animation:

```bash
pnpm bootup
```

## License

MIT
