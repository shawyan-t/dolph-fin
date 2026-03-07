import type {
  ComparisonBasisMode,
  NarrativeGovernanceMode,
  ReportingMode,
  ReportingPolicy,
} from '@dolph/shared';
import type { PipelineConfig } from './types.js';

export const INSTITUTIONAL_DEFAULTS: ReportingPolicy = {
  mode: 'institutional',
  comparisonBasisMode: 'overlap_normalized',
  requestedComparisonBasisMode: 'overlap_normalized',
  statementHistoryPeriods: 5,
  trendHistoryPeriods: 10,
  returnMetricBasisMode: 'average_balance',
  sparseDerivationMode: 'expanded',
  strictLayoutQA: true,
  persistAuditArtifacts: true,
  narrativeGovernanceMode: 'deterministic',
  allowExternalContext: false,
  comparisonRequireOverlap: true,
  comparisonFallbackMode: null,
  comparisonMaxPeriodSpreadDays: 45,
  metricNAInference: 'governed',
  displayDerivedLabels: true,
  percentMeaningfulBase: 0.05,
};

export const SCREENING_DEFAULTS: ReportingPolicy = {
  mode: 'screening',
  comparisonBasisMode: 'latest_per_peer_with_prominent_disclosure',
  requestedComparisonBasisMode: 'latest_per_peer_with_prominent_disclosure',
  statementHistoryPeriods: 5,
  trendHistoryPeriods: 10,
  returnMetricBasisMode: 'average_balance',
  sparseDerivationMode: 'expanded',
  strictLayoutQA: false,
  persistAuditArtifacts: true,
  narrativeGovernanceMode: 'deterministic',
  allowExternalContext: false,
  comparisonRequireOverlap: false,
  comparisonFallbackMode: 'latest_per_peer_with_prominent_disclosure',
  comparisonMaxPeriodSpreadDays: 45,
  metricNAInference: 'governed',
  displayDerivedLabels: true,
  percentMeaningfulBase: 0.05,
};

export function resolveReportingPolicy(config: PipelineConfig): ReportingPolicy {
  const baseMode: ReportingMode = config.policy?.mode || 'institutional';
  const base = baseMode === 'screening' ? SCREENING_DEFAULTS : INSTITUTIONAL_DEFAULTS;
  const requestedNarrativeMode: NarrativeGovernanceMode =
    config.narrativeMode === 'llm' ? 'structured_llm' : (config.policy?.narrativeGovernanceMode || base.narrativeGovernanceMode);

  const merged: ReportingPolicy = {
    ...base,
    ...config.policy,
    requestedComparisonBasisMode: config.policy?.comparisonBasisMode || base.comparisonBasisMode,
    narrativeGovernanceMode: requestedNarrativeMode,
  };

  if (merged.mode === 'institutional') {
    merged.strictLayoutQA = config.policy?.strictLayoutQA ?? true;
    merged.comparisonFallbackMode = null;
    if (merged.comparisonBasisMode === 'latest_per_peer_screening') {
      merged.comparisonBasisMode = 'latest_per_peer_with_prominent_disclosure';
    }
  }

  if (config.type !== 'comparison') {
    merged.comparisonRequireOverlap = false;
  } else if (merged.comparisonBasisMode === 'overlap_normalized') {
    merged.comparisonRequireOverlap = true;
  }

  return merged;
}

export function comparisonBasisLabel(mode: ComparisonBasisMode): string {
  switch (mode) {
    case 'overlap_normalized':
      return 'Overlap-normalized annual basis';
    case 'latest_per_peer_screening':
      return 'Latest annual per peer (screening)';
    case 'latest_per_peer_with_prominent_disclosure':
      return 'Latest annual per peer (disclosed)';
  }
}

export function comparisonBasisDescription(policy: ReportingPolicy): string {
  switch (policy.comparisonBasisMode) {
    case 'overlap_normalized':
      return 'Peer metrics are locked to shared comparable annual periods across all companies.';
    case 'latest_per_peer_screening':
      return 'Peer metrics use each company’s latest annual filing and are suitable only for screening, not strict like-for-like comparison.';
    case 'latest_per_peer_with_prominent_disclosure':
      return 'Peer metrics use each company’s latest annual filing with explicit disclosure that fiscal periods may not be synchronized.';
  }
}

export function isInstitutionalComparison(policy: ReportingPolicy): boolean {
  return policy.mode === 'institutional' && policy.comparisonBasisMode === 'overlap_normalized';
}
