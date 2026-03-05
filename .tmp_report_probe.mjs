import { runPipeline } from './packages/agent/dist/pipeline.js';

const result = await runPipeline({
  tickers: ['GOOG'],
  type: 'single',
  maxRetries: 2,
  maxValidationLoops: 0,
  narrativeMode: 'deterministic',
  snapshotDate: '2026-03-05',
}, undefined, {
  onStep(step,status,detail){ if(status==='error') console.log('STEP_ERROR',step,detail||''); }
});

const key = result.report.sections.find(s => s.id==='key_metrics');
const fin = result.report.sections.find(s => s.id==='financial_statements');
console.log('KEY_METRICS_START');
console.log(key?.content || 'MISSING');
console.log('KEY_METRICS_END');
console.log('FIN_STMT_HEAD');
console.log((fin?.content || '').split('\n').slice(0,40).join('\n'));
console.log('FIN_STMT_HEAD_END');
