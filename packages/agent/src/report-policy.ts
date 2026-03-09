import type {
  NarrativeGovernanceMode,
  ReportingMode,
  ReportingPolicy,
} from '@dolph/shared';
import type { PipelineConfig } from './types.js';

export const INSTITUTIONAL_DEFAULTS: ReportingPolicy = {
  mode: 'institutional',
  comparisonBasisMode: 'latest_per_peer_with_prominent_disclosure',
  requestedComparisonBasisMode: 'latest_per_peer_with_prominent_disclosure',
  statementHistoryPeriods: 5,
  trendHistoryPeriods: 10,
  returnMetricBasisMode: 'average_balance',
  sparseDerivationMode: 'expanded',
  strictLayoutQA: true,
  persistAuditArtifacts: true,
  narrativeGovernanceMode: 'deterministic',
  allowExternalContext: false,
  comparisonRequireOverlap: false,
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
    comparisonRequireOverlap: false,
  };

  return merged;
}

