# Dolph Reporting Governance

This document describes the governed reporting architecture for `analyze company` and `compare companies`.

## Policy Model

The policy model is resolved in [packages/agent/src/report-policy.ts](/Users/shawyant/Documents/projs/fagent/packages/agent/src/report-policy.ts) and persisted into the report and audit package.

Key policy controls:

- `mode`
  - `institutional`
  - `screening`
- `comparisonBasisMode`
  - `overlap_normalized`
  - `latest_per_peer_screening`
  - `latest_per_peer_with_prominent_disclosure`
- `returnMetricBasisMode`
  - `average_balance`
  - `ending_balance`
- `sparseDerivationMode`
  - `standard`
  - `expanded`
- `strictLayoutQA`
- `persistAuditArtifacts`
- `narrativeGovernanceMode`
  - `deterministic`
  - `structured_llm`

Institutional mode defaults to:

- overlap-normalized comparison basis
- average-balance return metrics
- expanded sparse derivation
- strict layout QA
- persisted audit artifacts

## Canonical Ledger

The single source of truth is built from:

- SEC/EDGAR company facts
- deterministic statement extraction
- governed deterministic derivations

Core modules:

- [packages/agent/src/report-facts.ts](/Users/shawyant/Documents/projs/fagent/packages/agent/src/report-facts.ts)
- [packages/agent/src/analyzer.ts](/Users/shawyant/Documents/projs/fagent/packages/agent/src/analyzer.ts)
- [packages/agent/src/report-model.ts](/Users/shawyant/Documents/projs/fagent/packages/agent/src/report-model.ts)

Every displayed metric is carried with:

- period lock
- availability reason
- basis metadata
- display-normalized value
- provenance or derivation context

## Period Governance

Standalone reports:

- use policy-driven history depth
- lock one current and one prior annual basis

Comparison reports:

- use the same policy-driven history depth as standalone reports
- default to overlap-normalized periods in institutional mode
- fail institutional QA if shared annual overlap does not exist
- may degrade to screening only when policy explicitly allows it

Relevant logic:

- [packages/agent/src/planner.ts](/Users/shawyant/Documents/projs/fagent/packages/agent/src/planner.ts)
- [packages/agent/src/analyzer.ts](/Users/shawyant/Documents/projs/fagent/packages/agent/src/analyzer.ts)
- [packages/agent/src/deterministic-qa.ts](/Users/shawyant/Documents/projs/fagent/packages/agent/src/deterministic-qa.ts)

## Share and Return Basis

Per-share metrics declare basis explicitly.

Current supported basis types:

- `period_end_shares`
- `ending_diluted_shares`
- `weighted_average_basic`
- `weighted_average_diluted`
- `cross_validated_fallback`

Return metrics use policy-driven basis:

- institutional default: `average_balance`

Relevant logic:

- [packages/agent/src/analyzer.ts](/Users/shawyant/Documents/projs/fagent/packages/agent/src/analyzer.ts)
- [packages/agent/src/metrics-builder.ts](/Users/shawyant/Documents/projs/fagent/packages/agent/src/metrics-builder.ts)
- [packages/agent/src/statements-builder.ts](/Users/shawyant/Documents/projs/fagent/packages/agent/src/statements-builder.ts)

## Sparse-Filer Derivation

Expanded sparse derivations currently include:

- total debt from long-term + short-term debt
- debt split from total debt and one component
- free cash flow from CFO and CapEx
- revenue / gross profit / cost of revenue triangle
- operating expenses from gross profit and operating income
- depreciation and amortization reconciliation
- total liabilities from assets and equity
- stockholders' equity from assets and liabilities
- total assets from liabilities and equity
- cash and equivalents from ending cash when balance-sheet cash is absent
- current assets from summed current-asset components
- current liabilities from summed current-liability components

These derivations are deterministic and provenance-tagged as derived.

## Narrative Governance

Narrative is governed in two modes:

- `deterministic`
  - all narrative is code-generated
- `structured_llm`
  - the executive summary is generated via schema-constrained JSON
  - every paragraph must carry fact IDs
  - unsupported fact IDs fail QA

Relevant modules:

- [packages/agent/src/narrator.ts](/Users/shawyant/Documents/projs/fagent/packages/agent/src/narrator.ts)
- [packages/agent/src/prompts/narrative.ts](/Users/shawyant/Documents/projs/fagent/packages/agent/src/prompts/narrative.ts)
- [packages/agent/src/deterministic-qa.ts](/Users/shawyant/Documents/projs/fagent/packages/agent/src/deterministic-qa.ts)

External world-event context is not currently source-governed. Policy defaults therefore disable it.

## Audit Artifacts

Successful PDF runs write an audit package beside the PDF.

Current required artifacts:

- `policy-manifest.json`
- `period-basis-manifest.json`
- `report-model.json`
- `canonical-ledger.json`
- `metric-availability.json`
- `derived-metrics-manifest.json`
- `source-manifest.json`
- `comparison-basis-manifest.json`
- `qa-result.json`
- `narrative-payload.json`
- `narrative-validation.json`
- `warnings-manifest.json`
- `layout-qa-report.json` (`status: completed` after render, `status: not_run` for pre-render audit packages)
- `render-manifest.json`
- `report-metadata.json`

Relevant module:

- [packages/agent/src/audit-artifacts.ts](/Users/shawyant/Documents/projs/fagent/packages/agent/src/audit-artifacts.ts)

## QA Framework

Deterministic QA validates:

- cross-section equality
- no-fake-N/A conditions
- balance-sheet reconciliation
- FCF reconciliation
- D&A subtotal/component reconciliation
- debt completeness
- outflow sign conventions
- share-basis labeling
- comparison-basis policy compliance
- narrative fact support
- narrative threshold alignment
- layout gates

Institutional mode treats layout QA as blocking by default.

## Rendering Guarantees

Rendering is policy-aware and basis-aware.

Current governed rendering behavior:

- comparison basis disclosure is surfaced on comparison reports
- metric availability is no longer collapsed blindly into `N/A`
- statement rows can be labeled as derived or reported/reconciled
- contra-equity formatting is normalized in the statement model
- audit artifacts are persisted on successful renders

## Current Limitation

External catalyst synthesis remains intentionally disabled unless a first-class, source-governed external context adapter is added. The current institutional path is SEC/EDGAR-driven and should be interpreted that way.
