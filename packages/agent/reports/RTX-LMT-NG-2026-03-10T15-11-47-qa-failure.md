# QA Failure Report — RTX, LMT, NG

Generated at: 2026-03-10T15:11:47.537Z
Report ID: fl_mmkr09vt_gv03z0

## Period Basis
- RTX: current=2025-12-31, prior=2024-12-31 (Peer figures use each company’s latest annual filing with prominent disclosure that fiscal periods can differ across peers.)
- LMT: current=2025-12-31, prior=2024-12-31 (Peer figures use each company’s latest annual filing with prominent disclosure that fiscal periods can differ across peers.)
- NG: current=2025-11-30, prior=2024-11-30 (Peer figures use each company’s latest annual filing with prominent disclosure that fiscal periods can differ across peers.)

## Mapping Fixes / Signals
- LMT: Gross profit mapping check failed — Gross profit ($7.62B) is below operating income ($7.73B). Gross-margin metrics were excluded.

## Metrics Computed (previously missing-sensitive)
- RTX: Free Cash Flow (prior), Diluted EPS (prior), Book Value Per Share (prior)
- LMT: Free Cash Flow (prior), Diluted EPS (prior), Book Value Per Share (prior)
- NG: Free Cash Flow (prior), Diluted EPS (prior), Book Value Per Share (prior)

## Validation Failures
- [ERROR] [data.sanity] LMT:income_statement: Gross profit is below operating income.
- [ERROR] [data.no_fake_na] comparison:LMT:Gross Margin: Metric missing despite all current-period inputs existing.
- [ERROR] [data.no_fake_na] comparison:NG:Operating Margin: Metric missing despite all current-period inputs existing.
- [ERROR] [data.no_fake_na] comparison:NG:Net Margin: Metric missing despite all current-period inputs existing.
