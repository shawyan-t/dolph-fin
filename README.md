# Dolph Research

Dolph is a workspace for SEC/EDGAR filing analysis.

It has two main surfaces:
- a CLI for running filing analysis, company comparisons, SEC filing search, and ticker resolution
- a Next.js web app that exposes the same core workflows in a browser

The project is filing-first. It pulls SEC data, normalizes it, computes report metrics, generates reports, and can export PDFs, CSV data, and filing bundles.

## What It Does

- Analyze a single company from SEC/EDGAR data
- Compare multiple companies
- Search SEC filings
- Resolve a ticker or company name to an SEC entity
- Generate report PDFs
- Export report data to CSV
- Preview and download filing assets from SEC filing directories

## Workspace Structure

`packages/agent`
- Main CLI
- Analysis pipeline
- PDF export
- CSV export
- Datawrapper chart rendering

`packages/web`
- Next.js web app
- Browser UI for analyze, compare, search, and resolve

`packages/mcp-sec-server`
- SEC/EDGAR access
- Filing search
- Company facts and statement retrieval
- Filing directory preview/download helpers

`packages/mcp-financials-server`
- Financial math and ratio helpers
- Trend analysis and normalization utilities

`packages/shared`
- Shared types, constants, mappings, and formatting helpers

`packages/bootup`
- CLI splash / startup animation

## Project Structure

```text
dolph/
├── docs/                       # Project docs
├── packages/
│   ├── agent/                  # Main analysis pipeline, report generation, CLI
│   ├── bootup/                 # Terminal splash animation
│   ├── mcp-financials-server/  # Financial math, ratios, trends, normalization helpers
│   ├── mcp-sec-server/         # SEC EDGAR retrieval, filing search, XBRL and filing assets
│   ├── shared/                 # Shared types, constants, mappings, formatting
│   └── web/                    # Next.js web app
├── .env.example                # Local environment template
├── package.json                # Root scripts
├── pnpm-workspace.yaml         # Workspace definition
└── tsconfig.base.json          # Shared TypeScript config

```
## Application Structure

```text
                           ┌──────────────────────┐
                           │      User Input      │
                           │  CLI or Web Request  │
                           └──────────┬───────────┘
                                      │
                    ┌─────────────────┴─────────────────┐
                    │                                   │
          ┌─────────▼─────────┐               ┌─────────▼─────────┐
          │   CLI Interface   │               │   Web Interface   │
          │ packages/agent    │               │  packages/web     │
          └─────────┬─────────┘               └─────────┬─────────┘
                    │                                   │
                    └─────────────────┬─────────────────┘
                                      │
                           ┌──────────▼──────────┐
                           │  Analysis Pipeline  │
                           │  packages/agent     │
                           │  runPipeline()      │
                           └──────────┬──────────┘
                                      │
                ┌─────────────────────┼─────────────────────┐
                │                     │                     │
      ┌─────────▼─────────┐ ┌────────▼────────┐ ┌─────────▼─────────┐
      │   SEC Retrieval   │ │ Financial Math  │ │ Shared Contracts  │
      │ mcp-sec-server    │ │ mcp-financials  │ │ shared            │
      │ filings, facts,   │ │ ratios, trends, │ │ types, mappings,  │
      │ XBRL, directories │ │ normalization   │ │ constants, format │
      └─────────┬─────────┘ └────────┬────────┘ └─────────┬─────────┘
                │                    │                    │
                └────────────────────┴──────────────┬─────┘
                                                   │
                                      ┌────────────▼────────────┐
                                      │ Canonical Report Model  │
                                      │ metrics, sections,      │
                                      │ statements, charts      │
                                      └────────────┬────────────┘
                                                   │
                          ┌────────────────────────┼────────────────────────┐
                          │                        │                        │
                ┌─────────▼─────────┐    ┌────────▼────────┐    ┌─────────▼─────────┐
                │   Terminal View   │    │   PDF / Charts  │    │    CSV Exports    │
                │ CLI output        │    │ exporter + DW   │    │ data + chart_data │
                └───────────────────┘    └─────────────────┘    └───────────────────┘
```

## How It Works

High-level flow:

1. Resolve the ticker or entity
2. Fetch SEC data
3. Normalize statements and facts
4. Build the analysis context
5. Generate report sections
6. Validate the report
7. Optionally render PDF and charts
8. Optionally export CSV data

The CLI and website both rely on the same analysis/reporting packages. The web app is not a separate analysis engine.

## Setup

Requirements:
- Node.js 20+
- pnpm 10+

Install:

```bash
pnpm install
```

Create a local env file:

```bash
cp .env.example .env
```

Minimum required setting:

```env
DOLPH_SEC_USER_AGENT="Your Name your@email.com"
```

Optional keys:

```env
DOLPH_LLM_PROVIDER=openai
DOLPH_LLM_MODEL=gpt-4o-mini
DOLPH_OPENAI_API_KEY=
DOLPH_GEMINI_API_KEY=
DOLPH_GROQ_API_KEY=
DATAWRAPPER_API_KEY=
```

Other useful settings:

```env
DOLPH_CACHE_DIR=~/.dolph/cache
DOLPH_MAX_RETRIES=2
DOLPH_MAX_VALIDATION_LOOPS=2
```

## Running It

Root commands:

```bash
pnpm dev
pnpm start
pnpm build
pnpm test
```

What they do:

`pnpm dev`
- starts the web app (`packages/web`)

`pnpm start`
- starts the CLI (`packages/agent`)

`pnpm build`
- builds all workspace packages

`pnpm test`
- runs package test suites that define a `test` script

Direct package commands:

```bash
pnpm --filter @dolph/web dev
pnpm --filter @dolph/agent start
pnpm --filter @dolph/agent build
pnpm --filter @dolph/mcp-sec-server build
```

## CLI

Start the CLI:

```bash
pnpm start
```

Current menu:
- Analyze a Company
- Compare Companies
- Search SEC Filings
- Resolve Ticker (/map)
- Settings

The CLI can:
- print reports in the terminal
- generate PDFs
- export CSV data
- preview filing files
- download filing data bundles from SEC filing directories

When the `@dolph/agent` package is installed or linked as a CLI package, the binary name is:

```bash
dolph
```

## Website

Start the web app:

```bash
pnpm --filter @dolph/web dev
```

Default local URL:

```text
http://localhost:3000
```

Current web workflows:
- Analyze Company
- Compare Companies
- Search SEC Filings
- Resolve Ticker


## Outputs

By default, local repo runs write outputs under:

- `packages/agent/reports`

Typical outputs include:
- PDF reports
- report CSVs
- chart-ready CSVs
- SEC filing ZIP bundles
- audit artifacts for generated reports

## CSV Exports

Current export shape:

- `*_data.csv`
  - full combined report data export
- `*_chart_data/`
  - chart-specific CSV files used for visualizations

The chart-data directory contains one chart-ready CSV per chart instead of one large mixed export.

## SEC Filing Search

Search SEC Filings supports:
- search results
- opening a filing in the browser
- previewing previewable files from the filing directory
- downloading a ZIP bundle of filing assets from the filing directory

The intended model is:
- use the real SEC filing directory as the source of truth
- list actual files in that directory
- preview only previewable files
- bundle listed filing assets into a ZIP

## Charts

Charts are prepared from canonical report data and rendered through Datawrapper when `DATAWRAPPER_API_KEY` is set.

Current chart flow:
- Get Data from SEC EDGAR
- Organize data into chart-ready files
- render through Datawrapper

## Use Cases

- research a public company from SEC filings
- compare peers using SEC-based data
- inspect a filing directory and download its assets
- generate PDFs and CSV exports for internal analysis
- use the web app as a browser interface to the same underlying CLI/reporting engine

## Notes

- The codebase currently assumes SEC access through a valid `DOLPH_SEC_USER_AGENT`
- The web app and CLI share core logic, but they have different UI layers
- Datawrapper is optional; reports still run without it, but chart rendering depends on its API key

## License

MIT. See [LICENSE](/Users/shawyant/Documents/projs/fagent/LICENSE).
